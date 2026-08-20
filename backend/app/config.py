"""Application configuration loaded from environment variables."""

from pydantic_settings import BaseSettings
from typing import List
import json


class Settings(BaseSettings):
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/iv_monitor"
    SIMULATOR_MODE: bool = True
    SIMULATOR_INTERVAL_SECONDS: float = 3.0
    SECRET_KEY: str = "change_me_in_production"
    CORS_ORIGINS: str = '["http://localhost:8081","http://localhost:19006"]'

    @property
    def cors_origins_list(self) -> List[str]:
        try:
            return json.loads(self.CORS_ORIGINS)
        except Exception:
            return ["*"]

    class Config:
        env_file = ".env"


settings = Settings()
