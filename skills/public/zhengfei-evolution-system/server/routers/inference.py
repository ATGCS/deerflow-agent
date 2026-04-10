# -*- coding: utf-8 -*-
"""
正飞进化系统后端服务 - 推理路由
"""

from fastapi import APIRouter
from server.models.schemas import InferenceRequest, InferenceResponse, ApiResponse
from server.services.inference_service import inference_service

router = APIRouter(prefix="/api/inference", tags=["推理服务"])


@router.post("/query", response_model=ApiResponse)
async def inference_query(request: InferenceRequest):
    results = inference_service.infer(request.query, request.max_depth)
    return ApiResponse(data={"count": len(results), "results": results})


@router.post("/path", response_model=ApiResponse)
async def find_path(start: str, end: str, max_depth: int = 5):
    paths = inference_service.find_path(start, end, max_depth)
    return ApiResponse(data={"count": len(paths), "paths": paths})


@router.get("/related", response_model=ApiResponse)
async def get_related(text: str, depth: int = 2):
    related = inference_service.get_related(text, depth)
    return ApiResponse(data={"count": len(related), "related": related})


@router.post("/node", response_model=ApiResponse)
async def add_node(text: str, node_type: str = "entity"):
    node = inference_service.add_node(text, node_type)
    if node is None:
        return ApiResponse(success=False, error="添加节点失败")
    return ApiResponse(data=node)


@router.post("/edge", response_model=ApiResponse)
async def add_edge(source_id: str, target_id: str, relation_type: str, evidence: str = ""):
    edge = inference_service.add_edge(source_id, target_id, relation_type, evidence)
    if edge is None:
        return ApiResponse(success=False, error="添加关系失败")
    return ApiResponse(data=edge)


@router.get("/stats", response_model=ApiResponse)
async def get_stats():
    stats = inference_service.get_statistics()
    if "error" in stats:
        return ApiResponse(success=False, error=stats["error"])
    return ApiResponse(data=stats)
