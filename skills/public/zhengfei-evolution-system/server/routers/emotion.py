# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 情绪路由
"""

from fastapi import APIRouter
from server.models.schemas import EmotionAnalyzeRequest, EmotionResponse, ApiResponse
from server.services.emotion_service import emotion_service

router = APIRouter(prefix="/api/emotion", tags=["情绪服务"])


@router.post("/analyze", response_model=ApiResponse)
async def analyze_emotion(request: EmotionAnalyzeRequest):
    result = emotion_service.analyze(request.text)
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.post("/track", response_model=ApiResponse)
async def track_emotion(text: str):
    result = emotion_service.track(text)
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.get("/trend", response_model=ApiResponse)
async def get_trend(days: int = 7):
    result = emotion_service.get_trend(days)
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.get("/distribution", response_model=ApiResponse)
async def get_distribution():
    result = emotion_service.get_distribution()
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.get("/context", response_model=ApiResponse)
async def get_context(text: str):
    result = emotion_service.get_context(text)
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)
