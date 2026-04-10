# 正飞进化系统 V6.0 - 双后端架构设计

## 架构概览

```
┌─────────────────────────────────────────────────────────────┐
│                    zhengfeiClaw 主应用                        │
│                   (Electron + React)                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              │ HTTP / IPC
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                 正飞进化系统后端服务                           │
│                   (Python FastAPI)                           │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  记忆服务     │  │  推理服务     │  │  进化服务     │       │
│  │ MemoryService│  │ InferenceSvc │  │ EvolutionSvc │       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
│                                                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐       │
│  │  情绪服务     │  │  能力服务     │  │  联动服务     │       │
│  │ EmotionService│  │CapabilitySvc │  │ LinkerService│       │
│  └──────────────┘  └──────────────┘  └──────────────┘       │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                     数据存储层                                │
│            (本地 JSON / SQLite)                              │
└─────────────────────────────────────────────────────────────┘
```

## API 设计

### 1. 记忆服务 API

```
POST   /api/memory/add          # 添加记忆
POST   /api/memory/search       # 搜索记忆
GET    /api/memory/stats        # 获取统计
DELETE /api/memory/{id}         # 删除记忆
GET    /api/memory/context      # 获取任务上下文
POST   /api/memory/conflicts    # 检测冲突
```

### 2. 推理服务 API

```
POST   /api/inference/query     # 推理查询
POST   /api/inference/path      # 路径查找
GET    /api/inference/related   # 相关概念
POST   /api/knowledge/node      # 添加知识节点
POST   /api/knowledge/edge      # 添加知识关系
```

### 3. 情绪服务 API

```
POST   /api/emotion/analyze     # 分析情绪
GET    /api/emotion/trend       # 情绪趋势
GET    /api/emotion/context     # 情绪感知上下文
```

### 4. 进化服务 API

```
POST   /api/evolution/trigger   # 触发进化
POST   /api/evolution/feedback  # 记录反馈
POST   /api/evolution/optimize  # 自动优化
GET    /api/evolution/params    # 获取参数
```

### 5. 能力服务 API

```
POST   /api/capability/generate # 自动生成能力
POST   /api/capability/match    # 匹配能力
POST   /api/capability/effect   # 记录效果
GET    /api/capability/top      # 获取顶级能力
```

### 6. 联动服务 API

```
GET    /api/linker/context/{skill}  # 获取技能上下文
GET    /api/linker/all              # 获取所有技能上下文
POST   /api/linker/register         # 注册技能映射
```

## 目录结构

```
zhengfei-evolution-system/
├── server/                     # 后端服务
│   ├── main.py                 # FastAPI 入口
│   ├── config.py               # 配置管理
│   ├── routers/                # API 路由
│   │   ├── memory.py           # 记忆服务路由
│   │   ├── inference.py        # 推理服务路由
│   │   ├── emotion.py          # 情绪服务路由
│   │   ├── evolution.py        # 进化服务路由
│   │   ├── capability.py       # 能力服务路由
│   │   └── linker.py           # 联动服务路由
│   ├── services/               # 业务逻辑层
│   │   ├── memory_service.py
│   │   ├── inference_service.py
│   │   ├── emotion_service.py
│   │   ├── evolution_service.py
│   │   ├── capability_service.py
│   │   └── linker_service.py
│   ├── models/                 # 数据模型
│   │   ├── memory.py
│   │   ├── knowledge.py
│   │   ├── emotion.py
│   │   └── capability.py
│   └── utils/                  # 工具函数
│       ├── storage.py
│       └── helpers.py
├── core/                       # 核心引擎（保留独立可用）
│   ├── zhengfei-memory-core.py
│   ├── zhengfei-knowledge-graph.py
│   ├── zhengfei-meta-evolution.py
│   ├── zhengfei-capability-automation.py
│   └── zhengfei-cross-skill-linker.py
├── cli/                        # 命令行工具
│   └── zhengfei-commands.py
├── data/                       # 数据目录
│   ├── memory/
│   ├── knowledge/
│   └── evolution/
├── tests/                      # 测试
│   ├── test_memory.py
│   ├── test_inference.py
│   └── test_api.py
├── SKILL.md
├── DESIGN-PHILOSOPHY.md
├── requirements.txt
└── start-server.py             # 启动脚本
```

## 集成方式

### 方式一：HTTP 调用（推荐）

```python
# Electron 主进程调用
import requests

response = requests.post('http://localhost:8765/api/memory/add', json={
    'text': '用户偏好TypeScript开发',
    'confidence': 0.9,
    'source': 'conversation'
})
```

### 方式二：直接 Python 调用

```python
# 直接导入服务
from services.memory_service import MemoryService

service = MemoryService()
result = service.add_memory(
    text='用户偏好TypeScript开发',
    confidence=0.9
)
```

### 方式三：CLI 调用

```bash
python cli/zhengfei-commands.py 搜索 "TypeScript"
```

## 启动方式

```bash
# 启动后端服务
python start-server.py --port 8765

# 或使用 uvicorn
uvicorn server.main:app --host 0.0.0.0 --port 8765
```

## 优势

1. **解耦**：主应用与进化系统独立部署
2. **灵活**：支持 HTTP / 直接调用 / CLI 三种方式
3. **可测试**：每个服务独立测试
4. **可扩展**：新增服务只需添加路由
5. **高性能**：FastAPI 异步支持
6. **标准化**：OpenAPI 文档自动生成
