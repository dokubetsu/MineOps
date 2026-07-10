from pydantic_settings import BaseSettings
from typing import List
import os


class Settings(BaseSettings):
    # Supabase — all required, no defaults, app refuses to start without .env
    SUPABASE_URL: str
    SUPABASE_ANON_KEY: str
    SUPABASE_SERVICE_ROLE_KEY: str

    # App
    APP_ENV: str = "development"
    SECRET_KEY: str

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
    ]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
