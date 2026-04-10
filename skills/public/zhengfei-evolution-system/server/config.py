# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 配置管理
"""

import os
from typing import Optional
from pydantic_settings import BaseSettings

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DATA_DIR = os.path.join(BASE_DIR, "zhengfei-memory")


class Settings(BaseSettings):
    app_name: str = "正飞进化系统"
    app_version: str = "6.0.0"
    debug: bool = False
    
    host: str = "127.0.0.1"
    port: int = 8765
    
    data_dir: str = DATA_DIR
    memory_dir: str = os.path.join(DATA_DIR, "memory")
    knowledge_dir: str = os.path.join(DATA_DIR, "knowledge")
    
    cors_origins: list = ["*"]
    
    class Config:
        env_file = ".env"
        env_file_encoding = "utf-8"


settings = Settings()
