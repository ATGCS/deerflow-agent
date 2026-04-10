from unittest.mock import patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.gateway.routers import collab, threads
from deerflow.collab.storage import get_task_stream_log_storage
from deerflow.config.paths import Paths


def test_get_collab_default_when_missing(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths):
        with TestClient(app) as client:
            r = client.get("/api/collab/threads/t1")
    assert r.status_code == 200
    j = r.json()
    assert j["collab_phase"] == "idle"
    assert j["bound_task_id"] is None
    assert j["bound_project_id"] is None
    assert "updated_at" in j


def test_put_collab_persists_and_get_roundtrip(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths):
        with TestClient(app) as client:
            r1 = client.put(
                "/api/collab/threads/t1",
                json={"collab_phase": "req_confirm", "bound_task_id": "task-a", "bound_project_id": "proj-x"},
            )
            assert r1.status_code == 200
            j1 = r1.json()
            assert j1["collab_phase"] == "req_confirm"
            assert j1["bound_task_id"] == "task-a"
            assert j1["bound_project_id"] == "proj-x"
            r2 = client.get("/api/collab/threads/t1")
            assert r2.status_code == 200
            assert r2.json()["bound_task_id"] == "task-a"


def test_put_collab_partial_merge(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths):
        with TestClient(app) as client:
            client.put(
                "/api/collab/threads/t2",
                json={"collab_phase": "planning", "bound_task_id": "m1", "bound_project_id": "p1"},
            )
            r = client.put("/api/collab/threads/t2", json={"collab_phase": "executing"})
            assert r.status_code == 200
            j = r.json()
            assert j["collab_phase"] == "executing"
            assert j["bound_task_id"] == "m1"
            assert j["bound_project_id"] == "p1"


def test_put_collab_clear_bound_ids_with_null(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths):
        with TestClient(app) as client:
            client.put(
                "/api/collab/threads/t3",
                json={"bound_task_id": "x", "bound_project_id": "y"},
            )
            r = client.put("/api/collab/threads/t3", json={"bound_task_id": None, "bound_project_id": None})
            assert r.status_code == 200
            j = r.json()
            assert j["bound_task_id"] is None
            assert j["bound_project_id"] is None


def test_collab_rejects_invalid_thread_id(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths):
        with TestClient(app) as client:
            r = client.get("/api/collab/threads/bad.id")
    assert r.status_code == 422


def test_delete_thread_removes_collab_state(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    app.include_router(threads.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths), patch(
        "app.gateway.routers.threads.get_paths", return_value=paths
    ):
        with TestClient(app) as client:
            client.put("/api/collab/threads/wipe-me", json={"collab_phase": "req_confirm"})
            assert paths.thread_dir("wipe-me").exists()
            d = client.delete("/api/threads/wipe-me")
            assert d.status_code == 200
            r = client.get("/api/collab/threads/wipe-me")
    assert r.status_code == 200
    assert r.json()["collab_phase"] == "idle"


def test_get_task_stream_log_reads_persisted_events(tmp_path):
    paths = Paths(tmp_path)
    app = FastAPI()
    app.include_router(collab.router)
    with patch("app.gateway.routers.collab.get_paths", return_value=paths), patch(
        "deerflow.collab.storage.get_paths", return_value=paths
    ):
        log_storage = get_task_stream_log_storage()
        assert log_storage.append_event("task123", {"step": "a", "progress": 10})
        assert log_storage.append_event("task123", {"step": "b", "progress": 50})
        with TestClient(app) as client:
            r = client.get("/api/collab/tasks/task123/stream-log?limit=10")
    assert r.status_code == 200
    j = r.json()
    assert j["task_id"] == "task123"
    assert j["count"] == 2
    assert isinstance(j["events"], list)
    assert j["events"][-1]["progress"] == 50
