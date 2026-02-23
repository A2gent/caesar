import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, ReactElement, PointerEvent as ReactPointerEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  browseMindDirectories,
  cancelSessionRun,
  createMindFolder,
  createProject,
  createSession,
  deleteMindFile,
  getSession,
  getSettings,
  getMindConfig,
  getMindFile,
  listMindTree,
  listProjects,
  listProviders,
  moveMindFile,
  renameMindEntry,
  saveMindFile,
  sendMessageStream,
  type ChatStreamEvent,
  type LLMProviderType,
  type Message,
  type MindTreeEntry,
  type ProviderConfig,
  type Session,
  updateSettings,
  updateMindConfig,
  updateProject,
} from './api';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import { EmptyState, EmptyStateTitle } from './EmptyState';
import {
  AGENT_INSTRUCTION_BLOCKS_SETTING_KEY,
  AGENT_SYSTEM_PROMPT_APPEND_SETTING_KEY,
  buildAgentSystemPromptAppend,
  parseInstructionBlocksSetting,
  serializeInstructionBlocksSetting,
  type InstructionBlock,
} from './instructionBlocks';

type MarkdownMode = 'preview' | 'source';

const DEFAULT_TREE_PANEL_WIDTH = 360;
const MIN_TREE_PANEL_WIDTH = 240;
const MAX_TREE_PANEL_WIDTH = 720;
const TREE_PANEL_WIDTH_STORAGE_KEY = 'a2gent.mind.tree.width';
const EXPANDED_DIRS_STORAGE_KEY = 'a2gent.mind.expandedDirs';
const SELECTED_FILE_STORAGE_KEY = 'a2gent.mind.selectedFile';
const SESSION_POLL_INTERVAL_MS = 4000;

function isTerminalSessionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'completed' || normalized === 'failed';
}

function readStoredTreePanelWidth(): number {
  const rawWidth = localStorage.getItem(TREE_PANEL_WIDTH_STORAGE_KEY);
  const parsed = rawWidth ? Number.parseInt(rawWidth, 10) : Number.NaN;
  if (!Number.isFinite(parsed)) {
    return DEFAULT_TREE_PANEL_WIDTH;
  }
  return Math.min(MAX_TREE_PANEL_WIDTH, Math.max(MIN_TREE_PANEL_WIDTH, parsed));
}

function readStoredExpandedDirs(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_DIRS_STORAGE_KEY);
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

function writeStoredExpandedDirs(dirs: Set<string>): void {
  try {
    localStorage.setItem(EXPANDED_DIRS_STORAGE_KEY, JSON.stringify(Array.from(dirs)));
  } catch {
    // ignore storage errors
  }
}

function readStoredSelectedFile(): string {
  try {
    const raw = localStorage.getItem(SELECTED_FILE_STORAGE_KEY);
    return raw || '';
  } catch {
    return '';
  }
}

function writeStoredSelectedFile(path: string): void {
  try {
    if (path) {
      localStorage.setItem(SELECTED_FILE_STORAGE_KEY, path);
    } else {
      localStorage.removeItem(SELECTED_FILE_STORAGE_KEY);
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
    `This request is tied to a My Mind ${targetLabel}.`,
    '',
    `Target type: ${targetLabel}`,
    `Full path: ${fullPath}`,
    '',
    'Use this path as primary context for the session.',
  ].join('\n');
}

function MyMindView() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [rootFolder, setRootFolder] = useState('');
  const [error, setError] = useState<string | null>(null);

  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);

  const [treeEntries, setTreeEntries] = useState<Record<string, MindTreeEntry[]>>({});
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(readStoredExpandedDirs);
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(() => new Set<string>());

  const [selectedFilePath, setSelectedFilePath] = useState(readStoredSelectedFile);
  const [selectedFileContent, setSelectedFileContent] = useState('');
  const [savedFileContent, setSavedFileContent] = useState('');
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [isDeletingFile, setIsDeletingFile] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');
  const [pendingAnchor, setPendingAnchor] = useState('');

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');

  const [isSessionPanelOpen, setIsSessionPanelOpen] = useState(false);
  const [isSessionContextExpanded, setIsSessionContextExpanded] = useState(false);
  const [sessionContextMessage, setSessionContextMessage] = useState('');
  const [sessionTargetLabel, setSessionTargetLabel] = useState('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [inlineSession, setInlineSession] = useState<Session | null>(null);
  const [inlineMessages, setInlineMessages] = useState<Message[]>([]);
  const [isInlineSessionLoading, setIsInlineSessionLoading] = useState(false);
  const [agentInstructionFilePaths, setAgentInstructionFilePaths] = useState<Set<string>>(new Set());
  const [isAddingAgentInstructionFile, setIsAddingAgentInstructionFile] = useState(false);
  const [isFileActionsMenuOpen, setIsFileActionsMenuOpen] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);
  const [treePanelWidth, setTreePanelWidth] = useState(readStoredTreePanelWidth);
  const [draggedFilePath, setDraggedFilePath] = useState<string | null>(null);
  const [dropTargetPath, setDropTargetPath] = useState<string | null>(null);
  const [isMovingFile, setIsMovingFile] = useState(false);
  const [renamingPath, setRenamingPath] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const [isRenaming, setIsRenaming] = useState(false);
  const renameInputRef = useRef<HTMLInputElement | null>(null);
  const treeResizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const fileActionsMenuRef = useRef<HTMLDivElement | null>(null);
  const handledOpenFileQueryRef = useRef('');
  const activeInlineStreamAbortRef = useRef<AbortController | null>(null);

  const loadTree = useCallback(async (path: string) => {
    setLoadingDirs((prev) => new Set(prev).add(path));
    try {
      const response = await listMindTree(path);
      setTreeEntries((prev) => ({
        ...prev,
        [path]: response.entries,
      }));
    } catch (loadError) {
      const message = loadError instanceof Error ? loadError.message : 'Failed to load My Mind folder tree';
      setError(message);
    } finally {
      setLoadingDirs((prev) => {
        const next = new Set(prev);
        next.delete(path);
        return next;
      });
    }
  }, []);

  const resetTreeState = useCallback(() => {
    setTreeEntries({});
    setExpandedDirs(new Set<string>(['']));
    setSelectedFilePath('');
    setSelectedFileContent('');
    setSavedFileContent('');
    setMarkdownMode('preview');
    // Clear stored state when root folder changes
    try {
      localStorage.removeItem(EXPANDED_DIRS_STORAGE_KEY);
      localStorage.removeItem(SELECTED_FILE_STORAGE_KEY);
    } catch {
      // ignore storage errors
    }
  }, []);

  const loadConfig = useCallback(async () => {
    setIsLoadingConfig(true);
    setError(null);
    try {
      const response = await getMindConfig();
      const configuredRoot = response.root_folder || '';
      setRootFolder(configuredRoot);

      if (configuredRoot !== '') {
        // Load stored state before resetting
        const storedExpanded = readStoredExpandedDirs();
        const storedFile = readStoredSelectedFile();

        resetTreeState();
        await loadTree('');

        // Restore expanded directories - load tree for each
        const expandedArray = Array.from(storedExpanded).filter((p) => p !== '');
        if (expandedArray.length > 0) {
          setExpandedDirs(storedExpanded);
          // Load tree data for all expanded directories
          await Promise.all(expandedArray.map((path) => loadTree(path)));
        }

        // Restore selected file if it exists
        if (storedFile) {
          setSelectedFilePath(storedFile);
          try {
            const fileResponse = await getMindFile(storedFile);
            setSelectedFileContent(fileResponse.content || '');
            setSavedFileContent(fileResponse.content || '');
          } catch (fileError) {
            // File might not exist anymore, clear it
            setSelectedFilePath('');
            setSelectedFileContent('');
            setSavedFileContent('');
            writeStoredSelectedFile('');
          }
        }
      } else {
        resetTreeState();
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load My Mind configuration');
    } finally {
      setIsLoadingConfig(false);
    }
  }, [loadTree, resetTreeState]);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const data = await listProviders();
        setProviders(data);
        const active = data.find((provider) => provider.is_active);
        if (active) {
          setSelectedProvider(active.type);
        }
      } catch (loadError) {
        console.error('Failed to load providers for My Mind session creation:', loadError);
      }
    };
    void loadProviders();
  }, []);

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
      console.error('Failed to load instruction settings in My Mind:', loadError);
    }
  }, []);

  useEffect(() => {
    void refreshInstructionFlags();
  }, [refreshInstructionFlags]);

  useEffect(() => {
    localStorage.setItem(TREE_PANEL_WIDTH_STORAGE_KEY, String(treePanelWidth));
  }, [treePanelWidth]);

  useEffect(() => {
    writeStoredExpandedDirs(expandedDirs);
  }, [expandedDirs]);

  useEffect(() => {
    writeStoredSelectedFile(selectedFilePath);
  }, [selectedFilePath]);

  useEffect(() => {
    setIsFileActionsMenuOpen(false);
  }, [selectedFilePath]);

  useEffect(() => {
    if (!isFileActionsMenuOpen) {
      return;
    }

    const handleDocumentPointerDown = (event: PointerEvent) => {
      if (!fileActionsMenuRef.current) {
        return;
      }
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

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!treeResizeStartRef.current) {
        return;
      }

      const deltaX = event.clientX - treeResizeStartRef.current.startX;
      const nextWidth = treeResizeStartRef.current.startWidth + deltaX;
      const boundedWidth = Math.min(MAX_TREE_PANEL_WIDTH, Math.max(MIN_TREE_PANEL_WIDTH, nextWidth));
      setTreePanelWidth(Math.round(boundedWidth));
    };

    const handlePointerUp = () => {
      treeResizeStartRef.current = null;
      document.body.classList.remove('mind-resizing');
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      document.body.classList.remove('mind-resizing');
      document.body.style.userSelect = '';
    };
  }, []);

  const loadBrowse = useCallback(async (path: string) => {
    setIsLoadingBrowse(true);
    setError(null);
    try {
      const response = await browseMindDirectories(path);
      setBrowsePath(response.path);
      setBrowseEntries(response.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to browse directories');
    } finally {
      setIsLoadingBrowse(false);
    }
  }, []);

  const openPicker = async () => {
    setIsPickerOpen(true);
    await loadBrowse(browsePath);
  };

  const closePicker = () => {
    setIsPickerOpen(false);
  };

  const handlePickCurrentFolder = async () => {
    if (browsePath.trim() === '') {
      return;
    }

    setError(null);
    try {
      const response = await updateMindConfig(browsePath);
      setRootFolder(response.root_folder || '');
      resetTreeState();
      setIsPickerOpen(false);
      await loadTree('');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save My Mind root folder');
    }
  };

  const toggleDirectory = async (path: string) => {
    const isExpanded = expandedDirs.has(path);
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (isExpanded) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });

    if (!isExpanded && !treeEntries[path]) {
      await loadTree(path);
    }
  };

  const openFile = useCallback(async (path: string) => {
    setSelectedFilePath(path);
    setIsLoadingFile(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await getMindFile(path);
      setSelectedFileContent(response.content || '');
      setSavedFileContent(response.content || '');
    } catch (loadError) {
      setSelectedFileContent('');
      setSavedFileContent('');
      setError(loadError instanceof Error ? loadError.message : 'Failed to load markdown file');
    } finally {
      setIsLoadingFile(false);
    }
  }, []);

  const expandTreePath = useCallback(async (relativePath: string) => {
    const parentPath = dirname(relativePath);
    const parentParts = parentPath.split('/').filter(Boolean);
    const pathsToLoad: string[] = [''];
    let current = '';
    for (const part of parentParts) {
      current = current ? `${current}/${part}` : part;
      pathsToLoad.push(current);
    }

    setExpandedDirs((prev) => {
      const next = new Set(prev);
      for (const path of pathsToLoad) {
        if (path !== '') {
          next.add(path);
        }
      }
      return next;
    });

    for (const path of pathsToLoad) {
      await loadTree(path);
    }
  }, [loadTree]);

  const saveCurrentFile = async () => {
    if (selectedFilePath.trim() === '') {
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSavingFile(true);
    try {
      const response = await saveMindFile(selectedFilePath, selectedFileContent);
      const nextContent = response.content || '';
      setSelectedFileContent(nextContent);
      setSavedFileContent(nextContent);
      await loadTree(dirname(selectedFilePath));
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save markdown file');
    } finally {
      setIsSavingFile(false);
    }
  };

  const deleteCurrentFile = async () => {
    if (selectedFilePath.trim() === '') {
      return;
    }

    const deletePath = selectedFilePath;
    const confirmMessage = hasUnsavedChanges
      ? `Delete "${deletePath}"? Unsaved changes will be lost.`
      : `Delete "${deletePath}"?`;
    if (!window.confirm(confirmMessage)) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsDeletingFile(true);
    try {
      await deleteMindFile(deletePath);
      const parentPath = dirname(deletePath);
      setSelectedFilePath('');
      setSelectedFileContent('');
      setSavedFileContent('');
      setMarkdownMode('preview');
      await loadTree(parentPath);
      setSuccess(`Deleted ${deletePath}.`);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete markdown file');
    } finally {
      setIsDeletingFile(false);
    }
  };

  const handleFileDrop = async (filePath: string, targetFolderPath: string) => {
    if (isMovingFile) return;
    
    const fileName = filePath.split('/').pop() || '';
    const newPath = targetFolderPath === '' ? fileName : `${targetFolderPath}/${fileName}`;
    
    if (filePath === newPath) {
      return;
    }

    setError(null);
    setSuccess(null);
    setIsMovingFile(true);
    
    try {
      await moveMindFile(filePath, newPath);
      const oldParent = dirname(filePath);
      const newParent = dirname(newPath);
      
      await loadTree(oldParent);
      if (oldParent !== newParent) {
        await loadTree(newParent);
      }
      
      if (selectedFilePath === filePath) {
        setSelectedFilePath(newPath);
      }
      
;
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : 'Failed to move file');
    } finally {
      setIsMovingFile(false);
      setDraggedFilePath(null);
      setDropTargetPath(null);
    }
  };

  const createNewFolder = async () => {
    const suggestedBase = selectedFilePath ? dirname(selectedFilePath) : '';
    const suggestedPath = suggestedBase ? `${suggestedBase}/new-folder` : 'new-folder';
    const input = window.prompt('New folder path (relative to My Mind root):', suggestedPath);
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
      await createMindFolder(normalizedPath);
      const parentPath = dirname(normalizedPath);
      await loadTree(parentPath);
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        next.add(normalizedPath);
        return next;
      });
      setSuccess(`Created folder: ${normalizedPath}`);
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create folder');
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
    if (!renamingPath || isRenaming) return;
    
    const newName = renameValue.trim();
    if (newName === '' || newName === renamingPath.split('/').pop()) {
      cancelRename();
      return;
    }

    setError(null);
    setSuccess(null);
    setIsRenaming(true);
    
    try {
      const result = await renameMindEntry(renamingPath, newName);
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
    } catch (renameError) {
      setError(renameError instanceof Error ? renameError.message : 'Failed to rename');
    } finally {
      setIsRenaming(false);
      cancelRename();
    }
  };

  const createNewFile = async () => {
    const suggestedBase = selectedFilePath ? dirname(selectedFilePath) : '';
    const suggestedPath = suggestedBase ? `${suggestedBase}/new-note.md` : 'new-note.md';
    const input = window.prompt('New markdown file path (relative to My Mind root):', suggestedPath);
    if (input === null) {
      return;
    }

    const normalizedPath = normalizeMindPath(input.trim());
    if (normalizedPath === '') {
      setError('File path is required.');
      return;
    }
    if (!normalizedPath.toLowerCase().endsWith('.md') && !normalizedPath.toLowerCase().endsWith('.markdown')) {
      setError('Only markdown files can be created in My Mind.');
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSavingFile(true);
    try {
      await saveMindFile(normalizedPath, '');
      const parentPath = dirname(normalizedPath);
      const parentParts = parentPath.split('/').filter(Boolean);
      const pathsToLoad: string[] = [''];
      let current = '';
      for (const part of parentParts) {
        current = current ? `${current}/${part}` : part;
        pathsToLoad.push(current);
      }

      setExpandedDirs((prev) => {
        const next = new Set(prev);
        for (const path of pathsToLoad) {
          if (path !== '') {
            next.add(path);
          }
        }
        return next;
      });
      for (const path of pathsToLoad) {
        await loadTree(path);
      }
      await openFile(normalizedPath);
      setMarkdownMode('source');
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : 'Failed to create markdown file');
    } finally {
      setIsSavingFile(false);
    }
  };

  const openSessionDialogForPath = (type: 'folder' | 'file', relativePath: string) => {
    if (!rootFolder) {
      setError('Configure a My Mind root folder before creating sessions from My Mind.');
      return;
    }

    const fullPath = joinMindAbsolutePath(rootFolder, relativePath);
    setSessionTargetLabel(`${type === 'folder' ? 'Folder' : 'File'}: ${fullPath}`);
    setIsSessionContextExpanded(false);
    setSessionContextMessage(buildMindSessionContext(type, fullPath));
    setInlineSession(null);
    setInlineMessages([]);
    setIsInlineSessionLoading(false);
    setIsSessionPanelOpen(true);
  };

  const closeSessionDialog = () => {
    setIsSessionPanelOpen(false);
    setIsSessionContextExpanded(false);
    setSessionTargetLabel('');
    setSessionContextMessage('');
    setInlineSession(null);
    setInlineMessages([]);
    setIsInlineSessionLoading(false);
  };

  const ensureMyMindProject = useCallback(async (): Promise<string> => {
    const projectName = 'My Mind';
    const expectedFolder = rootFolder.trim() || undefined;

    const projects = await listProjects();
    const existing = projects.find((project) => project.name.trim().toLowerCase() === projectName.toLowerCase());

    if (existing) {
      const needsFolderSync = existing.folder !== expectedFolder;

      if (needsFolderSync) {
        await updateProject(existing.id, { folder: expectedFolder });
      }
      return existing.id;
    }

    const created = await createProject({
      name: projectName,
      folder: expectedFolder,
    });
    return created.id;
  }, [rootFolder]);

  const handleInlineStreamEvent = (event: ChatStreamEvent, targetSessionId: string) => {
    if (event.type === 'assistant_delta') {
      if (!event.delta) {
        return;
      }
      setInlineMessages((prev) => {
        const next = [...prev];
        if (next.length === 0 || next[next.length - 1].role !== 'assistant') {
          next.push({
            role: 'assistant',
            content: event.delta,
            timestamp: new Date().toISOString(),
          });
          return next;
        }
        const last = next[next.length - 1];
        next[next.length - 1] = { ...last, content: `${last.content}${event.delta}` };
        return next;
      });
      return;
    }

    if (event.type === 'status') {
      setInlineSession((prev) => {
        if (!prev || prev.id !== targetSessionId) {
          return prev;
        }
        return { ...prev, status: event.status || prev.status };
      });
      return;
    }

    if (event.type === 'done') {
      setInlineMessages(event.messages || []);
      setInlineSession((prev) => {
        if (!prev || prev.id !== targetSessionId) {
          return prev;
        }
        return { ...prev, status: event.status || prev.status };
      });
      setIsInlineSessionLoading(false);
      void getSession(targetSessionId)
        .then((fresh) => {
          setInlineSession(fresh);
          setInlineMessages(fresh.messages || event.messages || []);
        })
        .catch((refreshError) => {
          console.error('Failed to refresh inline My Mind session:', refreshError);
        });
      return;
    }

    if (event.type === 'error') {
      setError(event.error || 'Failed to send initial My Mind session context');
      const nextStatus = typeof event.status === 'string' ? event.status.trim() : '';
      if (nextStatus !== '') {
        setInlineSession((prev) => (prev && prev.id === targetSessionId ? { ...prev, status: nextStatus } : prev));
      }
      setIsInlineSessionLoading(false);
    }
  };

  const sendInlineMessageWithStreaming = async (targetSessionId: string, message: string) => {
    const trimmedMessage = message.trim();
    if (trimmedMessage === '') {
      return;
    }

    const now = new Date().toISOString();
    setInlineMessages((prev) => [
      ...prev,
      { role: 'user', content: trimmedMessage, timestamp: now },
      { role: 'assistant', content: '', timestamp: now },
    ]);
    setIsInlineSessionLoading(true);
    setError(null);

    const controller = new AbortController();
    activeInlineStreamAbortRef.current = controller;

    try {
      for await (const event of sendMessageStream(targetSessionId, trimmedMessage, [], controller.signal)) {
        handleInlineStreamEvent(event, targetSessionId);
      }
    } catch (streamError) {
      const isAbort = streamError instanceof DOMException && streamError.name === 'AbortError';
      if (!isAbort) {
        console.error('Failed to send inline My Mind session message:', streamError);
        setError(streamError instanceof Error ? streamError.message : 'Failed to send message');
      }
      setIsInlineSessionLoading(false);
    } finally {
      if (activeInlineStreamAbortRef.current === controller) {
        activeInlineStreamAbortRef.current = null;
      }
    }
  };

  const handleCreateMindSession = async (userMessage: string) => {
    const userPrompt = userMessage.trim();
    if (userPrompt === '') {
      setError('Describe what you want to do with this file/folder.');
      return;
    }
    const context = sessionContextMessage.trim();
    const message = context === ''
      ? userPrompt
      : `${userPrompt}\n\nContext:\n${context}`;

    setError(null);
    setSuccess(null);
    setIsCreatingSession(true);

    try {
      const projectId = await ensureMyMindProject();
      const created = await createSession({
        agent_id: 'build',
        provider: selectedProvider || undefined,
        project_id: projectId,
      });
      const now = new Date().toISOString();
      setInlineSession({
        id: created.id,
        agent_id: 'build',
        provider: selectedProvider || undefined,
        title: 'My Mind Session',
        status: 'running',
        created_at: now,
        updated_at: now,
      });
      setInlineMessages([]);
      await sendInlineMessageWithStreaming(created.id, message);
    } catch (createError) {
      console.error('Failed to create session from My Mind:', createError);
      setError(createError instanceof Error ? createError.message : 'Failed to create session from My Mind');
      setIsInlineSessionLoading(false);
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleSendInlineMessage = async (message: string) => {
    if (!inlineSession || isInlineSessionLoading) {
      return;
    }
    await sendInlineMessageWithStreaming(inlineSession.id, message);
  };

  const handleCancelInlineSession = async () => {
    if (!inlineSession) {
      return;
    }
    activeInlineStreamAbortRef.current?.abort();
    setIsInlineSessionLoading(false);

    try {
      await cancelSessionRun(inlineSession.id);
      const fresh = await getSession(inlineSession.id);
      setInlineSession(fresh);
      setInlineMessages(fresh.messages || []);
      setError('Request was canceled before completion.');
    } catch (cancelError) {
      console.error('Failed to cancel inline My Mind session run:', cancelError);
      setError(cancelError instanceof Error ? cancelError.message : 'Failed to cancel session run');
    }
  };

  useEffect(() => {
    if (!inlineSession || isInlineSessionLoading) {
      return;
    }
    if (isTerminalSessionStatus(inlineSession.status)) {
      return;
    }

    const sessionId = inlineSession.id;
    const interval = window.setInterval(() => {
      void getSession(sessionId)
        .then((fresh) => {
          setInlineSession(fresh);
          setInlineMessages((prev) => {
            if ((fresh.messages || []).length === 0 && prev.length > 0) {
              return prev;
            }
            return fresh.messages || [];
          });
        })
        .catch((pollError) => {
          console.error('Failed to poll inline My Mind session:', pollError);
        });
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [inlineSession, isInlineSessionLoading]);

  const markdownHtml = useMemo(() => renderMarkdownToHtml(selectedFileContent), [selectedFileContent]);
  const hasUnsavedChanges = selectedFilePath !== '' && selectedFileContent !== savedFileContent;
  const selectedFilePathNormalized = selectedFilePath.trim();
  const selectedFileAbsolutePath = rootFolder.trim() !== '' && selectedFilePathNormalized !== ''
    ? joinMindAbsolutePath(rootFolder, selectedFilePathNormalized)
    : '';
  const isSelectedFileAgentInstruction = selectedFilePathNormalized !== ''
    && (
      agentInstructionFilePaths.has(selectedFilePathNormalized)
      || (selectedFileAbsolutePath !== '' && agentInstructionFilePaths.has(selectedFileAbsolutePath))
    );

  const addSelectedFileToAgentInstructions = async () => {
    if (selectedFilePathNormalized === '') {
      return;
    }
    if (rootFolder.trim() === '') {
      setError('Configure My Mind root folder first.');
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
    if (selectedFileAbsolutePath.trim() === '') {
      return;
    }
    setIsFileActionsMenuOpen(false);
    navigate(`/agent/jobs/new?prefillInstructionFile=${encodeURIComponent(selectedFileAbsolutePath)}`);
  };

  useEffect(() => {
    const requestedOpenPath = (searchParams.get('openFile') || '').trim();
    if (requestedOpenPath === '' || rootFolder.trim() === '') {
      return;
    }
    if (handledOpenFileQueryRef.current === requestedOpenPath) {
      return;
    }

    const relativePath = toMindRelativePath(rootFolder, requestedOpenPath);
    handledOpenFileQueryRef.current = requestedOpenPath;

    if (relativePath === '') {
      // File is outside root folder - open it directly by absolute path
      const openAbsoluteFromQuery = async () => {
        try {
          const response = await getMindFile(requestedOpenPath);
          setSelectedFilePath(requestedOpenPath);
          setSelectedFileContent(response.content);
          setSavedFileContent(response.content);
          
          const nextParams = new URLSearchParams(searchParams);
          nextParams.delete('openFile');
          setSearchParams(nextParams, { replace: true });
        } catch (loadError) {
          setError(loadError instanceof Error ? loadError.message : 'Failed to load file');
        }
      };
      void openAbsoluteFromQuery();
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

  useEffect(() => {
    if (!pendingAnchor || isLoadingFile || markdownMode !== 'preview') {
      return;
    }
    const id = decodeURIComponent(pendingAnchor);
    const target = document.getElementById(id);
    if (target) {
      target.scrollIntoView({ block: 'start' });
    }
    setPendingAnchor('');
  }, [pendingAnchor, isLoadingFile, markdownMode, markdownHtml]);

  const handlePreviewClick = async (event: React.MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a');
    if (!anchor) {
      return;
    }

    const rawHref = (anchor.getAttribute('href') || '').trim();
    if (rawHref === '') {
      return;
    }

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
      setError('Only markdown links are supported in My Mind preview.');
      return;
    }

    await openFile(resolvedPath);
    if (rawHash !== '') {
      setPendingAnchor(rawHash);
    }
  };

  const renderTree = (path: string, depth = 0): ReactElement => {
    const entries = treeEntries[path] || [];

    return (
      <div>
        {entries.map((entry) => {
          const isBeingRenamed = renamingPath === entry.path;
          
          if (entry.type === 'directory') {
            const isExpanded = expandedDirs.has(entry.path);
            const isLoading = loadingDirs.has(entry.path);
            const isDropTarget = dropTargetPath === entry.path;
            const isDraggingFolder = draggedFilePath === entry.path;
            const isDescendantOfDragged = draggedFilePath && entry.path.startsWith(draggedFilePath + '/');
            return (
              <div key={entry.path}>
                <div
                  className={`mind-tree-row ${isDropTarget ? 'mind-tree-drop-target' : ''} ${isDraggingFolder ? 'mind-tree-dragging' : ''}`}
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
                    <div className="mind-tree-item mind-tree-directory" style={{ paddingLeft: `${12 + depth * 18}px` }}>
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
                      className="mind-tree-item mind-tree-directory"
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
                <div className="mind-tree-item mind-tree-file" style={{ paddingLeft: `${12 + depth * 18}px` }}>
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
                  className={`mind-tree-item mind-tree-file ${selectedFilePath === entry.path ? 'active' : ''}`}
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

  const handleStartTreeResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    treeResizeStartRef.current = {
      startX: event.clientX,
      startWidth: treePanelWidth,
    };
    document.body.classList.add('mind-resizing');
    document.body.style.userSelect = 'none';
  };

  if (isLoadingConfig) {
    return (
      <div className="page-shell">
        <div className="page-header">
          <h1>My Mind</h1>
        </div>
        <div className="page-content">
          <div className="sessions-loading">Loading My Mind...</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header mind-page-header">
        <h1>My Mind</h1>
        {rootFolder !== '' ? (
          <div className="mind-header-controls">
            <div className="mind-root-path">Root: {rootFolder}</div>
            <div className="mind-toolbar-actions">
              <button type="button" className="settings-add-btn" onClick={() => void createNewFile()} disabled={isSavingFile}>
                New file
              </button>
              <button type="button" className="settings-add-btn" onClick={() => void createNewFolder()}>
                New folder
              </button>
              <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                Change root folder
              </button>
            </div>
          </div>
        ) : null}
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

      <div className="page-content mind-content">
        {rootFolder === '' ? (
          <div className="mind-empty-state">
            <p>Configure your main root folder for My Mind to start browsing your personal markdown docs.</p>
            <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
              Configure root folder
            </button>
          </div>
        ) : (
          <>
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
                {renderTree('')}
              </div>
              <div
                className="mind-tree-resize-handle"
                role="separator"
                aria-orientation="vertical"
                aria-label="Resize My Mind file tree panel"
                onPointerDown={handleStartTreeResize}
              />
              <div className="mind-viewer-panel">
                <div className="mind-viewer-header">
                  <div className="mind-viewer-path">{selectedFilePath || 'Select a markdown file from the tree'}</div>
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
                  {!isLoadingFile && !selectedFilePath ? (
                  <EmptyState className="sessions-empty">
                    <EmptyStateTitle>No file selected.</EmptyStateTitle>
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
          </>
        )}

        {isPickerOpen ? (
          <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose My Mind root folder">
            <div className="mind-picker-dialog">
              <h2>Choose My Mind root folder</h2>
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

        {isSessionPanelOpen ? (
          <div
            className={`mind-session-panel ${inlineSession ? 'with-inline-session' : 'create-mode'}`}
            role="region"
            aria-label="Create My Mind session"
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
                    projectId={inlineSession.project_id || null}
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
    </div>
  );
}

export default MyMindView;
