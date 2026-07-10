from pydantic_settings import BaseSettings
from typing import List


class Settings(BaseSettings):
    # Supabase
    SUPABASE_URL: str = "https://fnwbdxtspbovcvefemwn.supabase.co"
    SUPABASE_ANON_KEY: str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZud2JkeHRzcGJvdmN2ZWZlbXduIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODM2Nzk0MTQsImV4cCI6MjA5OTI1NTQxNH0.VJrSsy1uLu3bD0AOjK2hUdrwnD4uAnWlZ8zgIrMdumM"
    SUPABASE_SERVICE_ROLE_KEY: str = ""

    # App
    APP_ENV: str = "development"
    SECRET_KEY: str = "mine-logistics-secret-key-change-in-production"

    # CORS
    CORS_ORIGINS: List[str] = [
        "http://localhost:3000",
        "http://localhost:3001",
        "https://mine-logistics.vercel.app",
    ]

    class Config:
        env_file = ".env"
        case_sensitive = True


settings = Settings()
