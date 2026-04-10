# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 记忆路由
"""

from fastapi import APIRouter, HTTPException
from server.models.schemas import (
    MemoryAddRequest, MemorySearchRequest, MemoryResponse,
    MemoryStatsResponse, ApiResponse
)
from server.services.memory_service import memory_service

router = APIRouter(prefix="/api/memory", tags=["记忆服务"])


@router.post("/add", response_model=ApiResponse)
async def add_memory(request: MemoryAddRequest):
    result = memory_service.add_memory(
        text=request.text,
        confidence=request.confidence,
        source=request.source,
        category=request.category,
        importance=request.importance,
        tags=request.tags,
        ttl_days=request.ttl_days
    )
    if "error" in result:
        return ApiResponse(success=False, error=result["error"])
    return ApiResponse(data=result)


@router.post("/search", response_model=ApiResponse)
async def search_memory(request: MemorySearchRequest):
    results = memory_service.search(
        query=request.query,
        top_k=request.top_k,
        categories=request.categories,
        min_importance=request.min_importance,
        min_confidence=request.min_confidence
    )
    return ApiResponse(data={"count": len(results), "results": results})


@router.get("/stats", response_model=ApiResponse)
async def get_stats():
    stats = memory_service.get_statistics()
    if "error" in stats:
        return ApiResponse(success=False, error=stats["error"])
    return ApiResponse(data=stats)


@router.delete("/{memory_id}", response_model=ApiResponse)
async def delete_memory(memory_id: str):
    success = memory_service.delete_memory(memory_id)
    return ApiResponse(data={"deleted": success, "memory_id": memory_id})


@router.get("/context", response_model=ApiResponse)
async def get_context(task: str, max_tokens: int = 2000):
    context = memory_service.get_context(task, max_tokens)
    return ApiResponse(data={"context": context})


@router.post("/conflicts", response_model=ApiResponse)
async def detect_conflicts(text: str):
    conflicts = memory_service.detect_conflicts(text)
    return ApiResponse(data={"count": len(conflicts), "conflicts": conflicts})
