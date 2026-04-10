# DeerFlow vs CodeBuddy 工具体系对比与优化建议

> 生成时间：2026-04-10
> 对比范围：DeerFlow 项目工具 (backend/packages/harness/deerflow) vs CodeBuddy IDE 内置工具

---

## 目录

1. [架构定位差异](#1-架构定位差异)
2. [完整工具清单对比](#2-完整工具清单对比)
3. [功能重叠工具详细对比](#3-功能重叠工具详细对比)
4. [各方独有工具分析](#4-各方独有工具分析)
5. [代码质量问题诊断](#5-代码质量问题诊断)
6. [优化建议（按优先级排序）](#6-优化建议按优先级排序)
7. [具体优化步骤](#7-具体优化步骤)

---

## 1. 架构定位差异

```
┌─────────────────────────────────────────────────────────────────────┐
│                    CodeBuddy (IDE 内嵌 AI 助手)                       │
├─────────────────────────────────────────────────────────────────────┤
│ 运行环境:   Windows PowerShell (宿主机直接执行)                        │
│ 定位:       开发者日常编程助手，深度集成 IDE                           │
│ 核心优势:   文件操作丰富、团队协作、自动化任务、IDE 集成               │
│ 工具数量:   20 个基础工具 + 40+ 技能                                 │
│ 安全模型:   宿主机权限（用户自行负责）                                │
│ 扩展方式:   Skills（技能包）、MCP Server                             │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                   DeerFlow (后端 AI Agent 框架)                      │
├─────────────────────────────────────────────────────────────────────┤
│ 运行环境:   Linux Docker 沙箱 / Local Sandbox                        │
│ 定位:       多 Agent 编排与执行引擎                                  │
│ 核心优势:   Supervisor 编排、沙箱安全、多源搜索、ACP 协议             │
│ 工具数量:   8 内置 + 5 沙箱 + 8 搜索源 + MCP 动态 + ACP              │
│ 安全模型:   路径验证 / 虚拟路径映射 / 网络隔离 / 权限门控            │
│ 扩展方式:   Community 模块 / MCP Server / ACP Agent / Deferred Tools │
└─────────────────────────────────────────────────────────────────────┘
```

### 关键架构差异总结

| 维度 | CodeBuddy | DeerFlow |
|------|-----------|----------|
| **执行上下文** | IDE 进程内 | 独立沙箱容器/进程 |
| **文件系统** | 直接访问宿主机 | 虚拟路径 (`/mnt/user-data`) 映射 |
| **命令执行** | `execute_command` (PowerShell/CMD) | `bash` (Linux, 带安全检查链) |
| **搜索能力** | 单一内置搜索引擎 | 多源可插拔 (百度/Bing/DDG/Tavily/Firecrawl...) |
| **多Agent** | `task` (子代理) + `team` (团队) | `task` (子代理) + `supervisor` (编排器) + ACP |
| **持久化记忆** | `update_memory` + `RAG_search` | Task Memory (collab/storage) |
| **自动化** | `automation_update` (定时/一次性) | 无原生自动化（依赖外部调度） |
| **IDE 集成** | `read_lints` / `preview_url` / `install_binary` | 无 IDE 概念 |

---

## 2. 完整工具清单对比

### 2.1 功能映射表（相同或相似功能）

| # | 功能 | CodeBuddy 工具名 | DeerFlow 工具名 | 差异程度 |
|---|------|------------------|-----------------|----------|
| 1 | 执行命令 | `execute_command` | `bash` (sandbox) | ⚠️ 中等：环境不同，安全策略不同 |
| 2 | 列出目录 | `list_dir` | `ls` (sandbox) | ⚠️ 中等：CB 更灵活，DF 固定 2 层深度 |
| 3 | 读取文件 | `read_file` | `read_file` (sandbox) | 🔵 小：CB 支持图片，DF 支持行切片 |
| 4 | 写入文件 | `write_to_file` | `write_file` (sandbox) | 🟢 小：DF 支持 `append` 模式 |
| 5 | 替换编辑 | `replace_in_file` | `str_replace` (sandbox) | 🟢 小：DF 支持 `replace_all` 全局替换 |
| 6 | 网络搜索 | `web_search` | `web_search` (baidu_search) | 🔴 大：搜索引擎和实现完全不同 |
| 7 | 子代理委派 | `task` | `task` (builtin) | ⚠️ 中等：参数模型、协作集成深度不同 |
| 8 | 技能/工具发现 | `use_skill` | `tool_search` (builtin) | 🟡 不同范式：CB 加载 Skill 包，DF 延迟获取 schema |

### 2.2 CodeBuddy 独有工具（16 个）

| # | 工具名 | 功能说明 | DeerFlow 替代方案 | 可移植性评估 |
|---|--------|----------|-------------------|-------------|
| 1 | `delete_file` | 删除指定文件 | ❌ 无 | ✅ 易实现：在 sandbox/tools.py 新增即可 |
| 2 | `search_content` | ripgrep 正则内容搜索（支持上下文行/类型过滤/计数） | ❌ 无（只能用 bash+grep） | ✅ 易实现：新增独立工具 |
| 3 | `team_create` | 创建多代理团队 | ❌ 无（supervisor 本身隐含了类似概念） | ⚠️ 需设计团队抽象层 |
| 4 | `team_delete` | 删除团队及清理资源 | ❌ 无 | ⚠️ 配合 team_create |
| 5 | `send_message` | 团队消息通信（5 种类型） | ❌ 无（无 Agent 间通信机制） | 🔴 需要 IPC 设计 |
| 6 | `todo_write` | 结构化待办事项 CRUD | ❌ 无（supervisor 的 subtask 是替代但更重） | ⚠️ 可作为轻量级补充 |
| 7 | `automation_update` | 定时/一次性自动化任务管理 | ❌ 无 | ⚠️ 需要 scheduler 集成（APScheduler？） |
| 8 | `update_memory` | 持久化知识库记忆（CRUD） | ❌ 无（只有 task_memory） | ✅ 易实现：KV 存储 |
| 9 | `RAG_search` | 8 个专业知识库检索 | ❌ 无 | ⚠️ 需要接入知识库后端 |
| 10 | `invoke_integration` | 云服务集成（5 个） | ❌ 无 | ⚠️ 需要云 SDK 集成 |
| 11 | `ask_followup_question` | 结构化多选项问答收集 | ⚠️ `ask_clarification` (部分覆盖) | 🟡 已有类似工具 |
| 12 | `read_lints` | IDE Linter 错误检查 | ❌ 无（无 IDE 概念） | ❌ 不适用（非 IDE 场景） |
| 13 | `install_binary` | Python/Node 运行时安装 | ❌ 无（沙箱环境预装） | ⚠️ 沙箱安全限制 |
| 14 | `preview_url` | 内置浏览器 URL 预览 | ❌ 无 | ⚠️ 需要浏览器服务 |
| 15 | `web_fetch` | URL 抓取转 Markdown 分析 | ⚠️ jina_ai 有但被硬禁用 | ✅ 可重新启用 jina_ai 或自建 |
| 16 | `list_dir` (增强版) | 忽略模式、递归搜索 | `ls` 仅树形 2 层 | ✅ 增强 ls 即可 |

### 2.3 DeerFlow 独有工具（9 个）

| # | 工具名 | 功能说明 | 文件大小 | 复杂度 | CodeBuddy 替代方案 |
|---|--------|----------|---------|--------|--------------------|
| 1 | **`supervisor`** | 多 Agent 任务编排引擎（创建主任务/子任务/分配/并行执行/依赖管理/监控/收敛） | **120.9 KB / 2868 行** | 🔴 极高 | ❌ 无（CB 的 team 是简单消息通信） |
| 2 | `present_files` | 向用户展示文件（仅 `/mnt/user-data/outputs` 路径） | 3.7 KB | 🟢 低 | ❌ 无（CB 无 outputs 路径概念） |
| 3 | `ask_clarification` | 向用户提问并中断执行等待响应（5 种类型） | 2.6 KB | 🟢 低 | ⚠️ `ask_followup_question` (部分覆盖但不中断) |
| 4 | `setup_agent` | 创建自定义 Agent（写 SOUL.md + config.yaml） | 2.2 KB | 🟢 低 | ❌ 无 |
| 5 | `view_image` | 图片文件读取转 base64（给视觉模型用） | 3.5 KB | 🟢 低 | ⚠️ `read_file` 支持图片（但不转 base64 给模型） |
| 6 | `invoke_acp_agent` | 调用外部 ACP 兼容代理（如 Claude Code） | 9.5 KB | 🟡 中 | ❌ 无 |
| 7 | `advanced_search` | 多引擎深度搜索（quick/standard/deep 三级） | 19.9 KB (+10 个变体文件) | 🟡 中 | ❌ 无 |
| 8 | `quick_search` | 快速搜索变体 | - | - | ❌ 无 |
| 9 | `deep_search` | 深度搜索变体 | - | - | ❌ 无 |
| 10 | `image_search` | DuckDuckGo 图片搜索 | 4.4 KB | 🟢 低 | ❌ 无 |

---

## 3. 功能重叠工具详细对比

### 3.1 命令执行：`execute_command` vs `bash`

| 维度 | CodeBuddy `execute_command` | DeerFlow `bash` (sandbox) |
|------|----------------------------|---------------------------|
| **运行环境** | Windows PowerShell / CMD | Linux Bash (Docker / WSL) |
| **权限模型** | 用户级审批 (`requires_approval`) | 多层安全检查链 |
| **参数** | `command`, `explanation`, `requires_approval` | `description`(必填), `command`(必填) |
| **安全检查** | 无（信任用户） | 5 层：web_search 检测 → 网络命令检测 → Linux-only 检测 → 路径验证 → 虚拟路径映射 |
| **路径处理** | 直接使用 Windows 路径 | `/mnt/user-data` 虚拟路径 → 宿主路径映射 |
| **输出处理** | 原始返回 | `mask_local_paths_in_output()` 脱敏 |
| **网络访问** | 允许 | 默认禁止 (`DEERFLOW_ALLOW_NETWORK_IN_BASH`) |
| **错误处理** | 直接抛异常 | 结构化错误 (`SandboxError`, `PermissionError`) |

**DeerFlow bash 安全检查链详解** (`sandbox/tools.py:912-956`):

```python
# 第 1 层：检测 shell 层面的 web_search 行为
if _looks_like_shell_web_search(command):
    return "Error: Network search via shell is disabled..."

# 第 2 层：检测网络相关命令 (curl/wget/requests/...)
if (not _bash_network_access_allowed()) and _looks_like_network_command(command):
    return "Error: Network access via bash is disabled..."

# 第 3 层：检测 Linux-only 命令 (grep/sed/awk/...)
if is_local_sandbox(runtime) and _looks_like_linux_shell_only(command):
    return "Error: LOCAL_HOST mode detected..."

# 第 4 层：路径验证（虚拟路径 /mnt/...）
validate_local_bash_command_paths(command, thread_data)

# 第 5 层：虚拟路径替换 + 执行 + 输出脱敏
command = replace_virtual_paths_in_command(command, thread_data)
output = sandbox.execute_command(command)
return mask_local_paths_in_output(output, thread_data)
```

### 3.2 文件操作对比

#### `write_to_file` vs `write_file`

| 特性 | CodeBuddy | DeerFlow |
|------|-----------|----------|
| 写入模式 | 仅**覆盖** | **覆盖 + 追加** (`append=True`) |
| 第一参数 | filePath (绝对路径) | description (必填说明) + path (必填) |
| 路径校验 | 无 | `validate_local_tool_path()` + 路径遍历检测 |
| 目录创建 | 自动创建父目录 | `ensure_thread_directories_exist()` |
| 错误分类 | 通用异常 | `SandboxError` / `PermissionError` / `IsADirectoryError` / `OSError` |

#### `replace_in_file` vs `str_replace`

| 特性 | CodeBuddy | DeerFlow |
|------|-----------|----------|
| 匹配模式 | 精确匹配（必须唯一） | 精确匹配（默认唯一） |
| 全局替换 | ❌ 不支持 | ✅ `replace_all=True` |
| 实现 | 直接文件操作 | 读→替换→写（全量重写） |
| 路径安全 | 无 | 虚拟路径解析 + 校验 |

#### `read_file` 对比

| 特性 | CodeBuddy | DeerFlow |
|------|-----------|----------|
| 文本文件 | ✅ | ✅ |
| **图片文件** | ✅ (jpg/png/webp/gif) | ❌ （由独立的 `view_image` 负责） |
| **行范围切片** | 通过 offset/limit 参数 | `start_line`(1-indexed) + `end_line`(1-indexed) |
| 大文件处理 | 分段读取 | 同样支持 |

### 3.3 网络搜索对比

| 维度 | CodeBuddy `web_search` | DeerFlow `web_search` (baidu_search) |
|------|------------------------|-------------------------------------|
| **搜索引擎** | 内置（未公开具体实现） | 百度 (Playwright 优先) + Bing (fallback) |
| **API Key** | 不需要 | 不需要（纯爬虫） |
| **结果格式** | 结构化搜索结果块 | JSON（含 title/url/content/_score/_authority/_quality） |
| **内容提取** | 摘要级别 | **深度提取**（最多 5000 字/条，Playwright 渲染后提取） |
| **缓存机制** | 未知 | storage_state cookie 缓存 (TTL 7 天) |
| **安全验证绕过** | N/A | Playwright 绕过百度验证码 + storage_state 复用 |
| **版本迭代** | 稳定 | **高度活跃**：已有 V1 → V2 (tools_fast/tools_fast_v2/tools_stream/tools_stream_v2/tools_smart/tools_super/tools_ultimate/tools_ultra 共 10 个版本变体文件) |
| **Fallback** | 无 | FastSearchV2 失败 → 回退到 `_search_text` (百度+Bing 并行) |

**DeerFlow 搜索架构（当前实际调用链）**:

```
web_search_tool()
  ↓
tools_fast_v2.fast_search_v2()  ← 当前默认
  ↓ (失败时回退)
_search_text()
  ↓ (并行)
_baidu_html_search()  +  _bing_html_search()
  ↓ (_baidu_html_search 内部)
_baidu_playwright_search()  ← 优先 (Playwright 真浏览器)
  ↓ (失败时 fallback)
urllib 直接请求 (mobile endpoint → desktop endpoint)
```

### 3.4 子代理委派：`task` 对比

| 维度 | CodeBuddy `task` | DeerFlow `task` |
|------|------------------|-----------------|
| **代码量** | (内部实现未知) | **35.9 KB / 798 行** |
| **同步/异步** | 同步（阻塞等待） | 异步（后台执行 + 轮询） |
| **子代理类型** | `code-explorer` (一种) | `general-purpose` + `bash` (两种) |
| **协作集成** | 无 | **深度集成** collab 系统（任务存储/SSE 广播/进度追踪/自动 follow-up wave） |
| **流式输出** | 最终结果 | 实时流式 (task_running/task_completed/task_failed 事件) |
| **超时控制** | max_turns | timeout_seconds + poll timeout buffer |
| **WorkerProfile** | 无 | ✅ 工具白名单 / 技能集 / 依赖声明 / 模型覆盖 / 自定义指令 |
| **取消处理** | 无 | `asyncio.CancelledError` + 延迟清理 |
| **Detached 模式** | 无 | ✅ 后台脱离执行 (detach=True) |
| **工具调用观测** | 无 | ✅ observed_tools / observed_tool_calls 持久化 |
| **依赖链自动推进** | 无 | ✅ `auto_delegate_collab_followup_wave()` |

---

## 4. 各方独有工具分析

### 4.1 CodeBuddy 独有工具的价值评估

#### 高价值（DeerFlow 应考虑引入）

**① `delete_file`**
- **价值**: 文件操作的必要组成（CRUD 缺 D）
- **实现难度**: 极低（~20 行代码）
- **建议位置**: `sandbox/tools.py`
- **安全考量**: 需要路径校验 + 禁止删除关键目录

**② `search_content` (ripgrep)**
- **价值**: 代码探索的核心能力。当前 DF 只能用 `bash` + `grep`，效率低且不结构化
- **实现难度**: 低～中（需引入 ripgrep 或用 Python re 模块模拟）
- **功能需求**: 正则匹配、上下文行 (-A/-B/-C)、文件类型过滤 (.py/.md...)、计数模式
- **参考实现**: CodeBuddy 版本基于 `ripgrep`，输出格式统一

**③ `web_fetch` (URL 内容抓取)**
- **价值**: 搜索后的必要跟进——获取具体 URL 内容
- **现状**: DeerFlow 的 `jina_ai` 模块有此功能但被**硬禁用**（`_is_disabled_tool()`）
- **修复方案**: 
  - 方案 A：解除 jina_ai 禁用（需要 API Key）
  - 方案 B：基于 urllib + _strip_html 自建（baidu_search 已有类似逻辑）
  - 方案 C：集成到 baidu_search 的 `_fetch_page_text_fallback()` 作为独立工具

**④ `todo_write` (轻量待办)**
- **价值**: supervisor 的 subtask 太"重"（需要 collab 存储等基础设施），需要一个轻量级的 todo 工具供单 Agent 使用
- **实现难度**: 低（内存 JSON 文件存储）
- **与 supervisor 区别**: todo 用于单次对话内的临时任务跟踪；subtask 用于跨 Agent 的正式任务分发

#### 中等价值（视场景而定）

**⑤ `update_memory` + `RAG_search`**
- **价值**: 跨会话的知识积累
- **现状**: DeerFlow 有 task_memory 但局限于单个任务上下文
- **建议**: 可以基于 collab storage 扩展为全局知识库

**⑥ `automation_update` (定时任务)**
- **价值**: 解放用户——自动执行周期性任务
- **实现复杂度**: 中～高（需要 APScheduler / Celery 等调度器）
- **替代方案**: 外部 cron + API 调用

**⑦ `preview_url` (浏览器预览)**
- **价值**: 让 Agent 能"看到"网页渲染效果
- **现状**: DeerFlow 已有 Playwright（用于百度搜索），可以复用
- **复用可行性**: ✅ 高（baidu_search 已经证明 Playwright 在项目中可用）

#### 低价值 / 不适用于 DeerFlow

- `read_lints` — 无 IDE 概念
- `install_binary` — 沙箱环境应预装
- `team_create/team_delete/send_message` — DeerFlow 用 supervisor 替代
- `invoke_integration` — 需求场景不同

### 4.2 DeerFlow 独有工具的亮点

#### **`supervisor` (120.9 KB, 2868 行) — 核心竞争力**

这是 DeerFlow 最具差异化竞争力的工具，也是代码量最大的单一模块。

**能力矩阵**:

| Action | 说明 | 复杂度 |
|--------|------|--------|
| `create_task` | 创建主任务 + Project Bundle | 🟢 |
| `create_subtask` / `create_subtasks` | 批量创建子任务 + WorkerProfile + 依赖声明 | 🟡 |
| `start_execution` | **核心**: 依赖解析 → 并行委派 → 后台监控 | 🔴 |
| `monitor_execution` / `monitor_execution_step` | 实时监控 + 推荐信号 (continue_wait/retry_or_reassign/check_stalled) | 🟡 |
| `get_status` / `list_subtasks` | 富查询（含 memory snapshot / observed_tools） | 🟢 |
| `update_progress` | 进度更新 + rollup to root | 🟢 |
| `complete_subtask` | 子任务完成 + 自动 follow-up wave 触发 | 🟡 |
| `get_task_memory` | 任务记忆快照（facts/output_summary/progress/current_step） | 🟢 |
| `set_task_planned` | 标记计划阶段 | 🟢 |

**关键设计模式**:
- **依赖 DAG**: `depends_on` 支持按 ID 或名称引用上游子任务，自动拓扑排序
- **Auto-follow-up Wave**: 上游完成后自动启动下游（无需 LLM 再次调用 start_execution）
- **后台 Monitor**: `_ensure_background_task_monitor()` 保证 detached 任务不被丢失
- **自动终态收敛**: 所有子任务终态时自动设置 `collab_phase=DONE`
- **停滞检测**: 90 秒无 progress/current_step 变化 → `check_stalled` 推荐
- **不可达子任务跳过**: `_auto_finalize_unrunnable_pending_subtasks()` — 上游 failed 时自动 cancel 阻塞的下游

#### **`invoke_acp_agent` (ACP 协议集成)**

- 支持任何 ACP 兼容的外部 Agent（如 Claude Code / Codex）
- 独立 workspace 隔离（per-thread `acp-workspace/`）
- MCP Servers 自动桥接（DeerFlow 的 MCP 配置传递给 ACP Agent）
- Permission 自动批准策略（可配置 `auto_approve_permissions`）

---

## 5. 代码质量问题诊断

### 5.1 🔴 严重问题

#### P1: advanced_search 模块文件爆炸（11 个变体文件）

**现象**: `community/advanced_search/` 下存在 **11 个** tools 变体文件：

| 文件 | 大小 | 说明 |
|------|------|------|
| `tools.py` | 19.9 KB | 原始标准版 |
| `tools_enhanced.py` | 23.9 KB | 增强版 |
| `tools_fast.py` | 9.6 KB | 快速版 |
| `tools_fast_v2.py` | 22.0 KB | **快速 V2 ← 当前实际使用** |
| `tools_stream.py` | 16.6 KB | 流式版 |
| `tools_stream_v2.py` | 21.6 KB | 流式 V2 |
| `tools_smart.py` | 21.9 KB | 智能版 |
| `tools_super.py` | 21.7 KB | 超级版 |
| `tools_ultimate.py` | 31.3 KB | 终极版 |
| `tools_ultra.py` | 18.7 KB | 极速版 |
| `__init__.py` | 6.6 KB | 封装导出 |

**问题**:
- 只有 `tools_fast_v2` 被 `baidu_search/tools.py` 实际导入使用
- 其余 9 个文件是**死代码**，增加了维护负担和困惑
- 无法确定哪个是"正确"的最新版本

**建议**: 保留正在使用的版本，归档或删除其余变体。

#### P2: `supervisor_tool.py` 过于庞大（2868 行，120.9 KB）

**问题**:
- 单一文件承担了太多职责：任务 CRUD + 依赖解析 + 委派执行 + 监控 + 记忆聚合 + UI 步骤记录 + SSE 广播
- 至少可以拆分为 5-6 个独立模块

**建议拆分方案**:

```
tools/builtins/supervisor/
├── __init__.py           # 导出 supervisor_tool
├── actions/              # 每个 action 一个文件
│   ├── create_task.py
│   ├── create_subtask.py
│   ├── start_execution.py
│   ├── monitor_execution.py
│   ├── get_status.py
│   └── complete_subtask.py
├── dependency.py         # 依赖解析逻辑
├── monitor.py            # 后台监控器 + 停滞检测
├── memory.py             # 记忆聚合
└── ui_steps.py           # sidebar 步骤记录
```

#### P3: `task_tool.py` 与 `supervisor_tool.py` 强耦合

**现象**:
- `task_tool.py:368` 导入 `from deerflow.tools.builtins.supervisor_tool import auto_delegate_collab_followup_wave`
- `supervisor_task.py:327` 导入 `from deerflow.tools.builtins.task_tool import task_tool as tt`
- 循环依赖风险 + 单元测试困难

### 5.2 🟡 中等问题

#### M1: `sandbox/tools.py` 代码重复（路径解析逻辑）

**现象**: 以下路径解析代码块在每个沙箱工具函数中**重复出现 4 次**（ls/read_file/write_file/str_replace）：

```python
# 这个 ~15 行的模式重复 4+ 次
if is_local_sandbox(runtime):
    thread_data = get_thread_data(runtime)
    validate_local_tool_path(path, thread_data, read_only=True/False)
    if _is_skills_path(path):
        path = _resolve_skills_path(path)
    elif _is_acp_workspace_path(path):
        path = _resolve_acp_workspace_path(path, ...)
    elif not _use_virtual_paths(runtime):
        path = str(Path(path).resolve())
    elif _local_host_reads_enabled() and _is_explicit_host_filesystem_path(path):
        path = str(Path(path).resolve())
    else:
        path = _resolve_and_validate_user_data_path(path, thread_data)
```

**建议**: 提取为 `_resolve_sandbox_path(runtime, path, read_only)` 公共函数。

#### M2: `baidu_search` 的 Playwright 重量级依赖

**现象**:
- 每次 `web_search` 都可能启动 Chromium 浏览器（即使是无头模式）
- 在无 GPU / 低内存环境下可能失败或极慢
- storage_state 缓存缓解但不能完全消除

**影响**: 搜索延迟 5-30 秒不等，严重影响用户体验。

**建议**:
- 默认走 HTTP 快速路径（`_baidu_html_search`），仅在触发验证码时升级到 Playwright
- 引入搜索超时控制（目前 `allow_manual_seconds=20` 可能不够）

#### M3: `ddg_search` 是空壳兼容层

**文件**: `community/ddg_search/tools.py` (242 bytes)

```python
"""Compatibility shim."""
from deerflow.community.baidu_search.tools import web_search_tool
__all__ = ["web_search_tool"]
```

**问题**: 名字叫 ddg_search 但实际转发到 baidu_search，具有误导性。

**建议**: 要么真正实现 DuckDuckGo 搜索（使用 `duckduckgo-search` Python 库），要么删除这个空壳。

#### M4: `jina_ai` 硬禁用但没有清晰的迁移路径

```python
# tools/tools.py:37-43
def _is_disabled_tool(tool: object) -> bool:
    use = str(getattr(tool, "use", "") or "")
    if "deerflow.community.jina_ai" in use:
        return True  # 硬禁用
    return False
```

- 注释说 "User requirement"，但没有说明为什么禁用
- `advanced_search` 的 `_deep_extract()` 还尝试 `from deerflow.community.jina_ai.tools import web_fetch_tool`（会报 ImportError 被 except 吞掉）

**建议**: 明确 jina_ai 的禁因，并在代码注释中给出替代方案。

### 5.3 🟢 小问题 / 改进机会

#### S1: `QualityScorer._score_relevance()` 返回固定值

```python
# advanced_search/tools.py:113-117
def _score_relevance(self, result: SearchResult) -> float:
    # TODO: 使用 TF-IDF 或 BM25
    return 0.8  # 默认较高分 ← 硬编码！
```

相关性评分完全没用，所有结果得分相同。这使得评分排序基本无效。

#### S2: 沙箱工具的 `description` 参数冗余

每个沙箱工具都要求 `description` 作为第一个必填参数：
```python
def bash_tool(runtime, description: str, command: str) -> str:
def ls_tool(runtime, description: str, path: str) -> str:
def read_file_tool(runtime, description: str, path: str, ...) -> str:
...
```

这个 `description` 参数强制 LLM 在每次调用时都写一段解释，增加了 token 消耗但对实际执行没有作用。

#### S3: `tools_fast_v2.py` 等 10 个变体文件的命名不一致

没有遵循语义化版本规范，难以从名字判断功能差异（fast vs smart vs super vs ultimate vs ultra?）。

---

## 6. 优化建议（按优先级排序）

### 🔴 P0 - 必须立即处理（影响可维护性和稳定性）

| # | 建议 | 影响 | 工作量 | 风险 |
|---|------|------|--------|------|
| P0-1 | **清理 dead code**: 删除 advanced_search 下未使用的 9 个变体文件 | 减少混乱，避免用错版本 | 30 分钟 | 低 |
| P0-2 | **拆分 supervisor_tool.py**: 2868 行 → 多个模块 | 大幅提升可维护性 | 4-8 小时 | 中（需确保不破坏现有功能） |
| P0-3 | **提取沙箱路径解析公共函数**: 消除 4 处重复代码 | 减少 bugs，提升一致性 | 1 小时 | 低 |

### 🟡 P1 - 强烈建议（影响功能完整性）

| # | 建议 | 影响 | 工作量 | 风险 |
|---|------|------|--------|------|
| P1-1 | **新增 `delete_file` 工具**: 补齐文件 CRUD | 完整文件操作能力 | 30 分钟 | 低 |
| P1-2 | **新增 `search_content` 工具**: ripgrep 式内容搜索 | 代码探索效率大幅提升 | 2-4 小时 | 低 |
| P1-3 | **启用/重建 `web_fetch` 工具**: URL 内容抓取 | 搜索+抓取闭环 | 2-3 小时 | 低 |
| P1-4 | **修复 QualityScorer**: 实现真正的相关性评分 | 搜索结果排序质量 | 1-2 小时 | 低 |
| P1-5 | **解决 ddg_search 空壳问题**: 要么实现要么删除 | 代码诚实性 | 30 分钟 | 低 |

### 🟢 P2 - 建议改进（影响开发体验）

| # | 建议 | 影响 | 工作量 | 风险 |
|---|------|------|--------|------|
| P2-1 | **解耦 task_tool 和 supervisor_tool**: 消除循环依赖 | 可测试性 | 3-5 小时 | 中 |
| P2-2 | **优化搜索性能**: HTTP-first, Playwright-fallback | 搜索速度 5x 提升 | 2-3 小时 | 中 |
| P2-3 | **新增轻量级 `todo` 工具**: 单对话内任务跟踪 | Agent 自主规划能力 | 2 小时 | 低 |
| P2-4 | **标准化搜索版本管理**: 清理变体文件，建立版本策略 | 长期可维护性 | 2 小时 | 低 |
| P2-5 | **移除/可选化 `description` 冗余参数**: 减少 token 消耗 | 成本降低 (~5%) | 1 小时 | 低 |

### ⚪ P3 - 远期规划

| # | 建议 | 影响 | 工作量 |
|---|------|------|--------|
| P3-1 | **引入 `update_memory` + `RAG_search`**: 跨会话知识积累 | Agent 记忆能力 | 1-2 天 |
| P3-2 | **引入 `automation_update`**: 定时任务 | 自动化运营 | 2-3 天 |
| P3-3 | **`preview_url` 基于 Playwright 复用**: 网页可视化 | 调试体验 | 半天 |
| P3-4 | **统一搜索接口**: 把 baidu_search/advanced_search/ddg_search 合并为可配置的搜索策略模式 | 架构清晰 | 3-5 天 |

---

## 7. 具体优化步骤

### Step 1: 清理 Dead Code (P0-1)

**目标**: 删除 `community/advanced_search/` 下未使用的变体文件

**确认当前使用的版本**:
- `baidu_search/tools.py:702` 实际导入: `from tools_fast_v2 import fast_search_v2`
- 结论: **只有 `tools_fast_v2.py` 是活代码**

**操作**:

```
保留文件:
  ✓ community/advanced_search/__init__.py     (导出定义)
  ✓ community/advanced_search/tools_fast_v2.py  (实际使用)

归档/删除:
  ✗ community/advanced_search/tools.py          (原始版，被 v2 替代)
  ✗ community/advanced_search/tools_enhanced.py
  ✗ community/advanced_search/tools_fast.py
  ✗ community/advanced_search/tools_stream.py
  ✗ community/advanced_search/tools_stream_v2.py
  ✗ community/advanced_search/tools_smart.py
  ✗ community/advanced_search/tools_super.py
  ✗ community/advanced_search/tools_ultimate.py
  ✗ community/advanced_search/tools_ultra.py
```

**验证**: 运行现有测试套件 + 手动测试 `web_search` 功能

---

### Step 2: 提取沙箱路径解析公共函数 (P0-3)

**目标**: 在 `sandbox/tools.py` 中提取公共路径解析函数

**当前重复代码** (出现于 ls/read_file/write_file/str_replace 四个函数):

```python
# 新增公共函数 (放在 sandbox/tools.py 顶部工具函数定义区之前)
def _resolve_tool_path(
    runtime: ToolRuntime[ContextT, ThreadState] | None,
    path: str,
    *,
    read_only: bool = False,
) -> str:
    """Unified path resolution for all sandbox tools.
    
    Handles virtual paths (/mnt/user-data, /mnt/skills, /mnt/acp-workspace),
    host absolute paths, local sandbox mode, and security validation.
    """
    requested_path = path
    
    if is_local_sandbox(runtime):
        thread_data = get_thread_data(runtime)
        validate_local_tool_path(path, thread_data, read_only=read_only)
        
        if _is_skills_path(path):
            return _resolve_skills_path(path)
        if _is_acp_workspace_path(path):
            tid = _extract_thread_id_from_thread_data(thread_data)
            return _resolve_acp_workspace_path(path, tid)
        if not _use_virtual_paths(runtime):
            return str(Path(path).resolve())
        if _local_host_reads_enabled() and _is_explicit_host_filesystem_path(path):
            return str(Path(path).resolve())
        return _resolve_and_validate_user_data_path(path, thread_data)
    
    return path  # non-local sandbox: path is already correct


# 然后每个工具函数简化为:
@tool("read_file", parse_docstring=True)
def read_file_tool(runtime, description: str, path: str, 
                    start_line: int | None = None, end_line: int | None = None) -> str:
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        path = _resolve_tool_path(runtime, path, read_only=True)  # 一行搞定!
        content = sandbox.read_file(path)
        # ... rest of logic unchanged
```

**收益**: 减少约 **50 行重复代码**, 未来修改路径解析逻辑只需改一处。

---

### Step 3: 新增 `delete_file` 工具 (P1-1)

**位置**: `sandbox/tools.py` (与其他沙箱工具放在一起)

```python
@tool("delete_file", parse_docstring=True)
def delete_file_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    description: str,          # 必填：删除原因说明
    path: str,                  # 必填：要删除的文件绝对路径
) -> str:
    """Delete a file from the filesystem.
    
    Args:
        description: Reason for deleting this file. ALWAYS PROVIDE THIS PARAMETER FIRST.
        path: The **absolute** path to the file to delete. ALWAYS PROVIDE THIS PARAMETER SECOND.
    
    WARNING: This operation cannot be undone. Use with caution.
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        ensure_thread_directories_exist(runtime)
        requested_path = path
        
        if is_local_sandbox(runtime):
            thread_data = get_thread_data(runtime)
            validate_local_tool_path(path, thread_data)  # 不允许 read_only
            if not _use_virtual_paths(runtime):
                path = str(Path(path).resolve())
            else:
                path = _resolve_and_validate_user_data_path(path, thread_data)
        
        # 安全检查：不允许删除关键目录
        protected = {"/bin", "/usr/bin", "/sbin", "/etc", "/sys", "/proc"}
        normalized = Path(path).resolve()
        for pfx in protected:
            try:
                if normalized.is_relative_to(pfx):
                    return f"Error: Cannot delete system-protected path: {requested_path}"
            except ValueError:
                pass
        
        # 执行删除
        if not sandbox.path_exists(path):
            return f"Error: File not found: {requested_path}"
        
        sandbox.delete_file(path)
        return f"OK: Deleted {requested_path}"
        
    except SandboxError as e:
        return f"Error: {e}"
    except PermissionError:
        return f"Error: Permission denied deleting file: {requested_path}"
    except Exception as e:
        return f"Error: Unexpected error deleting file: {_sanitize_error(e, runtime)}"
```

**同时在 `Sandbox` 接口中添加 `path_exists()` 和 `delete_file()` 方法**（如果尚未存在的话）。

---

### Step 4: 新增 `search_content` 工具 (P1-2)

**位置**: `tools/builtins/search_content_tool.py` (新建文件)

```python
"""Content search tool using ripgrep-like regex search."""

import re
from pathlib import Path
from typing import Literal

from langchain.tools import ToolRuntime, tool
from langgraph.typing import ContextT

from deerflow.agents.thread_state import ThreadState
from deerflow.sandbox.tools import (
    get_thread_data,
    replace_virtual_path,
    ensure_sandbox_initialized,
    is_local_sandbox,
    _resolve_tool_path,
)


@tool("search_content", parse_docstring=True)
def search_content_tool(
    runtime: ToolRuntime[ContextT, ThreadState],
    description: str,
    pattern: str,
    path: str,
    *,
    context_before: int = 0,
    context_after: int = 0,
    case_sensitive: bool = False,
    output_mode: Literal["content", "count", "files_with_matches"] = "content",
    glob_pattern: str | None = None,
    max_results: int = 50,
) -> str:
    """Search file contents using regex patterns.
    
    Similar to ripgrep (rg), this tool searches for text patterns across files.
    
    Args:
        description: Why you are searching. ALWAYS PROVIDE THIS PARAMETER FIRST.
        pattern: Regular expression pattern to search for.
        path: Directory to search in (absolute path).
        context_before: Number of lines to show before each match (like rg -B).
        context_after: Number of lines to show after each match (like rg -A).
        case_sensitive: Whether to do case-sensitive search (default: False).
        output_mode: 'content' shows matches, 'count' shows match counts per file,
                     'files_with_matches' lists matching files only.
        glob_pattern: Glob pattern to filter files (e.g., "*.py", "*.md").
        max_results: Maximum number of results to return.
    
    Examples:
        - Search for "def " in all Python files: pattern="def ", path="/mnt/user-data/workspace", glob_pattern="*.py"
        - Find TODO comments: pattern="TODO|FIXME|HACK", path="/mnt/user-data/workspace"
        - Count occurrences: pattern="import .*requests", output_mode="count"
    """
    try:
        sandbox = ensure_sandbox_initialized(runtime)
        
        resolved_path = _resolve_tool_path(runtime, path, read_only=True)
        
        # Compile regex
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return f"Error: Invalid regex pattern '{pattern}': {e}"
        
        # Find files (using existing sandbox.list_dir recursively or os.walk equivalent)
        all_files = _find_files(sandbox, resolved_path, glob_pattern)
        
        if output_mode == "files_with_matches":
            matched_files = []
            for filepath in all_files[:max_results * 3]:  # look at more files
                try:
                    content = sandbox.read_file(filepath)
                    if regex.search(content):
                        # Convert back to virtual path for display
                        rel = _to_virtual_path(filepath, runtime)
                        matched_files.append(rel)
                except Exception:
                    continue
                if len(matched_files) >= max_results:
                    break
            return "\n".join(matched_files) if matched_files else "(no matches found)"
        
        elif output_mode == "count":
            counts = []
            for filepath in all_files[:max_results * 3]:
                try:
                    content = sandbox.read_file(filepath)
                    matches = regex.findall(content)
                    if matches:
                        rel = _to_virtual_path(filepath, runtime)
                        counts.append(f"{rel}: {len(matches)} match(es)")
                except Exception:
                    continue
            return "\n".join(counts) if counts else "(no matches found)"
        
        else:  # "content" mode - default
            results = []
            total_matches = 0
            for filepath in all_files[:max_results * 2]:
                try:
                    content = sandbox.read_file(filepath)
                    lines = content.splitlines()
                    for i, line in enumerate(lines):
                        if regex.search(line):
                            total_matches += 1
                            if len(results) >= max_results:
                                results.append(f"... (truncated, {total_matches} total matches)")
                                return "\n".join(results)
                            
                            start = max(0, i - context_before)
                            end = min(len(lines), i + 1 + context_after)
                            rel = _to_virtual_path(filepath, runtime)
                            
                            line_nums = ",".join(
                                str(n + 1) for n in range(start, end)
                            )
                            snippet = "\n".join(lines[start:end])
                            results.append(
                                f"{rel}:{line_nums}:\n{snippet}"
                            )
                except Exception:
                    continue
            
            return "\n".join(results) if results else "(no matches found)"
            
    except Exception as e:
        return f"Error searching content: {e}"


def _find_files(sandbox, root_path: str, glob_pattern: str | None = None) -> list[str]:
    """Recursively find files under root_path, optionally filtered by glob."""
    # Use sandbox's list_dir or implement recursive walk
    # This is a simplified implementation; real version should handle depth limits etc.
    results = []
    
    def _walk(current_path: str):
        try:
            entries = sandbox.list_dir(current_path)
            for entry in entries:
                if entry == "(empty)" or entry.startswith("Error:"):
                    continue
                
                # Parse tree-format entry back to path (implementation dependent)
                entry_path = f"{current_path}/{entry.lstrip('├└│├──└── ')}"
                
                # Try to determine if it's a file or directory
                try:
                    content = sandbox.read_file(entry_path)
                    # If readable, it's a file
                    if glob_pattern is None or _matches_glob(entry, glob_pattern):
                        results.append(entry_path)
                except Exception:
                    # It's a directory, recurse
                    _walk(entry_path)
        except Exception:
            pass
    
    _walk(root_path)
    return results


def _matches_glob(filename: str, pattern: str) -> bool:
    """Simple glob matching (doesn't need fnmatch for basic patterns)."""
    import fnmatch
    return fnmatch.fnmatch(filename, pattern)


def _to_virtual_path(filepath: str, runtime) -> str:
    """Convert host path back to virtual path for display."""
    if is_local_sandbox(runtime):
        thread_data = get_thread_data(runtime)
        if thread_data:
            from deerflow.sandbox.tools import mask_local_paths_in_output
            return mask_local_paths_in_output(filepath, thread_data)
    return filepath
```

**注册到 BUILTIN_TOOLS 或 config.tools**: 在 `tools/tools.py` 中添加导入和注册。

---

### Step 5: 修复 QualityScorer (P1-4)

**文件**: `community/advanced_search/tools.py:113-117`

**当前代码**:
```python
def _score_relevance(self, result: SearchResult) -> float:
    # TODO: 使用 TF-IDF 或 BM25
    return 0.8  # 默认较高分
```

**修复方案** (基于 BM25 的简化实现):

```python
def _score_relevance(self, result: SearchResult) -> float:
    """Score relevance based on query-term overlap with title/snippet/content.
    
    Simplified BM25-inspired scoring:
    - Title matches weighted 3x
    - Snippet matches weighted 2x  
    - Content matches weighted 1x
    """
    # Extract query terms (simple tokenization)
    # This uses the SearchRequest's query which we need to pass through
    # For now, use a simple approach based on available data
    query_terms = set(getattr(self, '_current_query', '').lower().split())
    
    if not query_terms:
        return 0.8  # Fallback when no query context
    
    score = 0.0
    text_fields = [
        (result.title or "", 3.0),
        (result.snippet or "", 2.0),
        (result.content[:500] if result.content else "", 1.0),
    ]
    
    for text, weight in text_fields:
        text_lower = text.lower()
        for term in query_terms:
            if len(term) < 2:
                continue
            count = text_lower.count(term)
            if count > 0:
                # BM25-like: diminishing returns for repeated terms
                score += weight * (count / (1 + count))
    
    # Normalize to 0-1 range (approximate)
    return min(1.0, score / 10.0) if score > 0 else 0.1
```

**注意**: 这需要在 `ParallelSearchEngine.search()` 中把 `request.query` 传递给 scorer。最简做法是在 scorer 上设一个 `_current_query` 属性。

---

### Step 6: 解决 ddg_search 空壳问题 (P1-5)

**两个选择**:

**选项 A: 删除空壳（推荐，如果不需要 DuckDuckGo）**

```bash
rm -rf community/ddg_search/
# 同时检查是否有其他地方 import ddg_search
```

**选项 B: 真正实现 DuckDuckGo 搜索**

```python
# community/ddg_search/tools.py (重写)
"""DuckDuckGo search using duckduckgo-search Python library."""

from langchain_core.tools import tool
import json
import logging

logger = logging.getLogger(__name__)

@tool("ddg_search", parse_docstring=True)
def ddg_search_tool(query: str, max_results: int = 5) -> str:
    """Search using DuckDuckGo.
    
    Args:
        query: Search keywords.
        max_results: Maximum results (default 5).
    """
    try:
        from duckduckgo_search import DDGS
        
        results = []
        with DDGS(timeout=30) as ddgs:
            for r in ddgs.text(query, max_results=max_results):
                results.append({
                    "title": r.get("title", ""),
                    "href": r.get("href", ""),
                    "body": r.get("body", ""),
                })
        return json.dumps(results, ensure_ascii=False, indent=2)
    except ImportError:
        return 'Error: Install duckduckgo-search: pip install "duckduckgo-search>=3.9.0"'
    except Exception as e:
        return f"Error: DuckDuckGo search failed: {e}"
```

---

### Step 7: 拆分 supervisor_tool.py (P0-2) - 高阶操作

这是最大的重构工作，需要谨慎进行。推荐**渐进式拆分**:

**Phase 1: 提取数据访问层** (不影响行为)

```python
# 新建 tools/builtins/supervisor/storage_ops.py
"""Supervisor storage operations - extracted from supervisor_tool.py."""

# 移动以下函数:
# - new_project_bundle_root_task (已在外部)
# - find_main_task (已在外部)
# - find_subtask_by_ids (已在外部)
# - find_open_main_task_id_by_name (已在外部)
# - _resolve_subtasks_for_start_execution
# - _auto_finalize_unrunnable_pending_subtasks
# - _build_monitor_subtask_rows
# - _compute_monitor_recommendation
# - _persist_main_task_memory_snapshot
# - _record_supervisor_ui_step
# - _build_dependency_context
```

**Phase 2: 提取 Action handlers**

```python
# tools/builtins/supervisor/actions/
#   create_task.py      → handle_create_task(...)
#   create_subtask.py   → handle_create_subtask(...) / handle_create_subtasks(...)
#   start_execution.py  → delegate_collab_subtasks_for_start_execution(...)
#   monitor.py          → _monitor_main_task_until_terminal(...) / _ensure_background_task_monitor(...)
#   status.py           → handle_get_status(...) / handle_list_subtasks(...) / handle_get_task_memory(...)
#   update.py           → handle_update_progress(...) / handle_complete_subtask(...)
```

**Phase 3: 保留 `supervisor_tool.py` 作为薄路由层**

```python
# supervisor_tool.py (重构后 ~100-150 行)
@tool("supervisor", parse_docstring=True)
async def supervisor_tool(runtime, action, tool_call_id, **kwargs) -> str:
    """Route to appropriate action handler."""
    handlers = {
        "create_task": actions.create_task.handle,
        "create_subtask": actions.create_subtask.handle,
        "create_subtasks": actions.create_subtasks.handle_batch,
        "start_execution": actions.start_execution.handle,
        "monitor_execution": actions.monitor.handle,
        "monitor_execution_step": actions.monitor.handle_step,
        "get_status": actions.status.handle_get,
        "list_subtasks": actions.status.handle_list,
        "get_task_memory": actions.status.handle_memory,
        "update_progress": actions.update.handle,
        "complete_subtask": actions.update.handle_complete,
        "set_task_planned": actions.update.handle_planned,
    }
    
    handler = handlers.get(action)
    if not handler:
        return json.dumps({"success": False, "error": f"Unknown action: {action}"})
    
    return await handler(runtime=runtime, tool_call_id=tool_call_id, **kwargs)
```

**预计工作量**: 1-2 天（含测试）

---

### Step 8: 优化搜索性能 (P2-2)

**当前瓶颈**: `web_search` 默认走 `tools_fast_v2.fast_search_v2()` → 内部可能还是调用了 Playwright

**优化策略: HTTP-first, Playwright-fallback**

```python
# 修改 baidu_search/tools.py 的 web_search_tool
@tool("web_search", parse_docstring=True)
def web_search_tool(query: str, max_results: int = 5) -> str:
    """Search the web..."""
    
    # Step 1: Try fast HTTP search first (latency: 1-3 seconds)
    try:
        http_results = _search_text(query=query, max_results=max_results)
        if http_results and len(http_results) >= max_results // 2:
            # Got enough results via HTTP, skip Playwright
            return _format_results(http_results, source="http_fast")
    except Exception as e:
        logger.warning("HTTP search failed: %s", e)
    
    # Step 2: Only fall back to Playwright if HTTP returned insufficient results
    try:
        pw_results = _baidu_playwright_search(query=query, max_results=max_results)
        if pw_results:
            return _format_results(pw_results, source="playwright")
    except Exception as e:
        logger.warning("Playwright search also failed: %s", e)
    
    # Step 3: Final fallback to Bing
    try:
        bing_results = _bing_html_search(query=query, max_results=max_results)
        if bing_results:
            return _format_results(bing_results, source="bing_fallback")
    except Exception:
        pass
    
    return json.dumps({"error": "All search sources failed"})
```

**预期效果**: 
- 常规搜索: 1-3 秒（HTTP-only 路径）
- 验证码触发时: 5-15 秒（Playwright 路径，比现在的 20-30 秒更快因为不再盲目先试 Playwright）

---

## 附录 A: 工具注册流程图 (DeerFlow)

```
get_available_tools()
  │
  ├─ 1. config.tools (YAML 配置声明的工具)
  │     ├─ 过滤 groups 参数
  │     ├─ _is_disabled_tool() → 过滤 jina_ai
  │     └─ _is_host_bash_tool() → 过滤 host bash (当 LocalSandboxProvider 活跃时)
  │
  ├─ 2. BUILTIN_TOOLS (始终加载)
  │     ├─ present_file_tool
  │     ├─ ask_clarification_tool
  │     └─ supervisor_tool
  │
  ├─ 3. SUBAGENT_TOOLS (条件: subagent_enabled=True)
  │     └─ task_tool
  │
  ├─ 4. view_image_tool (条件: model.supports_vision == True)
  │
  ├─ 5. web_search (条件: include_search=True 且不在已加载列表中时强制注入)
  │     └─ 来源: community.baidu_search.web_search_tool
  │
  ├─ 6. MCP tools (条件: include_mcp=True AND include_search=True)
  │     ├─ get_cached_mcp_tools() (带文件 mtime 缓存失效检测)
  │     └─ 如果 tool_search.enabled:
  │         ├─ 注册到 DeferredToolRegistry (ContextVar 隔离)
  │         └─ 加入 tool_search 到 builtin_tools
  │
  └─ 7. ACP invoke_acp_agent (条件: 有 ACP agents 配置)
        └─ build_invoke_acp_agent_tool() (动态生成描述包含可用 agent 列表)
```

## 附录 B: DeerFlow 工具统计汇总

| 分类 | 数量 | 总代码量 | 平均复杂度 |
|------|------|----------|-----------|
| Builtin Tools | 8 | ~175 KB | 高 (supervisor 占 99%) |
| Sandbox Tools | 5 | 43.5 KB | 中 (安全逻辑密集) |
| Community Search | 8+ 源 | ~100 KB | 中 (10 个变体) |
| MCP Tools | 动态 | ~8 KB | 低 (包装层) |
| ACP Tools | 1 | 9.5 KB | 中 (协议处理) |
| **总计** | **22+ 核心** | **~336 KB** | — |

## 附录 C: 快速决策参考表

| 你想做什么 | 应该用哪个工具 |
|-----------|--------------|
| 执行一条命令 | `bash` (DF) / `execute_command` (CB) |
| 读一个文件 | `read_file` (两者都有) |
| 写/创建文件 | `write_file` (DF, 支持 append) / `write_to_file` (CB) |
| 编辑文件中的文本 | `str_replace` (DF, 支持 replace_all) / `replace_in_file` (CB) |
| **删除文件** | ❌ DF 无 / CB 有 `delete_file` |
| 列出目录 | `ls` (DF, 2层树形) / `list_dir` (CB, 灵活) |
| **搜索文件内容** | ❌ DF 无 (只能 bash+grep) / CB 有 `search_content` (ripgrep) |
| 搜索互联网 | `web_search` (两者都有，但实现完全不同) |
| **抓取 URL 内容** | ❌ DF (jina_ai 被禁用) / CB 有 `web_fetch` |
| 委派子任务 | `task` (两者都有，DF 版本更强大) |
| 编排多个子任务 | `supervisor` (DF 独有, 2868 行巨兽) / CB 用 team 系列 |
| 创建自定义 Agent | `setup_agent` (DF 独有) | — |
| 调用外部 ACP Agent | `invoke_acp_agent` (DF 独有) | — |
| 向用户提问 | `ask_clarification` (DF, 中断执行) / `ask_followup_question` (CB, 不中断) |
| 显示图片给模型 | `view_image` (DF, 转 base64) | — |
| **展示文件给用户** | `present_files` (DF 独有) | — |
| **持久化记忆** | task_memory (DF, 任务 scoped) / `update_memory` (CB, 全局 KV) |
| **专业库检索** | ❌ / `RAG_search` (CB, 8 个知识库) |
| **定时自动化** | ❌ / `automation_update` (CB) |
| 发现新工具 schema | `tool_search` (DF, 延迟发现) / `use_skill` (CB, 加载技能包) |

---

*文档结束。如需要对某个优化步骤深入展开实现细节，请告知。*
