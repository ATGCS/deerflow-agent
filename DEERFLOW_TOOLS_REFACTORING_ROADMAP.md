# DeerFlow 基础工具重构开发清单

> 生成时间：2026-04-10
> 目标：重构 DeerFlow 基础工具体系，对标 IDE 级 AI 助手（如 CodeBuddy / Cursor / Windsurf）的能力水平
> 分支：`yintai-snapshot`

---

## 开发总览

```
Phase 1: 基础夯实 ━━━━→ Phase 2: 能力补齐 ━━━━→ Phase 3: 质量提升 ━━━━→ Phase 4: 架构优化
(清理+规范化)          (新工具开发)           (现有工具增强)         (大重构)
  P0 级别               P1 级别               P2 级别               P3 级别
  5 项                  6 项                   5 项                   4 项
```

---

## Phase 1: 基础夯实 (P0 - 必须先做)

> 目标：消除技术债务，建立干净的代码基础，为后续开发铺路

### #01 清理 advanced_search 死代码

| 属性 | 内容 |
|------|------|
| **优先级** | 🔴 P0 |
| **预估工时** | 30 分钟 |
| **依赖** | 无 |
| **涉及文件** | `backend/packages/harness/deerflow/community/advanced_search/` |

**细节操作**：

1. 确认当前实际使用的版本：
   ```bash
   grep -r "from.*import" backend/packages/harness/deerflow/community/baidu_search/tools.py
   # 预期结果：只导入了 tools_fast_v2
   ```

2. 创建归档目录并移动死代码文件：
   ```
   community/advanced_search/
   ├── __init__.py              ← 保留（导出定义）
   ├── tools_fast_v2.py         ← 保留（当前唯一活跃版本）
   └── _deprecated/             ← 新建归档目录
       ├── tools.py             ← 移入
       ├── tools_enhanced.py    ← 移入
       ├── tools_fast.py        ← 移入
       ├── tools_stream.py      ← 移入
       ├── tools_stream_v2.py   ← 移入
       ├── tools_smart.py       ← 移入
       ├── tools_super.py       ← 移入
       ├── tools_ultimate.py    ← 移入
       └── tools_ultra.py       ← 移入
   ```

3. 更新 `__init__.py`，移除对已归档文件的导入引用

4. 验证：
   - [ ] 运行 `web_search` 功能测试
   - [ ] 确认无 ImportError

**进度**: ⬜ 未开始

---

### #02 提取沙箱路径解析公共函数

| 属性 | 内容 |
|------|------|
| **优先级** | 🔴 P0 |
| **预估工时** | 1 小时 |
| **依赖** | 无 |
| **涉及文件** | `backend/packages/harness/deerflow/sandbox/tools.py` |

**细节操作**：

1. 在 `sandbox/tools.py` 中定位重复的路径解析代码块（出现于 `ls_tool`, `read_file_tool`, `write_file_tool`, `str_replace_tool` 四个函数中）

2. 在文件顶部工具函数区之前，新增公共函数 `_resolve_tool_path()`:

   ```python
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
       return path
   ```

3. 逐个替换四个函数中的重复代码为一行调用：
   ```python
   # 替换前（~15行重复代码）
   if is_local_sandbox(runtime):
       thread_data = get_thread_data(runtime)
       validate_local_tool_path(...)
       # ... 更多分支判断 ...
   
   # 替换后（1行）
   path = _resolve_tool_path(runtime, path, read_only=True/False)
   ```

4. 涉及的具体替换位置：

   | 函数名 | read_only 值 | 行范围（约） |
   |--------|-------------|-------------|
   | `ls_tool` | True | 函数体前段 |
   | `read_file_tool` | True | 函数体前段 |
   | `write_file_tool` | False | 函数体前段 |
   | `str_replace_tool` | False | 函数体前段 |

5. 验证：
   - [ ] 四个沙箱工具的功能回归测试
   - [ ] 虚拟路径解析正确性验证
   - [ ] 本地模式路径解析正确性验证

**进度**: ⬜ 未开始

---

### #03 解决 ddg_search 空壳问题

| 属性 | 内容 |
|------|------|
| **优先级** | 🔴 P0 |
| **预估工时** | 30 分钟 ~ 1 小时 |
| **依赖** | 无 |
| **涉及文件** | `backend/packages/harness/deerflow/community/ddg_search/__init__.py`, `tools.py` |

**细节操作**：

1. 先检查是否有其他地方 import ddg_search：
   ```bash
   grep -r "ddg_search" backend/packages/harness/deerflow/ --include="*.py"
   ```

2. 选择方案（二选一）：

   **方案 A - 删除空壳**（如果不需要 DuckDuckGo 搜索能力）：
   - 删除整个 `community/ddg_search/` 目录
   - 清理所有引用

   **方案 B - 实现真正的 DuckDuckGo 搜索**（推荐，增加搜索多样性）：
   
   重写 `community/ddg_search/tools.py`:
   ```python
   """DuckDuckGo search using duckduckgo-search Python library."""
   
   from langchain_core.tools import tool
   import json
   import logging
   
   logger = logging.getLogger(__name__)
   
   @tool("ddg_search", parse_docstring=True)
   def ddg_search_tool(query: str, max_results: int = 5) -> str:
       """Search the web using DuckDuckGo.
       
       Args:
           query: Search keywords or question.
           max_results: Maximum number of results to return (default 5).
       """
       try:
           from duckduckgo_search import DDGS
           
           results = []
           with DDGS(timeout=30) as ddgs:
               for r in ddgs.text(query, max_results=max_results):
                   results.append({
                       "title": r.get("title", ""),
                       "url": r.get("href", ""),
                       "snippet": r.get("body", ""),
                   })
           return json.dumps(results, ensure_ascii=False, indent=2)
       except ImportError:
           return 'Error: Install dependency: pip install "duckduckgo-search>=3.9.0"'
       except Exception as e:
           logger.exception("DDG search failed")
           return f"Error: DuckDuckGo search failed: {e}"
   ```

   更新 `__init__.py` 导出正确的 tool。

3. 如果选方案 B，还需在 `requirements.txt` 或 `pyproject.toml` 中添加依赖：
   ```
   duckduckgo-search>=3.9.0
   ```

4. 将 ddg_search 注册到搜索工具可选列表中（参考 baidu_search 的注册方式）

5. 验证：
   - [ ] `ddg_search("Python async", max_results=3)` 能返回结果
   - [ ] 错误情况（网络不通等）有友好提示

**进度**: ⬜ 未开始

---

### #04 标准化工具参数规范

| 属性 | 内容 |
|------|------|
| **优先级** | 🔴 P0 |
| **预估工时** | 1 小时 |
| **依赖** | #02 完成后（可并行） |
| **涉及文件** | 所有工具定义文件 |

**细节操作**：

1. **制定参数命名规范**：

   | 参数类型 | DeerFlow 当前 | 统一目标 | 参考来源 |
   |----------|--------------|----------|---------|
   | 操作说明 | `description` (必填第一个) | `description` → 可选或移至末尾 | CB 不需要此参数 |
   | 文件路径 | `path` | `path` (统一) | 一致 |
   | 文件内容 | `content` | `content` (统一) | 一致 |
   | 搜索关键词 | `query` / `question` | `query` (统一) | CB 用 query |
   | 正则模式 | 新工具用 `pattern` | `pattern` | CB 用 pattern |
   | 最大数量 | `max_results` / `maxCount` | `max_results` | CB 用 max_results |

2. **处理 `description` 冗余参数问题**：

   方案：将 `description` 从必填第一个参数改为**可选 kwargs**（带默认值），减少 token 消耗：
   
   ```python
   # 改造前
   def read_file_tool(runtime, description: str, path: str, ...) -> str:
   
   # 改造后
   def read_file_tool(runtime, path: str, *, description: str = "", ...) -> str:
   ```

3. **统一错误响应格式**：

   所有工具的错误输出应遵循统一格式：
   ```
   Error: <人类可读的错误描述>
   OK: <成功描述>
   ```

4. **逐个改造的工具清单**：

   | 工具 | 改动点 |
   |------|--------|
   | `bash` | description 放到最后可选 |
   | `ls` | description 放到最后可选 |
   | `read_file` | description 放到最后可选 |
   | `write_file` | description 放到最后可选 |
   | `str_replace` | description 放到最后可选 |
   | `delete_file` (新建) | 直接按新规范写 |
   | `search_content` (新建) | 直接按新规范写 |

5. 验证：
   - [ ] LLM 调用时 token 消耗降低约 3-5%
   - [ ] 所有工具功能不受影响

**进度**: ⬜ 未开始

---

### #05 修复 QualityScorer 相关性评分

| 属性 | 内容 |
|------|------|
| **优先级** | 🔴 P0 |
| **预估工时** | 1-2 小时 |
| **依赖** | #01 完成后（需要确认保留哪个版本） |
| **涉及文件** | `backend/packages/harness/deerflow/community/advanced_search/tools_fast_v2.py` 或相关 scorer 文件 |

**细节操作**：

1. 定位当前的硬编码评分逻辑：
   ```python
   # 类似这样的代码
   def _score_relevance(self, result) -> float:
       # TODO: 使用 TF-IDF 或 BM25
       return 0.8  # ← 问题所在
   ```

2. 实现 BM25 简化版评分算法：

   ```python
   def _score_relevance(self, result, query: str = "") -> float:
       """BM25-inspired relevance scoring.
       
       Weighting:
       - Title matches: 3x
       - Snippet matches: 2x
       - Content matches: 1x
       """
       if not query:
           return 0.8  # Fallback
       
       query_terms = set(q.lower() for q in query.split() if len(q) > 1)
       score = 0.0
       
       fields = [
           (getattr(result, 'title', '') or "", 3.0),
           (getattr(result, 'snippet', '') or "", 2.0),
           (getattr(result, 'content', '') or "")[:500], 1.0),
       ]
       
       for text, weight in fields:
           text_lower = text.lower()
           for term in query_terms:
               count = text_lower.count(term)
               if count > 0:
                   score += weight * (count / (1 + count))
       
       return min(1.0, score / 10.0) if score > 0 else 0.1
   ```

3. 确保 `search()` 方法将 `request.query` 传递给 scorer（可能需要设置实例属性）

4. 验证：
   - [ ] 搜索相同关键词时，结果排序有明显差异（更相关的排前面）
   - [ ] 边界测试：空查询、超长查询、特殊字符查询

**进度**: ⬜ 未开始

---

## Phase 2: 能力补齐 (P1 - 新工具开发)

> 目标：补充 DeerFlow 缺失但 IDE 级助手必备的基础工具

### #06 新增 `delete_file` 删除文件工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟡 P1 |
| **预估工时** | 30 分钟 - 1 小时 |
| **依赖** | #02 (#02完成后代码更干净) |
| **涉及文件** | `sandbox/tools.py` (新增), 可能需改 `sandbox/base.py` 接口 |

**细节操作**：

1. **在 `sandbox/tools.py` 末尾新增工具函数**:

   ```python
   @tool("delete_file", parse_docstring=True)
   def delete_file_tool(
       runtime: ToolRuntime[ContextT, ThreadState],
       path: str,
       *,
       description: str = "",
   ) -> str:
       """Delete a file from the filesystem.
       
       Args:
           path: Absolute path to the file to delete.
           description: Reason for deletion (optional).
       
       WARNING: This operation cannot be undone.
       """
       try:
           sandbox = ensure_sandbox_initialized(runtime)
           ensure_thread_directories_exist(runtime)
           requested_path = path
           
           # 复用公共路径解析
           path = _resolve_tool_path(runtime, path, read_only=False)
           
           # 安全检查：禁止删除系统关键目录
           protected_prefixes = {"/bin", "/usr/bin", "/usr/sbin", "/sbin", 
                                  "/etc", "/sys", "/proc", "/boot", "/lib", "/lib64"}
           normalized = Path(path).resolve()
           for pfx in protected_prefixes:
               try:
                   if normalized.is_relative_to(pfx):
                       return f"Error: Cannot delete system-protected file: {requested_path}"
               except ValueError:
                   continue
           
           # 执行删除
           if not sandbox.file_exists(path):
               return f"Error: File not found: {requested_path}"
           
           sandbox.delete_file(path)
           return f"OK: Deleted {requested_path}"
           
       except PermissionError:
           return f"Error: Permission denied: {requested_path}"
       except IsADirectoryError:
           return f"Error: Path is a directory, not a file: {requested_path}. Use bash with rm -rf for directories."
       except Exception as e:
           return f"Error: {_sanitize_error(e, runtime)}"
   ```

2. **在 Sandbox 接口中确认/添加必要方法** (`sandbox/base.py`):

   ```python
   # 需要确保以下方法存在：
   def file_exists(self, path: str) -> bool: ...
   def delete_file(self, path: str) -> None: ...
   ```

   如果不存在，需要在 `LocalSandbox` 和 `DockerSandbox` 两个实现中都补充。

3. **注册到工具列表**: 确认 `delete_file_tool` 被 `get_available_tools()` 或 config.tools 正确加载

4. **安全策略配置**（可选）：在 YAML 配置中支持禁用 delete_file:
   ```yaml
   tools:
     delete_file:
       enabled: true
       require_confirmation: true  # 未来可扩展
   ```

5. 验证：
   - [ ] 删除普通文件成功
   - [ ] 删除不存在的文件返回友好错误
   - [ ] 尝试删除系统目录被拦截
   - [ ] 尝试删除目录返回提示（非递归）
   - [ ] 虚拟路径映射正确

**进度**: ⬜ 未开始

---

### #07 新增 `search_content` 内容搜索工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟡 P1 |
| **预估工时** | 2-4 小时 |
| **依赖** | #02, #04 |
| **涉及文件** | 新建 `tools/builtins/search_content_tool.py`, 修改 `tools/tools.py` 注册 |

**细节操作**：

1. **创建新文件** `tools/builtins/search_content_tool.py`:

   完整实现 ripgrep 式内容搜索，核心能力：
   
   - ✅ 正则表达式匹配 (`re` 模块)
   - ✅ 上下文行显示 (`context_before` / `context_after`)
   - ✅ 大小写敏感/不敏感 (`case_sensitive`)
   - ✅ 三种输出模式: `content`(默认) / `count` / `files_with_matches`
   - ✅ Glob 文件过滤 (`*.py`, `*.md`, `*.{ts,tsx}`)
   - ✅ 结果数量限制 (`max_results`)
   - ✅ 虚拟路径兼容（复用 `_resolve_tool_path`）
   - ✅ 结果格式: `filepath:line_nums:\ncontent_snippet`

2. **核心数据结构设计**:

   ```python
   @tool("search_content", parse_docstring=True)
   def search_content_tool(
       runtime: ToolRuntime[ContextT, ThreadState],
       pattern: str,                # 正则表达式（必填）
       path: str,                   # 搜索目录（必填）
       *,
       context_before: int = 0,     # 匹配行前显示 N 行
       context_after: int = 0,      # 匹配行后显示 N 行
       case_sensitive: bool = False,# 大小写敏感
       output_mode: Literal["content", "count", "files_with_matches"] = "content",
       glob_pattern: str | None = None,  # 文件过滤, 如 "*.py"
       max_results: int = 50,       # 最大结果数
   ) -> str:
   ```

3. **文件遍历实现要点**:
   - 使用 `sandbox.list_dir` 或直接 `os.walk`（需确认沙箱环境可用）
   - 跳过 `.git/`, `node_modules/`, `__pycache__/`, `.venv/` 等无关目录
   - 尊重 `.gitignore` 规则（可选增强）
   - 支持 glob_pattern 过滤（使用 `fnmatch`）

4. **输出格式示例**:
   ```
   backend/packages/harness/deerflow/sandbox/tools.py:142,155:
       def _resolve_tool_path(runtime, path, *, read_only=False):
           """Unified path resolution for all sandbox tools."""
           if is_local_sandbox(runtime):
   ```

5. **注册到工具系统**:
   - 在 `tools/tools.py` 的 `BUILTIN_TOOLS` 列表中添加
   - 或者通过 config.tools 配置加载

6. **性能考量**:
   - 大目录搜索时加 `max_depth` 限制（默认 10 层）
   - 二进制文件自动跳过（检测 null byte 或文件头）
   - 超大文件 (>1MB) 只读取前 100KB

7. 验证：
   - [ ] 正则搜索 Python 函数定义：`pattern="def \w+\("`
   - [ ] 上下文行显示正确：`context_before=2, context_after=2`
   - [ ] 计数模式：`output_mode="count"`
   - [ ] 文件过滤：`glob_pattern="*.py"`
   - [ ] 大小写敏感/不敏感切换
   - [ ] 超大仓库搜索性能测试 (< 5秒)

**进度**: ⬜ 未开始

---

### #08 新增/重建 `web_fetch` URL 抓取工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟡 P1 |
| **预估工时** | 2-3 小时 |
| **依赖** | 无 |
| **涉及文件** | 新建 `community/web_fetch/tools.py` 或修复 `community/jina_ai/` |

**细节操作**：

1. **选择实现方案**：

   | 方案 | 描述 | 优劣 |
   |------|------|------|
   | A: 自建 HTTP 抓取 | 基于 `urllib` + `html2text`，零外部依赖 | ✅ 无 API 费 ⚠️ 反爬弱 |
   | B: 启用 jina_ai | 取消硬禁用，需 Jina API Key | ✅ 质量高 ❌ 有费用 |
   | C: 混合模式 | 默认自建，可选 jina_ai 作为增强后端 | ✅ 最佳灵活性 |

   **推荐方案 C**

2. **方案 C 实现步骤**：

   **Step 1** — 创建 `community/web_fetch/` 模块:
   ```
   community/web_fetch/
   ├── __init__.py
   ├── tools.py           # 主工具入口
   ├── fetchers/
   │   ├── __init__.py
   │   ├── base.py        # Fetcher 抽象基类
   │   ├── http_fetcher.py # urllib + readability 实现
   │   └── jina_fetcher.py # Jina Reader API (可选)
   └── processors/
       ├── __init__.py
       └── html_to_markdown.py  # HTML → Markdown 转换
   ```

   **Step 2** — 核心工具函数:
   ```python
   @tool("web_fetch", parse_docstring=True)
   def web_fetch_tool(url: str, *, extract: str = "main-content") -> str:
       """Fetch content from a URL and convert to structured text.
       
       Args:
           url: The URL to fetch (must start with http:// or https://)
           extract: What to extract - 'full' (entire page), 'main-content' (article body, default),
                    'text' (plain text only)
       """
   ```

   **Step 3** — HTTP Fetcher 核心（基于 `urllib` + `html.parser`）:
   ```python
   class HttpFetcher:
       def fetch(self, url: str) -> FetchedResult:
           req = Request(url, headers={
               "User-Agent": "Mozilla/5.0 (compatible; DeerFlow/1.0; ResearchBot)"
           })
           with urlopen(req, timeout=30) as resp:
               raw_html = resp.read().decode("utf-8", errors="replace")
           
           # 提取正文（去除 script/style/nav/footer 等）
           main_content = self._extract_main_content(raw_html)
           title = self._extract_title(raw_html)
           
           return FetchedResult(
               url=url,
               title=title,
               content=main_content,
               raw_html=raw_html,
               source="http",
           )
   ```

   **Step 4** — HTML to Markdown 转换（简化版）:
   - 保留 `<h1>-<h6>` → `#` 标题
   - 保留 `<p>` → 段落
   - 保留 `<a href>` → `[text](url)`
   - 保留 `<code>` / `<pre>` → 代码块
   - 保留 `<table>` → Markdown 表格
   - 丢弃 `<script>`, `<style>`, `<nav>`, `<footer>`, `<header>` (除非 extract='full')

   **Step 5** — Jina Fetcher (可选增强):
   ```python
   class JinaFetcher:
       def fetch(self, url: str) -> FetchedResult:
           api_url = f"https://r.jina.ai/{url}"
           headers = {"Accept": "text/markdown"}
           # ... 调用 Jina API ...
   ```

3. **安全限制**:
   - 仅允许 `http://` 和 `https://` 协议
   - 设置请求超时 30 秒
   - 限制响应大小 5 MB
   - 内网地址拦截（`localhost`, `127.0.0.1`, `10.*`, `192.168.*`）

4. **注册到工具系统**:
   - 在 `tools/tools.py` 中取消 `_is_disabled_tool` 对 jina_ai 的硬禁用（如果用方案 C 并包含 jina）
   - 或将 web_fetch 作为独立的 community tool 注册

5. 验证：
   - [ ] 抓取新闻文章，提取正文正确
   - [ ] 抓取 GitHub README，Markdown 格式保留
   - [ ] 抓取无效 URL 返回友好错误
   - [ ] 抓取超大页面（>5MB）被截断
   - [ ] 内网地址被拒绝
   - [ ] （如有 Key）Jina fallback 工作正常

**进度**: ⬜ 未开始

---

### #09 增强 `ls` 列出目录工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟡 P1 |
| **预估工时** | 1 小时 |
| **依赖** | #02 |
| **涉及文件** | `sandbox/tools.py` 中的 `ls_tool` |

**细节操作**：

当前 `ls` 工具的问题：
- 固定最多展示 2 层深度
- 不支持忽略模式（无法排除 `node_modules`, `.git` 等）
- 输出格式是树形但不适合程序化处理

**增强方案**：

1. **新增参数**:
   ```python
   def ls_tool(
       runtime,
       path: str,
       *,
       depth: int = 2,                    # 可配置深度（保持默认 2）
       ignore_patterns: list[str] | None = None,  # 忽略模式, 如 ["node_modules", ".git"]
       show_hidden: bool = False,          # 是否显示隐藏文件（以 . 开头）
       format: Literal["tree", "list"] = "tree",  # 输出格式
       description: str = "",
   ) -> str:
   ```

2. **忽略模式实现**:
   ```python
   DEFAULT_IGNORE_PATTERNS = {
       ".git", "__pycache__", "node_modules", ".venv", "venv",
       ".idea", ".vscode", "dist", "build", "*.pyc", ".DS_Store",
   }

   def _should_ignore(entry_name: str, patterns: set[str]) -> bool:
       for pattern in patterns:
           if pattern.startswith("*"):
               # Glob pattern
               import fnmatch
               if fnmatch.fnmatch(entry_name, pattern):
                   return True
           elif entry_name == pattern or entry_name.startswith(pattern + "/"):
               return True
       return False
   ```

3. **list 格式输出**（方便 LLM 解析）:
   ```
   drwxr-xr-x  backend/
   -rw-r--r--  README.md          (2.4 KB)
   -rw-r--r--  pyproject.toml     (1.1 KB)
   ```

4. 保持默认行为不变（向后兼容）：
   - `depth=2`, `ignore=None`, `show_hidden=False`, `format="tree"` 时表现与现有一致

5. 验证：
   - [ ] 默认参数下输出与改造前完全一致
   - [ ] `depth=1` 只列一层
   - [ ] `ignore_patterns=["node_modules"]` 排除指定目录
   - [ ] `format="list"` 返回列表格式
   - [ ] `show_hidden=True` 显示 .gitignore 等隐藏文件

**进度**: ⬜ 未开始

---

### #10 新增轻量级 `todo` 待办工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟡 P1 |
| **预估工时** | 2 小时 |
| **依赖** | 无 |
| **涉及文件** | 新建 `tools/builtins/todo_tool.py` |

**细节操作**：

> 设计原则：这是给**单 Agent 单对话**用的轻量级待办，不是 supervisor 的 subtask。
> 存储在线程级别的内存/SSE 中，不持久化到 collab 存储。

1. **核心数据结构**:
   ```python
   from dataclasses import dataclass, field
   from enum import Enum
   import uuid
   from datetime import datetime
   
   class TodoStatus(str, Enum):
       PENDING = "pending"
       IN_PROGRESS = "in_progress"
       COMPLETED = "completed"
       CANCELLED = "cancelled"
   
   @dataclass
   class TodoItem:
       id: str                          # UUID
       content: str                      # 待办描述
       status: TodoStatus = TodoStatus.PENDING
       created_at: str = ""              # ISO datetime
       updated_at: str = ""              # ISO datetime
   ```

2. **存储方案** — 基于 ThreadState 的内存存储:
   ```python
   # 存储在 thread_state 的额外字段中
   # key: "todos" → List[TodoItem]
   
   def _get_todos(thread_state: ThreadState) -> list[TodoItem]:
       return getattr(thread_state, "_todos", [])
   
   def _set_todos(thread_state: ThreadState, todos: list[TodoItem]):
       thread_state._todos = todos
   ```

3. **工具函数设计**:
   ```python
   @tool("todo", parse_docstring=True)
   def todo_tool(
       runtime: ToolRuntime[ContextT, ThreadState],
       action: str,            # "list" | "add" | "update" | "clear"
       *,
       content: str | None = None,      # add 时必填：待办内容
       id: str | None = None,           # update 时必填：待办 ID
       status: str | None = None,       # update 时可选：pending/in_progress/completed/cancelled
   ) -> str:
       """Manage todo items for task tracking within a conversation.
       
       Actions:
       - list: List all todos with their status
       - add: Add a new todo item (requires: content)
       - update: Update todo status (requires: id; optional: status)
       - clear: Remove all completed todos
       
       Examples:
           - Add: action="add", content="Implement delete_file tool"
           - Update: action="update", id="abc123", status="in_progress"
           - List: action="list"
       """
   ```

4. **输出格式示例**:
   ```
   ## Todos (4 items)
   
   ☐ #1  [pending]       清理 advanced_search 死代码
   🔄 #2 [in_progress]  提取沙箱路径解析公共函数
   ☐ #3  [pending]       解决 ddg_search 空壳问题
   ✅ #4  [completed]     制定工具参数规范
   ```

5. **注册到 BUILTIN_TOOLS**

6. 与 supervisor 的关系说明（写在 docstring 中）：
   > Note: This is a lightweight, conversation-scoped todo tracker.
   > For cross-agent task orchestration with dependencies, use the `supervisor` tool instead.

7. 验证：
   - [ ] add → list → update → list 全流程
   - [ ] clear 只移除已完成的
   - [ ] 对话结束时 todos 自然销毁（不持久化）
   - [ ] 多个 Agent 各自有独立的 todo 列表

**进度**: ⬜ 未开始

---

### #11 新增 `preview_url` 网页预览工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟡 P1 |
| **预估工时** | 2-3 小时 |
| **依赖** | #08 (可复用 web_fetch 的部分组件) |
| **涉及文件** | 新建 `tools/builtins/preview_url_tool.py` |

**细节操作**：

> 利用 DeerFlow 已有的 Playwright 基础设施（baidu_search 已在使用）

1. **两种模式**：

   | 模式 | 实现方式 | 适用场景 |
   |------|----------|---------|
   | screenshot | Playwright 截图 → Base64 | 需要"看到"网页视觉效果 |
   | text_snapshot | Playwright 渲染后的文本快照 | 需要读取页面文字内容 |

2. **核心实现**:
   ```python
   @tool("preview_url", parse_docstring=True)
   def preview_url_tool(
       runtime: ToolRuntime[ContextT, ThreadState],
       url: str,
       *,
       mode: Literal["screenshot", "text"] = "text",
       viewport_width: int = 1280,
       viewport_height: int = 800,
       full_page: bool = False,       # 截全页还是视口
       wait_selector: str | None = None,  # 等待特定元素出现
       description: str = "",
   ) -> str:
       """Preview a webpage by taking a screenshot or extracting rendered text.
       
       Args:
           url: URL to preview (http/https only).
           mode: 'screenshot' returns base64 image; 'text' returns rendered page text.
           viewport_width: Browser width in pixels (default 1280).
           viewport_height: Browser height in pixels (default 800).
           full_page: If true and mode=screenshot, capture entire page.
           wait_selector: CSS selector to wait for before capturing.
       """
   ```

3. **Screenshot 模式流程**:
   ```
   启动 Playwright browser (复用 baidu_search 的 browser pool?)
       → 设置 viewport
       → 导航到 URL
       → 等待 load 事件 (+ optional selector)
       → 截图 (png)
       → 转 base64
       → 返回 data:image/png;base64,... 格式字符串
   ```

4. **Text 模式流程**:
   ```
   启动 Playwright browser
       → 导航到 URL
       → 等待渲染完成
       → 提取 body.innerText (或更精细的选择器提取)
       → 返回纯文本
   ```

5. **浏览器资源管理**（关键）:
   - 不要每次调用都新建浏览器实例
   - 参考 `baidu_search` 中已有的 Playwright 管理：
     - browser context 复用
     - 超时自动关闭
     - 并发控制（同一时间只有一个 preview 任务）

6. **安全限制**（同 web_fetch）:
   - 仅允许 http/https
   - 超时 60 秒
   - 内网地址拦截

7. **与 view_image 的配合**:
   - Screenshot 模式的输出可以直接传给 `view_image` 让视觉模型分析

8. 验证：
   - [ ] Text 模式抓取新闻网站正文
   - [ ] Screenshot 模式截图并转 base64
   - [ ] `full_page=True` 长页面完整截图
   - [ ] `wait_selector=".main-content"` 等待动态内容
   - [ ] 浏览器进程正常退出（无泄漏）

**进度**: ⬜ 未开始

---

## Phase 3: 质量提升 (P2 - 现有工具增强)

> 目标：优化已有工具的性能和体验

### #12 拆分 supervisor_tool.py

| 属性 | 内容 |
|------|------|
| **优先级** | 🟢 P2 |
| **预估工时** | 1-2 天 |
| **依赖** | Phase 1 全部完成 |
| **涉及文件** | `tools/builtins/supervisor_tool.py` (2868 行 → 拆分为多文件) |

**细节操作**：

采用**渐进式拆分**策略，每步都可独立验证：

**Phase A — 提取存储操作层** (~3 小时):

```
新建目录结构:
tools/builtins/supervisor/
├── __init__.py                 # 导出 supervisor_tool
├── supervisor_tool.py          # 薄路由层 (~150 行)
├── storage_ops.py              # 数据存取操作 (从原文件抽取)
│   ├── find_main_task()
│   ├── find_subtask_by_ids()
│   ├── _resolve_subtasks_for_start()
│   ├── _persist_task_memory()
│   ├── _record_ui_step()
│   └── _build_dependency_context()
├── actions/                    # 每个 Action 一个模块
│   ├── __init__.py
│   ├── create.py               # create_task / create_subtask / create_subtasks
│   ├── execute.py              # start_execution (最复杂的 action)
│   ├── monitor.py              # monitor_execution / monitor_execution_step
│   ├── status.py               # get_status / list_subtasks / get_task_memory
│   └── update.py               # update_progress / complete_subtask / set_planned
├── dependency.py               # DAG 依赖解析
├── monitor.py                  # 后台监控器 + 停滞检测
└── memory.py                   # 记忆聚合逻辑
```

**具体步骤**:

1. 创建 `supervisor/` 目录和 `__init__.py`
2. 从 `supervisor_tool.py` 中提取纯数据函数到 `storage_ops.py`（不改逻辑，只搬位置）
3. 提取各 action handler 到 `actions/*.py`
4. 在新的 `supervisor_tool.py` 中做薄路由：
   ```python
   async def supervisor_tool(runtime, action, tool_call_id, **kwargs):
       router = {
           "create_task": actions.create.handle,
           "create_subtask": actions.create.handle_subtask,
           "start_execution": actions.execute.handle,
           "monitor_execution": actions.monitor.handle,
           # ... 其他 action 映射
       }
       handler = router.get(action)
       if not handler:
           return error_response(f"Unknown action: {action}")
       return await handler(runtime=runtime, tool_call_id=tool_call_id, **kwargs)
   ```
5. 处理循环导入问题（`task_tool` ↔ `supervisor_tool`）：
   - 引入事件/回调机制替代直接 import
   - 或将共享函数下沉到 `collab/` 模块
6. 每提取一个模块就运行一次回归测试
7. 最后删除原始 `supervisor_tool.py`（已变为空壳）

**验收标准**:
- [ ] 所有 existing supervisor action 调用正常工作
- [ ] 依赖 DAG 排序正确
- [ ] 后台监控和停滞检测正常
- [ ] 自动 follow-up wave 触发正常
- [ ] 单个源文件不超过 500 行

**进度**: ⬜ 未开始

---

### #13 解耦 task_tool 与 supervisor_tool

| 属性 | 内容 |
|------|------|
| **优先级** | 🟢 P2 |
| **预估工时** | 3-5 小时 |
| **依赖** | #12 (拆分后更容易解耦) |
| **涉及文件** | `tools/builtins/task_tool.py`, `tools/builtins/supervisor/` |

**细节操作**：

当前耦合点：

```python
# task_tool.py:368 导入了 supervisor 的内部函数
from deerflow.tools.builtins.supervisor_tool import auto_delegate_collab_followup_wave

# supervisor_task.py (supervisor 内部) 导入了 task_tool
from deerflow.tools.builtins.task_tool import task_tool as tt
```

**解耦方案**：

1. **提取共享接口到独立模块** `tools/builtins/collab_bridge.py`:
   ```python
   """Bridge between task_tool and supervisor_tool for collab operations.
   
   Both modules depend on this bridge instead of each other.
   """
   
   class CollabEventBus:
       """Event bus for decoupling task ↔ supervisor communication."""
       
       def emit_followup_needed(self, task_id: str, wave_type: str):
           """Signal that a follow-up wave should be triggered."""
           ...
       
       def get_task_status(self, task_id: str) -> dict:
           """Query task status without importing task_tool directly."""
           ...
   
   # 全局单例
   _event_bus: CollabEventBus | None = None
   
   def get_collab_event_bus() -> CollabEventBus:
       global _event_bus
       if _event_bus is None:
           _event_bus = CollabEventBus()
       return _event_bus
   ```

2. **改造 task_tool.py**:
   - 删除 `from ...supervisor_tool import ...`
   - 改为 `from .collab_bridge import get_collab_event_bus`
   - 通过 event bus 发送 follow-up-needed 事件

3. **改造 supervisor**:
   - 删除 `from ...task_tool import task_tool as tt`
   - 通过 event bus 或 collab storage 间接查询任务状态

4. **单元测试**:
   - Mock event bus 验证两个模块可以独立测试
   - 验证 follow-up wave 仍能正确触发

**进度**: ⬜ 未开始

---

### #14 优化 web_search 性能 (HTTP-first 策略)

| 属性 | 内容 |
|------|------|
| **优先级** | 🟢 P2 |
| **预估工时** | 2-3 小时 |
| **依赖** | 无 |
| **涉及文件** | `backend/packages/harness/deerflow/community/baidu_search/tools.py` |

**细节操作**：

当前问题：默认走 `fast_search_v2`，内部可能启动 Playwright，延迟 5-30 秒。

**优化策略：HTTP-first, Playwright-fallback**

1. **修改 `web_search_tool` 的执行流程**:

   ```
   web_search_tool(query, max_results)
   │
   ├─ Step 1: HTTP 快速搜索 (timeout=5s)
   │   ├─ _baidu_html_search (mobile endpoint, urllib)
   │   └─ _bing_html_search (并行)
   │   → 如果结果数 >= max_results * 0.5 → 直接返回 ✓
   │
   ├─ Step 2: HTTP 结果不足 → 升级 Playwright (timeout=20s)
   │   ├─ _baidu_playwright_search
   │   → 如果成功 → 返回 ✓
   │
   └─ Step 3: 全部失败 → Bing 兜底
       └─ 返回 Bing 结果或错误
   ```

2. **具体代码修改** (`baidu_search/tools.py` 中的 `web_search_tool`):

   ```python
   SEARCH_TIMEOUT_HTTP = 5       # HTTP 搜索超时
   SEARCH_TIMEOUT_PW = 20        # Playwright 搜索超时
   MIN_RESULTS_THRESHOLD = 0.5   # 最少结果比例阈值

   def web_search_tool(query: str, max_results: int = 5) -> str:
       """Search the web using optimized multi-tier strategy."""
       
       results = []
       source = "unknown"
       
       # Tier 1: Fast HTTP search
       try:
           http_results = _search_text_tier1(query=query, max_results=max_results, 
                                              timeout=SEARCH_TIMEOUT_HTTP)
           if http_results and len(http_results) >= max(MIN_RESULTS_THRESHOLD * max_results, 1):
               return _format_search_results(http_results, source="baidu_http")
           results.extend(http_results or [])
       except Exception as e:
           logger.debug("Tier1 HTTP search failed: %s", e)
       
       # Tier 2: Playwright (only when HTTP insufficient)
       try:
           pw_results = _baidu_playwright_search(query=query, max_results=max_results,
                                                  timeout=SEARCH_TIMEOUT_PW)
           if pw_results:
               return _format_search_results(pw_results, source="baidu_playwright")
       except Exception as e:
           logger.warning("Tier2 Playwright search also failed: %s", e)
       
       # Tier 3: Return whatever we got (even partial)
       if results:
           return _format_search_results(results, source="partial_fallback")
       
       return json.dumps({"error": "All search sources failed"}, ensure_ascii=False)
   ```

3. **新增 `_search_text_tier1`**（优化版 HTTP 搜索）:
   - 合并百度 mobile + Bing 并行请求
   - 使用 `concurrent.futures.ThreadPoolExecutor` 并行
   - 统一超时控制
   - 结果去重（按 URL）

4. **预期效果指标**:

   | 场景 | 优化前 | 优化后 |
   |------|--------|--------|
   | 常规搜索 | 15-30 秒 | **2-5 秒** |
   | 触发验证码 | 20-30 秒 | **10-20 秒** |
   | 搜索失败 | 30+ 秒 | **7 秒内** |
   | Token 成本 | 高 (Playwright日志) | 低 (HTTP简洁) |

5. 验证：
   - [ ] 3 组不同关键词搜索，平均延迟 < 5 秒
   - [ ] 百度验证码触发时自动升级到 Playwright
   - [ ] 并发搜索请求不会互相阻塞
   - [ ] 结果质量不低于优化前

**进度**: ⬜ 未开始

---

### #15 增强 write_file 的 append 和模板能力

| 属性 | 内容 |
|------|------|
| **优先级** | 🟢 P2 |
| **预估工时** | 1-2 小时 |
| **依赖** | #04 (参数规范) |
| **涉及文件** | `sandbox/tools.py` 中的 `write_file_tool` |

**细节操作**：

当前 `write_file` 已有 `append` 模式，但可以进一步增强：

1. **新增 `create_line` 参数** — 自动追加换行（如果内容末尾没有）:
   ```python
   def write_file_tool(runtime, path: str, content: str, 
                       *, append: bool = False,
                       create_line: bool = True,  # 新增：确保末尾有换行
                       description: str = "",
                       encoding: str = "utf-8") -> str:
   ```

2. **新增 `mkdir` 参数** — 控制是否自动创建父目录:
   ```python
   mkdir: bool = True  # 默认自动创建（当前行为）
   ```

3. **新增 `backup` 参数** — 写入前自动备份原文件:
   ```python
   backup: bool = False  # 写入前备份为 path.bak
   ```
   这对于重要配置文件的修改特别有用。

4. **增强错误信息** — 写入失败时显示更多上下文:
   ```
   Error: Write failed for /path/to/file.py
   - Target size: 15,234 bytes
   - Disk free: 2.3 GB
   - Permissions: rw-r--r--
   - Possible cause: File locked by another process
   ```

5. 验证：
   - [ ] `append=True` 正确追加
   - [ ] `create_line=True` 确保末尾换行
   - [ ] `backup=True` 生成 .bak 文件
   - [ ] `mkdir=False` 且父目录不存在时报错

**进度**: ⬜ 未开始

---

### #16 增强 str_replace 编辑工具

| 属性 | 内容 |
|------|------|
| **优先级** | 🟢 P2 |
| **预估工时** | 2 小时 |
| **依赖** | #04 (参数规范) |
| **涉及文件** | `sandbox/tools.py` 中的 `str_replace_tool` |

**细节操作**：

1. **增加 `dry_run` 参数** — 预览替换结果但不写入:
   ```python
   dry_run: bool = False  # True 时只显示将要做的变更，不实际修改文件
   ```

   输出示例:
   ```
   --- Dry Run Preview ---
   File: /mnt/user-data/project/app.py
   Match found at lines 42-45
   
   <<<< OLD
       def old_function():
           pass
   >>>> NEW
       def new_function():
           """Updated implementation."""
           return result
   ----
   Would change 4 lines (2 added, 2 removed)
   Run again with dry_run=False to apply.
   ```

2. **增加 `count` 参数** — 报告匹配次数（配合 `replace_all` 使用）:
   ```python
   # replace_all=True 时，报告总共替换了几处
   # 返回值中包含: f"OK: Replaced {count} occurrence(s)"
   ```

3. **增强唯一性校验错误信息**:
   ```
   Error: 'old_string' matches 3 locations in the file.
   Matches at:
     - Line 15-18:    def process(data): ...
     - Line 42-45:    def process(items): ...
     - Line 78-81:    def process(rows): ...
   
   Please provide more surrounding context to make the match unique,
   or use replace_all=True to replace all occurrences.
   ```

4. **支持正则模式替换**（高级选项）:
   ```python
   regex: bool = False  # True 时 old_string 是正则表达式
   # 注意: regex 模式下自动启用 replace_all
   ```

5. 验证：
   - [ ] `dry_run=True` 不修改文件但显示预览
   - [ ] `replace_all=True` 全局替换并报告次数
   - [ ] 非唯一匹配时显示所有位置
   - [ ] `regex=True` 正则替换工作正常

**进度**: ⬜ 未开始

---

## Phase 4: 架构优化 (P3 - 远期规划)

> 目标：提升架构层面的可扩展性和长期维护性

### #17 引入全局知识库记忆系统

| 属性 | 内容 |
|------|------|
| **优先级** | ⚪ P3 |
| **预估工时** | 1-2 天 |
| **依赖** | 无（独立模块） |
| **涉及文件** | 新建 `tools/builtins/memory_tool.py`, 可能新建 `core/knowledge/` |

**细节操作**：

1. **设计存储后端**:
   - 默认：本地 JSON 文件存储（`~/.deerflow/knowledge/`）
   - 可选：SQLite / Redis（通过配置切换）
   - 按 thread_id 隔离 + 全局共享两层

2. **两个工具函数**:
   ```python
   @tool("remember", parse_docstring=True)
   def remember_tool(title: str, knowledge: str, *, category: str = "general") -> str:
       """Store information for future reference across conversations."""

   @tool("recall", parse_docstring=True)
   def recall_tool(query: str, *, category: str | None = None, limit: int = 5) -> str:
       """Retrieve previously stored information by keyword matching."""
   ```

3. **检索方式**:
   - V1: 关键词匹配（简单实现）
   - V2: embedding 向量相似度（远期，需要 embedding 模型）

4. **集成到 system prompt**:
   - 定期自动 recall 相关记忆注入到上下文中

**进度**: ⬜ 未开始

---

### #18 统一搜索接口（Strategy Pattern）

| 属性 | 内容 |
|------|------|
| **优先级** | ⚪ P3 |
| **预估工时** | 3-5 天 |
| **依赖** | #03 (ddg_search), #08 (web_fetch), #14 (性能优化) |
| **涉及文件** | 新建 `community/search/` 统一模块 |

**细节操作**：

将 baidu_search / advanced_search / ddg_search / (未来的) google_search 等合并为一个统一的搜索策略框架：

```
community/search/
├── __init__.py
├── registry.py              # 搜索引擎注册表
├── base.py                  # SearchEngine 抽象基类
├── strategies/
│   ├── __init__.py
│   ├── baidu.py             # 百度搜索策略
│   ├── bing.py              # Bing 搜索策略
│   ├── ddg.py               # DuckDuckGo 搜索策略
│   └── google.py            # Google 搜索策略（未来）
├── orchestrator.py          # 搜索编排器（自动选择/组合策略）
└── tools.py                 # 统一的 web_search 入口
```

```python
class SearchOrchestrator:
    def search(self, query: str, *, engines: list[str] | None = None) -> SearchResults:
        """Execute search using optimal strategy selection."""
        
        # 如果指定了引擎，只用指定的
        if engines:
            return self._search_specific(query, engines)
        
        # 否则自动选择：快速引擎优先，慢速引擎兜底
        return self._search_auto(query)
    
    def _search_auto(self, query: str) -> SearchResults:
        # Tier 1: HTTP-fast engines (Bing, DDG)
        fast = self._try_engines(query, ["bing", "ddg"], timeout=5)
        if fast.is_good_enough():
            return fast
        
        # Tier 2: Deep engines (Baidu Playwright)
        deep = self._try_engines(query, ["baidu"], timeout=20)
        if deep.results:
            return deep.merge(fast)
        
        return fast or empty_result()
```

**进度**: ⬜ 未开始

---

### #19 引入定时任务自动化

| 属性 | 内容 |
|------|------|
| **优先级** | ⚪ P3 |
| **预估工时** | 2-3 天 |
| **依赖** | 无（独立模块） |
| **涉及文件** | 新建 `tools/builtins/automation_tool.py`, `core/scheduler/` |

**细节操作**：

1. **调度器选择**: APScheduler（轻量、异步友好）

2. **核心工具**:
   ```python
   @tool("automation", parse_docstring=True)
   def automation_tool(
       action: str,  # "create" | "list" | "pause" | "resume" | "delete"
       *,
       name: str = None,
       prompt: str = None,          # 要执行的任务描述
       schedule: str = None,        # cron 表达式或频率描述
       workspace: str = None,       # 工作目录
   ) -> str:
       """Manage scheduled automated tasks.
       
       Schedule examples:
       - "every hour" → FREQ=HOURLY;INTERVAL=1
       - "9am on weekdays" → FREQ=WEEKLY;BYDAY=MO-FR;BYHOUR=9
       - "once at 2026-04-15T14:30" → one-time execution
       """
   ```

3. **存储**: TOML 格式（类似 CodeBuddy 的 automation.toml）

4. **权限**: 自动任务的执行权限继承创建者的权限级别

**进度**: ⬜ 未开始

---

### #20 建立 Tool Contract 测试体系

| 属性 | 内容 |
|------|------|
| **优先级** | ⚪ P3 |
| **预估工时** | 2-3 天 |
| **依赖** | Phase 1-3 的主要项目完成 |
| **涉及文件** | 新建 `tests/tools/` 目录 |

**细节操作**：

为每个工具建立标准化契约测试：

```python
# tests/tools/test_delete_file.py

class TestDeleteFileToolContract:
    """Contract tests for delete_file tool."""
    
    def test_delete_existing_file(self, sandbox):
        """Should delete file and return success message."""
        ...
    
    def test_nonexistent_file_returns_error(self, sandbox):
        """Should return friendly error for missing files."""
        ...
    
    def test_system_path_rejected(self, sandbox):
        """Should reject paths under /bin, /etc, etc."""
        ...
    
    def test_directory_path_rejected(self, sandbox):
        """Should not allow deleting directories (only files)."""
        ...
    
    def test_virtual_path_resolved(self, local_sandbox):
        """Should correctly resolve /mnt/user-data/ paths."""
        ...

# 每个工具都需要通过的通用契约
class BaseToolContract:
    def test_returns_string(self): ...
    def test_error_starts_with_Error(self): ...
    def test_ok_starts_with_OK(self): ...
    def test_no_traceback_in_output(self): ...
    def test_paths_masked_in_output(self): ...
```

**进度**: ⬜ 未开始

---

## 总进度追踪

### 汇总表

| # | 事项 | 优先级 | Phase | 工时 | 状态 | 依赖 |
|---|------|--------|-------|------|------|------|
| 01 | 清理 advanced_search 死代码 | P0 | 1 | 30min | ⬜ | 无 |
| 02 | 提取沙箱路径解析公共函数 | P0 | 1 | 1h | ⬜ | 无 |
| 03 | 解决 ddg_search 空壳问题 | P0 | 1 | 1h | ⬜ | 无 |
| 04 | 标准化工具参数规范 | P0 | 1 | 1h | ⬜ | 无 |
| 05 | 修复 QualityScorer 评分 | P0 | 1 | 1.5h | ⬜ | #01 |
| 06 | 新增 delete_file 工具 | P1 | 2 | 1h | ⬜ | #02 |
| 07 | 新增 search_content 工具 | P1 | 2 | 3h | ⬜ | #02, #04 |
| 08 | 新增/重建 web_fetch 工具 | P1 | 2 | 2.5h | ⬜ | 无 |
| 09 | 增强 ls 目录列出工具 | P1 | 2 | 1h | ⬜ | #02 |
| 10 | 新增 todo 待办工具 | P1 | 2 | 2h | ⬜ | 无 |
| 11 | 新增 preview_url 预览工具 | P1 | 2 | 2.5h | ⬜ | #08 |
| 12 | 拆分 supervisor_tool.py | P2 | 3 | 1.5d | ⬜ | P1全部 |
| 13 | 解耦 task/supervisor 循环依赖 | P2 | 3 | 4h | ⬜ | #12 |
| 14 | 优化 web_search 性能 | P2 | 3 | 2.5h | ⬜ | 无 |
| 15 | 增强 write_file 能力 | P2 | 3 | 1.5h | ⬜ | #04 |
| 16 | 增强 str_replace 编辑工具 | P2 | 3 | 2h | ⬜ | #04 |
| 17 | 引入全局知识库记忆系统 | P3 | 4 | 1.5d | ⬜ | 无 |
| 18 | 统一搜索接口 Strategy Pattern | P3 | 4 | 4d | ⬜ | #03, #08, #14 |
| 19 | 引入定时任务自动化 | P3 | 4 | 2.5d | ⬜ | 无 |
| 20 | 建立 Tool Contract 测试体系 | P3 | 4 | 2.5d | ⬜ | P1-P2 完成 |
| **21** | **HostDirect 去沙箱化工具集 (IDE模式)** | 🔴 **P0+** | **NEW** | **2-3d** | ⬜ | #02, #04 |

**总预估工时**: 约 **25-29 人天**

---

### 进度时间线

```
Week 1: ████████████████████ Phase 1: 基础夯实 (5项+HostDirect, ~3天) ← #21 放这里
Week 2: ██████████████████████████████ Phase 2: 能力补齐 (6项, ~4天)
Week 3: ████████████████████████████ Phase 3: 质量提升 (5项, ~4天)
Week 4+: ░░░░░░░░░░░░░░░░░░░░░░░░░░ Phase 4: 架构优化 (4项, ~10天)
```

---

### 快速启动建议

**如果你只想先做最有价值的事，按这个顺序开始**：

1. 👆 **#02** 提取路径解析公共函数 (1h) → 为后续所有工具改动打基础
2. 👆 **#06** 新增 delete_file (1h) → 补齐 CRUD 最后一环
3. 👆 **#07** 新增 search_content (3h) → 代码探索效率质变
4. 👆 **#14** 优化搜索性能 (2.5h) → 用户体验立竿见影

这 4 项做完只需 **约 1 天**，DeerFlow 的基础工具能力就会有显著提升。

---

## Phase 0: HostDirect 去沙箱化工具集 (IDE 模式) — ⭐ 核心需求

> 目标：新建一套完全绕过沙箱层的基础工具，直接操作宿主机文件系统，对齐 CodeBuddy / Cursor / Windsurf 的工具体验。
> 这是整个重构的**前置基础**，完成后其他所有工具都可以基于这套干净的接口来构建。

### #21 新建 `tools/host_direct/` 工具集（IDE 模式）

| 属性 | 内容 |
|------|------|
| **优先级** | 🔴 **P0+** (最高优先，其他项的基础) |
| **预估工时** | 2-3 天 |
| **依赖** | 无（独立模块） |
| **涉及文件** | 新建 `tools/host_direct/` 整个目录 |

**设计哲学**:

```
┌───────────────────────────────────────────────────────────────┐
│                    现有架构 (要保留兼容)                        │
│                                                               │
│  LLM → tool("read_file") → sandbox/tools.py → LocalSandbox    │
│        → 路径解析(15行×4) → 安全校验 → 虚拟路径映射 → open() │
│        = 每次调用都有 ~50 行包装开销                            │
└───────────────────────────────────────────────────────────────┘

┌───────────────────────────────────────────────────────────────┐
│                  新建 HostDirect 架构                          │
│                                                               │
│  LLM → tool("read_file") → host_direct/read_file.py → open() │
│        = 直接操作系统，零包装                                   │
│                                                               │
│  特点:                                                        │
│  - 不经过 Sandbox 抽象层                                      │
│  - 不经过 ensure_sandbox_initialized()                        │
│  - 不经过 validate_local_tool_path() 安全门控                 │
│  - 不经过 _resolve_and_validate_user_data_path()              │
│  - 不经过 mask_local_paths_in_output() 输出脱敏               │
│  - 直接用 os / pathlib / subprocess                           │
│  - 就像 CodeBuddy 的工具一样简洁                               │
└───────────────────────────────────────────────────────────────┘

         ┌────────────── 切换开关 ──────────────┐
         │  config.yaml:                         │
         │  tools_mode: "host_direct" | "sandbox"│
         └──────────────────────────────────────┘
```

**目录结构设计**:

```
backend/packages/harness/deerflow/tools/host_direct/
├── __init__.py              # 导出所有工具 + 注册入口
├── read_file.py            # 读取文件（支持文本+图片+行范围）
├── write_file.py           # 写入文件（覆盖+追加+自动创建目录）
├── delete_file.py          # 删除文件（安全保护）
├── list_dir.py             # 列出目录（树形/列表/忽略模式/深度）
├── str_replace.py          # 字符串替换（精确/全局/dry_run/正则）
├── search_content.py       # 内容搜索（ripgrep式正则搜索）
├── execute_command.py      # 执行命令（PowerShell/CMD/Bash自适应）
├── web_fetch.py            # URL抓取（HTTP→Markdown）
└── utils/
    ├── __init__.py
    ├── path_utils.py       # 路径安全检查（轻量级，不含虚拟路径）
    └── output_utils.py     # 统一输出格式化
```

**详细操作步骤**:

#### Step 1: 创建 `host_direct/__init__.py` — 统一注册入口

```python
"""HostDirect tools: Zero-sandbox-overhead file operations for IDE-like experience.

These tools bypass the Sandbox abstraction layer entirely and operate directly
on the host filesystem. Designed to match CodeBuddy / Cursor / Windsurf UX.

Switch to this mode by setting in config.yaml:
    agent:
      tools_mode: "host_direct"   # or "sandbox" (default)
"""

from deerflow.tools.host_direct.read_file import read_file_hd
from deerflow.tools.host_direct.write_file import write_file_hd
from deerflow.tools.host_direct.delete_file import delete_file_hd
from deerflow.tools.host_direct.list_dir import list_dir_hd
from deerflow.tools.host_direct.str_replace import str_replace_hd
from deerflow.tools.host_direct.search_content import search_content_hd
from deerflow.tools.host_direct.execute_command import execute_command_hd
from deerflow.tools.host_direct.web_fetch import web_fetch_hd

# Complete tool set — can be swapped with sandbox tools via config
HOST_DIRECT_TOOLS = [
    read_file_hd,
    write_file_hd,
    delete_file_hd,
    list_dir_hd,
    str_replace_hd,
    search_content_hd,
    execute_command_hd,
    web_fetch_hd,
]

__all__ = ["HOST_DIRECT_TOOLS"] + [t.name for t in HOST_DIRECT_TOOLS]
```

#### Step 2: 实现 `read_file.py` — 文件读取

```python
"""Read file contents — direct filesystem access, no sandbox overhead.

Design principles (matching CodeBuddy's read_file):
- Supports text files with optional line-range slicing
- Supports image files (jpg/png/webp/gif) — returns base64 for vision models
- Path is used as-is (absolute), no virtual path translation
- Error messages are clean and actionable
"""

import base64
import mimetypes
from pathlib import Path

from langchain.tools import tool

# Supported image formats for vision model consumption
_IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".gif", ".webp"}


@tool("read_file", parse_docstring=True)
def read_file_hd(
    path: str,
    *,
    offset: int | None = None,     # Starting line number (1-indexed, inclusive)
    limit: int | None = None,      # Number of lines to read
) -> str:
    """Read a file from the local filesystem.
    
    Args:
        path: Absolute path to the file to read.
        offset: Optional starting line number (1-indexed). Use with limit.
        limit: Optional number of lines to read.
    
    Supports:
    - Text files: Returns content with optional line range slicing.
    - Image files: Returns base64-encoded data URI for vision models.
    
    Examples:
        - Read entire file: read_file(path="D:/project/main.py")
        - Read lines 10-30: read_file(path="D:/project/main.py", offset=10, limit=20)
    """
    try:
        p = Path(path)
        
        if not p.exists():
            return f"Error: File not found: {path}"
        
        if not p.is_file():
            return f"Error: Path is a directory, not a file: {path}"
        
        # Detect image files → return as base64 data URI
        if p.suffix.lower() in _IMAGE_EXTENSIONS:
            mime_type = mimetypes.guess_type(str(p))[0] or "image/png"
            with open(p, "rb") as f:
                b64 = base64.b64encode(f.read()).decode("ascii")
            return f"data:{mime_type};base64,{b64}"
        
        # Text file reading
        content = p.read_text(encoding="utf-8", errors="replace")
        lines = content.splitlines()
        
        if offset is not None or limit is not None:
            start = max(0, (offset or 1) - 1)
            end = start + limit if limit is not None else len(lines)
            lines = lines[start:end]
            # Prefix with line numbers for reference
            numbered = "\n".join(
                f"{start + i + 1}:{line}" for i, line in enumerate(lines)
            )
            return numbered
        
        return content
        
    except PermissionError:
        return f"Error: Permission denied reading file: {path}"
    except Exception as e:
        return f"Error: Failed to read file '{path}': {e}"
```

**与现有 sandbox read_file 的对比**:

| 特性 | sandbox/read_file_tool | host_direct/read_file |
|------|------------------------|-----------------------|
| 代码量 | ~50 行（含沙箱初始化+路径解析+校验） | **~35 行（纯逻辑）** |
| 参数 | `runtime, description, path, start_line, end_line` | `path, *, offset, limit` |
| description 参数 | ✅ 必填第一个参数 | ❌ 不需要 |
| runtime 依赖 | ✅ 必须 | ❌ 完全没有 |
| 图片支持 | ❌ （由 view_image 负责） | ✅ 内置 base64 |
| 行号格式 | 无行号前缀 | `line_number:` 前缀（方便引用） |
| 路径处理 | 虚拟路径→宿主路径翻译 | 直接使用 |

#### Step 3: 实现 `write_file.py` — 文件写入

```python
"""Write file — direct filesystem access."""

import os
from datetime import datetime
from pathlib import Path

from langchain.tools import tool


@tool("write_to_file", parse_docstring=True)
def write_file_hd(
    path: str,
    content: str,
    *,
    append: bool = False,
    create_line: bool = True,    # Ensure trailing newline
    backup: bool = False,       # Create .bak before overwriting
) -> str:
    """Write content to a file on the local filesystem.
    
    Args:
        path: Absolute path to the file to write.
        content: The text content to write.
        append: If True, append to existing file. Default False (overwrite).
        create_line: Ensure the content ends with a newline. Default True.
        backup: Create a .bak backup before overwriting. Default False.
    
    Parent directories are created automatically if they don't exist.
    """
    try:
        p = Path(path)
        
        # Auto-create parent directories
        p.parent.mkdir(parents=True, exist_ok=True)
        
        # Backup existing file
        if backup and p.exists() and not append:
            bak_path = p.with_suffix(p.suffix + ".bak")
            import shutil
            shutil.copy2(p, bak_path)
        
        # Ensure trailing newline
        if create_line and content and not content.endswith("\n"):
            content += "\n"
        
        mode = "a" if append else "w"
        count = len(content.encode("utf-8"))
        
        with open(p, mode, encoding="utf-8") as f:
            f.write(content)
        
        action = "appended to" if append else "wrote"
        return f"OK: {action} {count} bytes to {path}"
        
    except PermissionError:
        return f"Error: Permission denied writing to: {path}"
    except IsADirectoryError:
        return f"Error: Path is a directory: {path}"
    except Exception as e:
        return f"Error: Failed to write file '{path}': {e}"
```

#### Step 4: 实现 `delete_file.py` — 文件删除

```python
"""Delete file — direct filesystem access with safety guards."""

from pathlib import Path

from langchain.tools import tool

# Paths that should never be deleted via this tool
_PROTECTED_PREFIXES = {
    # Windows system paths (normalized)
    "/windows", "/program Files", "/program Files (x86)",
    "/programData", "/users/all users", "/users/default",
    # Linux system paths  
    "/bin", "/usr/bin", "/usr/sbin", "/sbin", "/etc",
    "/sys", "/proc", "/boot", "/lib", "/lib64", "/dev",
}


def _is_protected(path: str) -> bool:
    """Check if path is under a protected directory."""
    try:
        normalized = Path(path).resolve()
        for prefix in _PROTECTED_PREFIXES:
            try:
                if normalized.is_relative_to(prefix):
                    return True
            except ValueError:
                pass
    except (OSError, ValueError):
        pass
    return False


@tool("delete_file", parse_docstring=True)
def delete_file_hd(
    path: str,
    *,
    reason: str = "",           # Why deleting (for audit log, optional)
) -> str:
    """Delete a file from the local filesystem.
    
    WARNING: This operation cannot be undone. Use with caution.
    
    System-protected paths (/bin/, /usr/, C:/Windows/, etc.) are blocked.
    
    Args:
        path: Absolute path to the file to delete.
        reason: Reason for deletion (optional, for logging).
    """
    try:
        p = Path(path)
        
        if not p.exists():
            return f"Error: File not found: {path}"
        
        if not p.is_file():
            return f"Error: Not a file (directory?): {path}. Use bash 'rm -rf' for directories."
        
        if _is_protected(path):
            return f"Error: Protected system path, deletion blocked: {path}"
        
        size = p.stat().st_size
        p.unlink()
        
        return f"OK: Deleted {path} ({size} bytes)"
        
    except PermissionError:
        return f"Error: Permission denied: {path}"
    except Exception as e:
        return f"Error: Failed to delete '{path}': {e}"
```

#### Step 5: 实现 `list_dir.py` — 目录列表（增强版）

```python
"""List directory — enhanced version with ignore patterns and flexible output."""

import fnmatch
from pathlib import Path

from langchain.tools import tool

_DEFAULT_IGNORE = [
    ".git", "__pycache__", "node_modules", ".venv", "venv",
    ".idea", ".vscode", ".DS_Store", "*.pyc", ".next", "dist", "build",
    ".env", ".cache", "*.log", "*.tmp", ".coverage", ".pytest_cache",
]


@tool("list_dir", parse_docstring=True)
def list_dir_hd(
    path: str,
    *,
    depth: int = 2,                    # Max depth (default 2, like original)
    ignore: list[str] | None = None,   # Additional patterns to ignore
    show_hidden: bool = False,         # Show dot-files?
    format: Literal["tree", "list"] = "tree",  # Output format
) -> str:
    """List directory contents.
    
    Args:
        path: Absolute path to the directory to list.
        depth: Maximum depth to traverse (default 2).
        ignore: List of glob patterns to ignore (e.g., ["node_modules"]).
        show_hidden: Whether to show hidden files/dotfiles (default False).
        format: Output format - 'tree' (visual tree) or 'list' (flat listing).
    
    The following patterns are always ignored: .git, node_modules, __pycache__, etc.
    """
    try:
        root = Path(path).resolve()
        if not root.is_dir():
            return f"Error: Not a directory: {path}"
        
        all_ignore = set(_DEFAULT_IGNORE) | set(ignore or [])
        
        def should_skip(name: str) -> bool:
            for pattern in all_ignore:
                if fnmatch.fnmatch(name, pattern):
                    return True
            if not show_hidden and name.startswith("."):
                return True
            return False
        
        if format == "list":
            return _format_list(root, depth, should_skip)
        else:
            return _format_tree(root, depth, should_skip, prefix="")
            
    except PermissionError:
        return f"Error: Permission denied: {path}"
    except Exception as e:
        return f"Error: Listing directory failed: {e}"


def _format_tree(current: Path, max_depth: int, skip_fn, prefix: str, current_depth: int = 1) -> str:
    """Format as visual tree."""
    entries = sorted([e for e in current.iterdir() if not skip_fn(e.name)], key=lambda e: (not e.is_dir(), e.name.lower()))
    if not entries:
        return "(empty)"
    
    lines = []
    total = len(entries)
    for i, entry in enumerate(entries):
        is_last = i == total - 1
        connector = "└── " if is_last else "├── "
        post_fix = "/" if entry.is_dir() else ""
        size_str = ""
        if not entry.is_dir():
            size = entry.stat().st_size
            if size > 1024 * 1024:
                size_str = f" ({size / (1024*1024):.1f} MB)"
            elif size > 1024:
                size_str = f" ({size / 1024:.1f} KB)"
            else:
                size_str = f" ({size} B)"
        lines.append(f"{prefix}{connector}{entry.name}{post_fix}{size_str}")
        
        if entry.is_dir() and current_depth < max_depth:
            extension = "    " if is_last else "│   "
            sub_tree = _format_tree(entry, max_depth, skip_fn, prefix + extension, current_depth + 1)
            lines.append(sub_tree)
    
    return "\n".join(lines)


def _format_list(root: Path, max_depth: int, skip_fn) -> str:
    """Format as flat list with metadata (easy for LLM to parse)."""
    results = []
    
    def walk(current: Path, d: int):
        if d > max_depth:
            return
        try:
            for entry in sorted(current.iterdir()):
                if skip_fn(entry.name):
                    continue
                kind = "d" if entry.is_dir() else "-"
                size = entry.stat().st_size if entry.is_file() else 0
                size_fmt = f"{size:>8,}" if entry.is_file() else "       -"
                rel = str(entry.relative_to(root)) if entry != root else entry.name
                results.append(f"{kind}{kind}r--r-- {rel:<50} {size_fmt:>10}")
                if entry.is_dir():
                    walk(entry, d + 1)
        except PermissionError:
            pass
    
    walk(root, 1)
    return "\n".join(results) if results else "(empty)"
```

#### Step 6: 实现 `str_replace.py` — 字符串替换

```python
"""String replacement in files — with dry_run, regex, and multi-match support."""

from pathlib import Path

from langchain.tools import tool


@tool("replace_in_file", parse_docstring=True)
def str_replace_hd(
    path: str,
    old_string: str,
    new_string: str,
    *,
    dry_run: bool = False,          # Preview only, don't write
    regex: bool = False,            # Use old_string as regex pattern
) -> str:
    """Replace text in a file with precise matching.
    
    By default, old_string must appear EXACTLY ONCE in the file.
    If it appears multiple times, the tool reports all locations so you
    can provide more context for a unique match.
    
    Args:
        path: Absolute path to the file.
        old_string: The exact string to replace (or regex pattern if regex=True).
        new_string: The replacement string.
        dry_run: If True, show what would change without writing. Useful for preview.
        regex: If True, treat old_string as a regex pattern (enables replace-all semantics).
    """
    try:
        p = Path(path)
        if not p.exists():
            return f"Error: File not found: {path}"
        
        content = p.read_text(encoding="utf-8")
        
        if dry_run:
            return _preview_replace(content, old_string, new_string, path, regex=regex)
        
        if regex:
            import re
            flags = re.DOTALL
            compiled = re.compile(old_string, flags)
            matches = compiled.findall(content)
            new_content = compiled.sub(new_string, content)
            count = len(matches)
        else:
            count = content.count(old_string)
            if count == 0:
                return f"Error: String not found in file: {path}\nSearched for: {old_string[:100]}..."
            if count > 1:
                locations = _find_all_locations(content, old_string, path)
                return (
                    f"Error: Match appears {count} times in {path}. Provide more context for uniqueness.\n"
                    f"\n{locations}\n"
                    f"To replace all occurrences, call again with regex=False and use smaller unique context.\n"
                    f"(Or we can add replace_all=True parameter if needed.)"
                )
            new_content = content.replace(old_string, new_string, 1)
            count = 1
        
        p.write_text(new_content, encoding="utf-8")
        added = len(new_string) - len(old_string)
        return f"OK: Replaced {count} occurrence(s) in {path} ({'+'if added >= 0 else ''}{added} chars)"
        
    except PermissionError:
        return f"Error: Permission denied: {path}"
    except Exception as e:
        return f"Error: Replace failed in '{path}': {e}"


def _preview_replace(content, old, new, path, regex=False) -> str:
    """Generate a dry-run preview of changes."""
    if regex:
        import re
        matches = list(re.finditer(old, content, re.DOTALL))
        if not matches:
            return f"Dry run: No matches found for pattern in {path}"
        lines = [f"Dry Run Preview for: {path}"]
        lines.append(f"Pattern would match {len(matches)} location(s):")
        for i, m in enumerate(matches[:5]):
            start = m.start()
            snippet = content[max(0,start-20):start+len(m.group())+20].replace("\n", "\\n")
            lines.append(f"  [{i}] ...{snippet}...")
        lines.append(f"\nRun again with dry_run=False to apply.")
        return "\n".join(lines)
    
    count = content.count(old)
    if count == 0:
        return f"Dry run: String not found in {path}"
    
    lines = [f"--- Dry Run Preview ---", f"File: {path}", ""]
    old_lines = old.splitlines()
    new_lines = new.splitlines()
    lines.append(f"<<<< OLD ({len(old_lines)} lines)")
    for line in old_lines:
        lines.append(f"  {line}")
    lines.append(f">>>> NEW ({len(new_lines)} lines)")
    for line in new_lines:
        lines.append(f"  {line}")
    lines.append(f"---")
    lines.append(f"Would {'replace all ' if count > 1 else 'change'}{count} occurrence(s). Run with dry_run=False to apply.")
    return "\n".join(lines)


def _find_all_locations(content, target, path) -> str:
    """Find all locations where target appears, with context."""
    lines = content.splitlines()
    locations = []
    for i, line in enumerate(lines):
        idx = 0
        while True:
            pos = line.find(target, idx)
            if pos == -1:
                break
            locations.append((i + 1, pos, line.strip()))
            idx = pos + 1
    
    result = [f"Match locations:"]
    for line_no, col, text in locations[:5]:
        preview = text[:80] + "..." if len(text) > 80 else text
        result.append(f"  Line {line_no}: {preview}")
    if len(locations) > 5:
        result.append(f"  ... and {len(locations)-5} more")
    return "\n".join(result)
```

#### Step 7: 实现 `search_content.py` — ripgrep 式内容搜索

```python
"""Content search using regex — ripgrep-style, no sandbox overhead."""

import re
import fnmatch
from pathlib import Path
from typing import Literal

from langchain.tools import tool

_SKIP_DIRS = {".git", "node_modules", "__pycache__", ".venv", "venv",
              ".idea", ".vscode", "dist", "build", ".next", ".turbo",
              ".tox", ".eggs", ".mypy_cache", "site-packages"}
_MAX_FILE_SIZE = 1_000_000  # 1MB — skip larger files


@tool("search_content", parse_docstring=True)
def search_content_hd(
    pattern: str,
    path: str,
    *,
    context_before: int = 0,
    context_after: int = 0,
    case_sensitive: bool = False,
    output_mode: Literal["content", "count", "files_with_matches"] = "content",
    glob_pattern: str | None = None,   # e.g., "*.py", "*.{ts,tsx}"
    max_results: int = 50,
    max_depth: int = 10,
) -> str:
    """Search file contents using regex patterns (like ripgrep).
    
    This is the primary code exploration tool. Much more efficient than
    using bash + grep because results are structured and include context lines.
    
    Args:
        pattern: Regular expression pattern to search for.
        path: Directory to search in (absolute path).
        context_before: Lines before each match (like rg -B). Default 0.
        context_after: Lines after each match (like rg -A). Default 0.
        case_sensitive: Case-sensitive search? Default False.
        output_mode: 'content'=show matches, 'count'=per-file counts, 
                     'files_with_matches'=list matching files only.
        glob_pattern: Filter files by glob pattern, e.g. "*.py".
        max_results: Maximum number of results to return.
        max_depth: Maximum directory recursion depth. Default 10.
    
    Examples:
        - Find function defs: pattern="def \\w+\\(", path="D:/project", glob_pattern="*.py"
        - Find TODO comments: pattern="TODO|FIXME|HACK|XXX", path="D:/project"
        - Count imports: pattern="^import |^from .*import", output_mode="count", glob_pattern="*.py"
    """
    try:
        root = Path(path).resolve()
        if not root.is_dir():
            return f"Error: Not a directory: {path}"
        
        # Compile regex
        flags = 0 if case_sensitive else re.IGNORECASE
        try:
            regex = re.compile(pattern, flags)
        except re.error as e:
            return f"Error: Invalid regex '{pattern}': {e}"
        
        # Collect files
        files = _collect_files(root, glob_pattern, max_depth)
        
        # Search based on mode
        if output_mode == "files_with_matches":
            return _search_files_only(files, regex, max_results)
        elif output_mode == "count":
            return _search_count(files, regex, max_results)
        else:
            return _search_content(files, regex, context_before, context_after, max_results)
            
    except Exception as e:
        return f"Error searching content: {e}"


def _collect_files(root: Path, glob_pattern: str | None, max_depth: int) -> list[Path]:
    """Recursively collect files respecting ignores and depth limits."""
    results = []
    
    def _walk(current: Path, depth: int):
        if depth > max_depth:
            return
        try:
            entries = list(current.iterdir())
        except PermissionError:
            return
        
        for entry in sorted(entries):
            if entry.name.startswith(".") or entry.name in _SKIP_DIRS:
                continue
            if entry.is_dir():
                _walk(entry, depth + 1)
            elif entry.is_file():
                if entry.stat().st_size > _MAX_FILE_SIZE:
                    continue
                if _is_binary(entry):
                    continue
                if glob_pattern and not fnmatch.fnmatch(entry.name, glob_pattern):
                    continue
                results.append(entry)
    
    _walk(root, 1)
    return results


def _is_binary(p: Path) -> bool:
    """Quick check for binary files (null byte detection)."
    try:
        with open(p, "rb") as f:
            chunk = f.read(8192)
        return b'\x00' in chunk
    except (OSError, IOError):
        return True


def _search_files_only(files: list[Path], regex, max_results: int) -> str:
    matched = []
    for f in files[:max_results * 3]:
        try:
            content = f.read_text(encoding="utf-8", errors="skip")
            if regex.search(content):
                matched.append(str(f))
        except (OSError, UnicodeDecodeError):
            continue
        if len(matched) >= max_results:
            break
    return "\n".join(matched) if matched else "(no matches)"


def _search_count(files: list[Path], regex, max_results: int) -> str:
    counts = []
    for f in files[:max_results * 3]:
        try:
            content = f.read_text(encoding="utf-8", errors="skip")
            matches = regex.findall(content)
            if matches:
                counts.append(f"{f}: {len(matches)} match(es)")
        except (OSError, UnicodeDecodeError):
            continue
    return "\n".join(counts) if counts else "(no matches)"


def _search_content(files: list[Path], regex, ctx_b: int, ctx_a: int, max_r: int) -> str:
    results = []
    total = 0
    for f in files[:max_r * 2]:
        try:
            content = f.read_text(encoding="utf-8", errors="skip")
            lines = content.splitlines()
            for i, line in enumerate(lines):
                if regex.search(line):
                    total += 1
                    if len(results) >= max_r:
                        results.append(f"... (truncated, {total} total matches)")
                        return "\n".join(results)
                    
                    start = max(0, i - ctx_b)
                    end = min(len(lines), i + 1 + ctx_a)
                    nums = ",".join(str(n + 1) for n in range(start, end))
                    snippet = "\n".join(lines[start:end])
                    results.append(f"{f}:{nums}:\n{snippet}")
        except (OSError, UnicodeDecodeError):
            continue
    return "\n".join(results) if results else "(no matches)"
```

#### Step 8: 实现 `execute_command.py` — 命令执行

```python
"""Execute shell commands — auto-detects OS and available shell."""

import os
import shutil
import subprocess
from pathlib import Path

from langchain.tools import tool


@tool("execute_command", parse_docstring=True)
def execute_command_hd(
    command: str,
    *,
    timeout: int = 300,              # Timeout in seconds (default 5 min)
    workdir: str | None = None,       # Working directory (default: cwd)
) -> str:
    """Execute a shell command on the host machine.
    
    Automatically detects the best available shell:
    - Windows: PowerShell → cmd.exe fallback
    - Linux/macOS: bash → sh fallback
    
    Args:
        command: The shell command to execute.
        timeout: Maximum execution time in seconds (default 300).
        workdir: Working directory for command execution.
    
    WARNING: Commands run on the host machine with current user privileges.
    Be cautious with destructive commands (rm, del, format, etc.)
    """
    try:
        cwd = Path(workdir) if workdir else None
        
        # Auto-detect best shell
        shell_cmd, shell_args = _detect_shell()
        
        result = subprocess.run(
            command if isinstance(shell_args, bool) and not shell_args 
                else [shell_cmd] + shell_args + [command],
            shell=isinstance(shell_args, bool) and shell_args,
            capture_output=True,
            text=True,
            timeout=timeout,
            cwd=cwd,
        )
        
        output_parts = []
        if result.stdout:
            output_parts.append(result.stdout.rstrip())
        if result.stderr:
            output_parts.append(f"[stderr]\n{result.stderr.rstrip()}")
        if result.returncode != 0:
            output_parts.append(f"[exit code: {result.returncode}]")
        
        return "\n".join(output_parts) if output_parts else "(no output)"
        
    except subprocess.TimeoutExpired:
        return f"Error: Command timed out after {timeout} seconds"
    except FileNotFoundError:
        return f"Error: Shell executable not found"
    except Exception as e:
        return f"Error executing command: {e}"


def _detect_shell() -> tuple:
    """Auto-detect available shell: returns (executable, args_or_bool_for_shell_param)."""
    if os.name == "nt":
        # Windows priority: pwsh > powershell > cmd
        for candidate in ("pwsh.exe", "powershell.exe", "cmd.exe"):
            full = shutil.which(candidate)
            if full:
                if "powershell" in candidate:
                    return full, ["-NoProfile", "-Command"]
                elif candidate == "cmd.exe":
                    return full, ["/c"]
        raise RuntimeError("No shell found on Windows")
    else:
        # Unix: bash > zsh > sh
        for candidate in ("/bin/bash", "/bin/zsh", "/bin/sh"):
            if os.path.isfile(candidate) and os.access(candidate, os.X_OK):
                return candidate, True  # shell=True for unix
        raise RuntimeError("No shell found")
```

#### Step 9: 实现 `web_fetch.py` — URL 抓取

```python
"""Fetch URL content and convert to structured markdown."""

from urllib.request import Request, urlopen
from urllib.error import URLError, HTTPError
from html.parser import HTMLParser
import re
import ssl

from langchain.tools import tool

# Allow HTTPS without verification for general fetching (same as browsers)
_SSL_CONTEXT = ssl.create_default_context()
_SSL_CONTEXT.check_hostname = False
_SSL_CONTEXT.verify_mode = ssl.CERT_NONE

_BLOCKED_SCHEMES = {"file", "javascript", "data"}

# Internal network ranges that are blocked
_BLOCKED_NETWORKS = [
    ("127.0.0.0", "255.0.0.0"),      # Loopback
    ("10.0.0.0", "255.0.0.0"),        # RFC1918
    ("172.16.0.0", "255.240.0.0"),    # RFC1918
    ("192.168.0.0", "255.255.0.0"),   # RFC1918
    ("169.254.0.0", "255.255.0.0"),   # Link-local
]


class _HTMLToMarkdown(HTMLParser):
    """Minimal HTML → Markdown converter focused on readability."""
    
    def __init__(self):
        super().__init__()
        self.output = []
        self._in_script_style = False
        self._in_pre = False
        self._tag_stack = []
    
    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag in ("script", "style"):
            self._in_script_style = True
            return
        if tag == "pre":
            self._in_pre = True
        if tag == "br":
            self._write("\n")
        if tag == "hr":
            self._write("\n---\n")
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6"):
            level = int(tag[1])
            self._write("\n" + "#" * level + " ")
        if tag == "li":
            self._write("- ")
        if tag == "p":
            self._write("\n")
        if tag == "img":
            alt = dict(attrs).get("alt", "")
            src = dict(attrs).get("src", "")
            if src:
                self._write(f"![{alt}]({src})")
            elif alt:
                self._write(f"[Image: {alt}]")
        if tag == "a":
            href = dict(attrs).get("href", "")
            self._tag_stack.append(("a", href))
        if tag == "tr":
            self._write("|")
        if tag in ("td", "th"):
            self._write(" ")
    
    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag in ("script", "style"):
            self._in_script_style = False
            return
        if tag == "pre":
            self._in_pre = False
        if tag in ("h1", "h2", "h3", "h4", "h5", "h6", "li", "td", "th", "tr", "p"):
            self._write("\n")
        if tag == "a" and self._tag_stack:
            _, href = self._tag_stack.pop()
            self._write(f"({href})") if href else None
    
    def handle_data(self, data):
        if self._in_script_style:
            return
        text = data if self._in_pre else " ".join(data.split())
        self._write(text)
    
    def _write(self, text):
        self.output.append(text)
    
    def get_markdown(self) -> str:
        raw = "".join(self.output)
        # Clean up excessive blank lines
        cleaned = re.sub(r'\n{3,}', '\n\n', raw)
        return cleaned.strip()


@tool("web_fetch", parse_docstring=True)
def web_fetch_hd(
    url: str,
    *,
    extract: str = "main-content",   # "full" | "main-content" | "text"
    max_length: int = 50000,         # Max response length
    timeout: int = 30,
) -> str:
    """Fetch content from a URL and convert to readable text/markdown.
    
    Args:
        url: URL to fetch (http:// or https:// only).
        extract: What to extract - 'full' (entire page HTML→MD), 
                 'main-content' (article body, default), 
                 'text' (plain text only).
        max_length: Maximum content length in characters (default 50000).
        timeout: Request timeout in seconds (default 30).
    
    Internal/private network URLs (localhost, 10.*, 192.168.*) are blocked.
    """
    # Validate URL scheme
    parsed_url = urlparse(url)
    if parsed_url.scheme not in ("http", "https"):
        return f"Error: Only http/https URLs allowed, got: {parsed_url.scheme}"
    if parsed_url.scheme in _BLOCKED_SCHEMES:
        return f"Error: Blocked URL scheme: {parsed_url.scheme}"
    
    # Block internal networks
    hostname = parsed_url.hostname
        if hostname:
            for net, mask in _BLOCKED_NETWORKS:
                try:
                    ip = _ip_addr(hostname)  # type: ignore
                    if ip:
                        ip_net = _ip_net(f"{net}/{mask}", strict=False)
                        if ip in ip_net:
                            return f"Error: Private/internal network URL blocked: {hostname}"
                except (ValueError, TypeError):
                    pass
    
    try:
        req = Request(url, headers={
            "User-Agent": "Mozilla/5.0 (compatible; DeerFlow/1.0; ResearchTool)",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
        })
        
        with urlopen(req, timeout=timeout, context=_SSL_CONTEXT) as resp:
            raw_html = resp.read(max_length * 2)  # Read more than needed, trim later
            encoding = resp.headers.get_content_charset() or "utf-8"
            html_str = raw_html.decode(encoding, errors="replace")[:max_length]
        
        if extract == "text":
            # Strip ALL tags, plain text only
            text = re.sub(r'<[^>]+>', ' ', html_str)
            text = re.sub(r'\s+', ' ', text).strip()
            return text[:max_length]
        
        # Convert HTML to Markdown
        parser = _HTMLToMarkdown()
        parser.feed(html_str)
        md = parser.get_markdown()
        
        if extract == "main-content":
            # Try to extract <main>, <article>, or largest <div> block
            md = _extract_main_content(md) or md
        
        return md if md.strip() else "(page appears empty or had no extractable content)"
        
    except HTTPError as e:
        return f"Error: HTTP {e.code} {e.reason} for {url}"
    except URLError as e:
        return f"Error: Failed to fetch {url}: {e.reason}"
    except ssl.SSLError:
        return f"Error: SSL certificate error for {url}"
    except Exception as e:
        return f"Error: Fetching {url} failed: {e}"


# Helper functions for web_fetch
from urllib.parse import urlparse
from ipaddress import ip_address as _ip_addr, ip_network as _ip_net

def _extract_main_content(md: str) -> str | None:
    """Heuristic extraction of main content from Markdown.
    
    Looks for common markers like ## Article, ### Content, or the longest section.
    """
    sections = re.split(r'\n(?=#{1,3}\s)', md)
    if len(sections) <= 1:
        return None
    
    # Score each section by length and content density
    scored = []
    for sec in sections:
        text_len = len(sec)
        if text_len < 100:
            continue
        # Prefer sections with article/content-like headers
        score = text_len
        header_match = re.match(r'^#{1,3}\s*(?:Article|Content|Main|正文|文章|内容|正文)', sec, re.IGNORECASE)
        if header_match:
            score *= 2
        scored.append((score, sec))
    
    if not scored:
        return None
    
    scored.sort(key=lambda x: -x[0])
    return scored[0][1][:50000]  # Return best match, capped at 50K
```

#### Step 10: 集成到工具加载系统

修改 `tools/tools.py` 的 `get_available_tools()` 函数，增加 `tools_mode` 切换：

```python
# 在 tools/tools.py 中添加:

def get_available_tools(
    groups: list[str] | None = None,
    include_mcp: bool = True,
    model_name: str | None = None,
    subagent_enabled: bool = False,
    include_search: bool = True,
    tools_mode: str = "sandbox",   # ★ 新增参数："sandbox" | "host_direct"
) -> list[BaseTool]:
    """...existing docstring...
    
    Args:
        tools_mode: Tool mode - 'sandbox' (default, uses sandbox layer) or 
                   'host_direct' (IDE mode, direct filesystem access).
    """
    config = get_app_config()
    
    # ★★★ 新增：根据 mode 选择不同的基础工具集 ★★★
    if tools_mode == "host_direct":
        from deerflow.tools.host_direct import HOST_DIRECT_TOOLS
        loaded_tools = []  # 清空 sandbox 工具
        builtin_tools = list(HOST_DIRECT_TOOLS)  # 使用 HostDirect 工具替代
        # 注意: supervisor/task/present_file/view_image 等高级工具仍然从 BUILTIN_TOOLS 加载
        builtin_tools.extend(BUILTIN_TOOLS)
    else:
        # 原有逻辑不变
        ...
```

同时需要在 `agent.py` (`make_lead_agent`) 中透传这个参数：

```python
# 在 make_lead_agent 中:
tools_mode = cfg.get("tools_mode", "sandbox")  # 从 configurable 获取

tools = get_available_tools(
    ...
    tools_mode=tools_mode,  # ★ 传入
)
```

配置方式 (`config.yaml`)：

```yaml
agent:
  # 切换工具模式:
  # "sandbox"   = 默认，走沙箱层（路径翻译、安全校验、虚拟路径）
  # "host_direct" = IDE 模式，直通宿主机（零开销，类 CodeBuddy 体验）
  tools_mode: "host_direct"
```

或者更细粒度地控制（每个 agent 可不同）：

```yaml
agents:
  main:
    tools_mode: "host_direct"
    # 其他 agent 可以继续用 sandbox 模式
```

**验证清单**:

- [ ] 每个 HostDirect 工具可以独立工作，不需要 `runtime` 参数
- [ ] `read_file` 能读文本和图片
- [ ] `write_file` 支持 append/backup/create_line
- [ ] `delete_file` 保护系统路径
- [ ] `list_dir` 支持 tree/list 格式切换和忽略模式
- [ ] `str_replace` dry_run 正确预览
- [ ] `search_content` 正则搜索大仓库 < 5 秒
- [ ] `execute_command` Windows PowerShell 和 Linux Bash 都能用
- [ ] `web_fetch` 抓取新闻网站正文正确
- [ ] 通过 `tools_mode: "host_direct"` 一键切换
- [ ] 切换后原有 sandbox 工具不再被加载（避免重复）

**与现有系统的共存策略**:

```
tools_mode = "sandbox" (默认)     → 保持 100% 向后兼容，行为不变
tools_mode = "host_direct" (新)   → 替换基础文件操作工具，但保留:
                                     - supervisor (编排)
                                     - task (子代理)
                                     - present_file (展示)
                                     - view_image (视觉)
                                     - ask_clarification (提问)
                                     - web_search (搜索)
                                     - MCP tools
                                     - ACP invoke_acp_agent
```

**进度**: ⬜ 未开始

---

### 快速启动建议（更新版）

**如果你只想先做最有价值的事，按这个顺序开始**：

1. 👆👆 **#21** HostDirect 工具集 (2-3天) → **最核心！做完后体验质变**
2. 👆 **#02** 提取路径解析公共函数 (1h) → 为后续所有工具改动打基础
3. 👆 **#06** 新增 delete_file (1h) → 补齐 CRUD 最后一环（如果还用 sandbox 模式的话）
4. 👆 **#07** 新增 search_content (3h) → 代码探索效率质变

> **注意**: 如果先做 #21（HostDirect），则 #02/#06/#09/#15/#16 这些 sandbox 相关优化可以降低优先级或跳过，因为 HostDirect 已经绕过了沙箱层。

---

*文档结束。每完成一项请在对应位置更新进度: ⬜ → 🔄 进行中 → ✅ 完成*
