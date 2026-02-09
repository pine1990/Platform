-- ============================================================
-- 002: stock_prices 테이블 확장 (거래대금, 시가총액)
-- Run after 001_initial_schema.sql
-- ============================================================

-- 기존 stock_prices에 컬럼 추가
ALTER TABLE stock_prices
    ADD COLUMN IF NOT EXISTS trading_value   BIGINT,          -- 거래대금 (원)
    ADD COLUMN IF NOT EXISTS market_cap      BIGINT,          -- 시가총액 (원)
    ADD COLUMN IF NOT EXISTS listed_shares   BIGINT;          -- 상장주식수

-- companies 테이블 확장
ALTER TABLE companies
    ADD COLUMN IF NOT EXISTS name_short      VARCHAR(50),     -- 축약명
    ADD COLUMN IF NOT EXISTS industry        VARCHAR(100),    -- 업종 상세
    ADD COLUMN IF NOT EXISTS listing_date    DATE,            -- 상장일
    ADD COLUMN IF NOT EXISTS market_cap      BIGINT,          -- 최신 시가총액 (캐시)
    ADD COLUMN IF NOT EXISTS updated_at      TIMESTAMPTZ DEFAULT NOW();

-- 데이터 수집 이력 테이블
CREATE TABLE IF NOT EXISTS stock_sync_log (
    id              SERIAL PRIMARY KEY,
    sync_type       VARCHAR(30) NOT NULL,       -- LISTING / OHLCV / MARKET_CAP / FULL
    status          VARCHAR(20) NOT NULL,       -- STARTED / SUCCESS / FAILED
    target_count    INT DEFAULT 0,              -- 대상 종목 수
    synced_count    INT DEFAULT 0,              -- 실제 수집 수
    error_count     INT DEFAULT 0,
    error_message   TEXT,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    finished_at     TIMESTAMPTZ
);
