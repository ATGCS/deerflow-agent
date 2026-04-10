# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 能力路由
"""

from fastapi import APIRouter
from server.models.schemas import CapabilityMatchRequest, CapabilityResponse, ApiResponse
from server.services.capability_service import capability_service

router = APIRouter(prefix="/api/capability", tags=["能力服务"])


@router.post("/generate", response_model=ApiResponse)
async def generate_capability(task_description: str, execution_result: str, success: bool = True):
    result = capability_service.auto_generate(task_description, execution_result, success)
    if result is None:
        return ApiResponse(success=False, error="能力生成失败")
    return ApiResponse(data=result)


@router.post("/match", response_model=ApiResponse)
async def match_capability(request: CapabilityMatchRequest):
    results = capability_service.match(request.task_description)
    return ApiResponse(data={"count": len(results), "matches": results})


@router.post("/effect", response_model=ApiResponse)
async def record_effectiveness(
    capability_id: str,
    task_description: str,
    success: bool,
    user_feedback: str = None
):
    result = capability_service.record_effectiveness(
        capability_id, task_description, success, user_feedback
    )
    return ApiResponse(data={"recorded": result})


@router.get("/top", response_model=ApiResponse)
async def get_top_capabilities(limit: int = 10):
    results = capability_service.get_top(limit)
    return ApiResponse(data={"count": len(results), "capabilities": results})


@router.get("/stats", response_model=ApiResponse)
async def get_stats():
    result = capability_service.get_statistics()
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)
