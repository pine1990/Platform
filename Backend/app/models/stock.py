# backend/app/models/stock.py
from sqlalchemy import (
    Column, Integer, BigInteger, String, Date, Boolean,
    Numeric, ForeignKey, DateTime, UniqueConstraint, Index
)
from sqlalchemy.sql import func
from sqlalchemy.orm import relationship, DeclarativeBase


class Base(DeclarativeBase):
    pass


class Company(Base):
    __tablename__ = "companies"

    id = Column(Integer, primary_key=True, autoincrement=True)
    stock_code = Column(String(10), unique=True, nullable=False)  # 005930
    name = Column(String(100), nullable=False)                     # 삼성전자
    name_en = Column(String(100))
    name_short = Column(String(50))
    sector = Column(String(100))           # 업종
    industry = Column(String(100))         # 업종 상세
    market = Column(String(10))            # KOSPI / KOSDAQ
    listing_date = Column(Date)
    market_cap = Column(BigInteger)        # 최신 시가총액 캐시
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    prices = relationship("StockPrice", back_populates="company", lazy="dynamic")


class StockPrice(Base):
    __tablename__ = "stock_prices"

    id = Column(Integer, primary_key=True, autoincrement=True)
    company_id = Column(Integer, ForeignKey("companies.id"), nullable=False)
    trade_date = Column(Date, nullable=False)

    # OHLCV
    open = Column(Integer, nullable=False)
    high = Column(Integer, nullable=False)
    low = Column(Integer, nullable=False)
    close = Column(Integer, nullable=False)
    volume = Column(BigInteger, nullable=False)       # 거래량 (주)
    change_pct = Column(Numeric(8, 4))                # 등락률 (%)

    # pykrx 추가 데이터
    trading_value = Column(BigInteger)                # 거래대금 (원)
    market_cap = Column(BigInteger)                   # 시가총액 (원)
    listed_shares = Column(BigInteger)                # 상장주식수

    company = relationship("Company", back_populates="prices")

    __table_args__ = (
        UniqueConstraint("company_id", "trade_date", name="uq_stock_prices_company_date"),
        Index("idx_stock_prices_lookup", "company_id", "trade_date"),
    )


class StockSyncLog(Base):
    __tablename__ = "stock_sync_log"

    id = Column(Integer, primary_key=True, autoincrement=True)
    sync_type = Column(String(30), nullable=False)     # LISTING / OHLCV / MARKET_CAP / FULL
    status = Column(String(20), nullable=False)        # STARTED / SUCCESS / FAILED
    target_count = Column(Integer, default=0)
    synced_count = Column(Integer, default=0)
    error_count = Column(Integer, default=0)
    error_message = Column(String)
    started_at = Column(DateTime(timezone=True), server_default=func.now())
    finished_at = Column(DateTime(timezone=True))
