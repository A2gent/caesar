const TOOL_ICONS_BY_NAME: Record<string, string> = {
  bash: '💻',
  read: '📖',
  write: '📝',
  edit: '✏️',
  replace_lines: '🧩',
  glob: '🗂️',
  find_files: '🔎',
  grep: '🔍',
  take_screenshot_tool: '📸',
  recurring_jobs_tool: '🕒',
  task: '🧠',
  google_calendar_query: '🗓️',
  brave_search_query: '🌐',
  elevenlabs_tts: '🎙️',
  macos_say_tts: '🔊',
  notify_webapp: '🔔',
  telegram_send_message: '✉️',
};

export function toolIconForName(toolName: string): string {
  const normalized = toolName.trim().toLowerCase();
  if (normalized === '') {
    return '🧰';
  }
  return TOOL_ICONS_BY_NAME[normalized] || '🧰';
}

