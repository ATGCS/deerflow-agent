"""Reverse proxy for LangGraph API under gateway /api/langgraph."""

from __future__ import annotations

import asyncio
import json
import os
import time

import httpx
from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse, Response, StreamingResponse
from starlette.background import BackgroundTask

router = APIRouter(prefix="/api/langgraph", tags=["langgraph-proxy"])

LANGGRAPH_BASE_URL = os.getenv("DEERFLOW_LANGGRAPH_URL", "http://127.0.0.1:2024").rstrip("/")
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "host",
    "content-length",
}


@router.get("/threads/{thread_id}/runs/{run_id}/resume-stream", summary="Resume-like SSE streaming for an in-progress run")
async def resume_run_stream(
    thread_id: str,
    run_id: str,
    poll_interval_ms: int = 900,
    max_wait_seconds: int = 600,
) -> Response:
    """
    SSE endpoint that streams `event: values` frames derived from repeated
    `threads/{thread_id}/state` polling until the run reaches a terminal state.

    This is designed for the UI to keep showing incremental progress after
    page refresh / reconnect.
    """

    poll_seconds = max(0.2, min(5.0, float(poll_interval_ms) / 1000.0))
    timeout_seconds = max(1, int(max_wait_seconds))

    async def _fetch_json(client: httpx.AsyncClient, path: str) -> dict:
        upstream_url = f"{LANGGRAPH_BASE_URL}/{path.lstrip('/')}"
        resp = await client.get(upstream_url)
        resp.raise_for_status()
        data = resp.json()
        return data if isinstance(data, dict) else {}

    async def _event_generator() -> asyncio.AsyncGenerator[str, None]:
        started = time.monotonic()

        # Stop condition: rely on persisted collab_state (no need for LangGraph runs-list).
        from deerflow.collab.thread_collab import load_thread_collab_state
        from deerflow.config.paths import get_paths

        paths = get_paths()

        # Use a single upstream client for the lifetime of the SSE connection.
        timeout = httpx.Timeout(connect=10.0, read=30.0, write=10.0, pool=10)
        async with httpx.AsyncClient(timeout=timeout) as client:
            while True:
                if time.monotonic() - started > timeout_seconds:
                    return

                # 1) Stop when collab_state indicates it is terminal.
                try:
                    collab_state = load_thread_collab_state(paths, thread_id)
                    phase = getattr(collab_state, "collab_phase", None)
                    phase_str = getattr(phase, "value", phase)  # CollabPhase Enum -> value string
                    phase_str = str(phase_str).strip().lower() if phase_str is not None else "idle"
                except Exception:
                    phase_str = "idle"

                # 2) Fetch thread state for latest messages snapshot.
                state: dict = {}
                try:
                    state = await _fetch_json(client, f"threads/{thread_id}/state")
                except Exception:
                    state = {}

                # LangGraph state is usually { "values": {...} }.
                payload = {"values": state.get("values") if isinstance(state.get("values"), dict) else {}}

                # Emit SSE "values" event so existing frontend handler can parse it.
                yield f"event: values\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"

                if phase_str in {"idle", "done"}:
                    return

                await asyncio.sleep(poll_seconds)

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        # Reduce buffering in some proxies.
        "X-Accel-Buffering": "no",
    }
    return StreamingResponse(_event_generator(), headers=headers, media_type="text/event-stream")


@router.api_route("/{path:path}", methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"])
async def proxy_langgraph(path: str, request: Request) -> Response:
    target = f"{LANGGRAPH_BASE_URL}/{path}"
    if request.url.query:
        target = f"{target}?{request.url.query}"

    # Pass-through incoming request body/headers.
    body = await request.body()
    upstream_headers = {k: v for k, v in request.headers.items() if k.lower() not in HOP_BY_HOP_HEADERS}

    timeout = httpx.Timeout(connect=10.0, read=600.0, write=600.0, pool=60.0)
    client = httpx.AsyncClient(timeout=timeout)
    try:
        upstream_req = client.build_request(request.method, target, headers=upstream_headers, content=body)
        upstream_resp = await client.send(upstream_req, stream=True)
    except Exception as e:
        await client.aclose()
        return JSONResponse(status_code=502, content={"detail": f"LangGraph upstream unavailable: {e}"})

    async def _cleanup() -> None:
        await upstream_resp.aclose()
        await client.aclose()

    response_headers = {k: v for k, v in upstream_resp.headers.items() if k.lower() not in HOP_BY_HOP_HEADERS}
    return StreamingResponse(
        upstream_resp.aiter_raw(),
        status_code=upstream_resp.status_code,
        headers=response_headers,
        background=BackgroundTask(_cleanup),
    )

