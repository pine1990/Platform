# backend/app/routers/stock.py
"""
주식 데이터 API 엔드포인트

GET  /api/v1/stock/companies                    종목 목록
GET  /api/v1/stock/companies/{code}             종목 상세
GET  /api/v1/stock/prices/{code}                일봉 OHLCV + 거래대금
GET  /api/v1/stock/indicators/{code}            보조지표 계산
GET  /api/v1/stock/indicators/catalog           지표 카탈로그
POST /api/v1/stock/sync/listing                 종목 마스터 동기화
POST /api/v1/stock/sync/prices                  주가 데이터 수집
POST /api/v1/stock/sync/today                   당일 데이터 수집
"""

from datetime import date, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, Query, HTTPException
from pydantic import BaseModel
from sqlalchemy import select, and_, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.models.stock import Company, StockPrice
from app.services.stock_collector import StockCollector
from app.services.technical_indicators import TechnicalIndicatorService

router = APIRouter(prefix="/stock", tags=["Stock Data"])


# ─── Request/Response Models ────────────────────────────────
class SyncPricesRequest(BaseModel):
    stock_code: Optional[str] = None     # None = 전 종목
    start_date: str = "2024-01-01"
    end_date: Optional[str] = None
    market: Optional[str] = None         # KOSPI / KOSDAQ
    limit: Optional[int] = None          # 테스트용

class IndicatorRequest(BaseModel):
    indicators: list[str] = ["MA", "RSI", "MACD", "BB", "OBV"]
    params: Optional[dict] = None        # {"RSI": {"period": 21}}


# ─── 종목 목록 ──────────────────────────────────────────────
@router.get("/companies")
async def list_companies(
    market: Optional[str] = Query(None, description="KOSPI / KOSDAQ"),
    search: Optional[str] = Query(None, description="종목명/코드 검색"),
    limit: int = Query(100, le=3000),
    offset: int = Query(0),
    db: AsyncSession = Depends(get_db),
):
    """상장 종목 목록 조회"""
    query = select(Company).where(Company.is_active == True)

    if market:
        query = query.where(Company.market == market)

    if search:
        query = query.where(
            (Company.name.ilike(f"%{search}%")) |
            (Company.stock_code.ilike(f"%{search}%"))
        )

    # 총 개수
    count_q = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_q)).scalar()

    # 결과
    query = query.order_by(Company.stock_code).offset(offset).limit(limit)
    result = await db.execute(query)
    companies = result.scalars().all()

    return {
        "total": total,
        "companies": [
            {
                "stock_code": c.stock_code,
                "name": c.name,
                "market": c.market,
                "sector": c.sector,
                "market_cap": c.market_cap,
            }
            for c in companies
        ],
    }


# ─── 종목 상세 ──────────────────────────────────────────────
@router.get("/companies/{stock_code}")
async def get_company(stock_code: str, db: AsyncSession = Depends(get_db)):
    """종목 상세 정보"""
    result = await db.execute(
        select(Company).where(Company.stock_code == stock_code)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, f"종목 {stock_code} 없음")

    return {
        "stock_code": company.stock_code,
        "name": company.name,
        "name_en": company.name_en,
        "market": company.market,
        "sector": company.sector,
        "industry": company.industry,
        "listing_date": company.listing_date,
        "market_cap": company.market_cap,
        "is_active": company.is_active,
    }


# ─── 일봉 데이터 ────────────────────────────────────────────
@router.get("/prices/{stock_code}")
async def get_prices(
    stock_code: str,
    start: str = Query(default=None, description="시작일 (YYYY-MM-DD)"),
    end: str = Query(default=None, description="종료일 (YYYY-MM-DD)"),
    limit: int = Query(default=365, le=3000, description="최대 일수"),
    db: AsyncSession = Depends(get_db),
):
    """
    일봉 OHLCV + 거래대금 + 시가총액 조회.
    프론트엔드 캔들스틱 차트 데이터용.
    """
    # 종목 확인
    result = await db.execute(
        select(Company).where(Company.stock_code == stock_code)
    )
    company = result.scalar_one_or_none()
    if not company:
        raise HTTPException(404, f"종목 {stock_code} 없음")

    # 기간 설정
    if end is None:
        end = date.today().isoformat()
    if start is None:
        start = (date.today() - timedelta(days=limit)).isoformat()

    query = (
        select(StockPrice)
        .where(
            and_(
                StockPrice.company_id == company.id,
                StockPrice.trade_date >= start,
                StockPrice.trade_date <= end,
            )
        )
        .order_by(StockPrice.trade_date.asc())
        .limit(limit)
    )

    result = await db.execute(query)
    rows = result.scalars().all()

    return {
        "stock_code": stock_code,
        "name": company.name,
        "market": company.market,
        "count": len(rows),
        "data": [
            {
                "date": r.trade_date.isoformat(),
                "open": r.open,
                "high": r.high,
                "low": r.low,
                "close": r.close,
                "volume": r.volume,
                "trading_value": r.trading_value,
                "market_cap": r.market_cap,
                "change_pct": float(r.change_pct) if r.change_pct else None,
            }
            for r in rows
        ],
    }


# ─── 보조지표 계산 ──────────────────────────────────────────
@router.get("/indicators/{stock_code}")
async def get_indicators(
    stock_code: str,
    indicators: str = Query(
        default="MA,RSI,MACD,BB,OBV",
        description="쉼표로 구분된 지표 목록",
    ),
    start: str = Query(default=None, description="시작일"),
    end: str = Query(default=None, description="종료일"),
    rsi_period: int = Query(default=14, description="RSI 기간"),
    ma_periods: str = Query(default="5,20,60,120", description="MA 기간들"),
    bb_period: int = Query(default=20, description="볼린저 밴드 기간"),
    bb_std: float = Query(default=2.0, description="볼린저 밴드 표준편차"),
    db: AsyncSession = Depends(get_db),
):
    """
    종목의 보조지표 계산 결과 반환.
    프론트엔드 차트 오버레이/서브차트용.
    """
    indicator_list = [x.strip().upper() for x in indicators.split(",") if x.strip()]

    if not indicator_list:
        raise HTTPException(400, "최소 하나의 지표를 지정하세요")

    if start is None:
        start = (date.today() - timedelta(days=365)).isoformat()

    # 사용자 파라미터 빌드
    params_override = {}
    if rsi_period != 14:
        params_override["RSI"] = {"period": rsi_period}
    if ma_periods != "5,20,60,120":
        params_override["MA"] = {
            "periods": [int(x) for x in ma_periods.split(",")]
        }
        params_override["EMA"] = params_override["MA"]
    if bb_period != 20 or bb_std != 2.0:
        params_override["BB"] = {"period": bb_period, "std_dev": bb_std}

    service = TechnicalIndicatorService(db)
    try:
        result = await service.get_indicators(
            stock_code=stock_code,
            indicators=indicator_list,
            start_date=start,
            end_date=end,
            params_override=params_override,
        )
        return result
    except ValueError as e:
        raise HTTPException(404, str(e))


# ─── 지표 카탈로그 ──────────────────────────────────────────
@router.get("/indicators/catalog")
async def indicator_catalog():
    """사용 가능한 기술적 지표 목록과 파라미터 정보"""
    return TechnicalIndicatorService.get_catalog()


# ─── 데이터 동기화 (관리자용) ────────────────────────────────
@router.post("/sync/listing")
async def sync_listing(db: AsyncSession = Depends(get_db)):
    """KRX 종목 마스터 동기화"""
    collector = StockCollector(db)
    result = await collector.sync_company_listing()
    return result


@router.post("/sync/prices")
async def sync_prices(
    req: SyncPricesRequest,
    db: AsyncSession = Depends(get_db),
):
    """주가 데이터 수집 (개별/전체)"""
    collector = StockCollector(db)

    if req.stock_code:
        result = await collector.sync_prices(
            req.stock_code, req.start_date, req.end_date
        )
    else:
        result = await collector.sync_all_prices(
            req.start_date, req.end_date, req.market, req.limit
        )
    return result


@router.post("/sync/today")
async def sync_today(
    market: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """당일 데이터 수집 (스케줄러용)"""
    collector = StockCollector(db)
    result = await collector.sync_today(market)
    return result
