# 后端 API 实现指南

**更新时间**: 2026-04-05  
**目标**: 实现前端需要的 2 个新 API

---

## 📋 概述

前端任务进度可视化系统已 100% 完成，需要后端配合实现 2 个新 API：

1. **获取任务对话历史** - `GET /api/tasks/{task_id}/conversation`
2. **发送对话消息** - `POST /api/tasks/{task_id}/conversation/message`

---

## 🔧 API 1: 获取任务对话历史

### 接口定义

```python
# backend/app/gateway/routers/tasks.py

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

router = APIRouter()

class Message(BaseModel):
    """对话消息"""
    id: str
    type: str  # 'human' or 'ai'
    content: str
    timestamp: datetime
    tool_calls: Optional[List[dict]] = None
    metadata: Optional[dict] = None

class TaskConversationResponse(BaseModel):
    """任务对话响应"""
    thread_id: str
    messages: List[Message]
    total_count: int

@router.get("/{task_id}/conversation", response_model=TaskConversationResponse)
async def get_task_conversation(task_id: str):
    """
    获取任务绑定的聊天对话历史
    
    Args:
        task_id: 任务 ID
        
    Returns:
        TaskConversationResponse: 对话历史对象
        
    Raises:
        HTTPException: 404 - 任务不存在或没有绑定线程
    """
    from backend.app.gateway.dependencies import get_project_storage
    
    # 1. 加载任务
    storage = get_project_storage()
    task = storage.load_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 2. 检查是否绑定线程
    if not task.thread_id:
        # 返回空对话列表，而不是错误
        return TaskConversationResponse(
            thread_id="",
            messages=[],
            total_count=0
        )
    
    # 3. 获取对话历史（LangGraph API）
    from langgraph.api.client import LangGraphClient
    
    client = LangGraphClient()
    
    try:
        messages_response = await client.threads.get_messages(
            thread_id=task.thread_id,
            limit=100  # 最近 100 条
        )
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to fetch messages: {str(e)}"
        )
    
    # 4. 转换为前端格式
    messages = []
    for msg in messages_response:
        # 确定消息类型
        msg_type = 'human' if msg.get('role') == 'human' else 'ai'
        
        messages.append(
            Message(
                id=msg.get("id", ""),
                type=msg_type,
                content=msg.get("content", ""),
                timestamp=msg.get("timestamp", datetime.now()),
                tool_calls=msg.get("tool_calls"),
                metadata=msg.get("metadata")
            )
        )
    
    return TaskConversationResponse(
        thread_id=task.thread_id,
        messages=messages,
        total_count=len(messages)
    )
```

### 测试用例

```python
# 测试 1: 获取有对话的任务
async def test_get_conversation_with_thread():
    response = await client.get("/api/tasks/task-123/conversation")
    assert response.status_code == 200
    data = response.json()
    assert data["thread_id"] != ""
    assert len(data["messages"]) > 0
    assert data["total_count"] == len(data["messages"])

# 测试 2: 获取没有绑定线程的任务
async def test_get_conversation_without_thread():
    response = await client.get("/api/tasks/task-456/conversation")
    assert response.status_code == 200
    data = response.json()
    assert data["thread_id"] == ""
    assert len(data["messages"]) == 0
    assert data["total_count"] == 0

# 测试 3: 获取不存在的任务
async def test_get_conversation_not_found():
    response = await client.get("/api/tasks/non-existent/conversation")
    assert response.status_code == 404
```

---

## 🔧 API 2: 发送对话消息

### 接口定义

```python
# backend/app/gateway/routers/tasks.py

class SendMessageRequest(BaseModel):
    """发送消息请求"""
    content: str
    thread_id: str

class SendMessageResponse(BaseModel):
    """发送消息响应"""
    success: bool
    message_id: str
    timestamp: datetime

@router.post("/{task_id}/conversation/message", response_model=SendMessageResponse)
async def send_task_message(task_id: str, request: SendMessageRequest):
    """
    向任务绑定的线程发送对话消息
    
    Args:
        task_id: 任务 ID
        request: 发送消息请求
        
    Returns:
        SendMessageResponse: 发送结果
        
    Raises:
        HTTPException: 404 - 任务不存在
        HTTPException: 400 - 线程 ID 不匹配
    """
    from backend.app.gateway.dependencies import get_project_storage
    from langgraph.api.client import LangGraphClient
    import uuid
    from datetime import datetime
    
    # 1. 验证任务
    storage = get_project_storage()
    task = storage.load_task(task_id)
    
    if not task:
        raise HTTPException(status_code=404, detail="Task not found")
    
    # 2. 验证线程 ID 是否匹配
    if task.thread_id and task.thread_id != request.thread_id:
        raise HTTPException(
            status_code=400,
            detail="Thread ID does not match task's thread"
        )
    
    # 3. 发送消息到 LangGraph
    client = LangGraphClient()
    
    try:
        # 使用 LangGraph API 发送消息
        response = await client.threads.send_message(
            thread_id=request.thread_id,
            content=request.content,
            role="human"
        )
        
        message_id = response.get("id", str(uuid.uuid4()))
        timestamp = datetime.now()
        
    except Exception as e:
        raise HTTPException(
            status_code=500,
            detail=f"Failed to send message: {str(e)}"
        )
    
    # 4. 触发 SSE 事件（通知其他客户端）
    from backend.app.gateway.routers.events import broadcast_event
    
    await broadcast_event(
        event_type="thread:message",
        data={
            "task_id": task_id,
            "thread_id": request.thread_id,
            "message": {
                "id": message_id,
                "type": "human",
                "content": request.content,
                "timestamp": timestamp.isoformat()
            }
        },
        project_id=task.parent_project_id
    )
    
    return SendMessageResponse(
        success=True,
        message_id=message_id,
        timestamp=timestamp
    )
```

### 测试用例

```python
# 测试 1: 成功发送消息
async def test_send_message_success():
    request = SendMessageRequest(
        content="你好，请帮我分析这个任务",
        thread_id="thread-123"
    )
    response = await client.post("/api/tasks/task-123/conversation/message", json=request.dict())
    assert response.status_code == 200
    data = response.json()
    assert data["success"] == True
    assert data["message_id"] != ""
    assert "timestamp" in data

# 测试 2: 线程 ID 不匹配
async def test_send_message_thread_mismatch():
    request = SendMessageRequest(
        content="测试消息",
        thread_id="wrong-thread"
    )
    response = await client.post("/api/tasks/task-123/conversation/message", json=request.dict())
    assert response.status_code == 400

# 测试 3: 任务不存在
async def test_send_message_task_not_found():
    request = SendMessageRequest(
        content="测试消息",
        thread_id="thread-123"
    )
    response = await client.post("/api/tasks/non-existent/conversation/message", json=request.dict())
    assert response.status_code == 404
```

---

## 🔧 CORS 配置

### 开发环境配置

```python
# backend/main.py 或 backend/app/gateway/main.py

from fastapi.middleware.cors import CORSMiddleware

app = FastAPI()

# 添加 CORS 中间件
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",  # Vite 开发服务器
        "http://localhost:3000",  # 其他可能的端口
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],  # 允许所有 HTTP 方法
    allow_headers=["*"],  # 允许所有 HTTP 头
    allow_origins_regex=None,
)
```

### 生产环境配置

```python
# 生产环境使用环境变量配置
import os

ALLOWED_ORIGINS = os.getenv(
    "ALLOWED_ORIGINS",
    "http://localhost:5173,http://localhost:3000"
).split(",")

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
```

---

## 📦 依赖检查

### 需要的依赖

```python
# requirements.txt 或 pyproject.toml

# 已有依赖
fastapi >= 0.100.0
uvicorn >= 0.23.0
pydantic >= 2.0.0

# LangGraph（应该已有）
langgraph >= 0.0.1
```

### 导入检查

确保以下模块可以正常导入：

```python
# 测试导入
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime
from langgraph.api.client import LangGraphClient
```

---

## 🧪 本地测试

### 1. 启动后端服务

```bash
cd backend
uvicorn app.gateway.main:app --reload --host 0.0.0.0 --port 8000
```

### 2. 测试 API

使用 curl 或 Postman 测试：

```bash
# 测试获取对话历史
curl -X GET "http://localhost:8000/api/tasks/task-123/conversation"

# 测试发送消息
curl -X POST "http://localhost:8000/api/tasks/task-123/conversation/message" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "你好，请帮我分析这个任务",
    "thread_id": "thread-123"
  }'
```

### 3. 前端联调

启动前端开发服务器：

```bash
cd deerpanel
npm run dev
```

在浏览器控制台测试：

```javascript
// 测试获取对话
const response = await fetch('http://localhost:8000/api/tasks/task-123/conversation')
const data = await response.json()
console.log(data)

// 测试发送消息
const response = await fetch('http://localhost:8000/api/tasks/task-123/conversation/message', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    content: '测试消息',
    thread_id: 'thread-123'
  })
})
const data = await response.json()
console.log(data)
```

---

## 📝 实现步骤

### Step 1: 创建数据模型

在 `backend/app/gateway/models.py` 或 `tasks.py` 中添加：

```python
class Message(BaseModel):
    """对话消息"""
    id: str
    type: str
    content: str
    timestamp: datetime
    tool_calls: Optional[List[dict]] = None
    metadata: Optional[dict] = None

class TaskConversationResponse(BaseModel):
    """任务对话响应"""
    thread_id: str
    messages: List[Message]
    total_count: int

class SendMessageRequest(BaseModel):
    """发送消息请求"""
    content: str
    thread_id: str

class SendMessageResponse(BaseModel):
    """发送消息响应"""
    success: bool
    message_id: str
    timestamp: datetime
```

### Step 2: 实现 GET 接口

在 `backend/app/gateway/routers/tasks.py` 中添加 `get_task_conversation` 函数

### Step 3: 实现 POST 接口

在 `backend/app/gateway/routers/tasks.py` 中添加 `send_task_message` 函数

### Step 4: 配置 CORS

在 `backend/main.py` 或 `backend/app/gateway/main.py` 中添加 CORS 中间件

### Step 5: 测试验证

运行单元测试和手动测试

### Step 6: 前端联调

启动前端进行联调测试

---

## 🎯 验收标准

- [ ] 2 个新 API 正常响应
- [ ] CORS 配置正确，前端可以访问
- [ ] 单元测试通过
- [ ] 前端可以正常调用 API
- [ ] SSE 事件正常推送
- [ ] 错误处理完善（404, 400, 500）
- [ ] 代码符合项目规范

---

## 🐛 常见问题

### 问题 1: LangGraph API 不可用

**症状**: 调用 LangGraph 客户端时报错

**解决**: 
```python
# 确保 LangGraph 版本兼容
pip install --upgrade langgraph

# 检查 API 文档确认方法签名
from langgraph.api.client import LangGraphClient
help(LangGraphClient.threads.get_messages)
```

### 问题 2: CORS 错误

**症状**: 前端请求被浏览器拦截

**解决**:
- 检查 CORS 中间件是否正确添加
- 确认 origins 配置包含前端地址
- 检查 allow_credentials 是否为 True

### 问题 3: SSE 事件未推送

**症状**: 消息发送成功但其他客户端未收到推送

**解决**:
```python
# 确保 broadcast_event 正确调用
from backend.app.gateway.routers.events import broadcast_event

await broadcast_event(
    event_type="thread:message",
    data={...},
    project_id=task.parent_project_id
)
```

---

## 📖 参考文档

- [FastAPI CORS](https://fastapi.tiangolo.com/tutorial/cors/)
- [LangGraph API](https://langchain-ai.github.io/langgraph/)
- [DeerFlow 前端实现进度.md](./DeerFlow 前端实现进度.md)
- [页面状态恢复集成指南.md](./页面状态恢复集成指南.md)

---

**实现完成后，前端即可完整投入使用！** 🎉

**最后更新**: 2026-04-05
