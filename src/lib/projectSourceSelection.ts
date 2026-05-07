export type ProjectSourceLanguage = 'javascript' | 'typescript' | 'ruby' | 'go' | 'python' | 'json' | 'shell' | 'markdown' | 'text';

export type SourceEditorSelection = {
  start: number;
  end: number;
};

type SourcePosition = {
  line: number;
  column: number;
};

export function getProjectSourceLanguage(path: string): ProjectSourceLanguage {
  const normalizedPath = path.trim().toLowerCase();
  const baseName = normalizedPath.split('/').pop() || normalizedPath;

  if (/\.(tsx|cts|mts)$/.test(normalizedPath)) return 'typescript';
  if (/\.(ts)$/.test(normalizedPath)) return 'typescript';
  if (/\.(jsx|mjs|cjs|js)$/.test(normalizedPath)) return 'javascript';
  if (normalizedPath.endsWith('.go')) return 'go';
  if (/\.(py|pyw)$/.test(normalizedPath)) return 'python';
  if (normalizedPath.endsWith('.rb') || normalizedPath.endsWith('.gemspec')) return 'ruby';
  if (baseName === 'gemfile' || baseName === 'rakefile') return 'ruby';
  if (normalizedPath.endsWith('.json')) return 'json';
  if (/\.(sh|bash|zsh)$/.test(normalizedPath) || baseName === 'justfile') return 'shell';
  if (/\.(md|markdown)$/.test(normalizedPath)) return 'markdown';
  return 'text';
}

function getCodeFenceLanguageForPath(path: string): string {
  const language = getProjectSourceLanguage(path);
  if (language === 'typescript') return path.toLowerCase().endsWith('.tsx') ? 'tsx' : 'ts';
  if (language === 'javascript') return path.toLowerCase().endsWith('.jsx') ? 'jsx' : 'js';
  if (language === 'python') return 'py';
  if (language === 'markdown' || language === 'text') return '';
  return language;
}

export function normalizeSourceSelection(selection: SourceEditorSelection | null, contentLength: number): SourceEditorSelection | null {
  if (!selection) return null;
  const start = Math.min(Math.max(0, selection.start), contentLength);
  const end = Math.min(Math.max(0, selection.end), contentLength);
  if (start === end) return null;
  return start < end ? { start, end } : { start: end, end: start };
}

function sourcePositionAtOffset(content: string, offset: number): SourcePosition {
  const safeOffset = Math.min(Math.max(0, offset), content.length);
  let line = 1;
  let column = 1;

  for (let index = 0; index < safeOffset; index += 1) {
    if (content[index] === '\n') {
      line += 1;
      column = 1;
    } else {
      column += 1;
    }
  }

  return { line, column };
}

export function describeSourceSelection(content: string, selection: SourceEditorSelection): string {
  const normalized = normalizeSourceSelection(selection, content.length);
  if (!normalized) return '';

  const start = sourcePositionAtOffset(content, normalized.start);
  const inclusiveEnd = sourcePositionAtOffset(content, Math.max(normalized.start, normalized.end - 1));
  if (start.line === inclusiveEnd.line) {
    return `line ${start.line}, columns ${start.column}-${inclusiveEnd.column}`;
  }
  return `lines ${start.line}-${inclusiveEnd.line}, columns ${start.column}-${inclusiveEnd.column}`;
}

function codeFenceForSnippet(snippet: string): string {
  let fence = '```';
  while (snippet.includes(fence)) {
    fence += '`';
  }
  return fence;
}

export function buildSelectedCodeSessionContext(
  fullPath: string,
  relativePath: string,
  content: string,
  selection: SourceEditorSelection,
): string | null {
  const normalized = normalizeSourceSelection(selection, content.length);
  if (!normalized) return null;

  const snippet = content.slice(normalized.start, normalized.end);
  if (snippet.trim() === '') return null;

  const rangeLabel = describeSourceSelection(content, normalized);
  const language = getCodeFenceLanguageForPath(relativePath);
  const fence = codeFenceForSnippet(snippet);
  const openingFence = language ? `${fence}${language}` : fence;

  return [
    'This request is tied to a selected code range.',
    '',
    'Target type: code selection',
    `Full path: ${fullPath}`,
    `Relative path: ${relativePath}`,
    `Selection: ${rangeLabel}`,
    '',
    'Selected code:',
    openingFence,
    snippet,
    fence,
    '',
    'Use this selected code as the primary context for the session.',
  ].join('\n');
}
