export type AgentVisualKind = 'main' | 'subagent' | 'local';

const AGENT_EMOJI_STORAGE_KEY = 'a2gent.agent_emoji.v1';

const DEFAULT_EMOJIS: Record<AgentVisualKind, string> = {
  main: '🤖',
  subagent: '🧩',
  local: '🐳',
};

function visualKey(kind: AgentVisualKind, id?: string): string {
  if (kind === 'main') {
    return 'main';
  }
  const normalizedId = (id || '').trim();
  return `${kind}:${normalizedId}`;
}

function readEmojiMap(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }
  try {
    const raw = localStorage.getItem(AGENT_EMOJI_STORAGE_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }
    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        continue;
      }
      const normalizedValue = value.trim();
      if (normalizedValue !== '') {
        result[key] = normalizedValue;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function writeEmojiMap(next: Record<string, string>): void {
  if (typeof window === 'undefined') {
    return;
  }
  localStorage.setItem(AGENT_EMOJI_STORAGE_KEY, JSON.stringify(next));
}

export function getAgentEmoji(kind: AgentVisualKind, id?: string): string {
  const key = visualKey(kind, id);
  const map = readEmojiMap();
  const configured = (map[key] || '').trim();
  if (configured !== '') {
    return configured;
  }
  return DEFAULT_EMOJIS[kind];
}

export function setAgentEmoji(kind: AgentVisualKind, emoji: string, id?: string): void {
  const key = visualKey(kind, id);
  const map = readEmojiMap();
  const value = emoji.trim();
  if (value === '') {
    delete map[key];
  } else {
    map[key] = value;
  }
  writeEmojiMap(map);
}

export function withAgentEmoji(name: string, kind: AgentVisualKind, id?: string): string {
  const emoji = getAgentEmoji(kind, id).trim();
  const trimmedName = name.trim();
  if (emoji === '') {
    return trimmedName;
  }
  if (trimmedName === '') {
    return emoji;
  }
  return `${emoji} ${trimmedName}`;
}
