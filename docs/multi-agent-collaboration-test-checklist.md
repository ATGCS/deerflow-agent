# Real-time Multi-Agent Collaboration — Test Checklist (API + SSE + UI)

> Scope: `A-01` ~ `H-02`
>
> Principle: verify via API/SSE first; do UI checks manually.
>
> Note: this checklist assumes Nginx at `2026` proxies `/api/*` to the FastAPI Gateway.

---

## 0. Test Pre-req

### 0.1 Endpoints / Base URLs

- API base (recommended): `http://localhost:2026`
- Gateway directly (if needed): `http://localhost:8011`
- LangGraph (only for end-to-end supervisor): `2024`

### 0.2 Internal SSE secret (required for event injection)

- Header: `X-Internal-Events-Secret: <INTERNAL_EVENTS_SECRET>`

---

## 1. Common Interface Testing Methods

### 1.1 Create a task (also creates a project bundle)

1. `POST /api/tasks`
2. Body example:
   - `{ "name": "T1", "description": "...", "thread_id": null }`
3. Expect response:
   - `id` as `task_id`
   - `parent_project_id` as `project_id`

### 1.2 Subscribe project SSE

1. `GET /api/events/projects/{project_id}/stream`
2. Expect:
   - named events: `event: connected`, `event: ping`
   - business events: `data: <JSON>`
     - JSON includes `type` and `data`.

### 1.3 Inject business events (for SSE/UI verification)

1. `POST /api/events/internal/broadcast`
2. Body:
   - `{ "project_id": "<project_id>", "event_type": "task:progress", "data": { ... } }`
3. Add header: `X-Internal-Events-Secret`

---

## 2. Feature-by-Feature Checklist (with verification steps)

## A-01 — Gate 2 Execution Authorization (OR allow)

Verify via:
- `POST /api/tasks/{task_id}/start`
- `POST /api/tasks/{task_id}/authorize-execution`

Steps:
1. `POST /api/tasks` create task `T_A01` (expect `status=pending`, `execution_authorized=false`)
2. Call `POST /api/tasks/{task_id}/authorize-execution`
   - Expect: HTTP `400` because allowed statuses are `planned/planning`.
3. Call `POST /api/tasks/{task_id}/start`
   - Expect: task `status=planning`
4. Call `POST /api/tasks/{task_id}/authorize-execution` with body:
   - `{ "authorized_by": "user" }` (also test `lead/system`)
   - Expect: `success=true` and response `execution_authorized=true`
5. Call authorize again (idempotency)
   - Expect: still success, no errors.

---

## B-01 ~ B-04 — Storage/data model alignment

### B-01 Main task fields
1. `POST /api/tasks`
2. `GET /api/tasks/{task_id}`
   - Check fields: `execution_authorized`, `thread_id`, `status`
3. `POST /api/tasks/{task_id}/start` then authorize (as in A-01)
4. Re-check `execution_authorized=true` and `authorized_by` matches.

### B-02 Subtask `worker_profile`
1. `POST /api/tasks` -> task_id
2. `POST /api/tasks/{task_id}/subtasks` with `worker_profile` JSON
3. Response gives `subtask_id`
4. `GET /api/tasks/{task_id}/subtasks/{subtask_id}`
   - Check `worker_profile` fields match (e.g., `base_subagent/tools/instruction`)

### B-03 Task tool parameter mapping
API-only verification is hard.
- Use pytest if available.
- `backend/tests/test_task_tool_core_logic.py` covers worker_profile mapping + tool filtering.

### B-04 Unified “create task” path
- Prefer API creation (`POST /api/tasks`) and check project/task/subtasks shapes are consistent.

---

## C-01 ~ C-03 — Gates & validations

### C-01 authorize-execution API
Covered by A-01.

### C-02 supervisor(start_execution)
Best validated end-to-end (LangGraph execution).
- Interface layer can validate `authorize_main_task_execution` results by checking the same fields as C-01.

### C-03 task tool front gate (unauthorized reject)
Use pytest coverage:
- `backend/tests/test_task_tool_core_logic.py` validates “task tool blocks when gate returns error”.

---

## D-01 ~ D-04 — Progress updates and task-memory reads

### D-01 SSE emits on progress update
1. Create task: `POST /api/tasks`
2. Subscribe SSE: `GET /api/events/projects/{project_id}/stream`
3. Call progress endpoint:
   - `PUT /api/task-memory/tasks/{task_id}/progress`
   - Body: `{ "progress": 55, "current_step": "Step A" }`
4. Expect SSE:
   - `type=task:progress` with `data.task_id==task_id` and `data.progress==55`
   - `type=task_memory:updated` with `data.task_id==task_id`

### D-02 create_subtask with profile
Use B-02 checks + optionally verify subtask `progress/status` update via subtask update endpoints.

### D-03 supervisor reading TaskMemory
Prefer end-to-end or pytest-based contract checks.
Interface supplement:
- `GET /api/task-memory/tasks/{task_id}` should show `facts/current_step/progress` after you write them.

### D-04 POST /api/tasks response includes project binding fields
- Check presence of `parent_project_id` and `project_name`.

---

## E-01 / E-02 — collab_phase persistence

API validation:
1. `GET /api/collab/threads/{thread_id}` (e.g. `t1`)
   - Expect default `collab_phase=idle`, bound ids null
2. `PUT /api/collab/threads/{thread_id}`
   - Body example:
     - `{ "collab_phase": "req_confirm", "bound_task_id": "task-a", "bound_project_id": "proj-x" }`
3. Re-`GET` and assert values match.

---

## F-01 / F-02 — TaskMemory persistence + facts_count behavior

### F-02 POST fact increments facts_count + emits SSE
1. Create task: `POST /api/tasks`
2. Subscribe: `GET /api/events/projects/{project_id}/stream`
3. `POST /api/task-memory/tasks/{task_id}/facts`
   - Body: `{ "content": "fact-1", "category": "finding", "confidence": 0.8 }`
   - Expect HTTP `200`
4. Expect SSE:
   - `type=task_memory:updated`
   - `data.task_id==task_id`
   - `data.facts_count >= 1`
5. Post again and verify facts_count increases.

---

## F-03 / F-04 — SSE emit wiring (task:started/progress/completed/failed + task_memory:updated)

Use internal injection to verify end-to-end SSE dispatch:
1. Create task and subscribe SSE.
2. Inject in this order and confirm events arrive immediately:
   - `task:started`: `data={ "task_id": "<task_id>", "agent_id": "a1" }`
   - `task:progress`: `data={ "task_id": "<task_id>", "progress": 25, "current_step": "x" }`
   - `task:completed`: `data={ "task_id": "<task_id>", "result": "done" }`
   - `task:failed`: `data={ "task_id": "<task_id>", "error": "boom" }`
   - `task_memory:updated`: `data={ "task_id": "<task_id>", "facts_count": 1 }`

---

## G-01 / G-02 — ask_clarification & CollabPhaseMiddleware

API-only observation is hard.
- Preferred: pytest
- Fallback: run a real collaboration conversation and observe model behavior in the correct phases.

---

## H-01 / H-02 — DeerPanel UI (manual verification)

### H-01 project-detail: status columns
Manual checks on `project-detail.js`:
1. Open `#/projects/{project_id}`
2. Confirm columns exist and tasks are placed into:
   - executing (`executing`)
   - pending/planning/queued (`pending/planning/planned/paused`)
   - completed (`completed`)
   - failed (`failed`)
   - cancelled (`cancelled`) if any
3. Inject SSE and verify the UI updates:
   - `task:started` -> status becomes executing
   - `task:progress` -> progress bar + percent updates
   - `task:completed` -> completed + progress=100
   - `task:failed` -> failed + error shown

### H-02 task-detail: facts refresh (IMPORTANT risk)
Task-detail listens to `task_memory:updated` and calls `api.getTaskFacts(taskId)`.
Front-end `getTaskFacts` calls:
- `GET /api/task-memory/tasks/{taskId}/facts`

Backend currently implements:
- `POST /api/task-memory/tasks/{task_id}/facts` (write)
- `GET /api/task-memory/tasks/{task_id}` (returns `TaskMemoryResponse` including `facts`)
- No `GET .../tasks/{task_id}/facts`

So you must explicitly verify:
1. `GET /api/task-memory/tasks/{task_id}/facts`
   - Expect: likely `404` (risk)
2. `GET /api/task-memory/tasks/{task_id}`
   - Expect: returns `facts`

If task-detail facts are not updating, this endpoint mismatch is the first thing to fix.

---

## 3. Progress handling (how to track status)

Use these states per item:
- `未开始`: not tested
- `进行中`: testing
- `已完成`: API/SSE/UI checks passed
- `已阻塞`: blocked by environment/dependency or missing endpoint

After each verification, add a short conclusion line at the end of that section, e.g.:
- `A-01: 已完成（authorize before start 返回400，start后 authorize 返回 success=true）`
- `H-02: 进行中（task-detail facts GET /facts 可能404；需前端改为 GET /api/task-memory/tasks/{taskId}）`

