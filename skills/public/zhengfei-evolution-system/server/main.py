# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - FastAPI 主入口
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from datetime import datetime

from server.config import settings
from server.routers import memory, inference, emotion, evolution, capability, linker

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    description="""
正飞进化系统 V6.0 - 双后端架构

## 核心服务

- **记忆服务**: 记忆存储、搜索、冲突检测
- **推理服务**: 知识图谱推理、路径查找
- **情绪服务**: 情绪识别、趋势分析
- **进化服务**: 元进化、参数优化
- **能力服务**: 能力自动生成、匹配
- **联动服务**: 跨技能上下文共享

## 调用方式

1. HTTP API: `http://localhost:8765/api/...`
2. 直接调用: `from server.services import memory_service`
3. CLI: `python cli/zhengfei-commands.py`
""",
    docs_url="/docs",
    redoc_url="/redoc"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(memory.router)
app.include_router(inference.router)
app.include_router(emotion.router)
app.include_router(evolution.router)
app.include_router(capability.router)
app.include_router(linker.router)


@app.get("/")
async def root():
    return {
        "name": settings.app_name,
        "version": settings.app_version,
        "status": "running",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/health")
async def health_check():
    return {
        "status": "healthy",
        "timestamp": datetime.now().isoformat()
    }


@app.get("/api/status")
async def api_status():
    return {
        "services": {
            "memory": "available",
            "inference": "available",
            "emotion": "available",
            "evolution": "available",
            "capability": "available",
            "linker": "available"
        },
        "timestamp": datetime.now().isoformat()
    }
