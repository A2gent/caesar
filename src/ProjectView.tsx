import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  browseMindDirectories,
  cancelSessionRun,
  createSession,
  deleteProject,
  deleteProjectFile,
  deleteSession,
  getProject,
  getProjectFile,
  getSession,
  getSettings,
  listProjectTree,
  listProviders,
  listSessions,
  saveProjectFile,
  sendMessageStream,
  updateProject,
  type LLMProviderType,
  type Message,
  type MindTreeEntry,
  type Project,
  type ProviderConfig,
  type Session,
} from './api';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import {
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  buildAgentSystemPromptAppend,
  parseInstructionBlocksSetting,
  serializeInstructionBlocksSetting,
  type InstructionBlock,
} from './instructionBlocks';
import { updateSettings } from './api';

type MarkdownMode = 'preview' | 'source';

const DEFAULT_TREE_PANEL_WIDTH = 360;
const MIN_TREE_PANEL_WIDTH = 240;
const MAX_TREE_PANEL_WIDTH = 720;
const TREE_PANEL_WIDTH_STORAGE_KEY = 'a2gent.project.tree.width';
const EXPANDED_DIRS_STORAGE_KEY_PREFIX = 'a2gent.project.expandedDirs.';
const SELECTED_FILE_STORAGE_KEY_PREFIX = 'a2gent.project.selectedFile.';
const SESSIONS_COLLAPSED_STORAGE_KEY = 'a2gent.project.sessionsCollapsed';
const LAST_PROVIDER_STORAGE_KEY = 'a2gent.sessions.lastProvider';

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

function readStoredSessionsCollapsed(): boolean {
  try {
    return localStorage.getItem(SESSIONS_COLLAPSED_STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

function writeStoredSessionsCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(SESSIONS_COLLAPSED_STORAGE_KEY, String(collapsed));
  } catch {
    // ignore
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

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('```')) {
      closeList();
      closeTable();
      if (!inCodeFence) {
        html.push('<pre><code>');
        inCodeFence = true;
      } else {
        html.push('</code></pre>');
        inCodeFence = false;
      }
      continue;
    }

    if (inCodeFence) {
      html.push(`${escapeHtml(line)}\n`);
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

  if (inCodeFence) {
    html.push('</code></pre>');
  }
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

  // Sessions state
  const [sessions, setSessions] = useState<Session[]>([]);
  const [isLoadingSessions, setIsLoadingSessions] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [duplicatingSessionID, setDuplicatingSessionID] = useState<string | null>(null);
  const [sessionsCollapsed, setSessionsCollapsed] = useState(readStoredSessionsCollapsed);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');
  const [hasLoadedProviders, setHasLoadedProviders] = useState(false);

  // Files state
  const [rootFolder, setRootFolder] = useState('');
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
  const [pendingAnchor, setPendingAnchor] = useState('');
  const [treePanelWidth, setTreePanelWidth] = useState(readStoredTreePanelWidth);
  const treeResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  // File session panel state
  const [isSessionPanelOpen, setIsSessionPanelOpen] = useState(false);
  const [isSessionContextExpanded, setIsSessionContextExpanded] = useState(false);
  const [sessionContextMessage, setSessionContextMessage] = useState('');
  const [sessionTargetLabel, setSessionTargetLabel] = useState('');
  const [inlineSession, setInlineSession] = useState<Session | null>(null);
  const [inlineMessages, setInlineMessages] = useState<Message[]>([]);
  const [isInlineSessionLoading, setIsInlineSessionLoading] = useState(false);
  const [agentInstructionFilePaths, setAgentInstructionFilePaths] = useState<Set<string>>(new Set());
  const [isAddingAgentInstructionFile, setIsAddingAgentInstructionFile] = useState(false);
  const [isFileActionsMenuOpen, setIsFileActionsMenuOpen] = useState(false);
  const fileActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const handledOpenFileQueryRef = useRef('');
  const activeInlineStreamAbortRef = useRef<AbortController | null>(null);

  // Load project details
  useEffect(() => {
    if (!projectId) {
      setProject(null);
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

  // Load providers
  useEffect(() => {
    const loadProviders = async () => {
      try {
        const data = await listProviders();
        setProviders(data);
        let storedProvider: LLMProviderType | '' = '';
        try {
          storedProvider = (localStorage.getItem(LAST_PROVIDER_STORAGE_KEY) as LLMProviderType | null) || '';
        } catch {
          storedProvider = '';
        }
        if (storedProvider && data.some((provider) => provider.type === storedProvider)) {
          setSelectedProvider(storedProvider);
          return;
        }
        const active = data.find((provider) => provider.is_active);
        if (active) {
          setSelectedProvider(active.type);
          return;
        }
        if (data.length > 0) {
          setSelectedProvider(data[0].type);
        }
      } catch (err) {
        console.error('Failed to load providers:', err);
      } finally {
        setHasLoadedProviders(true);
      }
    };
    loadProviders();
  }, []);

  // Persist selected provider
  useEffect(() => {
    if (!hasLoadedProviders) return;
    try {
      if (selectedProvider) {
        localStorage.setItem(LAST_PROVIDER_STORAGE_KEY, selectedProvider);
      } else {
        localStorage.removeItem(LAST_PROVIDER_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures
    }
  }, [hasLoadedProviders, selectedProvider]);

  // Persist sessions collapsed state
  useEffect(() => {
    writeStoredSessionsCollapsed(sessionsCollapsed);
  }, [sessionsCollapsed]);

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
  const handleSelectSession = (sessionId: string, initialMessage?: string) => {
    navigate(`/chat/${sessionId}`, {
      state: initialMessage ? { initialMessage } : undefined,
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

  const handleStartSession = async (message: string) => {
    setIsCreatingSession(true);
    setError(null);

    try {
      const created = await createSession({
        agent_id: 'build',
        provider: selectedProvider || undefined,
        project_id: projectId || undefined,
      });
      handleSelectSession(created.id, message);
    } catch (err) {
      console.error('Failed to create session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsCreatingSession(false);
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
    setMarkdownMode('preview');
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

  const saveCurrentFile = async () => {
    if (!selectedFilePath || !projectId) return;
    setIsSavingFile(true);
    try {
      await saveProjectFile(projectId, selectedFilePath, selectedFileContent);
      setSavedFileContent(selectedFileContent);
      setSuccess('File saved successfully.');
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete file');
    } finally {
      setIsDeletingFile(false);
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
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create file');
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

  // File session dialog handlers
  const openSessionDialogForPath = (type: 'folder' | 'file', path: string) => {
    const fullPath = rootFolder ? joinMindAbsolutePath(rootFolder, path) : path;
    const label = type === 'folder' ? `folder "${path || 'root'}"` : `file "${path}"`;
    setSessionTargetLabel(label);
    setSessionContextMessage(buildMindSessionContext(type, fullPath));
    setIsSessionContextExpanded(false);
    setInlineSession(null);
    setInlineMessages([]);
    setIsSessionPanelOpen(true);
  };

  const closeSessionDialog = () => {
    setIsSessionPanelOpen(false);
    setSessionTargetLabel('');
    setSessionContextMessage('');
    setInlineSession(null);
    setInlineMessages([]);
    setIsInlineSessionLoading(false);
    if (activeInlineStreamAbortRef.current) {
      activeInlineStreamAbortRef.current.abort();
      activeInlineStreamAbortRef.current = null;
    }
  };

  const handleCreateMindSession = async (userMessage: string) => {
    if (!projectId) return;
    
    setIsCreatingSession(true);
    setError(null);

    try {
      const combinedMessage = sessionContextMessage
        ? `${sessionContextMessage}\n\n---\n\n${userMessage}`
        : userMessage;

      const created = await createSession({
        agent_id: 'build',
        task: combinedMessage,
        provider: selectedProvider || undefined,
        project_id: projectId,
      });

      const now = new Date().toISOString();
      setInlineSession({
        id: created.id,
        agent_id: created.agent_id,
        provider: created.provider,
        project_id: created.project_id,
        title: 'Session',
        status: 'running',
        created_at: created.created_at,
        updated_at: now,
      });
      setInlineMessages([{ role: 'user', content: combinedMessage, timestamp: now }]);
      setIsInlineSessionLoading(true);

      // Start streaming the response
      const abortController = new AbortController();
      activeInlineStreamAbortRef.current = abortController;

      const eventIterator = sendMessageStream(created.id, '', abortController.signal);
      let assistantContent = '';

      for await (const event of eventIterator) {
        if (event.type === 'assistant_delta') {
          assistantContent += event.delta;
          setInlineMessages((prev) => {
            const messages = [...prev];
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.role === 'assistant') {
              return [...messages.slice(0, -1), { ...lastMessage, content: assistantContent }];
            }
            return [...messages, { role: 'assistant', content: assistantContent, timestamp: new Date().toISOString() }];
          });
        } else if (event.type === 'done' || event.type === 'error') {
          break;
        }
      }

      // Refresh session to get final status
      const finalSession = await getSession(created.id);
      setInlineSession(finalSession);
      setIsInlineSessionLoading(false);
      activeInlineStreamAbortRef.current = null;
    } catch (err) {
      console.error('Failed to create session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create session');
      setIsInlineSessionLoading(false);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleSendInlineMessage = async (message: string) => {
    if (!inlineSession) return;
    
    setIsInlineSessionLoading(true);
    setInlineMessages((prev) => [...prev, { role: 'user', content: message, timestamp: new Date().toISOString() }]);

    try {
      const abortController = new AbortController();
      activeInlineStreamAbortRef.current = abortController;

      const eventIterator = sendMessageStream(inlineSession.id, message, abortController.signal);
      let assistantContent = '';

      for await (const event of eventIterator) {
        if (event.type === 'assistant_delta') {
          assistantContent += event.delta;
          setInlineMessages((prev) => {
            const messages = [...prev];
            const lastMessage = messages[messages.length - 1];
            if (lastMessage?.role === 'assistant') {
              return [...messages.slice(0, -1), { ...lastMessage, content: assistantContent }];
            }
            return [...messages, { role: 'assistant', content: assistantContent, timestamp: new Date().toISOString() }];
          });
        } else if (event.type === 'done' || event.type === 'error') {
          break;
        }
      }

      const finalSession = await getSession(inlineSession.id);
      setInlineSession(finalSession);
      setIsInlineSessionLoading(false);
      activeInlineStreamAbortRef.current = null;
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      setIsInlineSessionLoading(false);
    }
  };

  const handleCancelInlineSession = async () => {
    if (activeInlineStreamAbortRef.current) {
      activeInlineStreamAbortRef.current.abort();
      activeInlineStreamAbortRef.current = null;
    }
    if (inlineSession) {
      try {
        await cancelSessionRun(inlineSession.id);
      } catch (err) {
        console.error('Failed to cancel session:', err);
      }
    }
    setIsInlineSessionLoading(false);
  };

  // Computed values
  const hasUnsavedChanges = selectedFileContent !== savedFileContent;
  const markdownHtml = useMemo(() => renderMarkdownToHtml(selectedFileContent), [selectedFileContent]);
  
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
          if (entry.type === 'directory') {
            const isExpanded = expandedDirs.has(entry.path);
            const isLoading = loadingDirs.has(entry.path);
            return (
              <div key={entry.path}>
                <div className="mind-tree-row">
                  <button
                    type="button"
                    className="mind-tree-item mind-tree-directory"
                    style={{ paddingLeft: `${12 + depth * 18}px` }}
                    onClick={() => void toggleDirectory(entry.path)}
                  >
                    <span className="mind-tree-icon" aria-hidden="true">{isExpanded ? '📂' : '📁'}</span>
                    <span className="mind-tree-label">{entry.name}</span>
                    {isLoading ? <span className="mind-tree-meta">Loading...</span> : null}
                  </button>
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

          return (
            <div key={entry.path} className="mind-tree-row">
              <button
                type="button"
                className={`mind-tree-item mind-tree-file ${selectedFilePath === entry.path ? 'active' : ''}`}
                style={{ paddingLeft: `${12 + depth * 18}px` }}
                onClick={() => void openFile(entry.path)}
              >
                <span className="mind-tree-icon" aria-hidden="true">📄</span>
                <span className="mind-tree-label">{entry.name}</span>
              </button>
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
          <div className="sessions-empty">The requested project could not be found.</div>
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
          <button type="button" className="error-dismiss" onClick={() => setSuccess(null)}>×</button>
        </div>
      ) : null}

      <div className="page-content project-view-content">
        {/* Sessions Section (Collapsible) */}
        <div className={`project-sessions-section ${sessionsCollapsed ? 'collapsed' : ''}`}>
          <button
            type="button"
            className="project-sessions-header"
            onClick={() => setSessionsCollapsed(!sessionsCollapsed)}
            aria-expanded={!sessionsCollapsed}
          >
            <span className="project-sessions-toggle">{sessionsCollapsed ? '▶' : '▼'}</span>
            <span className="project-sessions-title">Sessions ({sessions.length})</span>
          </button>
          
          {!sessionsCollapsed && (
            <div className="project-sessions-body">
              {isLoadingSessions ? (
                <div className="sessions-loading">Loading sessions...</div>
              ) : sessions.length === 0 ? (
                <div className="sessions-empty">
                  <p>No sessions yet. Start speaking or typing below to create one.</p>
                </div>
              ) : (
                <div className="sessions-list project-sessions-list">
                  {sortedSessions.map((session) => (
                    <div
                      key={session.id}
                      className="session-card"
                      onClick={() => handleSelectSession(session.id)}
                    >
                      <div className="session-card-row">
                        <div className="session-name-wrap">
                          <span
                            className={`session-status-dot status-${session.status}`}
                            title={`Status: ${formatStatusLabel(session.status)}`}
                            aria-label={`Status: ${formatStatusLabel(session.status)}`}
                          />
                          <h3 className="session-name">{formatSessionTitle(session)}</h3>
                        </div>
                        <div className="session-row-right">
                          <div className="session-meta">
                            {session.provider ? <span className="session-provider-chip">{session.provider}</span> : null}
                            <span
                              className="session-token-count"
                              title={`Ran for ${formatDurationSeconds(session.run_duration_seconds ?? 0)}`}
                            >
                              {formatTokenCount(session.total_tokens ?? 0)}
                            </span>
                            <span className="session-date">{formatDate(session.updated_at)}</span>
                          </div>
                          <div className="session-actions">
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
                  ))}
                </div>
              )}

              <div className="project-sessions-composer">
                <ChatInput
                  onSend={handleStartSession}
                  disabled={isCreatingSession}
                  autoFocus={!rootFolder}
                  actionControls={
                    providers.length > 0 ? (
                      <div className="sessions-new-chat-controls">
                        <label className="chat-provider-select">
                          <select
                            value={selectedProvider}
                            onChange={(e) => setSelectedProvider(e.target.value as LLMProviderType)}
                            title="Provider"
                            aria-label="Provider"
                          >
                            {providers.map((provider) => (
                              <option key={provider.type} value={provider.type}>
                                {provider.display_name}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    ) : null
                  }
                />
              </div>
            </div>
          )}
        </div>

        {/* Files Section */}
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
              <div className="mind-tree-panel">
                <div className="mind-tree-toolbar">
                  <button type="button" className="settings-add-btn" onClick={() => void createNewFile()} disabled={isSavingFile}>
                    New file
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
                    <button
                      type="button"
                      className={`mind-mode-toggle ${markdownMode === 'source' ? 'source' : 'preview'}`}
                      onClick={() => setMarkdownMode((prev) => (prev === 'preview' ? 'source' : 'preview'))}
                      disabled={!selectedFilePath || isLoadingFile || isDeletingFile}
                      title={markdownMode === 'preview' ? 'Switch to source view' : 'Switch to preview mode'}
                    >
                      <span className="mind-mode-toggle-label">{markdownMode === 'preview' ? 'Preview' : 'Source'}</span>
                      <span className="mind-mode-toggle-switch" aria-hidden="true">
                        <span className="mind-mode-toggle-thumb" />
                      </span>
                    </button>
                  </div>
                </div>

                <div className="mind-viewer-body">
                  {isLoadingFile ? <div className="sessions-loading">Loading file...</div> : null}
                  {!isLoadingFile && !selectedFilePath ? <div className="sessions-empty">No file selected.</div> : null}
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
      </div>

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
              {!isLoadingBrowse && browseEntries.length === 0 ? <div className="sessions-empty">No folders found.</div> : null}
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

      {/* File Session Panel */}
      {isSessionPanelOpen ? (
        <div
          className={`mind-session-panel ${inlineSession ? 'with-inline-session' : 'create-mode'}`}
          role="region"
          aria-label="Create session for file"
        >
          {inlineSession ? (
            <div className="mind-session-panel-header">
              <h2>Session</h2>
              <div className="mind-session-inline-meta">
                <span className={`session-status status-${inlineSession.status}`}>
                  {inlineSession.status}
                </span>
                <button
                  type="button"
                  className="settings-add-btn"
                  onClick={() => navigate(`/chat/${inlineSession.id}`)}
                >
                  Open full session
                </button>
                <button
                  type="button"
                  className="settings-remove-btn"
                  onClick={() => {
                    setInlineSession(null);
                    setInlineMessages([]);
                    setIsInlineSessionLoading(false);
                  }}
                >
                  New session
                </button>
              </div>
            </div>
          ) : null}
          {inlineSession ? (
            <div className="mind-session-inline-conversation">
              <div className="mind-session-inline-body">
                <MessageList
                  messages={inlineMessages}
                  isLoading={isInlineSessionLoading}
                  sessionId={inlineSession.id}
                />
              </div>
              <ChatInput
                onSend={(message) => void handleSendInlineMessage(message)}
                disabled={isInlineSessionLoading}
                onStop={() => void handleCancelInlineSession()}
                showStopButton={isInlineSessionLoading || inlineSession.status === 'running'}
                canStop={true}
              />
            </div>
          ) : (
            <div className="mind-session-creation-form">
              {isSessionContextExpanded ? (
                <textarea
                  id="mind-session-context"
                  className="mind-session-textarea context-textarea"
                  value={sessionContextMessage}
                  onChange={(event) => setSessionContextMessage(event.target.value)}
                  disabled={isCreatingSession || isInlineSessionLoading}
                  placeholder="Generated context"
                />
              ) : null}
              <div className="mind-session-controls-row">
                <button
                  type="button"
                  className="mind-session-context-toggle"
                  onClick={() => setIsSessionContextExpanded((prev) => !prev)}
                  disabled={isCreatingSession || isInlineSessionLoading}
                >
                  {isSessionContextExpanded ? 'Hide generated context' : 'Show generated context'}
                </button>
                <button type="button" className="settings-remove-btn" onClick={closeSessionDialog} disabled={isCreatingSession}>
                  Close
                </button>
              </div>
              <ChatInput
                onSend={(message) => void handleCreateMindSession(message)}
                disabled={isCreatingSession || isInlineSessionLoading}
                autoFocus
                placeholder={sessionTargetLabel
                  ? `Describe the task for ${sessionTargetLabel.toLowerCase()}...`
                  : 'Describe the task...'}
                actionControls={(
                  <div className="sessions-new-chat-controls">
                    {providers.length > 0 ? (
                      <label className="chat-provider-select">
                        <select
                          value={selectedProvider}
                          onChange={(event) => setSelectedProvider(event.target.value as LLMProviderType)}
                          title="Provider"
                          aria-label="Provider"
                          disabled={isCreatingSession || isInlineSessionLoading}
                        >
                          {providers.map((provider) => (
                            <option key={provider.type} value={provider.type}>
                              {provider.display_name}
                            </option>
                          ))}
                        </select>
                      </label>
                    ) : null}
                  </div>
                )}
              />
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default ProjectView;
