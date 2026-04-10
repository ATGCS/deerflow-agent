# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 进化路由
"""

from fastapi import APIRouter
from server.models.schemas import (
    EvolutionTriggerRequest, EvolutionFeedbackRequest, ApiResponse
)
from server.services.evolution_service import evolution_service

router = APIRouter(prefix="/api/evolution", tags=["进化服务"])


@router.post("/trigger", response_model=ApiResponse)
async def trigger_evolution(request: EvolutionTriggerRequest):
    result = evolution_service.trigger(
        skill_name=request.skill_name,
        execution_result=request.execution_result,
        user_text=request.user_text,
        assistant_text=request.assistant_text,
        guard_level=request.guard_level
    )
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.post("/feedback", response_model=ApiResponse)
async def record_feedback(request: EvolutionFeedbackRequest):
    result = evolution_service.record_feedback(
        memory_text=request.memory_text,
        feedback_type=request.feedback_type,
        category=request.category,
        importance=request.importance
    )
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.post("/optimize", response_model=ApiResponse)
async def auto_optimize():
    result = evolution_service.auto_optimize()
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.get("/params", response_model=ApiResponse)
async def get_params():
    result = evolution_service.get_parameters()
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.get("/history", response_model=ApiResponse)
async def get_history(limit: int = 20):
    result = evolution_service.get_evolution_history(limit)
    return ApiResponse(data={"count": len(result), "history": result})


@router.get("/stats", response_model=ApiResponse)
async def get_stats():
    result = evolution_service.get_statistics()
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)
