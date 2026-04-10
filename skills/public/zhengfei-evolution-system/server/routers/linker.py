# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 跨技能联动路由
"""

from typing import List, Dict, Any, Optional
from fastapi import APIRouter, Body
from server.models.schemas import SkillContextResponse, ApiResponse
from server.services.linker_service import linker_service

router = APIRouter(prefix="/api/linker", tags=["联动服务"])


@router.get("/context/{skill_name}", response_model=ApiResponse)
async def get_skill_context(skill_name: str, task: Optional[str] = None):
    result = linker_service.get_context(skill_name, task)
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.get("/all", response_model=ApiResponse)
async def get_all_contexts():
    result = linker_service.get_all_contexts()
    return ApiResponse(data={"count": len(result), "contexts": result})


@router.post("/register", response_model=ApiResponse)
async def register_skill(
    skill_name: str,
    memory_categories: List[str] = Body(...),
    context_type: str = Body(...),
    keywords: List[str] = Body(...),
    default_context: Dict[str, Any] = Body(default={})
):
    result = linker_service.register_skill(
        skill_name, memory_categories, context_type, keywords, default_context
    )
    return ApiResponse(data={"registered": result, "skill_name": skill_name})


@router.post("/reload", response_model=ApiResponse)
async def reload_memory():
    result = linker_service.reload()
    return ApiResponse(data={"reloaded": result})
