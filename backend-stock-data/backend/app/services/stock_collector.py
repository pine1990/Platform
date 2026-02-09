# backend/app/services/stock_collector.py
"""
주식 데이터 수집 서비스
- FinanceDataReader: 일봉 OHLCV (수정주가)
- pykrx: 거래대금, 시가총액, 상장주식수

사용법:
    collector = StockCollector(db_session)
    await collector.sync_company_listing()         # 종목 마스터 갱신
    await collector.sync_prices("005930", "2024-01-01")  # 개별 종목
    await collector.sync_all_prices("2024-01-01")  # 전 종목
"""

import asyncio
import logging
from datetime import datetime, date, timedelta
from typing import Optional

import FinanceDataReader as fdr
from pykrx import stock as pykrx_stock

from sqlalchemy import select, and_
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.stock import Company, StockPrice, StockSyncLog

logger = logging.getLogger(__name__)

# pykrx는 동기 라이브러리이므로 thread pool에서 실행
from concurrent.futures import ThreadPoolExecutor

_thread_pool = ThreadPoolExecutor(max_workers=4)


def _run_sync(func, *args, **kwargs):
    """동기 함수를 asyncio에서 실행"""
    import functools
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(_thread_pool, functools.partial(func, *args, **kwargs))


# ─── pykrx 날짜 포맷 변환 ────────────────────────────────────
def _to_pykrx_date(d) -> str:
    """date/str → 'YYYYMMDD' 포맷"""
    if isinstance(d, date):
        return d.strftime("%Y%m%d")
    return str(d).replace("-", "")[:8]


def _to_iso_date(d) -> str:
    """date/str → 'YYYY-MM-DD' 포맷"""
    if isinstance(d, date):
        return d.isoformat()
    s = str(d).replace("-", "")[:8]
    return f"{s[:4]}-{s[4:6]}-{s[6:8]}"


# ═══════════════════════════════════════════════════════════════
# StockCollector
# ═══════════════════════════════════════════════════════════════
class StockCollector:
    """
    주식 데이터 수집기.

    수집 흐름:
    1. sync_company_listing() → companies 테이블 갱신
    2. sync_prices(code, start) → 개별 종목 일봉 수집
    3. sync_all_prices(start) → 전 종목 일봉 수집
    """

    def __init__(self, db: AsyncSession):
        self.db = db

    # ─── 1. 종목 마스터 동기화 ────────────────────────────────
    async def sync_company_listing(self) -> dict:
        """
        KRX 상장 종목 마스터를 companies 테이블에 동기화.
        FDR StockListing으로 KOSPI + KOSDAQ 전체 조회.
        """
        log = StockSyncLog(sync_type="LISTING", status="STARTED")
        self.db.add(log)
        await self.db.flush()

        try:
            # FDR은 동기 라이브러리
            krx_df = await _run_sync(fdr.StockListing, "KRX")

            if krx_df is None or krx_df.empty:
                raise ValueError("KRX 종목 리스트를 가져오지 못했습니다")

            log.target_count = len(krx_df)
            synced = 0
            errors = 0

            for _, row in krx_df.iterrows():
                try:
                    code = str(row.get("Code", row.name)).strip()
                    if not code or len(code) != 6:
                        continue

                    name = str(row.get("Name", "")).strip()
                    market = str(row.get("Market", "")).strip()
                    sector = str(row.get("Sector", "")).strip() if "Sector" in row else None
                    industry = str(row.get("Industry", "")).strip() if "Industry" in row else None

                    stmt = pg_insert(Company).values(
                        stock_code=code,
                        name=name,
                        market=market,
                        sector=sector or None,
                        industry=industry or None,
                        is_active=True,
                    ).on_conflict_do_update(
                        index_elements=["stock_code"],
                        set_=dict(
                            name=name,
                            market=market,
                            sector=sector or None,
                            industry=industry or None,
                            is_active=True,
                            updated_at=datetime.utcnow(),
                        ),
                    )
                    await self.db.execute(stmt)
                    synced += 1
                except Exception as e:
                    errors += 1
                    logger.warning(f"종목 저장 실패 {row.get('Code', '?')}: {e}")

            await self.db.commit()

            log.synced_count = synced
            log.error_count = errors
            log.status = "SUCCESS"
            log.finished_at = datetime.utcnow()
            await self.db.commit()

            logger.info(f"종목 마스터 동기화 완료: {synced}개 저장, {errors}개 오류")
            return {"synced": synced, "errors": errors, "total": log.target_count}

        except Exception as e:
            log.status = "FAILED"
            log.error_message = str(e)[:500]
            log.finished_at = datetime.utcnow()
            await self.db.commit()
            logger.error(f"종목 마스터 동기화 실패: {e}")
            raise

    # ─── 2. 개별 종목 일봉 수집 ───────────────────────────────
    async def sync_prices(
        self,
        stock_code: str,
        start_date: str = "2024-01-01",
        end_date: Optional[str] = None,
    ) -> dict:
        """
        개별 종목의 일봉 데이터를 수집하여 stock_prices에 저장.

        데이터 소스:
        - FDR: OHLCV (수정주가), 등락률
        - pykrx get_market_ohlcv_by_date: 거래대금
        - pykrx get_market_cap: 시가총액, 상장주식수
        """
        if end_date is None:
            end_date = date.today().isoformat()

        # 1) company_id 조회
        result = await self.db.execute(
            select(Company).where(Company.stock_code == stock_code)
        )
        company = result.scalar_one_or_none()
        if not company:
            raise ValueError(f"종목 {stock_code}이 companies 테이블에 없습니다. sync_company_listing() 먼저 실행하세요.")

        # 2) FDR에서 OHLCV 가져오기
        ohlcv_df = await _run_sync(fdr.DataReader, stock_code, start_date, end_date)
        if ohlcv_df is None or ohlcv_df.empty:
            logger.warning(f"{stock_code}: FDR OHLCV 데이터 없음")
            return {"stock_code": stock_code, "synced": 0}

        # 3) pykrx에서 거래대금 가져오기
        p_start = _to_pykrx_date(start_date)
        p_end = _to_pykrx_date(end_date)

        try:
            pykrx_ohlcv = await _run_sync(
                pykrx_stock.get_market_ohlcv_by_date, p_start, p_end, stock_code
            )
        except Exception as e:
            logger.warning(f"{stock_code}: pykrx OHLCV 실패 ({e}), 거래대금 없이 진행")
            pykrx_ohlcv = None

        # 4) pykrx에서 시가총액 가져오기
        try:
            # get_market_cap는 개별 종목 기간 조회 불가 → 일별 전 종목 조회
            # 대신 일봉 날짜별로 한번에 가져오기는 비효율적이므로,
            # 최근 거래일 시총만 가져와서 캐시
            today_str = _to_pykrx_date(date.today())
            cap_df = await _run_sync(
                pykrx_stock.get_market_cap, today_str, market="ALL"
            )
        except Exception as e:
            logger.warning(f"시가총액 조회 실패: {e}")
            cap_df = None

        # 5) 데이터 병합 및 저장
        synced = 0
        pykrx_tv_map = {}   # date → 거래대금
        if pykrx_ohlcv is not None and not pykrx_ohlcv.empty:
            for idx, row in pykrx_ohlcv.iterrows():
                d = idx.date() if hasattr(idx, 'date') else idx
                tv = row.get("거래대금", None)
                if tv is not None:
                    pykrx_tv_map[d] = int(tv)

        # 시가총액: cap_df에서 해당 종목 조회
        latest_market_cap = None
        latest_listed_shares = None
        if cap_df is not None and not cap_df.empty:
            if stock_code in cap_df.index:
                cap_row = cap_df.loc[stock_code]
                latest_market_cap = int(cap_row.get("시가총액", 0)) or None
                latest_listed_shares = int(cap_row.get("상장주식수", 0)) or None

        rows_to_upsert = []
        for idx, row in ohlcv_df.iterrows():
            trade_dt = idx.date() if hasattr(idx, 'date') else idx

            # FDR 기본 데이터
            o = int(row.get("Open", 0))
            h = int(row.get("High", 0))
            l = int(row.get("Low", 0))
            c = int(row.get("Close", 0))
            v = int(row.get("Volume", 0))
            chg = float(row.get("Change", 0)) * 100 if "Change" in row else None

            # pykrx 거래대금 매칭
            tv = pykrx_tv_map.get(trade_dt)

            if o == 0 and h == 0 and c == 0:
                continue  # 거래 정지일 스킵

            rows_to_upsert.append(dict(
                company_id=company.id,
                trade_date=trade_dt,
                open=o,
                high=h,
                low=l,
                close=c,
                volume=v,
                change_pct=round(chg, 4) if chg is not None else None,
                trading_value=tv,
                market_cap=latest_market_cap,       # 일별 시총은 비용이 크므로 최신값 사용
                listed_shares=latest_listed_shares,
            ))

        # Batch upsert (50개씩)
        batch_size = 50
        for i in range(0, len(rows_to_upsert), batch_size):
            batch = rows_to_upsert[i:i + batch_size]
            stmt = pg_insert(StockPrice).values(batch)
            stmt = stmt.on_conflict_do_update(
                constraint="uq_stock_prices_company_date",
                set_=dict(
                    open=stmt.excluded.open,
                    high=stmt.excluded.high,
                    low=stmt.excluded.low,
                    close=stmt.excluded.close,
                    volume=stmt.excluded.volume,
                    change_pct=stmt.excluded.change_pct,
                    trading_value=stmt.excluded.trading_value,
                    market_cap=stmt.excluded.market_cap,
                    listed_shares=stmt.excluded.listed_shares,
                ),
            )
            await self.db.execute(stmt)
            synced += len(batch)

        # 6) companies 테이블의 시가총액 캐시 업데이트
        if latest_market_cap:
            company.market_cap = latest_market_cap
            company.updated_at = datetime.utcnow()

        await self.db.commit()

        logger.info(f"{stock_code} ({company.name}): {synced}일치 저장 완료")
        return {
            "stock_code": stock_code,
            "name": company.name,
            "synced": synced,
            "has_trading_value": bool(pykrx_tv_map),
            "market_cap": latest_market_cap,
        }

    # ─── 3. 전 종목 일봉 수집 ────────────────────────────────
    async def sync_all_prices(
        self,
        start_date: str = "2024-01-01",
        end_date: Optional[str] = None,
        market: Optional[str] = None,       # KOSPI / KOSDAQ / None=전체
        limit: Optional[int] = None,        # 테스트용 제한
    ) -> dict:
        """
        전 종목 일봉 데이터 수집.
        pykrx 호출 빈도 제한을 위해 종목 간 0.5초 sleep.
        """
        log = StockSyncLog(sync_type="OHLCV", status="STARTED")
        self.db.add(log)
        await self.db.flush()

        try:
            # 대상 종목 조회
            query = select(Company).where(Company.is_active == True)
            if market:
                query = query.where(Company.market == market)
            query = query.order_by(Company.stock_code)
            if limit:
                query = query.limit(limit)

            result = await self.db.execute(query)
            companies = result.scalars().all()
            log.target_count = len(companies)

            total_synced = 0
            total_errors = 0

            for i, comp in enumerate(companies, 1):
                try:
                    result = await self.sync_prices(comp.stock_code, start_date, end_date)
                    total_synced += result.get("synced", 0)

                    if i % 50 == 0:
                        logger.info(f"진행: {i}/{len(companies)} ({comp.stock_code} {comp.name})")

                    # pykrx rate limit 방지
                    await asyncio.sleep(0.5)

                except Exception as e:
                    total_errors += 1
                    logger.warning(f"[{i}/{len(companies)}] {comp.stock_code} 실패: {e}")
                    await asyncio.sleep(1)  # 에러 시 더 기다림

            log.synced_count = total_synced
            log.error_count = total_errors
            log.status = "SUCCESS"
            log.finished_at = datetime.utcnow()
            await self.db.commit()

            logger.info(f"전 종목 수집 완료: {len(companies)}종목, {total_synced}일치, {total_errors}오류")
            return {
                "companies": len(companies),
                "total_synced": total_synced,
                "errors": total_errors,
            }

        except Exception as e:
            log.status = "FAILED"
            log.error_message = str(e)[:500]
            log.finished_at = datetime.utcnow()
            await self.db.commit()
            raise

    # ─── 4. 일별 시가총액 일괄 업데이트 ──────────────────────
    async def sync_market_caps(self, target_date: Optional[str] = None) -> dict:
        """
        특정일의 전 종목 시가총액/거래대금을 일괄 업데이트.
        pykrx get_market_cap() → 전 종목 한번에 조회.
        """
        if target_date is None:
            target_date = date.today().isoformat()

        p_date = _to_pykrx_date(target_date)

        cap_df = await _run_sync(pykrx_stock.get_market_cap, p_date, market="ALL")
        if cap_df is None or cap_df.empty:
            return {"synced": 0, "message": "시가총액 데이터 없음"}

        synced = 0
        for ticker, row in cap_df.iterrows():
            ticker = str(ticker).strip()
            if len(ticker) != 6:
                continue

            mcap = int(row.get("시가총액", 0))
            vol = int(row.get("거래량", 0))
            tv = int(row.get("거래대금", 0))
            listed = int(row.get("상장주식수", 0))

            # companies 테이블의 market_cap 캐시 업데이트
            result = await self.db.execute(
                select(Company).where(Company.stock_code == ticker)
            )
            comp = result.scalar_one_or_none()
            if comp:
                comp.market_cap = mcap
                comp.updated_at = datetime.utcnow()
                synced += 1

        await self.db.commit()
        logger.info(f"시가총액 업데이트: {synced}종목")
        return {"synced": synced, "date": target_date}

    # ─── 5. 증분 수집 (오늘치만) ─────────────────────────────
    async def sync_today(self, market: Optional[str] = None) -> dict:
        """
        당일 데이터만 수집 (스케줄러용).
        장 마감 후(18:00 이후) 실행 권장.
        """
        today = date.today().isoformat()
        yesterday = (date.today() - timedelta(days=7)).isoformat()  # 안전마진

        result = await self.sync_all_prices(
            start_date=yesterday,
            end_date=today,
            market=market,
        )
        # 시가총액도 업데이트
        cap_result = await self.sync_market_caps(today)

        return {
            **result,
            "market_caps_synced": cap_result.get("synced", 0),
        }
