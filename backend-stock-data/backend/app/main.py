# backend/app/main.py
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.routers import evernote, stock

settings = get_settings()

app = FastAPI(
    title="Research Platform API",
    version="0.1.0",
    description="기업 리서치 통합 플랫폼 백엔드",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=[settings.FRONTEND_URL, "http://localhost:5173", "http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routers
app.include_router(evernote.router, prefix=settings.API_PREFIX)
app.include_router(stock.router, prefix=settings.API_PREFIX)


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


# ─── Future routers (Phase 2-3) ──────────────────────────
# from app.routers import stocks, news, telegram, reports
# app.include_router(stocks.router, prefix=settings.API_PREFIX)
# app.include_router(news.router, prefix=settings.API_PREFIX)
# app.include_router(telegram.router, prefix=settings.API_PREFIX)
# app.include_router(reports.router, prefix=settings.API_PREFIX)
