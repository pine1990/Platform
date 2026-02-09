# backend/app/config.py
from pydantic_settings import BaseSettings
from functools import lru_cache


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/research_platform"

    # Evernote OAuth
    EVERNOTE_CONSUMER_KEY: str = ""
    EVERNOTE_CONSUMER_SECRET: str = ""
    EVERNOTE_SANDBOX: bool = False  # True for dev, False for production
    EVERNOTE_BASE_URL: str = "https://www.evernote.com"  # or https://sandbox.evernote.com

    # App
    SECRET_KEY: str = "change-me-in-production"
    FRONTEND_URL: str = "http://localhost:5173"
    API_PREFIX: str = "/api/v1"

    # Sync
    SYNC_INTERVAL_MINUTES: int = 30

    class Config:
        env_file = ".env"


@lru_cache
def get_settings() -> Settings:
    return Settings()
