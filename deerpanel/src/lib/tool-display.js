/**
 * 工具展示：中文标题、图标、supervisor action 枚举（供 ToolCallList / toolLabel 共用）
 */

/** supervisor(action=...) 与中文说明 */
export const SUPERVISOR_ACTION_ZH = {
  create_task: '创建任务',
  create_subtask: '创建子任务',
  assign_subtask: '分配子任务',
  update_progress: '更新进度',
  complete_subtask: '完成子任务',
  start_execution: '开始执行',
  set_task_planned: '标记计划就绪',
  get_status: '查询状态',
  get_task_memory: '读取任务记忆',
  list_subtasks: '列出子任务',
  create_agent: '创建 Agent',
  update_agent: '更新 Agent',
  list_agents: '列出 Agent',
}

/** 内置工具名 → 简短中文（作分类标题） */
export const TOOL_NAME_ZH = {
  bash: '终端命令',
  ls: '列出目录',
  read_file: '读取文件',
  write_file: '写入文件',
  str_replace: '编辑文件',
  web_search: '网络搜索',
  web_fetch: '网页抓取',
  image_search: '图片搜索',
  supervisor: '任务调度',
  task: '子任务',
  ask_clarification: '等待确认',
  write_todos: '待办列表',
  tool_search: '查找工具',
  present_files: '展示文件',
  view_image: '查看图片',
  invoke_acp_agent: 'ACP 子代理',
  invoke_acp_agent_tool: 'ACP 子代理',
  // 常见 MCP / 别名
  mcp: '扩展工具',
}

/** 与 TOOL_NAME_ZH 对齐的展示图标（emoji，无额外依赖） */
export const TOOL_ICON = {
  bash: '⌨️',
  ls: '📂',
  read_file: '📄',
  write_file: '✍️',
  str_replace: '🔧',
  web_search: '🔍',
  web_fetch: '🌐',
  image_search: '🖼️',
  supervisor: '🧭',
  task: '⚡',
  ask_clarification: '❔',
  write_todos: '📋',
  tool_search: '🔎',
  present_files: '📎',
  view_image: '🖼️',
  invoke_acp_agent: '🤖',
  invoke_acp_agent_tool: '🤖',
  mcp: '🔌',
  default: '🔧',
}

export function resolveToolKey(tool) {
  const raw = tool?.name ?? tool?.tool_name ?? tool?.toolName
  const s = String(raw != null ? raw : '').trim()
  if (!s) return 'tool'
  return s.replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()
}

export function getToolIcon(toolOrKey) {
  const key = typeof toolOrKey === 'string' ? toolOrKey : resolveToolKey(toolOrKey)
  return TOOL_ICON[key] || TOOL_ICON.default
}

export function getToolCategoryZh(toolOrKey) {
  const key = typeof toolOrKey === 'string' ? toolOrKey : resolveToolKey(toolOrKey)
  if (key === 'tool' || key === '') return '工具'
  return TOOL_NAME_ZH[key] || null
}

export function supervisorActionZh(action) {
  if (action == null || action === '') return ''
  const a = String(action).trim()
  return SUPERVISOR_ACTION_ZH[a] || a
}

/**
 * 单行摘要：图标由 UI 单独渲染时，此处只返回中文标题（与历史 toolLabel 行为兼容）
 */
export function formatToolDisplayTitle(tool) {
  const raw = tool?.name ?? tool?.tool_name ?? tool?.toolName
  const name = String(raw != null && String(raw).trim() ? raw : 'tool')
  const key = resolveToolKey(tool)
  const args = tool?.input && typeof tool.input === 'object' ? tool.input : null

  const cat = getToolCategoryZh(key) || (name === 'tool' || name === 'Tool' ? '工具' : name)

  if (name === 'web_search' || key === 'web_search') {
    return `网络搜索${args?.query ? ` · ${args.query}` : ''}`
  }
  if (name === 'web_fetch' || key === 'web_fetch') {
    return `网页抓取${args?.url ? ` · ${args.url}` : ''}`
  }
  if (name === 'read_file' || key === 'read_file') {
    return `读取文件${args?.path ? ` · ${args.path}` : ''}`
  }
  if (name === 'write_file' || key === 'write_file' || name === 'str_replace' || key === 'str_replace') {
    const verb = key === 'str_replace' || name === 'str_replace' ? '编辑文件' : '写入文件'
    return `${verb}${args?.path ? ` · ${args.path}` : ''}`
  }
  if (name === 'bash' || key === 'bash') {
    return `执行命令${args?.command ? ` · ${args.command}` : ''}`
  }
  if (name === 'ls' || key === 'ls') {
    return `列出目录${args?.path ? ` · ${args.path}` : ''}`
  }
  if (name === 'write_todos' || key === 'write_todos') return '更新待办'
  if (name === 'ask_clarification' || key === 'ask_clarification') return '等待用户确认'
  if (name === 'tool_search' || key === 'tool_search') {
    return `查找工具${args?.query ? ` · ${args.query}` : ''}`
  }
  if (name === 'present_files' || key === 'present_files') return '展示文件'
  if (name === 'view_image' || key === 'view_image') return '查看图片'
  if (name === 'image_search' || key === 'image_search') {
    return `图片搜索${args?.query ? ` · ${args.query}` : ''}`
  }

  if (name === 'supervisor' || key === 'supervisor') {
    const act = args?.action != null ? String(args.action).trim() : ''
    const actZh = act ? supervisorActionZh(act) : ''
    if (actZh) return `${TOOL_NAME_ZH.supervisor} · ${actZh}`
    return `${TOOL_NAME_ZH.supervisor}（选择操作）`
  }

  if (name === 'task' || key === 'task') return `${TOOL_NAME_ZH.task}（task）`

  if (
    name === 'invoke_acp_agent' ||
    name === 'invoke_acp_agent_tool' ||
    key === 'invoke_acp_agent' ||
    key === 'invoke_acp_agent_tool'
  ) {
    return TOOL_NAME_ZH.invoke_acp_agent
  }

  if (name === 'tool' || name === 'Tool') return '工具'

  /* 未知工具：尽量显示原名，便于排查 MCP */
  const mapped = getToolCategoryZh(key)
  if (mapped && mapped !== name) return `${mapped}（${name}）`
  return name
}
