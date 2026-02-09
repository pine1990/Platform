#!/usr/bin/env python3
"""
주식 데이터 수집 CLI / 테스트 스크립트

DB 없이도 데이터 수집/확인 가능.
TA-Lib 설치 전에도 FDR/pykrx 테스트 가능.

사용법:
    # 종목 리스트 확인
    python scripts/collect_stock_data.py listing

    # 개별 종목 일봉 수집 테스트
    python scripts/collect_stock_data.py ohlcv 005930 --start 2024-01-01

    # 거래대금/시가총액 확인
    python scripts/collect_stock_data.py market_cap 005930

    # 보조지표 계산 테스트
    python scripts/collect_stock_data.py indicators 005930 --indicators RSI,MACD,BB

    # 전 종목 일봉 수집 (DB 필요)
    python scripts/collect_stock_data.py sync --start 2024-01-01 --market KOSPI --limit 10
"""

import argparse
import sys
from datetime import date, timedelta

import pandas as pd


def cmd_listing(args):
    """KRX 종목 리스트 조회"""
    import FinanceDataReader as fdr

    market = args.market or "KRX"
    print(f"\n📋 {market} 종목 리스트 조회 중...")

    df = fdr.StockListing(market)
    print(f"   총 {len(df)}개 종목\n")

    # 상위 20개 출력
    cols = ["Name", "Market", "Sector"]
    available_cols = [c for c in cols if c in df.columns]
    print(df[available_cols].head(args.limit or 20).to_string())

    if args.save:
        filename = f"listing_{market}_{date.today().isoformat()}.csv"
        df.to_csv(filename, encoding="utf-8-sig")
        print(f"\n💾 저장: {filename}")


def cmd_ohlcv(args):
    """개별 종목 OHLCV + pykrx 거래대금"""
    import FinanceDataReader as fdr
    from pykrx import stock as pykrx_stock

    code = args.code
    start = args.start or (date.today() - timedelta(days=90)).isoformat()
    end = args.end or date.today().isoformat()

    print(f"\n📈 {code} 일봉 데이터 ({start} ~ {end})")

    # 1) FDR OHLCV
    print("   [FDR] OHLCV 수집 중...")
    fdr_df = fdr.DataReader(code, start, end)
    print(f"   [FDR] {len(fdr_df)}일치 수집 완료")
    print(f"\n   === FDR (수정주가 OHLCV) ===")
    print(fdr_df.tail(10).to_string())

    # 2) pykrx OHLCV (거래대금 포함)
    p_start = start.replace("-", "")
    p_end = end.replace("-", "")
    print(f"\n   [pykrx] 거래대금 수집 중...")
    try:
        pykrx_df = pykrx_stock.get_market_ohlcv_by_date(p_start, p_end, code)
        print(f"   [pykrx] {len(pykrx_df)}일치 수집 완료")
        print(f"\n   === pykrx (거래대금 포함) ===")
        print(pykrx_df.tail(10).to_string())
    except Exception as e:
        print(f"   [pykrx] 실패: {e}")
        pykrx_df = None

    # 3) 데이터 병합 미리보기
    if pykrx_df is not None and not pykrx_df.empty:
        merged = fdr_df.copy()
        merged["거래대금"] = None
        for idx in merged.index:
            d = idx.date() if hasattr(idx, 'date') else idx
            if d in pykrx_df.index:
                merged.loc[idx, "거래대금"] = pykrx_df.loc[d, "거래대금"]
            elif idx in pykrx_df.index:
                merged.loc[idx, "거래대금"] = pykrx_df.loc[idx, "거래대금"]

        print(f"\n   === 병합 결과 (FDR OHLCV + pykrx 거래대금) ===")
        print(merged.tail(10).to_string())

    if args.save:
        filename = f"ohlcv_{code}_{start}_{end}.csv"
        fdr_df.to_csv(filename, encoding="utf-8-sig")
        print(f"\n💾 저장: {filename}")


def cmd_market_cap(args):
    """시가총액, 상장주식수 조회"""
    from pykrx import stock as pykrx_stock

    code = args.code
    target_date = args.date or date.today().isoformat()
    p_date = target_date.replace("-", "")

    print(f"\n🏢 시가총액 조회 ({target_date})")

    if code:
        # 개별 종목
        print(f"   종목: {code}")
        try:
            cap_df = pykrx_stock.get_market_cap(p_date, market="ALL")
            if code in cap_df.index:
                row = cap_df.loc[code]
                print(f"\n   시가총액:   {int(row['시가총액']):>20,}원")
                print(f"   거래량:     {int(row['거래량']):>20,}주")
                print(f"   거래대금:   {int(row['거래대금']):>20,}원")
                print(f"   상장주식수: {int(row['상장주식수']):>20,}주")
            else:
                print(f"   ⚠️ {code} 데이터 없음")
        except Exception as e:
            print(f"   ❌ 실패: {e}")
    else:
        # 전체 상위 20
        print("   전체 종목 (시가총액 상위 20)")
        try:
            cap_df = pykrx_stock.get_market_cap(p_date, market="ALL")
            cap_df = cap_df.sort_values("시가총액", ascending=False).head(20)
            print(cap_df.to_string())
        except Exception as e:
            print(f"   ❌ 실패: {e}")


def cmd_indicators(args):
    """보조지표 계산 테스트"""
    import FinanceDataReader as fdr

    code = args.code
    start = args.start or (date.today() - timedelta(days=365)).isoformat()
    end = args.end or date.today().isoformat()
    indicators = [x.strip().upper() for x in args.indicators.split(",")]

    print(f"\n📊 {code} 보조지표 계산 ({start} ~ {end})")
    print(f"   지표: {', '.join(indicators)}")

    # OHLCV 수집 (lookback 포함)
    lookback_start = (
        pd.Timestamp(start) - pd.Timedelta(days=300)
    ).strftime("%Y-%m-%d")

    df = fdr.DataReader(code, lookback_start, end)
    if df.empty:
        print("   ⚠️ 데이터 없음")
        return

    print(f"   데이터: {len(df)}일치 (lookback 포함)")

    import numpy as np

    c = df["Close"].values.astype(np.float64)
    h = df["High"].values.astype(np.float64)
    l = df["Low"].values.astype(np.float64)
    v = df["Volume"].values.astype(np.float64)

    try:
        import talib
        has_talib = True
        print("   ✅ TA-Lib 사용")
    except ImportError:
        has_talib = False
        print("   ⚠️ TA-Lib 미설치 → pandas 기반 계산")

    results = {}

    for ind in indicators:
        print(f"\n   ── {ind} ──")

        if ind == "MA":
            for p in [5, 20, 60, 120]:
                if has_talib:
                    ma = talib.SMA(c, timeperiod=p)
                else:
                    ma = pd.Series(c).rolling(p).mean().values
                df[f"MA{p}"] = ma
                last_val = ma[-1]
                print(f"   MA{p}: {last_val:,.0f}" if not np.isnan(last_val) else f"   MA{p}: N/A")

        elif ind == "RSI":
            period = 14
            if has_talib:
                rsi = talib.RSI(c, timeperiod=period)
            else:
                delta = pd.Series(c).diff()
                gain = delta.where(delta > 0, 0).rolling(period).mean()
                loss = (-delta.where(delta < 0, 0)).rolling(period).mean()
                rs = gain / loss
                rsi = (100 - (100 / (1 + rs))).values
            df["RSI"] = rsi
            print(f"   RSI({period}): {rsi[-1]:.2f}" if not np.isnan(rsi[-1]) else "   RSI: N/A")

        elif ind == "MACD":
            if has_talib:
                macd, signal, hist = talib.MACD(c, 12, 26, 9)
            else:
                exp1 = pd.Series(c).ewm(span=12).mean()
                exp2 = pd.Series(c).ewm(span=26).mean()
                macd = (exp1 - exp2).values
                signal = pd.Series(macd).ewm(span=9).mean().values
                hist = macd - signal
            df["MACD"] = macd
            df["Signal"] = signal
            df["Hist"] = hist
            print(f"   MACD: {macd[-1]:,.2f}")
            print(f"   Signal: {signal[-1]:,.2f}")
            print(f"   Histogram: {hist[-1]:,.2f}")

        elif ind == "BB":
            if has_talib:
                upper, middle, lower = talib.BBANDS(c, 20, 2, 2)
            else:
                ma20 = pd.Series(c).rolling(20).mean()
                std20 = pd.Series(c).rolling(20).std()
                upper = (ma20 + 2 * std20).values
                middle = ma20.values
                lower = (ma20 - 2 * std20).values
            df["BB_Upper"] = upper
            df["BB_Middle"] = middle
            df["BB_Lower"] = lower
            print(f"   Upper: {upper[-1]:,.0f}")
            print(f"   Middle: {middle[-1]:,.0f}")
            print(f"   Lower: {lower[-1]:,.0f}")

        elif ind == "OBV":
            if has_talib:
                obv = talib.OBV(c, v)
            else:
                direction = np.sign(np.diff(c, prepend=c[0]))
                obv = np.cumsum(v * direction)
            df["OBV"] = obv
            print(f"   OBV: {obv[-1]:,.0f}")

        elif ind == "STOCH":
            if has_talib:
                slowk, slowd = talib.STOCH(h, l, c, 14, 3, 0, 3, 0)
            else:
                low14 = pd.Series(l).rolling(14).min()
                high14 = pd.Series(h).rolling(14).max()
                fastk = ((pd.Series(c) - low14) / (high14 - low14) * 100)
                slowk = fastk.rolling(3).mean().values
                slowd = pd.Series(slowk).rolling(3).mean().values
            print(f"   Slow %K: {slowk[-1]:.2f}")
            print(f"   Slow %D: {slowd[-1]:.2f}")

        elif ind == "ATR":
            if has_talib:
                atr = talib.ATR(h, l, c, 14)
            else:
                tr1 = pd.Series(h) - pd.Series(l)
                tr2 = abs(pd.Series(h) - pd.Series(c).shift(1))
                tr3 = abs(pd.Series(l) - pd.Series(c).shift(1))
                tr = pd.concat([tr1, tr2, tr3], axis=1).max(axis=1)
                atr = tr.rolling(14).mean().values
            print(f"   ATR(14): {atr[-1]:,.0f}")

        elif ind == "ADX":
            if has_talib:
                adx = talib.ADX(h, l, c, 14)
                print(f"   ADX(14): {adx[-1]:.2f}")
            else:
                print("   ADX: TA-Lib 필요")

        elif ind == "CCI":
            if has_talib:
                cci = talib.CCI(h, l, c, 20)
                print(f"   CCI(20): {cci[-1]:.2f}")
            else:
                tp = (pd.Series(h) + pd.Series(l) + pd.Series(c)) / 3
                ma20 = tp.rolling(20).mean()
                md = tp.rolling(20).apply(lambda x: abs(x - x.mean()).mean())
                cci = ((tp - ma20) / (0.015 * md)).values
                print(f"   CCI(20): {cci[-1]:.2f}")

        elif ind == "WILLR":
            if has_talib:
                willr = talib.WILLR(h, l, c, 14)
                print(f"   Williams %R: {willr[-1]:.2f}")
            else:
                print("   Williams %R: TA-Lib 필요")

        else:
            print(f"   ⚠️ 미지원: {ind}")

    # 결과 테이블 (최근 10일)
    trim_df = df[df.index >= start]
    extra_cols = [col for col in df.columns if col not in ["Open", "High", "Low", "Close", "Volume", "Change"]]
    if extra_cols:
        print(f"\n   === 최근 10일 지표값 ===")
        display_cols = ["Close"] + extra_cols[:6]
        available = [c for c in display_cols if c in trim_df.columns]
        print(trim_df[available].tail(10).to_string())


def main():
    parser = argparse.ArgumentParser(description="주식 데이터 수집 CLI")
    sub = parser.add_subparsers(dest="command", help="명령어")

    # listing
    p_list = sub.add_parser("listing", help="종목 리스트 조회")
    p_list.add_argument("--market", default="KRX", help="KRX/KOSPI/KOSDAQ/NASDAQ/NYSE")
    p_list.add_argument("--limit", type=int, default=20)
    p_list.add_argument("--save", action="store_true")

    # ohlcv
    p_ohlcv = sub.add_parser("ohlcv", help="일봉 OHLCV 수집")
    p_ohlcv.add_argument("code", help="종목코드 (예: 005930)")
    p_ohlcv.add_argument("--start", help="시작일 (YYYY-MM-DD)")
    p_ohlcv.add_argument("--end", help="종료일")
    p_ohlcv.add_argument("--save", action="store_true")

    # market_cap
    p_cap = sub.add_parser("market_cap", help="시가총액 조회")
    p_cap.add_argument("code", nargs="?", help="종목코드 (없으면 상위 20)")
    p_cap.add_argument("--date", help="조회일 (YYYY-MM-DD)")

    # indicators
    p_ind = sub.add_parser("indicators", help="보조지표 계산")
    p_ind.add_argument("code", help="종목코드")
    p_ind.add_argument("--indicators", default="MA,RSI,MACD,BB,OBV", help="지표 (쉼표 구분)")
    p_ind.add_argument("--start", help="시작일")
    p_ind.add_argument("--end", help="종료일")

    args = parser.parse_args()

    if args.command == "listing":
        cmd_listing(args)
    elif args.command == "ohlcv":
        cmd_ohlcv(args)
    elif args.command == "market_cap":
        cmd_market_cap(args)
    elif args.command == "indicators":
        cmd_indicators(args)
    else:
        parser.print_help()


if __name__ == "__main__":
    main()
