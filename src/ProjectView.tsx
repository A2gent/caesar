import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { FileDiff, type FileDiffMetadata } from '@pierre/diffs/react';
import { parsePatchFiles } from '@pierre/diffs';
import {
  browseMindDirectories,
  commitProjectGit,
  createProjectFolder,
  createSession,
  discardProjectGitFile,
  deleteProject,
  deleteProjectFile,
  deleteSession,
  getProject,
  getProjectFile,
  generateProjectGitCommitMessage,
  getProjectGitCommitFileDiff,
  getProjectGitCommitFiles,
  getProjectGitFileDiff,
  getProjectGitHistory,
  getProjectGitStatus,
  initializeProjectGit,
  getSession,
  getSettings,
  listProjectTree,
  listProviders,
  listSessions,
  moveProjectFile,
  parseTaskProgress,
  pullProjectGit,
  pushProjectGit,
  renameProjectEntry,
  saveProjectFile,
  searchProject,
  stageAllProjectGitFiles,
  stageProjectGitFile,
  startSession,
  unstageProjectGitFile,
  updateProject,
  type LLMProviderType,
  type MessageImage,
  type ProjectContentMatch,
  type ProjectFileNameMatch,
  type MindTreeEntry,
  type ProjectGitChangedFile,
  type ProjectGitCommitFile,
  type ProjectGitHistoryCommit,
  type ProjectGitBranch,
  type Project,
  type ProjectSearchResponse,
  type Session,
} from './api';
import ChatInput from './ChatInput';
import { EmptyState, EmptyStateTitle, EmptyStateHint } from './EmptyState';
import {
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  buildAgentSystemPromptAppend,
  parseInstructionBlocksSetting,
  serializeInstructionBlocksSetting,
  type InstructionBlock,
} from './instructionBlocks';
import { updateSettings } from './api';
import {
  DEFAULT_WORKFLOW_ID,
  listWorkflows,
  resolveWorkflowLaunchTarget,
  type WorkflowDefinition,
} from './workflows';

type MarkdownMode = 'kanban' | 'preview' | 'source';
type ProjectViewTab = 'explorer' | 'tasks' | 'sessions' | 'changes' | 'history';

const TODO_FILE_NAMES = new Set(['todo.md', 'to-do.md']);
const TODO_TASK_LINE_PATTERN = /^(\s*)-\s+\[( |x|X)\]\s+(.*?)(?:\s+<!--\s*task-file:\s*([^\s][^>]*)\s*-->)?\s*$/;
const TODO_HEADING_PATTERN = /^(#{1,6})\s+(.+?)\s*$/;

type TodoTask = {
  id: string;
  lineIndex: number;
  indent: string;
  checked: boolean;
  text: string;
  linkedFilePath: string;
};

type TodoColumn = {
  id: string;
  title: string;
  headingLineIndex: number | null;
  tasks: TodoTask[];
};

type TodoBoard = {
  columns: TodoColumn[];
};

type SessionListRow = {
  session: Session;
  depth: number;
};

type DraggedTodoTask = {
  task: TodoTask;
  sourceColumnId: string;
};

const GIT_HISTORY_COLORS = ['#5b8cff', '#22c55e', '#f59e0b', '#ef4444', '#a855f7', '#14b8a6', '#e879f9', '#f97316'];

function gitHistoryColorForRef(ref: string): string {
  if (ref.trim() === '') {
    return GIT_HISTORY_COLORS[0];
  }
  let hash = 0;
  for (let index = 0; index < ref.length; index += 1) {
    hash = (hash * 31 + ref.charCodeAt(index)) >>> 0;
  }
  return GIT_HISTORY_COLORS[hash % GIT_HISTORY_COLORS.length];
}

function formatGitHistoryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function gitHistoryAuthorInitials(name: string): string {
  const trimmed = name.trim();
  if (trimmed === '') return '?';
  const words = trimmed.split(/\s+/).filter(Boolean);
  if (words.length === 1) {
    return words[0].slice(0, 2).toUpperCase();
  }
  return `${words[0][0] || ''}${words[1][0] || ''}`.toUpperCase();
}

const GIT_STATUS_LABELS: Record<string, string> = {
  ' ': 'Unchanged',
  M: 'Modified',
  A: 'Added',
  D: 'Deleted',
  R: 'Renamed',
  C: 'Copied',
  U: 'Unmerged',
  '?': 'Untracked',
  '!': 'Ignored',
};

function describeGitStatusCode(code: string): string {
  return GIT_STATUS_LABELS[code] || `Unknown (${code})`;
}

function buildGitFileStatusTooltip(file: ProjectGitChangedFile): string {
  const summaryCode = file.status || '??';
  const indexCode = file.index_status || ' ';
  const worktreeCode = file.worktree_status || ' ';
  const stagedText = file.staged ? 'Staged' : 'Not staged';
  const untrackedText = file.untracked ? 'Untracked' : 'Tracked';

  return [
    `Git status: ${summaryCode}`,
    `Index: ${describeGitStatusCode(indexCode)}`,
    `Worktree: ${describeGitStatusCode(worktreeCode)}`,
    `Stage: ${stagedText}`,
    `File: ${untrackedText}`,
  ].join('\n');
}

function isTodoFilePath(path: string): boolean {
  const base = path.split('/').filter(Boolean).pop()?.toLowerCase() || '';
  return TODO_FILE_NAMES.has(base);
}

function defaultMarkdownModeForPath(path: string): MarkdownMode {
  return isTodoFilePath(path) ? 'kanban' : 'preview';
}

function parseTodoBoard(content: string): TodoBoard {
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const columns: TodoColumn[] = [];
  let currentColumn: TodoColumn = {
    id: 'default',
    title: 'Tasks',
    headingLineIndex: null,
    tasks: [],
  };
  columns.push(currentColumn);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = TODO_HEADING_PATTERN.exec(line.trim());
    if (headingMatch) {
      currentColumn = {
        id: `h:${index}`,
        title: headingMatch[2].trim(),
        headingLineIndex: index,
        tasks: [],
      };
      columns.push(currentColumn);
      continue;
    }

    const taskMatch = TODO_TASK_LINE_PATTERN.exec(line);
    if (!taskMatch) {
      continue;
    }

    currentColumn.tasks.push({
      id: `t:${index}`,
      lineIndex: index,
      indent: taskMatch[1] || '',
      checked: taskMatch[2].toLowerCase() === 'x',
      text: (taskMatch[3] || '').trim(),
      linkedFilePath: (taskMatch[4] || '').trim(),
    });
  }

  const hasExplicitColumns = columns.some((column) => column.headingLineIndex !== null);
  const visibleColumns = hasExplicitColumns
    ? columns.filter((column) => column.headingLineIndex !== null || column.tasks.length > 0)
    : columns;

  return { columns: visibleColumns };
}

function slugifyTaskFileName(text: string): string {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-');
  return normalized || 'task';
}

function mutateLines(content: string, mutate: (lines: string[]) => void): string {
  const normalized = content.replace(/\r\n/g, '\n');
  const hadTrailingNewline = normalized.endsWith('\n');
  const lines = normalized.split('\n');
  mutate(lines);
  let next = lines.join('\n');
  if (hadTrailingNewline && next !== '' && !next.endsWith('\n')) {
    next += '\n';
  }
  return next;
}

function buildTodoTaskLine(taskText: string, linkedFilePath = '', indent = '', checked = false): string {
  const mark = checked ? 'x' : ' ';
  const base = `${indent}- [${mark}] ${taskText.trim()}`;
  if (linkedFilePath.trim() === '') {
    return base;
  }
  return `${base} <!-- task-file: ${linkedFilePath.trim()} -->`;
}

function findInsertIndexForColumn(lines: string[], column: TodoColumn): number {
  if (column.headingLineIndex === null) {
    return lines.length;
  }

  const regionStart = column.headingLineIndex + 1;
  let regionEnd = lines.length;
  for (let i = regionStart; i < lines.length; i += 1) {
    if (TODO_HEADING_PATTERN.test(lines[i].trim())) {
      regionEnd = i;
      break;
    }
  }

  let lastTaskIndex = -1;
  for (let i = regionStart; i < regionEnd; i += 1) {
    if (TODO_TASK_LINE_PATTERN.test(lines[i])) {
      lastTaskIndex = i;
    }
  }

  return lastTaskIndex >= 0 ? lastTaskIndex + 1 : regionStart;
}

function findHeadingLineIndexByTitle(lines: string[], title: string): number | null {
  for (let i = 0; i < lines.length; i += 1) {
    const match = TODO_HEADING_PATTERN.exec(lines[i].trim());
    if (!match) continue;
    if (match[2].trim() === title.trim()) {
      return i;
    }
  }
  return null;
}

const DEFAULT_TREE_PANEL_WIDTH = 360;
const MIN_TREE_PANEL_WIDTH = 240;
const MAX_TREE_PANEL_WIDTH = 720;
const TREE_PANEL_WIDTH_STORAGE_KEY = 'a2gent.project.tree.width';

function buildWorkflowSessionMetadata(workflow: WorkflowDefinition): Record<string, unknown> {
  return {
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    workflow_definition: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      entryNodeId: workflow.entryNodeId,
      policy: workflow.policy,
      nodes: workflow.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        ref: node.kind === 'subagent'
          ? (node.subAgentId || '')
          : node.kind === 'local'
            ? (node.localAgentId || '')
            : node.kind === 'external'
              ? (node.externalAgentId || '')
              : '',
        subAgentId: node.subAgentId,
        localAgentId: node.localAgentId,
        externalAgentId: node.externalAgentId,
      })),
      edges: workflow.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        mode: edge.mode,
      })),
    },
  };
}
const EXPANDED_DIRS_STORAGE_KEY_PREFIX = 'a2gent.project.expandedDirs.';
const SELECTED_FILE_STORAGE_KEY_PREFIX = 'a2gent.project.selectedFile.';
const SELECTED_WORKFLOW_STORAGE_KEY_PREFIX = 'a2gent.project.selectedWorkflow.';
const SYSTEM_PROJECT_KB_ID = 'system-kb';
const SYSTEM_PROJECT_BODY_ID = 'system-agent';
const SYSTEM_PROJECT_SOUL_ID = 'system-soul';

function readStoredTreePanelWidth(): number {
  const rawWidth = localStorage.getItem(TREE_PANEL_WIDTH_STORAGE_KEY);
  const parsed = rawWidth ? Number.parseInt(rawWidth, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TREE_PANEL_WIDTH;
  }
  return Math.min(MAX_TREE_PANEL_WIDTH, Math.max(MIN_TREE_PANEL_WIDTH, parsed));
}

function readStoredExpandedDirs(projectId: string): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_DIRS_STORAGE_KEY_PREFIX + projectId);
    if (!raw) {
      return new Set<string>(['']);
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return new Set<string>(parsed);
    }
  } catch {
    // ignore parse errors
  }
  return new Set<string>(['']);
}

function writeStoredExpandedDirs(projectId: string, dirs: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_DIRS_STORAGE_KEY_PREFIX + projectId, JSON.stringify(Array.from(dirs)));
  } catch {
    // ignore storage errors
  }
}

function readStoredSelectedFile(projectId: string): string {
  try {
    const raw = localStorage.getItem(SELECTED_FILE_STORAGE_KEY_PREFIX + projectId);
    return raw || '';
  } catch {
    return '';
  }
}

function writeStoredSelectedFile(projectId: string, path: string): void {
  try {
    if (path) {
      localStorage.setItem(SELECTED_FILE_STORAGE_KEY_PREFIX + projectId, path);
    } else {
      localStorage.removeItem(SELECTED_FILE_STORAGE_KEY_PREFIX + projectId);
    }
  } catch {
    // ignore storage errors
  }
}

function isExternalLink(href: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(href);
}

function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/<[^>]*>/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function normalizeMindPath(path: string): string {
  const parts = path.split('/').filter((segment) => segment !== '');
  const normalized: string[] = [];
  for (const part of parts) {
    if (part === '.') {
      continue;
    }
    if (part === '..') {
      if (normalized.length > 0) {
        normalized.pop();
      }
      continue;
    }
    normalized.push(part);
  }
  return normalized.join('/');
}

function dirname(path: string): string {
  const idx = path.lastIndexOf('/');
  if (idx < 0) {
    return '';
  }
  return path.slice(0, idx);
}

function resolveMarkdownLinkPath(currentFilePath: string, hrefPath: string): string {
  if (hrefPath.startsWith('/')) {
    return normalizeMindPath(hrefPath.slice(1));
  }
  return normalizeMindPath([dirname(currentFilePath), hrefPath].filter(Boolean).join('/'));
}

function normalizePathForCompare(value: string): string {
  return value.replace(/[\\]+/g, '/').replace(/\/+$/, '');
}

function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith('\\\\');
}

function toMindRelativePath(rootFolder: string, path: string): string {
  const trimmedPath = path.trim();
  if (trimmedPath === '') {
    return '';
  }

  if (!isAbsolutePath(trimmedPath)) {
    return normalizeMindPath(trimmedPath);
  }

  const rootNormalized = normalizePathForCompare(rootFolder.trim());
  const pathNormalized = normalizePathForCompare(trimmedPath);
  if (rootNormalized === '' || pathNormalized.length <= rootNormalized.length) {
    return '';
  }
  if (!pathNormalized.toLowerCase().startsWith(`${rootNormalized.toLowerCase()}/`)) {
    return '';
  }

  return normalizeMindPath(pathNormalized.slice(rootNormalized.length + 1));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

type TokenRule = {
  regex: RegExp;
  className: string;
  priority: number;
};

type TokenMatch = {
  start: number;
  end: number;
  className: string;
  priority: number;
};

const JS_KEYWORDS = [
  'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'debugger',
  'default', 'delete', 'do', 'else', 'enum', 'export', 'extends', 'false', 'finally', 'for',
  'from', 'function', 'if', 'implements', 'import', 'in', 'instanceof', 'interface', 'let',
  'new', 'null', 'of', 'package', 'private', 'protected', 'public', 'return', 'static',
  'super', 'switch', 'this', 'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var',
  'void', 'while', 'with', 'yield',
];

const GO_KEYWORDS = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
  'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
  'return', 'select', 'struct', 'switch', 'type', 'var',
];

const PY_KEYWORDS = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def', 'del', 'elif',
  'else', 'except', 'False', 'finally', 'for', 'from', 'global', 'if', 'import', 'in', 'is',
  'lambda', 'None', 'nonlocal', 'not', 'or', 'pass', 'raise', 'return', 'True', 'try', 'while',
  'with', 'yield',
];

const SQL_KEYWORDS = [
  'select', 'from', 'where', 'join', 'left', 'right', 'inner', 'outer', 'on', 'group', 'by',
  'order', 'insert', 'into', 'values', 'update', 'set', 'delete', 'create', 'table', 'alter',
  'drop', 'index', 'as', 'distinct', 'limit', 'offset', 'having', 'union', 'all', 'and', 'or',
  'not', 'null', 'is', 'like', 'between',
];

function keywordRegex(words: string[], caseInsensitive = false): RegExp {
  const flags = caseInsensitive ? 'gi' : 'g';
  return new RegExp(`\\b(${words.join('|')})\\b`, flags);
}

function getTokenRules(language: string): TokenRule[] {
  const normalized = language.trim().toLowerCase();

  if (normalized === 'json') {
    return [
      { regex: /\"(?:[^\"\\]|\\.)*\"\s*(?=:)/g, className: 'tok-key', priority: 4 },
      { regex: /\"(?:[^\"\\]|\\.)*\"/g, className: 'tok-string', priority: 3 },
      { regex: /\b(?:true|false|null)\b/g, className: 'tok-keyword', priority: 2 },
      { regex: /\b\d+(?:\.\d+)?(?:e[+-]?\d+)?\b/gi, className: 'tok-number', priority: 1 },
    ];
  }

  if (normalized === 'bash' || normalized === 'sh' || normalized === 'zsh' || normalized === 'shell') {
    return [
      { regex: /#.*$/gm, className: 'tok-comment', priority: 4 },
      { regex: /\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 3 },
      { regex: /\b(?:if|then|else|fi|for|in|do|done|case|esac|while|until|function)\b/g, className: 'tok-keyword', priority: 2 },
      { regex: /\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/g, className: 'tok-variable', priority: 2 },
      { regex: /\b\d+\b/g, className: 'tok-number', priority: 1 },
    ];
  }

  if (normalized === 'go' || normalized === 'golang') {
    return [
      { regex: /\/\*[\s\S]*?\*\/|\/\/.*$/gm, className: 'tok-comment', priority: 5 },
      { regex: /\"(?:[^\"\\]|\\.)*\"|`[\s\S]*?`|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 4 },
      { regex: keywordRegex(GO_KEYWORDS), className: 'tok-keyword', priority: 3 },
      { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 2 },
      { regex: /\b[A-Z][A-Za-z0-9_]*\b/g, className: 'tok-type', priority: 1 },
    ];
  }

  if (normalized === 'py' || normalized === 'python') {
    return [
      { regex: /#.*$/gm, className: 'tok-comment', priority: 5 },
      { regex: /\"\"\"[\s\S]*?\"\"\"|'''[\s\S]*?'''|\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 4 },
      { regex: keywordRegex(PY_KEYWORDS), className: 'tok-keyword', priority: 3 },
      { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 2 },
      { regex: /\bself\b/g, className: 'tok-variable', priority: 1 },
    ];
  }

  if (normalized === 'sql') {
    return [
      { regex: /--.*$/gm, className: 'tok-comment', priority: 4 },
      { regex: /\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'/g, className: 'tok-string', priority: 3 },
      { regex: keywordRegex(SQL_KEYWORDS, true), className: 'tok-keyword', priority: 2 },
      { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 1 },
    ];
  }

  return [
    { regex: /\/\*[\s\S]*?\*\/|\/\/.*$|#.*$/gm, className: 'tok-comment', priority: 5 },
    { regex: /\"(?:[^\"\\]|\\.)*\"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`/g, className: 'tok-string', priority: 4 },
    { regex: keywordRegex(JS_KEYWORDS), className: 'tok-keyword', priority: 3 },
    { regex: /\b\d+(?:\.\d+)?\b/g, className: 'tok-number', priority: 2 },
    { regex: /\b[A-Z][A-Za-z0-9_]*\b/g, className: 'tok-type', priority: 1 },
  ];
}

function findMatches(code: string, rules: TokenRule[]): TokenMatch[] {
  const matches: TokenMatch[] = [];

  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match = rule.regex.exec(code);
    while (match) {
      const value = match[0];
      if (value.length > 0) {
        matches.push({
          start: match.index,
          end: match.index + value.length,
          className: rule.className,
          priority: rule.priority,
        });
      }
      match = rule.regex.exec(code);
    }
  }

  matches.sort((a, b) => {
    if (a.start !== b.start) {
      return a.start - b.start;
    }
    if (a.priority !== b.priority) {
      return b.priority - a.priority;
    }
    return (b.end - b.start) - (a.end - a.start);
  });

  return matches;
}

function highlightCode(code: string, language: string): string {
  const matches = findMatches(code, getTokenRules(language));
  const byStart = new Map<number, TokenMatch[]>();
  for (const match of matches) {
    const list = byStart.get(match.start);
    if (list) {
      list.push(match);
    } else {
      byStart.set(match.start, [match]);
    }
  }

  let index = 0;
  let html = '';

  while (index < code.length) {
    const candidates = byStart.get(index) || [];
    let selected: TokenMatch | null = null;
    for (const candidate of candidates) {
      if (!selected) {
        selected = candidate;
        continue;
      }
      if (candidate.priority > selected.priority) {
        selected = candidate;
        continue;
      }
      if (candidate.priority === selected.priority && candidate.end - candidate.start > selected.end - selected.start) {
        selected = candidate;
      }
    }

    if (selected && selected.end > index) {
      html += `<span class="${selected.className}">${escapeHtml(code.slice(index, selected.end))}</span>`;
      index = selected.end;
      continue;
    }

    html += escapeHtml(code[index]);
    index += 1;
  }

  return html;
}

function renderInlineMarkdown(value: string): string {
  let text = escapeHtml(value);
  text = text.replace(/`([^`]+)`/g, '<code>$1</code>');
  text = text.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  text = text.replace(/\*([^*]+)\*/g, '<em>$1</em>');
  text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" rel="noreferrer noopener">$1</a>');
  return text;
}

function parseTableCells(line: string): string[] | null {
  if (!line.includes('|')) {
    return null;
  }

  let value = line.trim();
  if (value.startsWith('|')) {
    value = value.slice(1);
  }
  if (value.endsWith('|')) {
    value = value.slice(0, -1);
  }

  const cells = value.split('|').map((cell) => cell.trim());
  return cells.length > 0 ? cells : null;
}

function isTableSeparator(line: string, expectedCells: number): boolean {
  const cells = parseTableCells(line);
  if (!cells || cells.length !== expectedCells) {
    return false;
  }
  return cells.every((cell) => /^:?-{3,}:?$/.test(cell));
}

function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inList = false;
  let inCodeFence = false;
  let inTable = false;
  let tableColumns = 0;
  let codeLanguage = '';
  let codeFenceLines: string[] = [];
  const headingCounts = new Map<string, number>();

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  const closeTable = () => {
    if (inTable) {
      html.push('</tbody></table>');
      inTable = false;
      tableColumns = 0;
    }
  };

  const closeCodeFence = () => {
    if (!inCodeFence) {
      return;
    }
    const langClass = codeLanguage ? ` language-${escapeHtml(codeLanguage)}` : '';
    const highlighted = highlightCode(codeFenceLines.join('\n'), codeLanguage);
    html.push(`<pre class="md-code-block"><code class="${langClass.trim()}">${highlighted}</code></pre>`);
    inCodeFence = false;
    codeLanguage = '';
    codeFenceLines = [];
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = /^```\s*([a-zA-Z0-9_+-]+)?\s*$/.exec(line);
    if (fenceMatch) {
      closeList();
      closeTable();
      if (!inCodeFence) {
        inCodeFence = true;
        codeLanguage = (fenceMatch[1] || '').toLowerCase();
        codeFenceLines = [];
      } else {
        closeCodeFence();
      }
      continue;
    }

    if (inCodeFence) {
      codeFenceLines.push(line);
      continue;
    }

    const trimmed = line.trim();
    if (trimmed === '') {
      closeList();
      closeTable();
      continue;
    }

    if (!inTable) {
      const headerCells = parseTableCells(trimmed);
      if (headerCells && index + 1 < lines.length && isTableSeparator(lines[index + 1].trim(), headerCells.length)) {
        closeList();
        inTable = true;
        tableColumns = headerCells.length;
        html.push('<table class="md-table"><thead><tr>');
        for (const cell of headerCells) {
          html.push(`<th>${renderInlineMarkdown(cell)}</th>`);
        }
        html.push('</tr></thead><tbody>');
        index += 1;
        continue;
      }
    }

    if (inTable) {
      const rowCells = parseTableCells(trimmed);
      if (rowCells) {
        const normalizedCells = [...rowCells];
        while (normalizedCells.length < tableColumns) {
          normalizedCells.push('');
        }
        normalizedCells.length = tableColumns;
        html.push('<tr>');
        for (const cell of normalizedCells) {
          html.push(`<td>${renderInlineMarkdown(cell)}</td>`);
        }
        html.push('</tr>');
        continue;
      }
      closeTable();
    }

    const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmed);
    if (headingMatch) {
      closeList();
      const level = headingMatch[1].length;
      const headingHtml = renderInlineMarkdown(headingMatch[2]);
      const baseSlug = slugifyHeading(headingHtml) || 'section';
      const currentCount = headingCounts.get(baseSlug) || 0;
      headingCounts.set(baseSlug, currentCount + 1);
      const headingID = currentCount === 0 ? baseSlug : `${baseSlug}-${currentCount + 1}`;
      html.push(`<h${level} id="${headingID}">${headingHtml}</h${level}>`);
      continue;
    }

    const listMatch = /^[-*]\s+(.+)$/.exec(trimmed);
    if (listMatch) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${renderInlineMarkdown(listMatch[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${renderInlineMarkdown(trimmed)}</p>`);
  }

  closeCodeFence();
  if (inList) {
    html.push('</ul>');
  }
  if (inTable) {
    html.push('</tbody></table>');
  }

  return html.join('\n');
}

function getParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (trimmed === '' || trimmed === '/') {
    return '/';
  }

  const windowsRootMatch = /^[a-zA-Z]:$/.exec(trimmed);
  if (windowsRootMatch) {
    return trimmed + '\\';
  }

  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex < 0) {
    return trimmed;
  }

  if (separatorIndex === 0) {
    return '/';
  }

  return trimmed.slice(0, separatorIndex);
}

function joinMindAbsolutePath(rootFolder: string, relativePath: string): string {
  const cleanRoot = rootFolder.trim().replace(/[\\/]+$/, '');
  const cleanRelative = relativePath.trim().replace(/^[\\/]+/, '');
  if (cleanRelative === '') {
    return cleanRoot;
  }
  const separator = cleanRoot.includes('\\') ? '\\' : '/';
  const normalizedRelative = cleanRelative.replace(/[\\/]+/g, separator);
  return `${cleanRoot}${separator}${normalizedRelative}`;
}

function buildMindSessionContext(type: 'folder' | 'file', fullPath: string): string {
  const targetLabel = type === 'folder' ? 'folder' : 'file';
  return [
    `This request is tied to a project ${targetLabel}.`,
    '',
    `Target type: ${targetLabel}`,
    `Full path: ${fullPath}`,
    '',
    'Use this path as primary context for the session.',
  ].join('\n');
}

function getProjectViewerPlaceholder(project: Project | null): { icon: string; title: string; hint: string } {
  if (!project) {
    return {
      icon: '📄',
      title: 'No file selected.',
      hint: 'Select a file from the tree to start viewing and editing.',
    };
  }

  if (project.id === SYSTEM_PROJECT_KB_ID) {
    return {
      icon: '🧠',
      title: 'Knowledge Base (Vault)',
      hint: 'Use this as your Obsidian-style personal vault. Store linked notes so the agent can use your context and long-term knowledge.',
    };
  }

  if (project.id === SYSTEM_PROJECT_BODY_ID) {
    return {
      icon: '🛠️',
      title: 'Body (Agent Source Code)',
      hint: 'This is the agent codebase. Ask the agent to improve behavior, implement changes, and commit updates here.',
    };
  }

  if (project.id === SYSTEM_PROJECT_SOUL_ID) {
    return {
      icon: '🫀',
      title: 'Soul (Agent State)',
      hint: 'This stores database, sessions, and identity state. Keep it versioned so the agent can be moved to another machine quickly.',
    };
  }

  return {
    icon: '📄',
    title: 'No file selected.',
    hint: 'Select a file from the tree to start viewing and editing.',
  };
}

function ProjectView() {
  const navigate = useNavigate();
  const { projectId } = useParams<{ projectId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  
  // Project state
  const [project, setProject] = useState<Project | null>(null);
  const [isLoadingProject, setIsLoadingProject] = useState(true);
  const [isDeletingProject, setIsDeletingProject] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [projectSearchQuery, setProjectSearchQuery] = useState('');
  const [projectSearchResults, setProjectSearchResults] = useState<ProjectSearchResponse | null>(null);
  const [isSearchingProject, setIsSearchingProject] = useState(false);
  const [projectSearchError, setProjectSearchError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ProjectViewTab>('explorer');
  const [rootFolder, setRootFolder] = useState('');
  const [isGitRepo, setIsGitRepo] = useState(false);
  const [gitChangedFiles, setGitChangedFiles] = useState<ProjectGitChangedFile[]>([]);
  const [isLoadingGitStatus, setIsLoadingGitStatus] = useState(false);
  const [commitRepoPath, setCommitRepoPath] = useState('');
  const [commitRepoLabel, setCommitRepoLabel] = useState('');
  const [commitDialogFiles, setCommitDialogFiles] = useState<ProjectGitChangedFile[]>([]);
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [gitFileActionPath, setGitFileActionPath] = useState<string | null>(null);
  const [selectedCommitFilePath, setSelectedCommitFilePath] = useState('');
  const [selectedCommitFileDiff, setSelectedCommitFileDiff] = useState('');
  const [isLoadingCommitFileDiff, setIsLoadingCommitFileDiff] = useState(false);
  const [commitDiffThemeMode, setCommitDiffThemeMode] = useState<'dark' | 'light'>(() => {
    if (typeof document === 'undefined') return 'dark';
    return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
  });
  const [isGeneratingCommitMessage, setIsGeneratingCommitMessage] = useState(false);
  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [isInitializingGit, setIsInitializingGit] = useState(false);
  const [isGitInitDialogOpen, setIsGitInitDialogOpen] = useState(false);
  const [gitInitRemoteURL, setGitInitRemoteURL] = useState('');
  const [gitHistoryBranches, setGitHistoryBranches] = useState<ProjectGitBranch[]>([]);
  const [gitHistoryCommits, setGitHistoryCommits] = useState<ProjectGitHistoryCommit[]>([]);
  const [isLoadingGitHistory, setIsLoadingGitHistory] = useState(false);
  const [gitHistoryError, setGitHistoryError] = useState<string | null>(null);
  const [selectedHistoryCommitHash, setSelectedHistoryCommitHash] = useState('');
  const [historyCommitFiles, setHistoryCommitFiles] = useState<ProjectGitCommitFile[]>([]);
  const [isLoadingHistoryCommitFiles, setIsLoadingHistoryCommitFiles] = useState(false);
  const [selectedHistoryFilePath, setSelectedHistoryFilePath] = useState('');
  const [selectedHistoryFileDiff, setSelectedHistoryFileDiff] = useState('');
  const [isLoadingHistoryFileDiff, setIsLoadingHistoryFileDiff] = useState(false);
  const commitDiffRequestRef = useRef(0);
  const gitStatusRequestRef = useRef(0);
  const commitDialogFilesRequestRef = useRef(0);
  const gitHistoryRequestRef = useRef(0);
  const historyCommitFilesRequestRef = useRef(0);
  const historyFileDiffRequestRef = useRef(0);
  const [gitDiscardPath, setGitDiscardPath] = useState<string | null>(null);
  const [isStagingAll, setIsStagingAll] = useState(false);
  const [folderGitStatusByPath, setFolderGitStatusByPath] = useState<Record<string, { hasGit: boolean; hasChanges: boolean }>>({});
  const folderGitScanGenerationRef = useRef(0);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const root = document.documentElement;
    const syncTheme = () => {
      setCommitDiffThemeMode(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
    };
    syncTheme();
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        if (mutation.type === 'attributes' && mutation.attributeName === 'data-theme') {
          syncTheme();
          break;
        }
      }
    });
    observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, []);

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isDeletingAllSessions, setIsDeletingAllSessions] = useState(false);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isQueuingSession, setIsQueuingSession] = useState(false);
  const [duplicatingSessionID, setDuplicatingSessionID] = useState<string | null>(null);
  const [startingSessionID, setStartingSessionID] = useState<string | null>(null);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(DEFAULT_WORKFLOW_ID);

  // Files state
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);
  const [treeEntries, setTreeEntries] = useState<Record<string, MindTreeEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set<string>(['']));
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set<string>());
  const [selectedFilePath, setSelectedFilePath] = useState('');
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [savedFileContent, setSavedFileContent] = useState('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');
  const [isUpdatingTodoBoard, setIsUpdatingTodoBoard] = useState(false);
  const [startingTaskSessionID, setStartingTaskSessionID] = useState<string | null>(null);
  const [draggedTodoTask, setDraggedTodoTask] = useState<DraggedTodoTask | null>(null);
  const [todoDropTargetColumnID, setTodoDropTargetColumnID] = useState<string | null>(null);
  const [editingTodoTaskID, setEditingTodoTaskID] = useState<string | null>(null);
  const [editingTodoTaskText, setEditingTodoTaskText] = useState('');
  const [pendingAnchor, setPendingAnchor] = useState('');
  const [treePanelWidth, setTreePanelWidth] = useState(readStoredTreePanelWidth);
  const treeResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // File session context state
  const [sessionComposerMessage, setSessionComposerMessage] = useState('');
  const [sessionTargetLabel, setSessionTargetLabel] = useState('');
  const [agentInstructionFilePaths, setAgentInstructionFilePaths] = useState<Set<string>>(new Set());
  const [isAddingAgentInstructionFile, setIsAddingAgentInstructionFile] = useState(false);
  const [isFileActionsMenuOpen, setIsFileActionsMenuOpen] = useState(false);
  const [draggedFilePath, setDraggedFilePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [isMovingFile, setIsMovingFile] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const fileActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const handledOpenFileQueryRef = useRef('');
  const projectSearchRequestRef = useRef(0);

  // Load project details
  useEffect(() => {
    // Reset git-scoped UI state so repo sub-path from previous project is never reused.
    setProject(null);
    setRootFolder('');
    setIsGitRepo(false);
    setGitChangedFiles([]);
    setCommitRepoPath('');
    setCommitRepoLabel('');
    setCommitDialogFiles([]);
    setCommitMessage('');
    setSelectedCommitFilePath('');
    setSelectedCommitFileDiff('');
    setGitHistoryBranches([]);
    setGitHistoryCommits([]);
    setGitHistoryError(null);
    setSelectedHistoryCommitHash('');
    setHistoryCommitFiles([]);
    setSelectedHistoryFilePath('');
    setSelectedHistoryFileDiff('');
    commitDiffRequestRef.current += 1;
    gitStatusRequestRef.current += 1;
    commitDialogFilesRequestRef.current += 1;
    gitHistoryRequestRef.current += 1;
    historyCommitFilesRequestRef.current += 1;
    historyFileDiffRequestRef.current += 1;

    if (!projectId) {
      setIsLoadingProject(false);
      return;
    }

    const loadProject = async () => {
      setIsLoadingProject(true);
      try {
        const proj = await getProject(projectId);
        setProject(proj);
        setRootFolder(proj.folder || '');
        // Clear file tree state when switching projects
        setTreeEntries({});
        setLoadingDirs(new Set());
        setSelectedFilePath('');
        setSelectedFileContent('');
        setSavedFileContent('');
        // Load stored file state for this project
        if (proj.folder) {
          setExpandedDirs(readStoredExpandedDirs(projectId));
          setSelectedFilePath(readStoredSelectedFile(projectId));
        } else {
          setExpandedDirs(new Set(['']));
        }
      } catch (err) {
        console.error('Failed to load project:', err);
        setError(err instanceof Error ? err.message : 'Failed to load project');
      } finally {
        setIsLoadingProject(false);
      }
    };
    void loadProject();
  }, [projectId]);

  useEffect(() => {
    setProjectSearchQuery('');
    setProjectSearchResults(null);
    setProjectSearchError(null);
    setIsSearchingProject(false);
    projectSearchRequestRef.current += 1;
  }, [projectId]);

  // Load sessions for this project
  const loadSessions = useCallback(async () => {
    if (!projectId) return;
    
    try {
      setIsLoadingSessions(true);
      const data = await listSessions();
      setSessions(data.filter((s) => s.project_id === projectId));
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setIsLoadingSessions(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadGitStatus = useCallback(async () => {
    if (!projectId || !rootFolder) {
      setIsGitRepo(false);
      setGitChangedFiles([]);
      setGitHistoryBranches([]);
      setGitHistoryCommits([]);
      setSelectedHistoryCommitHash('');
      setHistoryCommitFiles([]);
      setSelectedHistoryFilePath('');
      setSelectedHistoryFileDiff('');
      return;
    }

    const requestID = gitStatusRequestRef.current + 1;
    gitStatusRequestRef.current = requestID;
    setIsLoadingGitStatus(true);
    try {
      const status = await getProjectGitStatus(projectId);
      if (requestID !== gitStatusRequestRef.current) return;

      setIsGitRepo(status.has_git);
      setGitChangedFiles(status.files || []);
    } catch (err) {
      if (requestID !== gitStatusRequestRef.current) return;
      console.error('Failed to load git status:', err);
      setIsGitRepo(false);
      setGitChangedFiles([]);
      setError(err instanceof Error ? err.message : 'Failed to load git status');
    } finally {
      if (requestID !== gitStatusRequestRef.current) return;
      setIsLoadingGitStatus(false);
    }
  }, [projectId, rootFolder]);

  const loadGitHistory = useCallback(async (repoPathOverride?: string) => {
    const targetRepoPath = repoPathOverride ?? commitRepoPath;
    if (!projectId || !rootFolder || (!isGitRepo && targetRepoPath.trim() === '')) {
      setGitHistoryBranches([]);
      setGitHistoryCommits([]);
      setSelectedHistoryCommitHash('');
      setHistoryCommitFiles([]);
      setSelectedHistoryFilePath('');
      setSelectedHistoryFileDiff('');
      setGitHistoryError(null);
      return;
    }

    const requestID = gitHistoryRequestRef.current + 1;
    gitHistoryRequestRef.current = requestID;
    setIsLoadingGitHistory(true);
    setGitHistoryError(null);
    try {
      const response = await getProjectGitHistory(projectId, targetRepoPath, 160);
      if (requestID !== gitHistoryRequestRef.current) return;
      const commits = response.commits || [];
      setGitHistoryBranches(response.branches || []);
      setGitHistoryCommits(commits);
      setSelectedHistoryCommitHash((current) => {
        if (current && commits.some((commit) => commit.hash === current)) {
          return current;
        }
        return commits[0]?.hash || '';
      });
      if (commits.length === 0) {
        setHistoryCommitFiles([]);
        setSelectedHistoryFilePath('');
        setSelectedHistoryFileDiff('');
      }
    } catch (historyError) {
      if (requestID !== gitHistoryRequestRef.current) return;
      setGitHistoryBranches([]);
      setGitHistoryCommits([]);
      setSelectedHistoryCommitHash('');
      setHistoryCommitFiles([]);
      setSelectedHistoryFilePath('');
      setSelectedHistoryFileDiff('');
      setGitHistoryError(historyError instanceof Error ? historyError.message : 'Failed to load git history');
    } finally {
      if (requestID !== gitHistoryRequestRef.current) return;
      setIsLoadingGitHistory(false);
    }
  }, [projectId, rootFolder, isGitRepo, commitRepoPath]);

  useEffect(() => {
    void loadGitStatus();
  }, [loadGitStatus]);

  const visibleDirectoryPaths = useMemo(() => {
    const visible: string[] = [];
    const visit = (path: string) => {
      const entries = treeEntries[path] || [];
      for (const entry of entries) {
        if (entry.type !== 'directory') {
          continue;
        }
        visible.push(entry.path);
        if (expandedDirs.has(entry.path)) {
          visit(entry.path);
        }
      }
    };
    visit('');
    return visible;
  }, [treeEntries, expandedDirs]);

  useEffect(() => {
    folderGitScanGenerationRef.current += 1;
    setFolderGitStatusByPath({});
  }, [projectId, rootFolder]);

  useEffect(() => {
    if (!projectId || !rootFolder || visibleDirectoryPaths.length === 0) {
      return;
    }

    const missingPaths = visibleDirectoryPaths.filter((path) => folderGitStatusByPath[path] === undefined);
    if (missingPaths.length === 0) {
      return;
    }

    const generation = folderGitScanGenerationRef.current;
    let cancelled = false;

    const scanVisibleFolders = async () => {
      for (const folderPath of missingPaths) {
        try {
          const status = await getProjectGitStatus(projectId, folderPath);
          if (cancelled || generation !== folderGitScanGenerationRef.current) {
            return;
          }
          setFolderGitStatusByPath((prev) => {
            if (prev[folderPath] !== undefined) {
              return prev;
            }
            return {
              ...prev,
              [folderPath]: {
                hasGit: status.has_git,
                hasChanges: (status.files || []).length > 0,
              },
            };
          });
        } catch {
          if (cancelled || generation !== folderGitScanGenerationRef.current) {
            return;
          }
          setFolderGitStatusByPath((prev) => {
            if (prev[folderPath] !== undefined) {
              return prev;
            }
            return {
              ...prev,
              [folderPath]: {
                hasGit: false,
                hasChanges: false,
              },
            };
          });
        }
      }
    };

    void scanVisibleFolders();

    return () => {
      cancelled = true;
    };
  }, [projectId, rootFolder, visibleDirectoryPaths, folderGitStatusByPath]);

  // Load providers
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const data = await listProviders();

        // Set active provider for internal use (session creation)
        const active = data.find((provider) => provider.is_active);
        if (active) {
          setSelectedProvider(active.type);
        } else if (data.length > 0) {
          setSelectedProvider(data[0].type);
        }
      } catch (err) {
        console.error('Failed to load providers:', err);
      }
    };
    loadProviders();
  }, []);

  // Load workflows and restore project selection
  useEffect(() => {
    let cancelled = false;
    const loadWorkflowOptions = async () => {
      try {
        const available = await listWorkflows();
        if (cancelled) return;
        setWorkflowOptions(available);
        const stored = projectId
          ? localStorage.getItem(SELECTED_WORKFLOW_STORAGE_KEY_PREFIX + projectId) || ''
          : '';
        if (stored && available.some((workflow) => workflow.id === stored)) {
          setSelectedWorkflowId(stored);
          return;
        }
        setSelectedWorkflowId(DEFAULT_WORKFLOW_ID);
      } catch (loadError) {
        if (cancelled) return;
        setWorkflowOptions([]);
        setSelectedWorkflowId(DEFAULT_WORKFLOW_ID);
        setError(loadError instanceof Error ? loadError.message : 'Failed to load workflows');
      }
    };
    void loadWorkflowOptions();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Persist selected workflow for this project
  useEffect(() => {
    try {
      if (!projectId) return;
      localStorage.setItem(SELECTED_WORKFLOW_STORAGE_KEY_PREFIX + projectId, selectedWorkflowId);
    } catch {
      // Ignore storage failures
    }
  }, [selectedWorkflowId, projectId]);

  // File tree loading
  const loadTree = useCallback(async (path: string) => {
    if (!rootFolder || !projectId) return;
    
    setLoadingDirs((prev) => new Set(prev).add(path));
    try {
      const response = await listProjectTree(projectId, path);
      setTreeEntries((prev) => ({
        ...prev,
        [path]: response.entries,
      }));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load folder tree';
      console.error('Failed to list directory:', message);
      // Remove the path from expandedDirs if it doesn't exist
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
      // Only show error for root path, silently skip non-existent subdirs
      if (path === '') {
        setError(message);
      }
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, [rootFolder, projectId]);

  // Load tree when root folder is set
  useEffect(() => {
    if (rootFolder) {
      void loadTree('');
      // Also load expanded directories (but only non-empty paths)
      const expandedArray = Array.from(expandedDirs).filter((p) => p !== '');
      if (expandedArray.length > 0) {
        expandedArray.forEach((path) => void loadTree(path));
      }
    }
  }, [rootFolder, loadTree, expandedDirs]);

  // Load selected file content
  useEffect(() => {
    if (!selectedFilePath || !rootFolder || !projectId) return;
    
    const loadFile = async () => {
      setIsLoadingFile(true);
      try {
        const response = await getProjectFile(projectId, selectedFilePath);
        setSelectedFileContent(response.content || '');
        setSavedFileContent(response.content || '');
      } catch (err) {
        console.error('Failed to load file:', err);
        setSelectedFilePath('');
        setSelectedFileContent('');
        setSavedFileContent('');
        if (projectId) {
          writeStoredSelectedFile(projectId, '');
        }
      } finally {
        setIsLoadingFile(false);
      }
    };
    void loadFile();
  }, [selectedFilePath, rootFolder, projectId]);

  useEffect(() => {
    setMarkdownMode(defaultMarkdownModeForPath(selectedFilePath));
  }, [selectedFilePath]);

  // Persist expanded dirs
  useEffect(() => {
    if (projectId) {
      writeStoredExpandedDirs(projectId, expandedDirs);
    }
  }, [expandedDirs, projectId]);

  // Persist selected file
  useEffect(() => {
    if (projectId) {
      writeStoredSelectedFile(projectId, selectedFilePath);
    }
  }, [selectedFilePath, projectId]);

  // Persist tree panel width
  useEffect(() => {
    localStorage.setItem(TREE_PANEL_WIDTH_STORAGE_KEY, String(treePanelWidth));
  }, [treePanelWidth]);

  // Load instruction flags for file actions menu
  const refreshInstructionFlags = useCallback(async () => {
    try {
      const settings = await getSettings();
      const configuredAgentInstructionBlocks = parseInstructionBlocksSetting(settings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '');
      const configuredAgentInstructionFiles = new Set(
        configuredAgentInstructionBlocks
          .filter((block) => block.type === 'file' && block.value.trim() !== '')
          .map((block) => block.value.trim()),
      );
      setAgentInstructionFilePaths(configuredAgentInstructionFiles);
    } catch (loadError) {
      console.error('Failed to load instruction settings:', loadError);
    }
  }, []);

  useEffect(() => {
    void refreshInstructionFlags();
  }, [refreshInstructionFlags]);

  // Close file actions menu when file changes
  useEffect(() => {
    setIsFileActionsMenuOpen(false);
  }, [selectedFilePath]);

  // Handle clicks outside file actions menu
  useEffect(() => {
    if (!isFileActionsMenuOpen) return;

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!fileActionsMenuRef.current) return;
      if (event.target instanceof Node && !fileActionsMenuRef.current.contains(event.target)) {
        setIsFileActionsMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsFileActionsMenuOpen(false);
      }
    };

    document.addEventListener('pointerdown', handleDocumentPointerDown);
    document.addEventListener('keydown', handleEscape);

    return () => {
      document.removeEventListener('pointerdown', handleDocumentPointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [isFileActionsMenuOpen]);

  // Session handlers
  const selectedWorkflow = useMemo(
    () => workflowOptions.find((workflow) => workflow.id === selectedWorkflowId) || null,
    [selectedWorkflowId, workflowOptions],
  );

  const handleSelectSession = (sessionId: string, initialMessage?: string, initialImages?: MessageImage[]) => {
    navigate(`/chat/${sessionId}`, {
      state: (initialMessage || (initialImages && initialImages.length > 0))
        ? { initialMessage, initialImages }
        : undefined,
    });
  };

  const handleDeleteSession = async (sessionId: string) => {
    if (!confirm('Delete this session?')) return;
    
    try {
      await deleteSession(sessionId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete session');
    }
  };

  const handleDeleteAllSessions = async () => {
    if (sessions.length === 0) return;
    if (!confirm(`Delete all ${sessions.length} session(s) in this project? This cannot be undone.`)) return;

    setIsDeletingAllSessions(true);
    setError(null);

    try {
      // Only delete roots; backend cascades children.
      const sessionsByID = new Map(sessions.map((session) => [session.id, session]));
      const rootSessions = sessions.filter((session) => {
        const parentID = (session.parent_id || '').trim();
        return parentID === '' || !sessionsByID.has(parentID);
      });

      for (const rootSession of rootSessions) {
        await deleteSession(rootSession.id);
      }
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete all project sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete all project sessions');
      await loadSessions();
    } finally {
      setIsDeletingAllSessions(false);
    }
  };

  const handleStartSession = async (message: string, images: MessageImage[] = []) => {
    setIsCreatingSession(true);
    setError(null);

    try {
      const workflow = selectedWorkflow;
      if (!workflow) {
        throw new Error('Select a workflow first.');
      }
      const target = resolveWorkflowLaunchTarget(workflow);

      if (target.kind === 'external') {
        setSessionTargetLabel('');
        navigate(`/a2a/contact/${encodeURIComponent(target.externalAgentId)}`, {
          state: {
            agent: {
              id: target.externalAgentId,
              name: target.externalAgentName || target.node.label,
            },
            forceNewSession: true,
            initialMessage: message,
            initialImages: images,
          },
        });
        return;
      }
      if (target.kind === 'local') {
        throw new Error('Launching local-agent workflows is not implemented yet. Use Main/Sub-agent or External targets for now.');
      }
      if (target.kind === 'none') {
        throw new Error('This workflow has no launchable agent target.');
      }

      const created = await createSession({
        agent_id: 'build',
        provider: target.kind === 'main' ? (selectedProvider || undefined) : undefined,
        sub_agent_id: target.kind === 'subagent' ? target.subAgentId : undefined,
        project_id: projectId || undefined,
        metadata: buildWorkflowSessionMetadata(workflow),
      });

      setSessionTargetLabel('');

      handleSelectSession(created.id, message, images);
    } catch (err) {
      console.error('Failed to create session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleQueueSession = async (message: string, images: MessageImage[] = []) => {
    setIsQueuingSession(true);
    setError(null);

    try {
      const workflow = selectedWorkflow;
      if (!workflow) {
        throw new Error('Select a workflow first.');
      }
      const target = resolveWorkflowLaunchTarget(workflow);
      if (target.kind === 'external' || target.kind === 'local') {
        throw new Error('Queued runs currently support only Main/Sub-agent workflow targets.');
      }
      if (target.kind === 'none') {
        throw new Error('This workflow has no launchable agent target.');
      }

      await createSession({
        agent_id: 'build',
        task: message,
        images,
        provider: target.kind === 'main' ? (selectedProvider || undefined) : undefined,
        sub_agent_id: target.kind === 'subagent' ? target.subAgentId : undefined,
        project_id: projectId || undefined,
        queued: true,
        metadata: buildWorkflowSessionMetadata(workflow),
      });
      
      setSessionTargetLabel('');

      await loadSessions();
    } catch (err) {
      console.error('Failed to queue session:', err);
      setError(err instanceof Error ? err.message : 'Failed to queue session');
    } finally {
      setIsQueuingSession(false);
    }
  };

  const handleStartQueuedSession = async (session: Session) => {
    setStartingSessionID(session.id);
    setError(null);

    try {
      // Get full session with messages to find initial task
      const fullSession = await getSession(session.id);
      const firstUserMessage = (fullSession.messages || [])
        .find((msg) => msg.role === 'user' && msg.content.trim() !== '')
        ?.content.trim();

      await startSession(session.id);
      // Pass the initial message so ChatView will send it to the agent
      handleSelectSession(session.id, firstUserMessage);
    } catch (err) {
      console.error('Failed to start queued session:', err);
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setStartingSessionID((current) => (current === session.id ? null : current));
    }
  };

  const handleDuplicateSession = async (sourceSession: Session) => {
    setDuplicatingSessionID(sourceSession.id);
    setError(null);

    try {
      const detailedSession = await getSession(sourceSession.id);
      const firstUserMessage = (detailedSession.messages || [])
        .find((message) => message.role === 'user' && message.content.trim() !== '')
        ?.content.trim();

      const created = await createSession({
        agent_id: detailedSession.agent_id || sourceSession.agent_id || 'build',
        task: firstUserMessage || undefined,
        provider: detailedSession.provider || sourceSession.provider || undefined,
        model: detailedSession.model || sourceSession.model || undefined,
        project_id: detailedSession.project_id || sourceSession.project_id || undefined,
      });
      handleSelectSession(created.id);
    } catch (err) {
      console.error('Failed to duplicate session:', err);
      setError(err instanceof Error ? err.message : 'Failed to duplicate session');
    } finally {
      setDuplicatingSessionID((current) => (current === sourceSession.id ? null : current));
    }
  };

  // File tree handlers
  const toggleDirectory = async (path: string) => {
    const isCurrentlyExpanded = expandedDirs.has(path);
    if (isCurrentlyExpanded) {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    } else {
      setExpandedDirs((prev) => new Set(prev).add(path));
      if (!treeEntries[path]) {
        await loadTree(path);
      }
    }
  };

  const openFile = useCallback(async (path: string) => {
    if (!projectId) return;
    setSelectedFilePath(path);
    setMarkdownMode(defaultMarkdownModeForPath(path));
    setIsLoadingFile(true);
    try {
      const response = await getProjectFile(projectId, path);
      setSelectedFileContent(response.content || '');
      setSavedFileContent(response.content || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      setSelectedFilePath('');
    } finally {
      setIsLoadingFile(false);
    }
  }, [projectId]);

  const expandTreePath = useCallback(async (targetPath: string) => {
    const segments = targetPath.split('/').filter((s) => s !== '');
    let currentPath = '';
    for (const segment of segments.slice(0, -1)) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment;
      if (!expandedDirs.has(currentPath)) {
        setExpandedDirs((prev) => new Set(prev).add(currentPath));
        if (!treeEntries[currentPath]) {
          await loadTree(currentPath);
        }
      }
    }
  }, [expandedDirs, treeEntries, loadTree]);

  const openSearchResultFile = useCallback(async (path: string) => {
    const normalizedPath = normalizeMindPath(path);
    if (normalizedPath === '') return;
    await expandTreePath(normalizedPath);
    await openFile(normalizedPath);
  }, [expandTreePath, openFile]);

  const saveCurrentFile = async () => {
    if (!selectedFilePath || !projectId) return;
    setIsSavingFile(true);
    try {
      await saveProjectFile(projectId, selectedFilePath, selectedFileContent);
      setSavedFileContent(selectedFileContent);
      setSuccess('File saved successfully.');
      await loadGitStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save file');
    } finally {
      setIsSavingFile(false);
    }
  };

  const deleteCurrentFile = async () => {
    if (!selectedFilePath || !projectId) return;
    if (!confirm(`Delete "${selectedFilePath}"?`)) return;
    
    setIsDeletingFile(true);
    try {
      await deleteProjectFile(projectId, selectedFilePath);
      const parentDir = dirname(selectedFilePath);
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSavedFileContent('');
      await loadTree(parentDir || '');
      await loadGitStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    } finally {
      setIsDeletingFile(false);
    }
  };

  const handleFileDrop = async (filePath: string, targetFolderPath: string) => {
    if (isMovingFile || !projectId) return;
    
    const fileName = filePath.split('/').pop() || '';
    const newPath = targetFolderPath === '' ? fileName : `${targetFolderPath}/${fileName}`;
    
    if (filePath === newPath) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsMovingFile(true);
    
    try {
      await moveProjectFile(projectId, filePath, newPath);
      const oldParent = dirname(filePath);
      const newParent = dirname(newPath);
      
      await loadTree(oldParent);
      if (oldParent !== newParent) {
        await loadTree(newParent);
      }
      
      if (selectedFilePath === filePath) {
        setSelectedFilePath(newPath);
      }
      await loadGitStatus();
      

    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Failed to move file');
    } finally {
      setIsMovingFile(false);
      setDraggedFilePath(null);
      setDropTargetPath(null);
    }
  };

  const createNewFile = async () => {
    if (!projectId) return;
    const name = prompt('New file name (e.g., notes.md):');
    if (!name) return;
    
    const parentPath = selectedFilePath ? dirname(selectedFilePath) : '';
    const newPath = parentPath ? `${parentPath}/${name}` : name;
    
    try {
      await saveProjectFile(projectId, newPath, '');
      await loadTree(parentPath || '');
      setSelectedFilePath(newPath);
      setSelectedFileContent('');
      setSavedFileContent('');
      setMarkdownMode('source');
      await loadGitStatus();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create file');
    }
  };

  const createNewFolder = async () => {
    if (!projectId) return;
    const parentPath = selectedFilePath ? dirname(selectedFilePath) : '';
    const suggestedPath = parentPath ? `${parentPath}/new-folder` : 'new-folder';
    const input = window.prompt('New folder path:', suggestedPath);
    if (input === null) {
      return;
    }

    const normalizedPath = normalizeMindPath(input.trim());
    if (normalizedPath === '') {
      setError('Folder path is required.');
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      await createProjectFolder(projectId, normalizedPath);
      const folderParent = dirname(normalizedPath);
      await loadTree(folderParent);
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add(normalizedPath);
        return next;
      });
      setSuccess(`Created folder: ${normalizedPath}`);
      await loadGitStatus();
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create folder');
    }
  };

  const createTodoFile = async () => {
    if (!projectId) return;
    const todoPath = 'todo.md';
    try {
      await saveProjectFile(projectId, todoPath, '# Backlog\n\n- [ ] First task\n');
      await loadTree('');
      await openFile(todoPath);
      setActiveTab('tasks');
      setSuccess(`Created ${todoPath}.`);
      await loadGitStatus();
    } catch (todoError) {
      setError(todoError instanceof Error ? todoError.message : 'Failed to create todo.md');
    }
  };

  const startRename = (path: string, currentName: string) => {
    setRenamingPath(path);
    setRenameValue(currentName);
    setTimeout(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    }, 0);
  };

  const cancelRename = () => {
    setRenamingPath(null);
    setRenameValue('');
  };

  const submitRename = async () => {
    if (!renamingPath || isRenaming || !projectId) return;
    
    const newName = renameValue.trim();
    if (newName === '' || newName === renamingPath.split('/').pop()) {
      cancelRename();
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRenaming(true);
    
    try {
      const result = await renameProjectEntry(projectId, renamingPath, newName);
      const parentPath = dirname(renamingPath);
      await loadTree(parentPath);
      
      if (selectedFilePath === renamingPath) {
        setSelectedFilePath(result.new_path);
      }
      
      if (expandedDirs.has(renamingPath)) {
        setExpandedDirs((prev) => {
          const next = new Set(prev);
          next.delete(renamingPath);
          next.add(result.new_path);
          return next;
        });
        await loadTree(result.new_path);
      }
      
      setSuccess(`Renamed to: ${newName}`);
      await loadGitStatus();
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Failed to rename');
    } finally {
      setIsRenaming(false);
      cancelRename();
    }
  };

  // Folder picker handlers
  const openPicker = async () => {
    setIsPickerOpen(true);
    setIsLoadingBrowse(true);
    try {
      const response = await browseMindDirectories('');
      setBrowsePath(response.path);
      setBrowseEntries(response.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directories');
    } finally {
      setIsLoadingBrowse(false);
    }
  };

  const closePicker = () => {
    setIsPickerOpen(false);
    setBrowsePath('');
    setBrowseEntries([]);
  };

  const loadBrowse = async (path: string) => {
    setIsLoadingBrowse(true);
    try {
      const response = await browseMindDirectories(path);
      setBrowsePath(response.path);
      setBrowseEntries(response.entries);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to browse directories');
    } finally {
      setIsLoadingBrowse(false);
    }
  };

  const handlePickCurrentFolder = async () => {
    if (!browsePath || !projectId) return;
    
    try {
      await updateProject(projectId, { folder: browsePath });
      setRootFolder(browsePath);
      setProject((prev) => prev ? { ...prev, folder: browsePath } : null);
      closePicker();
      // Reset tree state for new folder
      setTreeEntries({});
      setExpandedDirs(new Set<string>(['']));
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSavedFileContent('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update project folder');
    }
  };

  // Project deletion handler
  const handleDeleteProject = async () => {
    if (!projectId || !project) return;

    // Check if it's a system project
    if (project.is_system) {
      setError('Cannot delete system projects.');
      return;
    }

    // Confirm deletion
    if (!confirm(`Are you sure you want to delete "${project.name}"? This will also delete all associated sessions and cannot be undone.`)) {
      return;
    }

    setIsDeletingProject(true);
    setError(null);

    try {
      await deleteProject(projectId);
      setSuccess('Project deleted successfully.');
      
      // Navigate back to home after successful deletion
      setTimeout(() => {
        navigate('/');
      }, 1500);
    } catch (err) {
      console.error('Failed to delete project:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete project');
    } finally {
      setIsDeletingProject(false);
    }
  };

  const openGitViewForRepo = async (repoPath = '', repoLabel = project?.name || 'Project') => {
    if (!projectId) return;
    setError(null);
    try {
      const status = await getProjectGitStatus(projectId, repoPath);
      if (!status.has_git) {
        setError('Selected folder is not a Git repository.');
        return;
      }
      setCommitRepoPath(repoPath);
      setCommitRepoLabel(repoLabel);
      setCommitDialogFiles(status.files || []);
      const firstPath = (status.files || [])[0]?.path || '';
      setSelectedCommitFilePath(firstPath);
      setSelectedCommitFileDiff('');
      setActiveTab('changes');
      void loadGitHistory(repoPath);
      if (firstPath) {
        void loadCommitFileDiff(firstPath, repoPath);
      }
      if ((status.files || []).length > 0) {
        void handleGenerateCommitMessage(repoPath, true);
      }
    } catch (gitError) {
      setError(gitError instanceof Error ? gitError.message : 'Failed to load git status');
    }
  };

  const openGitInitDialog = () => {
    if (!projectId) return;
    setGitInitRemoteURL('');
    setIsGitInitDialogOpen(true);
  };

  const closeGitInitDialog = () => {
    if (isInitializingGit) return;
    setIsGitInitDialogOpen(false);
  };

  const handleInitializeGit = async () => {
    if (!projectId) return;
    setIsInitializingGit(true);
    setError(null);
    setSuccess(null);
    try {
      const remoteURL = gitInitRemoteURL.trim();
      await initializeProjectGit(projectId, remoteURL);
      await loadGitStatus();
      await loadGitHistory();
      closeGitInitDialog();
      if (remoteURL !== '') {
        setSuccess('Git repository initialized and linked to remote origin.');
      } else {
        setSuccess('Git repository initialized.');
      }
    } catch (initError) {
      setError(initError instanceof Error ? initError.message : 'Failed to initialize Git repository');
    } finally {
      setIsInitializingGit(false);
    }
  };

  const refreshCommitDialogFiles = useCallback(async () => {
    if (!projectId) return;
    const requestID = commitDialogFilesRequestRef.current + 1;
    commitDialogFilesRequestRef.current = requestID;
    try {
      const status = await getProjectGitStatus(projectId, commitRepoPath);
      if (requestID !== commitDialogFilesRequestRef.current) return;
      const files = status.files || [];
      setCommitDialogFiles(files);
      if (files.length === 0) {
        setSelectedCommitFilePath('');
        setSelectedCommitFileDiff('');
        return;
      }
      const hasSelected = selectedCommitFilePath !== '' && files.some((file) => file.path === selectedCommitFilePath);
      if (!hasSelected) {
        setSelectedCommitFilePath(files[0].path);
        setSelectedCommitFileDiff('');
      }
    } catch (refreshError) {
      if (requestID !== commitDialogFilesRequestRef.current) return;
      throw refreshError;
    }
  }, [projectId, commitRepoPath, selectedCommitFilePath]);

  const loadCommitFileDiff = useCallback(async (path: string, repoPathOverride?: string) => {
    if (!projectId || path.trim() === '') {
      setSelectedCommitFileDiff('');
      return;
    }
    const requestID = commitDiffRequestRef.current + 1;
    commitDiffRequestRef.current = requestID;
    const targetRepoPath = repoPathOverride ?? commitRepoPath;
    setIsLoadingCommitFileDiff(true);
    try {
      const diffResponse = await getProjectGitFileDiff(projectId, path, targetRepoPath);
      if (requestID !== commitDiffRequestRef.current) return;
      setSelectedCommitFileDiff(diffResponse.preview || '');
    } catch (diffError) {
      if (requestID !== commitDiffRequestRef.current) return;
      setSelectedCommitFileDiff('');
      setError(diffError instanceof Error ? diffError.message : 'Failed to load diff preview');
    } finally {
      if (requestID !== commitDiffRequestRef.current) return;
      setIsLoadingCommitFileDiff(false);
    }
  }, [projectId, commitRepoPath]);

  const loadHistoryCommitFiles = useCallback(async (commitHash: string, repoPathOverride?: string) => {
    if (!projectId || commitHash.trim() === '') {
      setHistoryCommitFiles([]);
      setSelectedHistoryFilePath('');
      setSelectedHistoryFileDiff('');
      return;
    }

    const requestID = historyCommitFilesRequestRef.current + 1;
    historyCommitFilesRequestRef.current = requestID;
    const targetRepoPath = repoPathOverride ?? commitRepoPath;
    setIsLoadingHistoryCommitFiles(true);
    try {
      const response = await getProjectGitCommitFiles(projectId, commitHash, targetRepoPath);
      if (requestID !== historyCommitFilesRequestRef.current) return;
      const files = response.files || [];
      setHistoryCommitFiles(files);
      setSelectedHistoryFilePath((currentPath) => {
        if (currentPath && files.some((file) => file.path === currentPath)) {
          return currentPath;
        }
        return files[0]?.path || '';
      });
      if (files.length === 0) {
        setSelectedHistoryFileDiff('');
      }
    } catch (historyFilesError) {
      if (requestID !== historyCommitFilesRequestRef.current) return;
      setHistoryCommitFiles([]);
      setSelectedHistoryFilePath('');
      setSelectedHistoryFileDiff('');
      setGitHistoryError(historyFilesError instanceof Error ? historyFilesError.message : 'Failed to load commit files');
    } finally {
      if (requestID !== historyCommitFilesRequestRef.current) return;
      setIsLoadingHistoryCommitFiles(false);
    }
  }, [projectId, commitRepoPath]);

  const loadHistoryFileDiff = useCallback(async (commitHash: string, path: string, repoPathOverride?: string) => {
    if (!projectId || commitHash.trim() === '' || path.trim() === '') {
      setSelectedHistoryFileDiff('');
      return;
    }

    const requestID = historyFileDiffRequestRef.current + 1;
    historyFileDiffRequestRef.current = requestID;
    const targetRepoPath = repoPathOverride ?? commitRepoPath;
    setIsLoadingHistoryFileDiff(true);
    try {
      const response = await getProjectGitCommitFileDiff(projectId, commitHash, path, targetRepoPath);
      if (requestID !== historyFileDiffRequestRef.current) return;
      setSelectedHistoryFileDiff(response.preview || '');
    } catch (historyDiffError) {
      if (requestID !== historyFileDiffRequestRef.current) return;
      setSelectedHistoryFileDiff('');
      setGitHistoryError(historyDiffError instanceof Error ? historyDiffError.message : 'Failed to load commit diff');
    } finally {
      if (requestID !== historyFileDiffRequestRef.current) return;
      setIsLoadingHistoryFileDiff(false);
    }
  }, [projectId, commitRepoPath]);

  const handleToggleGitFileStage = async (file: ProjectGitChangedFile) => {
    if (!projectId || isCommitting || isPushing || isPulling || gitFileActionPath === file.path) return;
    setError(null);
    setGitFileActionPath(file.path);
    try {
      if (file.staged) {
        await unstageProjectGitFile(projectId, file.path, commitRepoPath);
      } else {
        await stageProjectGitFile(projectId, file.path, commitRepoPath);
      }
      await refreshCommitDialogFiles();
      await loadGitStatus();
    } catch (gitError) {
      setError(gitError instanceof Error ? gitError.message : 'Failed to update file staging');
    } finally {
      setGitFileActionPath(null);
    }
  };

  const handleStageAllFiles = useCallback(async () => {
    if (!projectId || isCommitting || isPushing || isPulling) return;
    const unstagedFiles = commitDialogFiles.filter((f) => !f.staged);
    if (unstagedFiles.length === 0) return;

    setError(null);
    setIsStagingAll(true);
    try {
      await stageAllProjectGitFiles(projectId, commitRepoPath);
      await refreshCommitDialogFiles();
      await loadGitStatus();
    } catch (gitError) {
      setError(gitError instanceof Error ? gitError.message : 'Failed to stage all files');
    } finally {
      setIsStagingAll(false);
    }
  }, [projectId, isCommitting, isPushing, isPulling, commitDialogFiles, commitRepoPath, refreshCommitDialogFiles, loadGitStatus]);

  const handleDiscardGitFileChanges = async (file: ProjectGitChangedFile) => {
    if (!projectId || isCommitting || isPushing || isPulling || gitDiscardPath === file.path) return;
    const confirmed = window.confirm(`Discard all changes in "${file.path}"? This cannot be undone.`);
    if (!confirmed) return;

    setError(null);
    setGitDiscardPath(file.path);
    try {
      await discardProjectGitFile(projectId, file.path, commitRepoPath);
      await refreshCommitDialogFiles();
      await loadGitStatus();
      if (selectedCommitFilePath === file.path) {
        const remaining = commitDialogFiles.filter((f) => f.path !== file.path);
        setSelectedCommitFilePath(remaining[0]?.path || '');
        setSelectedCommitFileDiff('');
      }
    } catch (discardError) {
      setError(discardError instanceof Error ? discardError.message : 'Failed to discard file changes');
    } finally {
      setGitDiscardPath(null);
    }
  };

  const handleGenerateCommitMessage = async (repoPathOverride?: string, hasFilesOverride?: boolean) => {
    if (!projectId || isCommitting || isPushing || isPulling || isGeneratingCommitMessage) return;
    const hasFiles = hasFilesOverride ?? (commitDialogFiles.length > 0);
    if (!hasFiles) return;
    const targetRepoPath = repoPathOverride ?? commitRepoPath;
    setIsGeneratingCommitMessage(true);
    try {
      const suggestion = await generateProjectGitCommitMessage(projectId, targetRepoPath);
      if (suggestion && suggestion.trim() !== '') {
        const trimmedSuggestion = suggestion.trim();
        setCommitMessage((prev) => {
          const current = prev.trim();
          if (current === '') {
            return trimmedSuggestion;
          }
          if (current.includes(trimmedSuggestion)) {
            return prev;
          }
          return `${prev.trimEnd()}\n${trimmedSuggestion}`;
        });
      }
    } catch {
      // Intentionally ignore generation failures and keep current message unchanged.
    } finally {
      setIsGeneratingCommitMessage(false);
    }
  };

  const handleCommitChanges = async () => {
    if (!projectId || isPulling) return;

    const message = commitMessage.trim();
    if (message === '') {
      setError('Commit message is required.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsCommitting(true);
    try {
      const result = await commitProjectGit(projectId, message, commitRepoPath);
      setSuccess(`Committed ${result.files_committed} file(s) as ${result.commit}.`);
      setCommitMessage('');
      await loadGitStatus();
      await refreshCommitDialogFiles();
      await loadGitHistory();
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  };

  const handleCommitAndPushChanges = async () => {
    if (!projectId || isCommitting || isPushing || isPulling) return;

    const message = commitMessage.trim();
    if (message === '') {
      setError('Commit message is required.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsCommitting(true);
    setIsPushing(true);
    try {
      const commitResult = await commitProjectGit(projectId, message, commitRepoPath);
      await pushProjectGit(projectId, commitRepoPath);
      setSuccess(`Committed ${commitResult.files_committed} file(s) and pushed ${commitResult.commit}.`);
      setCommitMessage('');
      await loadGitStatus();
      await refreshCommitDialogFiles();
      await loadGitHistory();
    } catch (err) {
      const messageText = err instanceof Error ? err.message : 'Failed to commit and push';
      const normalized = messageText.toLowerCase();
      if (normalized.includes('no staged files to commit')) {
        try {
          const pushOutput = await pushProjectGit(projectId, commitRepoPath);
          setSuccess(pushOutput ? `No new commit. Push completed: ${pushOutput}` : 'No new commit. Push completed.');
          await loadGitStatus();
          await refreshCommitDialogFiles();
          await loadGitHistory();
        } catch (pushErr) {
          setError(pushErr instanceof Error ? pushErr.message : 'Failed to push');
        }
      } else {
        setError(messageText);
        await loadGitStatus();
        await refreshCommitDialogFiles();
        await loadGitHistory();
      }
    } finally {
      setIsCommitting(false);
      setIsPushing(false);
    }
  };

  const handlePullChanges = async () => {
    if (!projectId || isCommitting || isPushing || isPulling) return;

    setError(null);
    setSuccess(null);
    setIsPulling(true);
    try {
      const pullOutput = await pullProjectGit(projectId, commitRepoPath, 'auto');
      if (pullOutput) {
        setSuccess(`Pulled latest changes with auto-merge: ${pullOutput}`);
      } else {
        setSuccess('Pulled latest changes with auto-merge strategy.');
      }
      await loadGitStatus();
      await refreshCommitDialogFiles();
      await loadGitHistory();
    } catch (pullError) {
      setError(pullError instanceof Error ? pullError.message : 'Failed to pull changes');
    } finally {
      setIsPulling(false);
    }
  };

  // File session dialog handlers
  const openSessionDialogForPath = (type: 'folder' | 'file', path: string) => {
    const fullPath = rootFolder ? joinMindAbsolutePath(rootFolder, path) : path;
    const label = type === 'folder' ? `folder "${path || 'root'}"` : `file "${path}"`;
    setSessionTargetLabel(label);
    setSessionComposerMessage(`${buildMindSessionContext(type, fullPath)}\n`);
    
    // Scroll to the sessions form
    setTimeout(() => {
      const sessionsComposer = document.querySelector('.project-sessions-composer');
      if (sessionsComposer) {
        sessionsComposer.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  };



  // Computed values
  const hasUnsavedChanges = selectedFileContent !== savedFileContent;
  const markdownHtml = useMemo(() => renderMarkdownToHtml(selectedFileContent), [selectedFileContent]);
  const todoBoard = useMemo(() => parseTodoBoard(selectedFileContent), [selectedFileContent]);
  const knownTodoFilePaths = useMemo(() => {
    const found = new Set<string>();
    for (const entries of Object.values(treeEntries)) {
      for (const entry of entries) {
        if (entry.type === 'file' && isTodoFilePath(entry.path)) {
          found.add(entry.path);
        }
      }
    }
    return Array.from(found).sort();
  }, [treeEntries]);
  const activeTodoFilePath = isTodoFilePath(selectedFilePath)
    ? selectedFilePath
    : (knownTodoFilePaths[0] || '');
  const stagedCommitFilesCount = commitDialogFiles.filter((file) => file.staged).length;
  const commitDiffOptions = useMemo(() => ({
    theme: {
      light: 'pierre-light' as const,
      dark: 'pierre-dark' as const,
    },
    themeType: commitDiffThemeMode,
    diffStyle: 'unified' as const,
    diffIndicators: 'classic' as const,
    hunkSeparators: 'line-info' as const,
    lineDiffType: 'word' as const,
    overflow: 'scroll' as const,
  }), [commitDiffThemeMode]);
  const parsedCommitDiffFile = useMemo<FileDiffMetadata | null>(() => {
    if (!selectedCommitFileDiff) return null;
    try {
      const parsed = parsePatchFiles(selectedCommitFileDiff);
      const files = parsed.flatMap((patch) => patch.files || []) as FileDiffMetadata[];
      if (files.length === 0) return null;
      if (files.length === 1) return files[0];
      const normalizedPath = selectedCommitFilePath.replace(/^\.\/+/, '');
      const byExactPath = files.find((file: FileDiffMetadata) => file.name === normalizedPath || file.prevName === normalizedPath);
      if (byExactPath) return byExactPath;
      const bySuffixPath = files.find((file: FileDiffMetadata) =>
        file.name.endsWith(`/${normalizedPath}`) || (file.prevName || '').endsWith(`/${normalizedPath}`),
      );
      return bySuffixPath || files[0];
    } catch {
      return null;
    }
  }, [selectedCommitFileDiff, selectedCommitFilePath]);
  const selectedHistoryCommit = useMemo(
    () => gitHistoryCommits.find((commit) => commit.hash === selectedHistoryCommitHash) || null,
    [gitHistoryCommits, selectedHistoryCommitHash],
  );
  const parsedHistoryDiffFile = useMemo<FileDiffMetadata | null>(() => {
    if (!selectedHistoryFileDiff) return null;
    try {
      const parsed = parsePatchFiles(selectedHistoryFileDiff);
      const files = parsed.flatMap((patch) => patch.files || []) as FileDiffMetadata[];
      if (files.length === 0) return null;
      if (files.length === 1) return files[0];
      const normalizedPath = selectedHistoryFilePath.replace(/^\.\/+/, '');
      const byExactPath = files.find((file: FileDiffMetadata) => file.name === normalizedPath || file.prevName === normalizedPath);
      if (byExactPath) return byExactPath;
      const bySuffixPath = files.find((file: FileDiffMetadata) =>
        file.name.endsWith(`/${normalizedPath}`) || (file.prevName || '').endsWith(`/${normalizedPath}`),
      );
      return bySuffixPath || files[0];
    } catch {
      return null;
    }
  }, [selectedHistoryFileDiff, selectedHistoryFilePath]);

  const persistTodoContent = useCallback(async (nextContent: string) => {
    if (!projectId || !selectedFilePath) return;
    setIsUpdatingTodoBoard(true);
    setError(null);
    try {
      await saveProjectFile(projectId, selectedFilePath, nextContent);
      setSelectedFileContent(nextContent);
      setSavedFileContent(nextContent);
      await loadGitStatus();
    } catch (todoError) {
      setError(todoError instanceof Error ? todoError.message : 'Failed to update TODO board');
    } finally {
      setIsUpdatingTodoBoard(false);
    }
  }, [loadGitStatus, projectId, selectedFilePath]);

  const handleAddTaskToColumn = async (column: TodoColumn) => {
    const taskText = window.prompt(`New task for "${column.title}":`, '');
    if (!taskText || taskText.trim() === '') return;
    const nextContent = mutateLines(selectedFileContent, (lines) => {
      const insertIndex = findInsertIndexForColumn(lines, column);
      lines.splice(insertIndex, 0, buildTodoTaskLine(taskText, '', '', false));
    });
    await persistTodoContent(nextContent);
  };

  const handleDeleteTodoTask = async (task: TodoTask) => {
    const nextContent = mutateLines(selectedFileContent, (lines) => {
      if (task.lineIndex >= 0 && task.lineIndex < lines.length) {
        lines.splice(task.lineIndex, 1);
      }
    });
    await persistTodoContent(nextContent);
  };

  const handleMoveTask = async (task: TodoTask, targetColumn: TodoColumn) => {
    const nextContent = mutateLines(selectedFileContent, (lines) => {
      if (task.lineIndex < 0 || task.lineIndex >= lines.length) return;
      const [taskLine] = lines.splice(task.lineIndex, 1);
      if (!taskLine) return;
      const resolvedHeadingLineIndex = targetColumn.headingLineIndex === null
        ? null
        : findHeadingLineIndexByTitle(lines, targetColumn.title);
      const insertIndex = findInsertIndexForColumn(lines, {
        ...targetColumn,
        headingLineIndex: resolvedHeadingLineIndex,
      });
      lines.splice(insertIndex, 0, taskLine);
    });
    await persistTodoContent(nextContent);
  };

  const handleDropTaskToColumn = async (targetColumn: TodoColumn) => {
    if (!draggedTodoTask || isUpdatingTodoBoard) return;
    if (draggedTodoTask.sourceColumnId === targetColumn.id) {
      setDraggedTodoTask(null);
      setTodoDropTargetColumnID(null);
      return;
    }
    const { task } = draggedTodoTask;
    setDraggedTodoTask(null);
    setTodoDropTargetColumnID(null);
    await handleMoveTask(task, targetColumn);
  };

  const startEditingTodoTask = (taskID: string, taskText: string) => {
    if (isUpdatingTodoBoard) return;
    setEditingTodoTaskID(taskID);
    setEditingTodoTaskText(taskText);
  };

  const cancelEditingTodoTask = () => {
    setEditingTodoTaskID(null);
    setEditingTodoTaskText('');
  };

  const handleSaveTodoTaskText = async (task: TodoTask, taskID: string) => {
    if (editingTodoTaskID !== taskID || isUpdatingTodoBoard) return;
    const nextText = editingTodoTaskText.trim();
    if (nextText === '' || nextText === task.text) {
      cancelEditingTodoTask();
      return;
    }
    cancelEditingTodoTask();
    const nextContent = mutateLines(selectedFileContent, (lines) => {
      const idx = task.lineIndex;
      if (idx < 0 || idx >= lines.length) return;
      const match = TODO_TASK_LINE_PATTERN.exec(lines[idx]);
      if (!match) return;
      const checked = (match[2] || '').toLowerCase() === 'x';
      const linkedPath = (match[4] || '').trim();
      lines[idx] = buildTodoTaskLine(nextText, linkedPath, match[1] || '', checked);
    });
    await persistTodoContent(nextContent);
    if (task.linkedFilePath.trim() !== '') {
      // Keep linked task file header aligned with renamed task.
      try {
        const linkedPath = normalizeMindPath(task.linkedFilePath);
        if (linkedPath !== '' && projectId) {
          const linkedFile = await getProjectFile(projectId, linkedPath);
          const linkedLines = linkedFile.content.replace(/\r\n/g, '\n').split('\n');
          if (linkedLines.length > 0 && linkedLines[0].startsWith('# ')) {
            linkedLines[0] = `# ${nextText}`;
            await saveProjectFile(projectId, linkedPath, linkedLines.join('\n'));
          }
        }
      } catch {
        // Ignore linked file sync errors; board rename already succeeded.
      }
    }
  };

  const handleOpenTodoTaskFile = async (linkedPath: string) => {
    const normalizedPath = normalizeMindPath(linkedPath);
    if (normalizedPath === '') return;
    await expandTreePath(normalizedPath);
    await openFile(normalizedPath);
  };

  const ensureTodoTaskFile = async (task: TodoTask, column: TodoColumn): Promise<string> => {
    if (!projectId || !selectedFilePath) {
      throw new Error('Project file is not selected.');
    }

    if (task.linkedFilePath.trim() !== '') {
      return task.linkedFilePath.trim();
    }

    const todoDir = dirname(selectedFilePath);
    const tasksDir = todoDir ? `${todoDir}/.tasks` : '.tasks';
    try {
      await createProjectFolder(projectId, tasksDir);
    } catch (createErr) {
      const message = createErr instanceof Error ? createErr.message.toLowerCase() : '';
      if (!message.includes('already exists')) {
        throw createErr;
      }
    }

    const slug = slugifyTaskFileName(task.text);
    const taskFilePath = `${tasksDir}/${slug}-${Date.now().toString(36)}.md`;
    const taskFileContent = [
      `# ${task.text}`,
      '',
      `- TODO file: ${selectedFilePath}`,
      `- Column: ${column.title}`,
      `- Origin line: ${task.lineIndex + 1}`,
      '',
      '## Notes',
      '',
      '## Progress',
      '',
      '## Next Steps',
      '',
    ].join('\n');
    await saveProjectFile(projectId, taskFilePath, taskFileContent);

    const nextContent = mutateLines(selectedFileContent, (lines) => {
      const idx = task.lineIndex;
      if (idx < 0 || idx >= lines.length) return;
      const match = TODO_TASK_LINE_PATTERN.exec(lines[idx]);
      if (!match) return;
      const checked = (match[2] || '').toLowerCase() === 'x';
      lines[idx] = buildTodoTaskLine(match[3] || '', taskFilePath, match[1] || '', checked);
    });
    await persistTodoContent(nextContent);
    return taskFilePath;
  };

  const handleStartTaskSession = async (task: TodoTask, column: TodoColumn) => {
    if (!projectId) return;
    const taskID = `${column.id}:${task.id}`;
    setStartingTaskSessionID(taskID);
    setError(null);

    try {
      const linkedFilePath = await ensureTodoTaskFile(task, column);
      const workflow = selectedWorkflow;
      if (!workflow) {
        throw new Error('Select a workflow first.');
      }
      const target = resolveWorkflowLaunchTarget(workflow);
      if (target.kind === 'external' || target.kind === 'local') {
        throw new Error('Task sessions currently support only Main/Sub-agent workflow targets.');
      }
      if (target.kind === 'none') {
        throw new Error('This workflow has no launchable agent target.');
      }
      const created = await createSession({
        agent_id: 'build',
        provider: target.kind === 'main' ? (selectedProvider || undefined) : undefined,
        sub_agent_id: target.kind === 'subagent' ? target.subAgentId : undefined,
        project_id: projectId,
        metadata: buildWorkflowSessionMetadata(workflow),
      });
      const initialMessage = [
        `Work on this task from ${selectedFilePath}:`,
        '',
        `Column: ${column.title}`,
        `Task: ${task.text}`,
        `Task file: ${linkedFilePath}`,
        '',
        'Read both files first, then execute the task and keep the task file updated.',
      ].join('\n');
      handleSelectSession(created.id, initialMessage);
    } catch (taskSessionError) {
      setError(taskSessionError instanceof Error ? taskSessionError.message : 'Failed to start task session');
    } finally {
      setStartingTaskSessionID(null);
    }
  };

  useEffect(() => {
    if (activeTab !== 'changes') return;
    if (!selectedCommitFilePath) {
      setSelectedCommitFileDiff('');
      return;
    }
    void loadCommitFileDiff(selectedCommitFilePath);
  }, [activeTab, selectedCommitFilePath, loadCommitFileDiff]);

  useEffect(() => {
    setDraggedTodoTask(null);
    setTodoDropTargetColumnID(null);
    cancelEditingTodoTask();
  }, [selectedFilePath, selectedFileContent]);

  useEffect(() => {
    if (!projectId || !rootFolder) {
      setProjectSearchResults(null);
      setProjectSearchError(null);
      setIsSearchingProject(false);
      return;
    }

    const trimmedQuery = projectSearchQuery.trim();
    const requestID = projectSearchRequestRef.current + 1;
    projectSearchRequestRef.current = requestID;
    if (trimmedQuery === '') {
      setProjectSearchResults(null);
      setProjectSearchError(null);
      setIsSearchingProject(false);
      return;
    }

    const timer = window.setTimeout(async () => {
      setIsSearchingProject(true);
      setProjectSearchError(null);
      try {
        const response = await searchProject(projectId, trimmedQuery);
        if (requestID !== projectSearchRequestRef.current) return;
        setProjectSearchResults(response);
      } catch (searchError) {
        if (requestID !== projectSearchRequestRef.current) return;
        setProjectSearchResults(null);
        setProjectSearchError(searchError instanceof Error ? searchError.message : 'Failed to search project');
      } finally {
        if (requestID !== projectSearchRequestRef.current) return;
        setIsSearchingProject(false);
      }
    }, 220);

    return () => {
      window.clearTimeout(timer);
    };
  }, [projectId, projectSearchQuery, rootFolder]);

  useEffect(() => {
    if (activeTab !== 'tasks') return;
    if (!activeTodoFilePath) return;
    if (selectedFilePath === activeTodoFilePath) return;
    void openFile(activeTodoFilePath);
  }, [activeTab, activeTodoFilePath, selectedFilePath, openFile]);

  const isProjectContextReady = Boolean(projectId && project && project.id === projectId);

  useEffect(() => {
    if (activeTab !== 'changes') return;
    if (!isProjectContextReady) return;
    if (!projectId || !rootFolder || (!isGitRepo && commitRepoPath.trim() === '')) return;
    if (commitRepoPath.trim() === '') {
      setCommitRepoLabel(project?.name || 'Project');
    }
    void refreshCommitDialogFiles();
  }, [activeTab, isProjectContextReady, projectId, rootFolder, isGitRepo, project?.name, commitRepoPath, refreshCommitDialogFiles]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!isProjectContextReady) return;
    if (!projectId || !rootFolder || (!isGitRepo && commitRepoPath.trim() === '')) return;
    void loadGitHistory();
  }, [activeTab, isProjectContextReady, projectId, rootFolder, isGitRepo, commitRepoPath, loadGitHistory]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!isProjectContextReady) return;
    if ((!isGitRepo && commitRepoPath.trim() === '') || selectedHistoryCommitHash.trim() === '') {
      setHistoryCommitFiles([]);
      setSelectedHistoryFilePath('');
      setSelectedHistoryFileDiff('');
      return;
    }
    void loadHistoryCommitFiles(selectedHistoryCommitHash);
  }, [activeTab, isProjectContextReady, isGitRepo, commitRepoPath, selectedHistoryCommitHash, loadHistoryCommitFiles]);

  useEffect(() => {
    if (activeTab !== 'history') return;
    if (!isProjectContextReady) return;
    if (selectedHistoryCommitHash.trim() === '' || selectedHistoryFilePath.trim() === '') {
      setSelectedHistoryFileDiff('');
      return;
    }
    void loadHistoryFileDiff(selectedHistoryCommitHash, selectedHistoryFilePath);
  }, [activeTab, isProjectContextReady, selectedHistoryCommitHash, selectedHistoryFilePath, loadHistoryFileDiff]);
  
  const selectedFilePathNormalized = normalizeMindPath(selectedFilePath);
  const selectedFileAbsolutePath = rootFolder && selectedFilePath
    ? joinMindAbsolutePath(rootFolder, selectedFilePath)
    : '';
  const isSelectedFileAgentInstruction = selectedFilePathNormalized !== ''
    && (
      agentInstructionFilePaths.has(selectedFilePathNormalized)
      || (selectedFileAbsolutePath !== '' && agentInstructionFilePaths.has(selectedFileAbsolutePath))
    );

  const addSelectedFileToAgentInstructions = async () => {
    if (selectedFilePathNormalized === '') return;
    if (!rootFolder) {
      setError('Configure project folder first.');
      return;
    }

    const absolutePath = selectedFileAbsolutePath;
    if (isSelectedFileAgentInstruction) {
      setIsFileActionsMenuOpen(false);
      setSuccess('File is already in Agent Instructions.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsFileActionsMenuOpen(false);
    setIsAddingAgentInstructionFile(true);

    try {
      const currentSettings = await getSettings();
      const existingBlocks = parseInstructionBlocksSetting(currentSettings[AGENT_INSTRUCTION_BLOCKS_SETTING_KEY] || '');
      const nextBlocks: InstructionBlock[] = [
        ...existingBlocks,
        { type: 'file', value: absolutePath, enabled: true },
      ];

      const nextSettings = {
        ...currentSettings,
        [AGENT_INSTRUCTION_BLOCKS_SETTING_KEY]: serializeInstructionBlocksSetting(nextBlocks),
        [AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY]: buildAgentSystemPromptAppend(nextBlocks),
      };
      await updateSettings(nextSettings);
      await refreshInstructionFlags();
      setSuccess(`Added ${absolutePath} to Agent Instructions.`);
    } catch (addError) {
      setError(addError instanceof Error ? addError.message : 'Failed to add file to Agent Instructions');
    } finally {
      setIsAddingAgentInstructionFile(false);
    }
  };

  const addSelectedFileToRecurringJob = () => {
    if (selectedFileAbsolutePath.trim() === '') return;
    setIsFileActionsMenuOpen(false);
    navigate(`/agent/jobs/new?prefillInstructionFile=${encodeURIComponent(selectedFileAbsolutePath)}`);
  };

  // Handle openFile query param
  useEffect(() => {
    const requestedOpenPath = (searchParams.get('openFile') || '').trim();
    if (requestedOpenPath === '' || !rootFolder) return;
    if (handledOpenFileQueryRef.current === requestedOpenPath) return;

    const relativePath = toMindRelativePath(rootFolder, requestedOpenPath);
    handledOpenFileQueryRef.current = requestedOpenPath;

    if (relativePath === '') {
      setError('Requested file is outside of project folder.');
      return;
    }

    const openFromQuery = async () => {
      await expandTreePath(relativePath);
      await openFile(relativePath);

      const nextParams = new URLSearchParams(searchParams);
      nextParams.delete('openFile');
      setSearchParams(nextParams, { replace: true });
    };

    void openFromQuery();
  }, [expandTreePath, openFile, rootFolder, searchParams, setSearchParams]);

  // Handle markdown anchor scrolling
  useEffect(() => {
    if (!pendingAnchor || isLoadingFile || markdownMode !== 'preview') return;
    const id = decodeURIComponent(pendingAnchor);
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ block: 'start' });
    }
    setPendingAnchor('');
  }, [pendingAnchor, isLoadingFile, markdownMode, markdownHtml]);

  const handlePreviewClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) return;

    const rawHref = (anchor.getAttribute('href') || '').trim();
    if (rawHref === '') return;

    if (isExternalLink(rawHref)) {
      anchor.setAttribute('target', '_blank');
      anchor.setAttribute('rel', 'noreferrer noopener');
      return;
    }

    event.preventDefault();

    const [rawPathPart, rawHash = ''] = rawHref.split('#', 2);
    if (rawPathPart === '') {
      if (rawHash !== '') {
        setPendingAnchor(rawHash);
      }
      return;
    }

    const resolvedPath = resolveMarkdownLinkPath(selectedFilePath, decodeURIComponent(rawPathPart));
    if (!resolvedPath.toLowerCase().endsWith('.md') && !resolvedPath.toLowerCase().endsWith('.markdown')) {
      setError('Only markdown links are supported in preview.');
      return;
    }

    await openFile(resolvedPath);
    if (rawHash !== '') {
      setPendingAnchor(rawHash);
    }
  };

  // Tree panel resize handlers
  const handleStartTreeResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    treeResizeStartRef.current = {
      startX: event.clientX,
      startWidth: treePanelWidth,
    };
    document.body.classList.add('mind-resizing');
    document.body.style.userSelect = 'none';
  };

  useEffect(() => {
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      if (!treeResizeStartRef.current) return;
      const delta = event.clientX - treeResizeStartRef.current.startX;
      const newWidth = Math.min(MAX_TREE_PANEL_WIDTH, Math.max(MIN_TREE_PANEL_WIDTH, treeResizeStartRef.current.startWidth + delta));
      setTreePanelWidth(newWidth);
    };

    const handlePointerUp = () => {
      if (treeResizeStartRef.current) {
        treeResizeStartRef.current = null;
        document.body.classList.remove('mind-resizing');
        document.body.style.userSelect = '';
      }
    };

    document.addEventListener('pointermove', handlePointerMove);
    document.addEventListener('pointerup', handlePointerUp);

    return () => {
      document.removeEventListener('pointermove', handlePointerMove);
      document.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // Render tree
  const renderTree = (path: string, depth = 0): ReactElement => {
    const entries = treeEntries[path] || [];

    return (
      <div>
        {entries.map((entry) => {
          const isBeingRenamed = renamingPath === entry.path;
          const isHiddenEntry = entry.name.startsWith('.');
          
          if (entry.type === 'directory') {
            const isExpanded = expandedDirs.has(entry.path);
            const isLoading = loadingDirs.has(entry.path);
            const isDropTarget = dropTargetPath === entry.path;
            const isDraggingFolder = draggedFilePath === entry.path;
            const isDescendantOfDragged = draggedFilePath && entry.path.startsWith(draggedFilePath + '/');
            const folderGitStatus = folderGitStatusByPath[entry.path];
            const hasFolderGitChanges = Boolean(folderGitStatus?.hasGit && folderGitStatus.hasChanges);
            return (
              <div key={entry.path}>
                <div
                  className={`mind-tree-row ${isDropTarget ? 'mind-tree-drop-target' : ''} ${isDraggingFolder ? 'mind-tree-dragging' : ''} ${hasFolderGitChanges ? 'mind-tree-row-has-git-changes' : ''}`}
                  draggable={!isBeingRenamed}
                  onDragStart={(e) => {
                    if (isBeingRenamed) return;
                    e.stopPropagation();
                    setDraggedFilePath(entry.path);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', entry.path);
                  }}
                  onDragEnd={() => {
                    setDraggedFilePath(null);
                    setDropTargetPath(null);
                  }}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (draggedFilePath && draggedFilePath !== entry.path && !isDescendantOfDragged && !entry.path.startsWith(draggedFilePath + '/')) {
                      setDropTargetPath(entry.path);
                    }
                  }}
                  onDragLeave={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (dropTargetPath === entry.path) {
                      setDropTargetPath(null);
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (draggedFilePath && draggedFilePath !== entry.path && !entry.path.startsWith(draggedFilePath + '/')) {
                      void handleFileDrop(draggedFilePath, entry.path);
                    }
                    setDropTargetPath(null);
                  }}
                >
                  {isBeingRenamed ? (
                    <div className={`mind-tree-item mind-tree-directory ${isHiddenEntry ? 'mind-tree-hidden' : ''} ${hasFolderGitChanges ? 'mind-tree-directory-has-git-changes' : ''}`} style={{ paddingLeft: `${12 + depth * 18}px` }}>
                      <span className="mind-tree-icon" aria-hidden="true">{isExpanded ? '📂' : '📁'}</span>
                      <input
                        ref={renameInputRef}
                        type="text"
                        className="mind-tree-rename-input"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            void submitRename();
                          } else if (e.key === 'Escape') {
                            cancelRename();
                          }
                        }}
                        onBlur={() => void submitRename()}
                        disabled={isRenaming}
                      />
                    </div>
                  ) : (
                    <button
                      type="button"
                      className={`mind-tree-item mind-tree-directory ${isHiddenEntry ? 'mind-tree-hidden' : ''} ${hasFolderGitChanges ? 'mind-tree-directory-has-git-changes' : ''}`}
                      style={{ paddingLeft: `${12 + depth * 18}px` }}
                      onClick={() => void toggleDirectory(entry.path)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename(entry.path, entry.name);
                      }}
                    >
                      <span className="mind-tree-icon" aria-hidden="true">{isExpanded ? '📂' : '📁'}</span>
                      <span className="mind-tree-label">{entry.name}</span>
                      {isLoading ? <span className="mind-tree-meta">Loading...</span> : null}
                    </button>
                  )}
                  {hasFolderGitChanges ? (
                    <button
                      type="button"
                      className="mind-tree-commit-btn"
                      title={`Open Git changes for ${entry.name}`}
                      aria-label={`Open Git changes for folder ${entry.name}`}
                      onClick={(event) => {
                        event.stopPropagation();
                        void openGitViewForRepo(entry.path, entry.name);
                      }}
                    >
                      <svg viewBox="0 0 16 16" aria-hidden="true" className="mind-tree-commit-icon">
                        <path
                          fill="currentColor"
                          d="M8 0C3.58 0 0 3.58 0 8a8.01 8.01 0 0 0 5.47 7.59c.4.07.55-.17.55-.38c0-.19-.01-.82-.01-1.49C4 14.09 3.48 13.22 3.32 12.77c-.09-.23-.48-.94-.82-1.13c-.28-.15-.68-.52-.01-.53c.63-.01 1.08.58 1.23.82c.72 1.21 1.87.87 2.33.66c.07-.52.28-.87.5-1.07c-1.78-.2-3.64-.89-3.64-3.95c0-.87.31-1.59.82-2.15c-.08-.2-.36-1.02.08-2.12c0 0 .67-.21 2.2.82A7.66 7.66 0 0 1 8 4.82c.68 0 1.37.09 2.01.27c1.53-1.04 2.2-.82 2.2-.82c.44 1.1.16 1.92.08 2.12c.51.56.82 1.27.82 2.15c0 3.07-1.87 3.75-3.65 3.95c.29.25.54.73.54 1.48c0 1.07-.01 1.93-.01 2.2c0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z"
                        />
                      </svg>
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="mind-tree-session-btn"
                    title="Create session for this folder"
                    aria-label={`Create session for folder ${entry.name}`}
                    onClick={(event) => {
                      event.stopPropagation();
                      openSessionDialogForPath('folder', entry.path);
                    }}
                  >
                    💭
                  </button>
                </div>
                {isExpanded ? renderTree(entry.path, depth + 1) : null}
              </div>
            );
          }

          const isDragging = draggedFilePath === entry.path;
          return (
            <div
              key={entry.path}
              className={`mind-tree-row ${isDragging ? 'mind-tree-dragging' : ''}`}
              draggable={!isBeingRenamed}
              onDragStart={(e) => {
                if (isBeingRenamed) return;
                e.stopPropagation();
                setDraggedFilePath(entry.path);
                e.dataTransfer.effectAllowed = 'move';
                e.dataTransfer.setData('text/plain', entry.path);
              }}
              onDragEnd={() => {
                setDraggedFilePath(null);
                setDropTargetPath(null);
              }}
            >
              {isBeingRenamed ? (
                <div className={`mind-tree-item mind-tree-file ${isHiddenEntry ? 'mind-tree-hidden' : ''}`} style={{ paddingLeft: `${12 + depth * 18}px` }}>
                  <span className="mind-tree-icon" aria-hidden="true">📄</span>
                  <input
                    ref={renameInputRef}
                    type="text"
                    className="mind-tree-rename-input"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        void submitRename();
                      } else if (e.key === 'Escape') {
                        cancelRename();
                      }
                    }}
                    onBlur={() => void submitRename()}
                    disabled={isRenaming}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className={`mind-tree-item mind-tree-file ${isHiddenEntry ? 'mind-tree-hidden' : ''} ${selectedFilePath === entry.path ? 'active' : ''}`}
                  style={{ paddingLeft: `${12 + depth * 18}px` }}
                  onClick={() => void openFile(entry.path)}
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(entry.path, entry.name);
                  }}
                >
                  <span className="mind-tree-icon" aria-hidden="true">📄</span>
                  <span className="mind-tree-label">{entry.name}</span>
                </button>
              )}
              <button
                type="button"
                className="mind-tree-session-btn"
                title="Create session for this file"
                aria-label={`Create session for file ${entry.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  openSessionDialogForPath('file', entry.path);
                }}
              >
                💭
              </button>
            </div>
          );
        })}
      </div>
    );
  };

  // Format helpers
  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const formatSessionTitle = (session: Session) => {
    if (session.title) return session.title;
    return `Session ${session.id.substring(0, 8)}`;
  };

  const isChildSession = (session: Session) => Boolean(session.parent_id);
  const linkTypeLabel = (session: Session) => {
    if (session.link_type === 'review') return 'Review';
    if (session.link_type === 'continuation') return 'Continuation';
    return '';
  };

  const formatStatusLabel = (status: string) => {
    const normalized = status.trim();
    if (normalized.length === 0) return 'Unknown';
    return normalized.charAt(0).toUpperCase() + normalized.slice(1);
  };

  const formatTokenCount = (tokens: number) => {
    return `${new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(tokens)} tok`;
  };

  const formatDurationSeconds = (seconds: number) => {
    const total = Math.max(0, Math.floor(seconds));
    const days = Math.floor(total / 86400);
    const hours = Math.floor((total % 86400) / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const secs = total % 60;

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${minutes}m`;
    if (minutes > 0) return `${minutes}m ${secs}s`;
    return `${secs}s`;
  };

  // Sort sessions by updated_at descending
  const sortedSessions = [...sessions].sort((a, b) => {
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });
  const sessionsByID = new Map(sortedSessions.map((session) => [session.id, session]));
  const childSessions = new Map<string, Session[]>();
  for (const session of sortedSessions) {
    const parentID = (session.parent_id || '').trim();
    if (parentID === '' || !sessionsByID.has(parentID)) {
      continue;
    }
    const items = childSessions.get(parentID) || [];
    items.push(session);
    childSessions.set(parentID, items);
  }
  const sessionRows: SessionListRow[] = [];
  const appendSessionRows = (session: Session, depth: number) => {
    sessionRows.push({ session, depth });
    const nested = childSessions.get(session.id) || [];
    for (const nestedSession of nested) {
      appendSessionRows(nestedSession, depth + 1);
    }
  };
  const rootSessions = sortedSessions.filter((session) => {
    const parentID = (session.parent_id || '').trim();
    return parentID === '' || !sessionsByID.has(parentID);
  });
  for (const rootSession of rootSessions) {
    appendSessionRows(rootSession, 0);
  }
  const fileNameSearchMatches: ProjectFileNameMatch[] = projectSearchResults?.filename_matches || [];
  const contentSearchMatches: ProjectContentMatch[] = projectSearchResults?.content_matches || [];
  const firstSearchHitPath = fileNameSearchMatches[0]?.path || contentSearchMatches[0]?.path || '';
  const hasSearchHits = fileNameSearchMatches.length > 0 || contentSearchMatches.length > 0;
  const viewerPlaceholder = getProjectViewerPlaceholder(project);
  const showSessionComposer = activeTab === 'explorer' || activeTab === 'sessions';

  const sessionsListBlock = (
    <>
      {isLoadingSessions ? (
        <div className="sessions-loading">Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <EmptyState className="sessions-empty">
          <EmptyStateTitle>No sessions yet.</EmptyStateTitle>
          <EmptyStateHint>Start speaking or typing below to create one.</EmptyStateHint>
        </EmptyState>
      ) : (
        <div className="sessions-list project-sessions-list">
          {sessionRows.map(({ session, depth }) => {
            const isChild = isChildSession(session);
            const linkLabel = linkTypeLabel(session);
            return (
              <div
                key={session.id}
                className={`session-card ${isChild ? 'session-child' : ''}`}
                style={depth > 0 ? { marginLeft: `${Math.min(depth, 6) * 18}px` } : undefined}
                onClick={() => handleSelectSession(session.id)}
              >
                <div className="session-card-row">
                  <div className="session-name-wrap">
                    {isChild && (
                      <span
                        className="session-hierarchy-marker"
                        title="Sub-agent session"
                        aria-label="Sub-agent session"
                      >
                        ↳
                      </span>
                    )}
                    <span
                      className={`session-status-dot status-${session.status}`}
                      title={`Status: ${formatStatusLabel(session.status)}`}
                      aria-label={`Status: ${formatStatusLabel(session.status)}`}
                    />
                    <h3 className="session-name">{formatSessionTitle(session)}</h3>
                    {linkLabel ? <span className="session-link-type-chip">{linkLabel}</span> : null}
                  </div>
                  <div className="session-row-right">
                    <div className="session-meta">
                      {session.task_progress && (() => {
                        const progress = parseTaskProgress(session.task_progress);
                        if (progress.total > 0) {
                          return (
                            <span
                              className="session-task-progress-bar"
                              title={`${progress.completed}/${progress.total} tasks (${progress.progressPct}%)`}
                            >
                              <span className="session-task-progress-fill" style={{ width: `${progress.progressPct}%` }} />
                            </span>
                          );
                        }
                        return null;
                      })()}
                      <span
                        className="session-token-count"
                        title={`Ran for ${formatDurationSeconds(session.run_duration_seconds ?? 0)}`}
                      >
                        {formatTokenCount(session.total_tokens ?? 0)}
                      </span>
                      <span className="session-date">{formatDate(session.updated_at)}</span>
                    </div>
                    <div className="session-actions">
                      {session.status === 'queued' ? (
                        <button
                          className="session-play-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleStartQueuedSession(session);
                          }}
                          title="Start session"
                          aria-label={`Start ${formatSessionTitle(session)}`}
                          disabled={startingSessionID === session.id}
                        >
                          ▶
                        </button>
                      ) : (
                        <button
                          className="session-duplicate-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleDuplicateSession(session);
                          }}
                          title="Duplicate session"
                          aria-label={`Duplicate ${formatSessionTitle(session)}`}
                          disabled={duplicatingSessionID === session.id}
                        >
                          ↻
                        </button>
                      )}
                      <button
                        className="session-delete-btn"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteSession(session.id);
                        }}
                        title="Delete session"
                        aria-label={`Delete ${formatSessionTitle(session)}`}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </>
  );

  if (isLoadingProject) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1>Loading...</h1>
        </div>
        <div className="page-content">
          <div className="sessions-loading">Loading project...</div>
        </div>
      </div>
    );
  }

  if (!project) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1>Project Not Found</h1>
        </div>
        <div className="page-content">
          <EmptyState className="sessions-empty">
            <EmptyStateTitle>The requested project could not be found.</EmptyStateTitle>
          </EmptyState>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell project-view-shell">
      <div className="page-header project-view-header">
        <div className="project-header-left">
          <h1>
            {project.name}
            {rootFolder ? (
              <span className="project-folder-path">{rootFolder}</span>
            ) : null}
          </h1>
        </div>
        {rootFolder ? (
          <div className="project-header-search">
            <div className="project-search-input-wrap">
              <span className="project-search-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" focusable="false">
                  <circle cx="11" cy="11" r="6.5" stroke="currentColor" strokeWidth="1.8" />
                  <path d="M16 16L21 21" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
                </svg>
              </span>
              <input
                type="search"
                className="project-search-input"
                value={projectSearchQuery}
                onChange={(event) => setProjectSearchQuery(event.target.value)}
                placeholder="Search files and content..."
                aria-label="Search project files and file contents"
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && firstSearchHitPath) {
                    event.preventDefault();
                    void openSearchResultFile(firstSearchHitPath);
                  }
                  if (event.key === 'Escape') {
                    setProjectSearchQuery('');
                  }
                }}
              />
            </div>
            {projectSearchQuery.trim() !== '' ? (
              <div className="project-search-results" role="listbox" aria-label="Project search results">
                {isSearchingProject ? <div className="project-search-status">Searching...</div> : null}
                {!isSearchingProject && projectSearchError ? (
                  <div className="project-search-status error">{projectSearchError}</div>
                ) : null}
                {!isSearchingProject && !projectSearchError ? (
                  <>
                    <div className="project-search-group">
                      <div className="project-search-group-title">File names</div>
                      {fileNameSearchMatches.length === 0 ? (
                        <div className="project-search-empty">No filename matches.</div>
                      ) : (
                        fileNameSearchMatches.map((match) => (
                          <button
                            key={`filename:${match.path}`}
                            type="button"
                            className="project-search-item"
                            onClick={() => void openSearchResultFile(match.path)}
                          >
                            <code>{match.path}</code>
                          </button>
                        ))
                      )}
                    </div>
                    <div className="project-search-group">
                      <div className="project-search-group-title">File contents</div>
                      {contentSearchMatches.length === 0 ? (
                        <div className="project-search-empty">No content matches.</div>
                      ) : (
                        contentSearchMatches.map((match) => (
                          <button
                            key={`content:${match.path}:${match.line}`}
                            type="button"
                            className="project-search-item"
                            onClick={() => void openSearchResultFile(match.path)}
                          >
                            <code>{match.path}:{match.line}</code>
                            <span>{match.preview}</span>
                          </button>
                        ))
                      )}
                    </div>
                    {!hasSearchHits ? (
                      <div className="project-search-status">No matches found.</div>
                    ) : null}
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
        <div className="project-header-actions">
          {rootFolder ? (
            <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
              Change folder
            </button>
          ) : null}
          {!project.is_system && (
            <button
              type="button"
              className="project-delete-btn"
              onClick={handleDeleteProject}
              disabled={isDeletingProject}
              title="Delete project"
              aria-label={`Delete project ${project.name}`}
            >
              {isDeletingProject ? 'Deleting...' : 'Delete Project'}
            </button>
          )}
        </div>
      </div>

      {error ? (
        <div className="error-banner">
          {error}
          <button type="button" className="error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      ) : null}
      {success ? (
        <div className="success-banner">
          {success}
          <button type="button" className="success-dismiss" onClick={() => setSuccess(null)}>×</button>
        </div>
      ) : null}

      <div className="page-content project-view-content">
        <div className="project-view-tabs" role="tablist" aria-label="Project workflow views">
          <button type="button" role="tab" aria-selected={activeTab === 'explorer'} className={`project-view-tab ${activeTab === 'explorer' ? 'active' : ''}`} onClick={() => setActiveTab('explorer')}>
            Explorer
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'tasks'} className={`project-view-tab ${activeTab === 'tasks' ? 'active' : ''}`} onClick={() => setActiveTab('tasks')}>
            Tasks
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'sessions'} className={`project-view-tab ${activeTab === 'sessions' ? 'active' : ''}`} onClick={() => setActiveTab('sessions')}>
            Sessions ({sessions.length})
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'changes'} className={`project-view-tab ${activeTab === 'changes' ? 'active' : ''}`} onClick={() => setActiveTab('changes')}>
            Changes ({gitChangedFiles.length})
          </button>
          <button type="button" role="tab" aria-selected={activeTab === 'history'} className={`project-view-tab ${activeTab === 'history' ? 'active' : ''}`} onClick={() => setActiveTab('history')}>
            History
          </button>
        </div>

        {activeTab === 'explorer' ? (
          <div className="project-files-section">
            {!rootFolder ? (
              <div className="project-files-empty">
                <p>No folder configured for this project.</p>
                <p>Configure a folder to browse and edit files.</p>
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Configure folder
                </button>
              </div>
            ) : (
              <div
                className="mind-layout"
                style={
                  {
                    '--mind-tree-width': `${treePanelWidth}px`,
                  } as CSSProperties
                }
              >
                <div
                  className={`mind-tree-panel ${dropTargetPath === '' ? 'mind-tree-drop-target' : ''}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    if (draggedFilePath) {
                      const targetPath = '';
                      const draggedDir = dirname(draggedFilePath);
                      if (draggedDir !== targetPath) {
                        setDropTargetPath(targetPath);
                      }
                    }
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
                      if (dropTargetPath === '') {
                        setDropTargetPath(null);
                      }
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (draggedFilePath) {
                      const draggedDir = dirname(draggedFilePath);
                      if (draggedDir !== '') {
                        void handleFileDrop(draggedFilePath, '');
                      }
                    }
                    setDropTargetPath(null);
                  }}
                >
                  <div className="mind-tree-toolbar">
                    <button type="button" className="settings-add-btn" onClick={() => void createNewFile()} disabled={isSavingFile}>
                      New file
                    </button>
                    <button type="button" className="settings-add-btn" onClick={() => void createNewFolder()}>
                      New folder
                    </button>
                  </div>
                  {renderTree('')}
                </div>
                <div
                  className="mind-tree-resize-handle"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="Resize file tree panel"
                  onPointerDown={handleStartTreeResize}
                />
                <div className="mind-viewer-panel">
                  <div className="mind-viewer-header">
                    <div className="mind-viewer-path">{selectedFilePath || 'Select a file from the tree'}</div>
                    <div className="mind-viewer-mode">
                      {selectedFilePath ? (
                        <button
                          type="button"
                          className="mind-create-session-btn"
                          onClick={() => openSessionDialogForPath('file', selectedFilePath)}
                          title="Create session for this file"
                        >
                          💭 Session
                        </button>
                      ) : null}
                      {selectedFilePath ? (
                        <div className="mind-file-actions-menu" ref={fileActionsMenuRef}>
                          <button
                            type="button"
                            className="mind-file-actions-trigger"
                            onClick={() => setIsFileActionsMenuOpen((prev) => !prev)}
                            title="Use this file..."
                            aria-haspopup="menu"
                            aria-expanded={isFileActionsMenuOpen}
                          >
                            ⋯
                          </button>
                          {isFileActionsMenuOpen ? (
                            <div className="mind-file-actions-dropdown" role="menu">
                              <button
                                type="button"
                                className="mind-file-actions-item"
                                onClick={() => void addSelectedFileToAgentInstructions()}
                                disabled={isAddingAgentInstructionFile || isSelectedFileAgentInstruction}
                                title="Add this file as a global Agent Instructions file block"
                              >
                                {isAddingAgentInstructionFile
                                  ? 'Adding...'
                                  : isSelectedFileAgentInstruction
                                    ? 'In Agent Instructions'
                                    : 'Use for Agent Instructions'}
                              </button>
                              <button
                                type="button"
                                className="mind-file-actions-item"
                                onClick={addSelectedFileToRecurringJob}
                                title="Create a recurring job prefilled to use this file"
                              >
                                Use in Recurring Job
                              </button>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                      {selectedFilePath && hasUnsavedChanges ? (
                        <button
                          type="button"
                          className="settings-save-btn"
                          onClick={() => void saveCurrentFile()}
                          disabled={isLoadingFile || isSavingFile || isDeletingFile}
                          title="Save changes"
                        >
                          {isSavingFile ? 'Saving...' : 'Save'}
                        </button>
                      ) : null}
                      {selectedFilePath ? (
                        <button
                          type="button"
                          className="mind-delete-file-btn"
                          onClick={() => void deleteCurrentFile()}
                          disabled={isLoadingFile || isSavingFile || isDeletingFile}
                          title="Delete this file"
                        >
                          {isDeletingFile ? 'Deleting...' : 'Delete'}
                        </button>
                      ) : null}
                      <div className="mind-mode-tabs" role="tablist" aria-label="File viewer mode">
                        <button
                          type="button"
                          role="tab"
                          aria-selected={markdownMode === 'preview'}
                          className={`mind-mode-tab ${markdownMode === 'preview' ? 'active' : ''}`}
                          onClick={() => setMarkdownMode('preview')}
                          disabled={!selectedFilePath || isLoadingFile || isDeletingFile}
                          title="Markdown preview"
                        >
                          Preview
                        </button>
                        <button
                          type="button"
                          role="tab"
                          aria-selected={markdownMode === 'source'}
                          className={`mind-mode-tab ${markdownMode === 'source' ? 'active' : ''}`}
                          onClick={() => setMarkdownMode('source')}
                          disabled={!selectedFilePath || isLoadingFile || isDeletingFile}
                          title="Edit markdown source"
                        >
                          Edit
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="mind-viewer-body">
                    {isLoadingFile ? <div className="sessions-loading">Loading file...</div> : null}
                    {!isLoadingFile && !selectedFilePath ? (
                      <EmptyState className="sessions-empty project-viewer-empty">
                        <div className="project-viewer-empty-icon" aria-hidden="true">{viewerPlaceholder.icon}</div>
                        <EmptyStateTitle>{viewerPlaceholder.title}</EmptyStateTitle>
                        <EmptyStateHint>{viewerPlaceholder.hint}</EmptyStateHint>
                      </EmptyState>
                    ) : null}
                    {!isLoadingFile && selectedFilePath && markdownMode === 'source' ? (
                      <textarea
                        className="mind-markdown-editor"
                        value={selectedFileContent}
                        onChange={(event) => setSelectedFileContent(event.target.value)}
                        disabled={isSavingFile}
                        spellCheck={false}
                      />
                    ) : null}
                    {!isLoadingFile && selectedFilePath && markdownMode === 'preview' ? (
                      <div className="mind-markdown-preview" onClick={(event) => void handlePreviewClick(event)} dangerouslySetInnerHTML={{ __html: markdownHtml }} />
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'tasks' ? (
          <div className="project-tab-panel">
            {!rootFolder ? (
              <div className="project-files-empty">
                <p>No folder configured for this project.</p>
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Configure folder
                </button>
              </div>
            ) : !activeTodoFilePath ? (
              <EmptyState className="sessions-empty project-task-empty">
                <EmptyStateTitle>No `todo.md` file found.</EmptyStateTitle>
                <EmptyStateHint>Create one to use the Kanban board.</EmptyStateHint>
                <button type="button" className="settings-add-btn" onClick={() => void createTodoFile()}>
                  Create todo.md
                </button>
              </EmptyState>
            ) : isLoadingFile || selectedFilePath !== activeTodoFilePath ? (
              <div className="sessions-loading">Loading TODO board...</div>
            ) : (
              <div className="project-task-board-wrap">
                <div className="project-task-header">
                  <h2>{activeTodoFilePath}</h2>
                  <div className="project-task-header-actions">
                    <button type="button" className="settings-add-btn" onClick={() => setActiveTab('explorer')}>
                      Open in Explorer
                    </button>
                    <button type="button" className="mind-create-session-btn" onClick={() => openSessionDialogForPath('file', activeTodoFilePath)}>
                      Session
                    </button>
                  </div>
                </div>
                <div className="mind-todo-board">
                  {todoBoard.columns.map((column) => (
                    <div key={column.id} className="mind-todo-column">
                      <div className="mind-todo-column-header">
                        <h3>{column.title}</h3>
                        <button
                          type="button"
                          className="mind-todo-add-btn"
                          onClick={() => void handleAddTaskToColumn(column)}
                          disabled={isUpdatingTodoBoard || isSavingFile}
                          title={`Add task to ${column.title}`}
                        >
                          + Task
                        </button>
                      </div>
                      <div
                        className={`mind-todo-column-body ${todoDropTargetColumnID === column.id ? 'drop-target' : ''}`}
                        onDragOver={(event) => {
                          if (!draggedTodoTask || isUpdatingTodoBoard) return;
                          event.preventDefault();
                          event.dataTransfer.dropEffect = 'move';
                          setTodoDropTargetColumnID(column.id);
                        }}
                        onDragLeave={() => {
                          if (todoDropTargetColumnID === column.id) {
                            setTodoDropTargetColumnID(null);
                          }
                        }}
                        onDrop={(event) => {
                          event.preventDefault();
                          void handleDropTaskToColumn(column);
                        }}
                      >
                        {column.tasks.length === 0 ? <div className="mind-todo-empty">No tasks</div> : null}
                        {column.tasks.map((task) => {
                          const taskID = `${column.id}:${task.id}`;
                          const isEditing = editingTodoTaskID === taskID;
                          return (
                            <article
                              key={task.id}
                              className={`mind-todo-card ${draggedTodoTask?.task.id === task.id ? 'dragging' : ''}`}
                              draggable={!isUpdatingTodoBoard && !isEditing}
                              onDragStart={(event) => {
                                event.dataTransfer.effectAllowed = 'move';
                                event.dataTransfer.setData('text/plain', task.id);
                                setDraggedTodoTask({ task, sourceColumnId: column.id });
                              }}
                              onDragEnd={() => {
                                setDraggedTodoTask(null);
                                setTodoDropTargetColumnID(null);
                              }}
                            >
                              {isEditing ? (
                                <input
                                  type="text"
                                  className="mind-todo-card-input"
                                  value={editingTodoTaskText}
                                  onChange={(event) => setEditingTodoTaskText(event.target.value)}
                                  onBlur={() => void handleSaveTodoTaskText(task, taskID)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') {
                                      event.preventDefault();
                                      void handleSaveTodoTaskText(task, taskID);
                                      return;
                                    }
                                    if (event.key === 'Escape') {
                                      event.preventDefault();
                                      cancelEditingTodoTask();
                                    }
                                  }}
                                  onDoubleClick={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
                                  autoFocus
                                />
                              ) : (
                                <div
                                  className="mind-todo-card-title"
                                  onDoubleClick={() => startEditingTodoTask(taskID, task.text)}
                                  title="Double-click to edit task"
                                >
                                  {task.text}
                                </div>
                              )}
                              <div className="mind-todo-card-actions">
                                <button
                                  type="button"
                                  className="mind-todo-action-btn"
                                  onClick={() => void handleDeleteTodoTask(task)}
                                  disabled={isUpdatingTodoBoard}
                                  title="Delete task"
                                  aria-label={`Delete task ${task.text}`}
                                >
                                  ✕
                                </button>
                                {task.linkedFilePath !== '' ? (
                                  <button
                                    type="button"
                                    className="mind-todo-action-btn"
                                    onClick={() => void handleOpenTodoTaskFile(task.linkedFilePath)}
                                    title="Open linked task file"
                                    aria-label={`Open linked task file for ${task.text}`}
                                  >
                                    ↗
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  className="mind-todo-action-btn"
                                  onClick={() => void handleStartTaskSession(task, column)}
                                  disabled={startingTaskSessionID === taskID}
                                  title="Start a new session for this task"
                                  aria-label={`Start a session for task ${task.text}`}
                                >
                                  {startingTaskSessionID === taskID ? '…' : '▶'}
                                </button>
                              </div>
                            </article>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'sessions' ? (
          <div className="project-tab-panel project-sessions-tab">
            <div className="project-sessions-header-static">
              <span>Sessions ({sessions.length})</span>
              <button
                type="button"
                className="project-bulk-delete-btn"
                onClick={() => void handleDeleteAllSessions()}
                disabled={sessions.length === 0 || isDeletingAllSessions}
                title="Delete all sessions in this project"
              >
                {isDeletingAllSessions ? 'Deleting...' : 'Delete All'}
              </button>
            </div>
            <div className="project-sessions-body">{sessionsListBlock}</div>
          </div>
        ) : null}

        {activeTab === 'changes' ? (
          <div className="project-tab-panel project-git-tab">
            {!rootFolder ? (
              <div className="project-files-empty">
                <p>No folder configured for this project.</p>
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Configure folder
                </button>
              </div>
            ) : (!isGitRepo && commitRepoPath.trim() === '') ? (
              <EmptyState className="sessions-empty">
                <EmptyStateTitle>This folder is not a Git repository.</EmptyStateTitle>
                <button type="button" className="settings-save-btn" onClick={openGitInitDialog} disabled={isLoadingGitStatus || isInitializingGit}>
                  {isInitializingGit ? 'Initializing Git...' : 'Initialize Git'}
                </button>
              </EmptyState>
            ) : (
              <div className="project-git-panel">
                <h2>Git Changes</h2>
                {commitRepoLabel ? <p className="project-commit-target">Repository: {commitRepoLabel}</p> : null}
                <p className="project-commit-summary">
                  {commitDialogFiles.length > 0
                    ? `${commitDialogFiles.length} changed file(s), ${stagedCommitFilesCount} staged`
                    : 'No changed files.'}
                </p>
                <textarea
                  className="project-commit-message"
                  value={commitMessage}
                  onChange={(event) => setCommitMessage(event.target.value)}
                  placeholder="Commit message"
                  rows={4}
                  disabled={isCommitting || isPushing || isPulling}
                />
                <div className="project-commit-controls">
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => void handleGenerateCommitMessage()}
                    disabled={isCommitting || isPushing || isPulling || isGeneratingCommitMessage || commitDialogFiles.length === 0}
                  >
                    {isGeneratingCommitMessage ? 'Generating...' : 'Suggest message'}
                  </button>
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => void handleStageAllFiles()}
                    disabled={isCommitting || isPushing || isPulling || isStagingAll || commitDialogFiles.filter((f) => !f.staged).length === 0}
                  >
                    {isStagingAll ? 'Adding...' : 'Add All'}
                  </button>
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => {
                      void refreshCommitDialogFiles();
                      void loadGitStatus();
                    }}
                    disabled={isLoadingGitStatus || isCommitting || isPushing || isPulling}
                  >
                    Refresh
                  </button>
                </div>
                <div className="project-commit-content">
                  <div className="project-commit-files">
                    {commitDialogFiles.length === 0 ? (
                      <div className="project-commit-empty">Working tree is clean.</div>
                    ) : (
                      commitDialogFiles.map((file) => (
                        <div
                          key={`${file.status}-${file.path}`}
                          className={`project-commit-file ${file.staged ? 'staged' : 'unstaged'} ${file.untracked ? 'untracked' : ''} ${selectedCommitFilePath === file.path ? 'selected' : ''}`}
                          onClick={() => setSelectedCommitFilePath(file.path)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              setSelectedCommitFilePath(file.path);
                            }
                          }}
                        >
                          <code className="project-commit-status" title={buildGitFileStatusTooltip(file)}>{file.status || '??'}</code>
                          <span className="project-commit-path">{file.path}</span>
                          <button
                            type="button"
                            className="project-commit-toggle-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleToggleGitFileStage(file);
                            }}
                            disabled={isCommitting || isPushing || isPulling || gitFileActionPath === file.path}
                          >
                            {gitFileActionPath === file.path
                              ? 'Updating...'
                              : file.staged
                                ? 'Remove'
                                : 'Add'}
                          </button>
                          <button
                            type="button"
                            className="project-commit-discard-btn"
                            onClick={(event) => {
                              event.stopPropagation();
                              void handleDiscardGitFileChanges(file);
                            }}
                            disabled={isCommitting || isPushing || isPulling || gitDiscardPath === file.path}
                            title="Discard changes in this file"
                          >
                            {gitDiscardPath === file.path ? 'Discarding...' : 'Discard'}
                          </button>
                        </div>
                      ))
                    )}
                  </div>
                  <div className="project-commit-diff">
                    <div className="project-commit-diff-header">
                      {selectedCommitFilePath || 'Select a file'}
                    </div>
                    {isLoadingCommitFileDiff ? (
                      <div className="project-commit-diff-empty">Loading diff...</div>
                    ) : (
                      <div className="project-commit-diff-body">
                        {parsedCommitDiffFile ? (
                          <FileDiff
                            fileDiff={parsedCommitDiffFile}
                            options={commitDiffOptions}
                            className="project-commit-diff-renderer"
                          />
                        ) : (
                          <div className="project-commit-diff-empty">No diff preview.</div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <div className="project-git-actions">
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => void handlePullChanges()}
                    disabled={isCommitting || isPushing || isPulling}
                  >
                    {isPulling ? 'Pulling changes...' : 'Pull Changes'}
                  </button>
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => void handleCommitChanges()}
                    disabled={isCommitting || isPushing || isPulling || commitMessage.trim() === '' || stagedCommitFilesCount === 0}
                  >
                    {isCommitting && !isPushing ? 'Committing...' : 'Commit'}
                  </button>
                  <button
                    type="button"
                    className="settings-save-btn"
                    onClick={() => void handleCommitAndPushChanges()}
                    disabled={isCommitting || isPushing || isPulling || commitMessage.trim() === '' || stagedCommitFilesCount === 0}
                  >
                    {isCommitting && isPushing ? 'Committing & pushing...' : 'Commit & Push'}
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {activeTab === 'history' ? (
          <div className="project-tab-panel project-git-tab">
            {!rootFolder ? (
              <div className="project-files-empty">
                <p>No folder configured for this project.</p>
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Configure folder
                </button>
              </div>
            ) : (!isGitRepo && commitRepoPath.trim() === '') ? (
              <EmptyState className="sessions-empty">
                <EmptyStateTitle>This folder is not a Git repository.</EmptyStateTitle>
                <button type="button" className="settings-save-btn" onClick={openGitInitDialog} disabled={isLoadingGitStatus || isInitializingGit}>
                  {isInitializingGit ? 'Initializing Git...' : 'Initialize Git'}
                </button>
              </EmptyState>
            ) : (
              <div className="project-git-panel">
                <div className="project-history-panel">
                  <div className="project-history-left">
                    <div className="project-history-header">
                      <h3>History</h3>
                      <button
                        type="button"
                        className="settings-add-btn"
                        onClick={() => void loadGitHistory()}
                        disabled={isLoadingGitHistory || isCommitting || isPushing || isPulling}
                      >
                        {isLoadingGitHistory ? 'Loading...' : 'Refresh History'}
                      </button>
                    </div>
                    {gitHistoryBranches.length > 0 ? (
                      <div className="project-history-branches">
                        {gitHistoryBranches.map((branch) => {
                          const branchColor = gitHistoryColorForRef(branch.name);
                          const branchClassName = `project-history-branch-chip${branch.current ? ' current' : ''}${branch.remote ? ' remote' : ''}`;
                          return (
                            <span
                              key={`${branch.remote ? 'remote' : 'local'}:${branch.name}`}
                              className={branchClassName}
                              style={{ '--branch-color': branchColor } as CSSProperties}
                              title={`${branch.name}${branch.ahead > 0 ? ` · ahead ${branch.ahead}` : ''}${branch.behind > 0 ? ` · behind ${branch.behind}` : ''}`}
                            >
                              {branch.name}
                              {branch.ahead > 0 ? ` ↑${branch.ahead}` : ''}
                              {branch.behind > 0 ? ` ↓${branch.behind}` : ''}
                            </span>
                          );
                        })}
                      </div>
                    ) : null}
                    {gitHistoryError ? (
                      <div className="project-history-error">{gitHistoryError}</div>
                    ) : null}
                    <div className="project-history-commit-list">
                      {isLoadingGitHistory ? (
                        <div className="project-history-empty">Loading commit history...</div>
                      ) : gitHistoryCommits.length === 0 ? (
                        <div className="project-history-empty">No commits found.</div>
                      ) : (
                        gitHistoryCommits.map((commit) => {
                          const refForColor = commit.branch || commit.refs?.[0] || commit.hash;
                          const laneColor = gitHistoryColorForRef(refForColor);
                          const authorName = commit.author_name || 'Unknown author';
                          const authoredAt = formatGitHistoryTime(commit.authored_at);
                          const shortHash = commit.short_hash || commit.hash.slice(0, 7);
                          return (
                            <button
                              key={commit.hash}
                              type="button"
                              className={`project-history-commit-row ${selectedHistoryCommitHash === commit.hash ? 'selected' : ''}`}
                              onClick={() => setSelectedHistoryCommitHash(commit.hash)}
                            >
                              <span className="project-history-lane" style={{ '--lane-color': laneColor } as CSSProperties}>
                                <span className="project-history-node" />
                              </span>
                              <span className="project-history-commit-main">
                                <span className="project-history-commit-line">
                                  <code className="project-history-commit-hash">{shortHash}</code>
                                  <span className="project-history-subject">{commit.subject || '(no subject)'}</span>
                                </span>
                                {commit.refs && commit.refs.length > 0 ? (
                                  <span className="project-history-refs">
                                    {commit.refs.map((refName) => (
                                      <span
                                        key={`${commit.hash}:${refName}`}
                                        className="project-history-ref-chip"
                                        style={{ '--branch-color': gitHistoryColorForRef(refName) } as CSSProperties}
                                      >
                                        {refName}
                                      </span>
                                    ))}
                                  </span>
                                ) : null}
                              </span>
                              <span
                                className="project-history-author-avatar"
                                title={`${authorName} · ${authoredAt}`}
                                aria-label={`${authorName} at ${authoredAt}`}
                              >
                                {gitHistoryAuthorInitials(authorName)}
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  </div>
                  <div className="project-history-right">
                    <div className="project-history-right-header">
                      {selectedHistoryCommit ? (
                        <>
                          <strong>{selectedHistoryCommit.subject || '(no subject)'}</strong>
                          <span>
                            <code>{selectedHistoryCommit.short_hash || selectedHistoryCommit.hash.slice(0, 7)}</code>
                            {' · '}
                            {selectedHistoryCommit.author_name || 'Unknown author'}
                            {' · '}
                            {formatGitHistoryTime(selectedHistoryCommit.authored_at)}
                          </span>
                        </>
                      ) : (
                        <span>Select a commit to inspect its files and diff.</span>
                      )}
                    </div>
                    <div className="project-history-right-body">
                      <div className="project-history-files">
                        {isLoadingHistoryCommitFiles ? (
                          <div className="project-history-empty">Loading changed files...</div>
                        ) : historyCommitFiles.length === 0 ? (
                          <div className="project-history-empty">No changed files for selected commit.</div>
                        ) : (
                          historyCommitFiles.map((file) => (
                            <button
                              key={`${selectedHistoryCommitHash}:${file.path}`}
                              type="button"
                              className={`project-history-file-row ${selectedHistoryFilePath === file.path ? 'selected' : ''}`}
                              onClick={() => setSelectedHistoryFilePath(file.path)}
                            >
                              <code>{file.status || 'M'}</code>
                              <span className="project-history-file-path">{file.path}</span>
                              <span className="project-history-file-stats">
                                {file.binary ? 'binary' : `+${file.additions} -${file.deletions}`}
                              </span>
                            </button>
                          ))
                        )}
                      </div>
                      <div className="project-history-diff">
                        <div className="project-commit-diff-header">
                          {selectedHistoryFilePath || 'Select a file'}
                        </div>
                        {isLoadingHistoryFileDiff ? (
                          <div className="project-commit-diff-empty">Loading commit diff...</div>
                        ) : (
                          <div className="project-commit-diff-body">
                            {parsedHistoryDiffFile ? (
                              <FileDiff
                                fileDiff={parsedHistoryDiffFile}
                                options={commitDiffOptions}
                                className="project-commit-diff-renderer"
                              />
                            ) : (
                              <div className="project-commit-diff-empty">No diff preview.</div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {showSessionComposer ? (
          <div className="project-sessions-composer">
            <ChatInput
              onSend={handleStartSession}
              onQueue={handleQueueSession}
              disabled={isCreatingSession || isQueuingSession}
              showVoiceButton={false}
              autoFocus={!rootFolder}
              showQueueButton={true}
              value={sessionComposerMessage}
              onValueChange={setSessionComposerMessage}
              placeholder={sessionTargetLabel
                ? `Describe the task for ${sessionTargetLabel}...`
                : 'Start a new chat...'}
              actionControls={
                <div className="sessions-new-chat-controls">
                  <label className="chat-provider-select">
                    <select
                      value={selectedWorkflowId}
                      onChange={(event) => setSelectedWorkflowId(event.target.value)}
                      title="Workflow"
                      aria-label="Workflow"
                    >
                      {workflowOptions.map((workflow) => (
                        <option key={workflow.id} value={workflow.id}>
                          {workflow.name}{workflow.builtIn ? ' (Built-in)' : ''}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              }
            />
          </div>
        ) : null}
      </div>

      {/* Git Init Dialog */}
      {isGitInitDialogOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Initialize git repository">
          <div className="mind-picker-dialog project-git-init-dialog">
            <h2>Initialize Git Repository</h2>
            <p className="project-git-init-summary">
              This will run <code>git init</code> in the current project folder.
            </p>
            <label className="project-git-init-field">
              <span>Remote URL (optional)</span>
              <input
                type="text"
                value={gitInitRemoteURL}
                onChange={(event) => setGitInitRemoteURL(event.target.value)}
                placeholder="git@github.com:owner/repo.git or https://github.com/owner/repo.git"
                disabled={isInitializingGit}
              />
            </label>
            <p className="project-git-init-hint">
              If provided, it will be added as <code>origin</code>.
            </p>
            <div className="mind-picker-actions">
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => void handleInitializeGit()}
                disabled={isInitializingGit}
              >
                {isInitializingGit ? 'Initializing...' : 'Initialize'}
              </button>
              <button type="button" className="settings-remove-btn" onClick={closeGitInitDialog} disabled={isInitializingGit}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {/* Folder Picker Dialog */}
      {isPickerOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose project folder">
          <div className="mind-picker-dialog">
            <h2>Choose project folder</h2>
            <div className="mind-picker-path">{browsePath || 'Loading...'}</div>
            <div className="mind-picker-actions">
              <button
                type="button"
                className="settings-add-btn"
                onClick={() => void loadBrowse(getParentPath(browsePath))}
                disabled={isLoadingBrowse || browsePath.trim() === '' || getParentPath(browsePath) === browsePath}
              >
                Up
              </button>
              <button type="button" className="settings-save-btn" onClick={handlePickCurrentFolder} disabled={isLoadingBrowse || browsePath === ''}>
                Use this folder
              </button>
              <button type="button" className="settings-remove-btn" onClick={closePicker}>
                Cancel
              </button>
            </div>
            <div className="mind-picker-list">
              {isLoadingBrowse ? <div className="sessions-loading">Loading directories...</div> : null}
              {!isLoadingBrowse && browseEntries.length === 0 ? (
                <EmptyState className="sessions-empty">
                  <EmptyStateTitle>No folders found.</EmptyStateTitle>
                </EmptyState>
              ) : null}
              {!isLoadingBrowse
                ? browseEntries.map((entry) => (
                  <button key={entry.path} type="button" className="mind-picker-item" onClick={() => void loadBrowse(entry.path)}>
                    <span className="mind-tree-icon" aria-hidden="true">📁</span>
                    <span>{entry.name}</span>
                  </button>
                ))
                : null}
            </div>
          </div>
        </div>
      ) : null}


    </div>
  );
}

export default ProjectView;
