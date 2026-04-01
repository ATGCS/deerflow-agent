"""Gateway router for IM channel management."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/channels", tags=["channels"])


class ChannelStatusResponse(BaseModel):
    service_running: bool
    channels: dict[str, dict]


class ChannelRestartResponse(BaseModel):
    success: bool
    message: str


class ChannelEnableRequest(BaseModel):
    enabled: bool


class ChannelEnableResponse(BaseModel):
    success: bool
    message: str
    enabled: bool


class ChannelConfigResponse(BaseModel):
    name: str
    enabled: bool
    running: bool
    config: dict[str, Any]


@router.get("/", response_model=ChannelStatusResponse)
async def get_channels_status() -> ChannelStatusResponse:
    """Get the status of all IM channels."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        return ChannelStatusResponse(service_running=False, channels={})
    status = service.get_status()
    return ChannelStatusResponse(**status)


@router.post("/{name}/restart", response_model=ChannelRestartResponse)
async def restart_channel(name: str) -> ChannelRestartResponse:
    """Restart a specific IM channel."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    success = await service.restart_channel(name)
    if success:
        logger.info("Channel %s restarted successfully", name)
        return ChannelRestartResponse(success=True, message=f"Channel {name} restarted successfully")
    else:
        logger.warning("Failed to restart channel %s", name)
        return ChannelRestartResponse(success=False, message=f"Failed to restart channel {name}")


@router.post("/{name}/enable", response_model=ChannelEnableResponse)
async def enable_channel(name: str, request: ChannelEnableRequest) -> ChannelEnableResponse:
    """Enable or disable a specific IM channel."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    success = await service.set_channel_enabled(name, request.enabled)
    if success:
        action = "enabled" if request.enabled else "disabled"
        logger.info("Channel %s %s successfully", name, action)
        return ChannelEnableResponse(
            success=True,
            message=f"Channel {name} {action} successfully",
            enabled=request.enabled
        )
    else:
        action = "enable" if request.enabled else "disable"
        logger.warning("Failed to %s channel %s", action, name)
        return ChannelEnableResponse(
            success=False,
            message=f"Failed to {action} channel {name}",
            enabled=request.enabled
        )


@router.get("/{name}/config", response_model=ChannelConfigResponse)
async def get_channel_config(name: str) -> ChannelConfigResponse:
    """Get the configuration of a specific IM channel."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    config, enabled, running = service.get_channel_config(name)
    return ChannelConfigResponse(
        name=name,
        enabled=enabled,
        running=running,
        config=config or {}
    )


@router.put("/{name}/config", response_model=ChannelRestartResponse)
async def update_channel_config(name: str, config: dict[str, Any]) -> ChannelRestartResponse:
    """Update the configuration of a specific IM channel."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    success = await service.update_channel_config(name, config)
    if success:
        logger.info("Channel %s config updated successfully", name)
        return ChannelRestartResponse(success=True, message=f"Channel {name} config updated successfully")
    else:
        logger.warning("Failed to update channel %s config", name)
        return ChannelRestartResponse(success=False, message=f"Failed to update channel {name} config")
