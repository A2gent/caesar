const TOOL_ICONS_BY_NAME: Record<string, string> = {
  bash: '💻',
  code_execution: '🐍',
  pipeline: '🔗',
  read: '📖',
  write: '📝',
  edit: '✏️',
  replace_lines: '🧩',
  glob: '🗂️',
  find_files: '🔎',
  grep: '🔍',
  filter: '🧹',
  take_screenshot_tool: '📸',
  take_camera_photo_tool: '📷',
  recurring_jobs_tool: '🕒',
  session_task_progress: '📋',
  task: '🧠',
  google_calendar_query: '🗓️',
  brave_search_query: '🌐',
  elevenlabs_tts: '🎙️',
  macos_say_tts: '🔊',
  piper_tts: '🔊',
  notify_webapp: '🔔',
  telegram_send_message: '✉️',
  whisper_stt: '🎤',
  browser_chrome: '🧭',
  mcp_manage: '🔌',
  fetch_url: '📡',
  exa_search: '🔬',
  git_integration: '🌿',
  delegate_to_subagent: '🤖',
  delegate_to_external_agent: '🌐',
  discover_external_agents: '🛰️',
  create_local_docker_agents_bulk: '🐳',
};

// Tool categories for grouping in the UI
export type ToolCategory =
  | 'file-system'
  | 'multimedia'
  | 'web-network'
  | 'system'
  | 'task-management'
  | 'notifications'
  | 'search-external'
  | 'mcp'
  | 'other';

export interface CategoryInfo {
  id: ToolCategory;
  label: string;
  icon: string;
  description: string;
}

export const TOOL_CATEGORIES: CategoryInfo[] = [
  {
    id: 'file-system',
    label: 'File System',
    icon: '📁',
    description: 'Read, write, and manipulate files and directories',
  },
  {
    id: 'multimedia',
    label: 'Multimedia',
    icon: '🎬',
    description: 'Audio, video, images, screenshots, and speech',
  },
  {
    id: 'web-network',
    label: 'Web & Network',
    icon: '🌐',
    description: 'Browser automation and web requests',
  },
  {
    id: 'system',
    label: 'System',
    icon: '⚙️',
    description: 'Shell commands and system operations',
  },
  {
    id: 'task-management',
    label: 'Task Management',
    icon: '📋',
    description: 'Recurring jobs and task delegation',
  },
  {
    id: 'notifications',
    label: 'Notifications',
    icon: '🔔',
    description: 'Web and messaging notifications',
  },
  {
    id: 'search-external',
    label: 'Search & External',
    icon: '🔍',
    description: 'Search engines and external services',
  },
  {
    id: 'mcp',
    label: 'External Services & Agents',
    icon: '🌐',
    description: 'Access external services, MCP servers, and network agents',
  },
];

// Mapping of tool names to their categories
const TOOL_CATEGORY_MAP: Record<string, ToolCategory> = {
  // File System
  read: 'file-system',
  write: 'file-system',
  edit: 'file-system',
  replace_lines: 'file-system',
  glob: 'file-system',
  find_files: 'file-system',
  grep: 'file-system',
  filter: 'file-system',
  // Multimedia
  take_screenshot_tool: 'multimedia',
  take_camera_photo_tool: 'multimedia',
  whisper_stt: 'multimedia',
  piper_tts: 'multimedia',
  macos_say_tts: 'multimedia',
  elevenlabs_tts: 'multimedia',
  // Web & Network
  browser_chrome: 'web-network',
  fetch_url: 'web-network',
  // System
  bash: 'system',
  code_execution: 'system',
  pipeline: 'system',
  git_integration: 'system',
  // Task Management
  recurring_jobs_tool: 'task-management',
  session_task_progress: 'task-management',
  task: 'task-management',
  delegate_to_subagent: 'task-management',
  create_local_docker_agents_bulk: 'mcp',
  delegate_to_external_agent: 'mcp',
  // Notifications
  notify_webapp: 'notifications',
  telegram_send_message: 'notifications',
  // Search & External
  brave_search_query: 'search-external',
  exa_search: 'search-external',
  google_calendar_query: 'search-external',
  discover_external_agents: 'mcp',
  // MCP
  mcp_manage: 'mcp',
};

export function toolIconForName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === '') {
    return '🧰';
  }
  return TOOL_ICONS_BY_NAME[normalized] || '🧰';
}

export function getToolCategory(toolName: string): ToolCategory {
  const normalized = toolName.trim().toLowerCase();
  return TOOL_CATEGORY_MAP[normalized] || 'other';
}

export function getCategoryInfo(categoryId: ToolCategory): CategoryInfo | undefined {
  return TOOL_CATEGORIES.find((cat) => cat.id === categoryId);
}
