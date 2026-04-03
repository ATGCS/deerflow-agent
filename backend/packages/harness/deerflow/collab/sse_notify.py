"""Push collaboration SSE events to the API Gateway (LangGraph runs in a separate process)."""

from __future__ import annotations

import logging
import os
from typing import Any

logger = logging.getLogger(__name__)


async def broadcast_project_event(project_id: str, event_type: str, data: dict[str, Any]) -> None:
    """POST to Gateway ``/api/events/internal/broadcast`` when ``INTERNAL_EVENTS_SECRET`` is set.

    Set ``DEERFLOW_GATEWAY_URL`` (default ``http://127.0.0.1:8001``) so LangGraph can reach the gateway.
    """
    secret = (os.getenv("INTERNAL_EVENTS_SECRET") or "").strip()
    if not secret:
        return
    base = (os.getenv("DEERFLOW_GATEWAY_URL") or "http://127.0.0.1:8001").rstrip("/")
    url = f"{base}/api/events/internal/broadcast"
    try:
        import httpx

        async with httpx.AsyncClient(timeout=3.0) as client:
            resp = await client.post(
                url,
                json={"project_id": project_id, "event_type": event_type, "data": data},
                headers={"X-Internal-Events-Secret": secret},
            )
            if resp.status_code >= 400:
                logger.warning(
                    "SSE internal broadcast failed status=%s body=%s",
                    resp.status_code,
                    (resp.text or "")[:300],
                )
    except Exception:
        logger.debug("SSE internal broadcast skipped or failed", exc_info=True)
