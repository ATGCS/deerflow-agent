import os
from pathlib import Path

from fastapi import APIRouter
from pydantic import BaseModel


router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])


class ResolveWorkspaceRequest(BaseModel):
    path: str


class ResolveWorkspaceResponse(BaseModel):
    input: str
    resolved: str
    exists: bool
    is_dir: bool


@router.post("/resolve", response_model=ResolveWorkspaceResponse)
async def resolve_workspace(req: ResolveWorkspaceRequest) -> ResolveWorkspaceResponse:
    """
    Resolve and validate a local workspace path (frontend-selected directory).

    - Normalizes user input (expands env vars and ~).
    - Resolves to an absolute path where possible.
    - Returns existence and directory flags for UI validation.
    """
    raw = (req.path or "").strip()
    expanded = os.path.expanduser(os.path.expandvars(raw))
    p = Path(expanded)
    try:
        resolved = str(p.resolve(strict=False))
    except Exception:
        resolved = str(p.absolute())
    rp = Path(resolved)
    return ResolveWorkspaceResponse(
        input=raw,
        resolved=resolved,
        exists=rp.exists(),
        is_dir=rp.is_dir(),
    )

