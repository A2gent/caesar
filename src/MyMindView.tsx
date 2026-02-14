import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  browseMindDirectories,
  createProject,
  createSession,
  getSettings,
  getMindConfig,
  getMindFile,
  listMindTree,
  listProjects,
  listProviders,
  saveMindFile,
  sendMessage,
  type LLMProviderType,
  type MindTreeEntry,
  type ProviderConfig,
  updateMindConfig,
  updateProject,
} from './api';
import { THINKING_FILE_PATH_SETTING_KEY } from './thinking';

type MarkdownMode = 'preview' | 'source';

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

function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inList = false;
  let inCodeFence = false;
  const headingCounts = new Map<string, number>();

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const line of lines) {
    if (line.startsWith('```')) {
      closeList();
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
      continue;
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
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [rootFolder, setRootFolder] = useState('');
  const [error, setError] = useState<string | null>(null);

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
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');
  const [pendingAnchor, setPendingAnchor] = useState('');

  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');

  const [isSessionDialogOpen, setIsSessionDialogOpen] = useState(false);
  const [sessionContextMessage, setSessionContextMessage] = useState('');
  const [sessionTargetLabel, setSessionTargetLabel] = useState('');
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [thinkingFileConfigured, setThinkingFileConfigured] = useState(false);

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
  }, []);

  const loadConfig = useCallback(async () => {
    setIsLoadingConfig(true);
    setError(null);
    try {
      const response = await getMindConfig();
      const configuredRoot = response.root_folder || '';
      setRootFolder(configuredRoot);
      resetTreeState();
      if (configuredRoot !== '') {
        await loadTree('');
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

  useEffect(() => {
    const loadThinkingSettings = async () => {
      try {
        const settings = await getSettings();
        setThinkingFileConfigured((settings[THINKING_FILE_PATH_SETTING_KEY] || '').trim() !== '');
      } catch (loadError) {
        console.error('Failed to load Thinking settings in My Mind:', loadError);
      }
    };
    void loadThinkingSettings();
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

  const openFile = async (path: string) => {
    setSelectedFilePath(path);
    setIsLoadingFile(true);
    setError(null);
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
  };

  const saveCurrentFile = async () => {
    if (selectedFilePath.trim() === '') {
      return;
    }
    setError(null);
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
    setSessionContextMessage(buildMindSessionContext(type, fullPath));
    setIsSessionDialogOpen(true);
  };

  const closeSessionDialog = () => {
    setIsSessionDialogOpen(false);
    setSessionTargetLabel('');
    setSessionContextMessage('');
  };

  const ensureMyMindProject = useCallback(async (): Promise<string> => {
    const projectName = 'My Mind';
    const expectedFolders = rootFolder.trim() ? [rootFolder.trim()] : [];

    const projects = await listProjects();
    const existing = projects.find((project) => project.name.trim().toLowerCase() === projectName.toLowerCase());

    if (existing) {
      const existingFolders = [...(existing.folders || [])].sort();
      const nextFolders = [...expectedFolders].sort();
      const needsFolderSync =
        existingFolders.length !== nextFolders.length ||
        existingFolders.some((value, index) => value !== nextFolders[index]);

      if (needsFolderSync) {
        await updateProject(existing.id, { folders: expectedFolders });
      }
      return existing.id;
    }

    const created = await createProject({
      name: projectName,
      folders: expectedFolders,
    });
    return created.id;
  }, [rootFolder]);

  const handleCreateMindSession = async () => {
    const message = sessionContextMessage.trim();
    if (message === '') {
      setError('Session context cannot be empty.');
      return;
    }

    setError(null);
    setIsCreatingSession(true);

    try {
      const projectId = await ensureMyMindProject();
      const created = await createSession({
        agent_id: 'build',
        provider: selectedProvider || undefined,
        project_id: projectId,
      });
      await sendMessage(created.id, message);
      closeSessionDialog();
      navigate(`/chat/${created.id}`);
    } catch (createError) {
      console.error('Failed to create session from My Mind:', createError);
      setError(createError instanceof Error ? createError.message : 'Failed to create session from My Mind');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const markdownHtml = useMemo(() => renderMarkdownToHtml(selectedFileContent), [selectedFileContent]);
  const hasUnsavedChanges = selectedFilePath !== '' && selectedFileContent !== savedFileContent;

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
      <div className="page-header">
        <h1>My Mind</h1>
      </div>

      {error ? (
        <div className="error-banner">
          {error}
          <button type="button" className="error-dismiss" onClick={() => setError(null)}>×</button>
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
            <div className="mind-toolbar">
              <div className="mind-root-path">Root: {rootFolder}</div>
              <div className="mind-toolbar-actions">
                <button type="button" className="settings-add-btn" onClick={() => void createNewFile()} disabled={isSavingFile}>
                  New file
                </button>
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Change root folder
                </button>
              </div>
            </div>

            <div className="mind-layout">
              <div className="mind-tree-panel">{renderTree('')}</div>
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
                    {selectedFilePath && !thinkingFileConfigured ? (
                      <button
                        type="button"
                        className="mind-thinking-btn"
                        onClick={() => navigate(`/thinking?prefillFile=${encodeURIComponent(selectedFilePath)}`)}
                        title="Use this file for Thinking instructions"
                      >
                        Use for Thinking
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className="settings-save-btn"
                      onClick={() => void saveCurrentFile()}
                      disabled={!selectedFilePath || !hasUnsavedChanges || isLoadingFile || isSavingFile}
                      title={hasUnsavedChanges ? 'Save changes' : 'No changes to save'}
                    >
                      {isSavingFile ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      type="button"
                      className={`mind-mode-btn ${markdownMode === 'preview' ? 'active' : ''}`}
                      onClick={() => setMarkdownMode('preview')}
                      disabled={!selectedFilePath}
                    >
                      Preview
                    </button>
                    <button
                      type="button"
                      className={`mind-mode-btn ${markdownMode === 'source' ? 'active' : ''}`}
                      onClick={() => setMarkdownMode('source')}
                      disabled={!selectedFilePath}
                    >
                      Source
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

        {isSessionDialogOpen ? (
          <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Create My Mind session">
            <div className="mind-picker-dialog mind-session-dialog">
              <h2>Create session</h2>
              <div className="mind-session-target">{sessionTargetLabel}</div>
              <label className="mind-session-label" htmlFor="mind-session-context">Initial context</label>
              <textarea
                id="mind-session-context"
                className="mind-session-textarea"
                value={sessionContextMessage}
                onChange={(event) => setSessionContextMessage(event.target.value)}
                disabled={isCreatingSession}
              />
              <div className="mind-session-controls">
                {providers.length > 0 ? (
                  <label className="chat-provider-select">
                    <select
                      value={selectedProvider}
                      onChange={(event) => setSelectedProvider(event.target.value as LLMProviderType)}
                      title="Provider"
                      aria-label="Provider"
                      disabled={isCreatingSession}
                    >
                      {providers.map((provider) => (
                        <option key={provider.type} value={provider.type}>
                          {provider.display_name}
                        </option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button type="button" className="settings-save-btn" onClick={() => void handleCreateMindSession()} disabled={isCreatingSession}>
                  {isCreatingSession ? 'Creating...' : 'Create session'}
                </button>
                <button type="button" className="settings-remove-btn" onClick={closeSessionDialog} disabled={isCreatingSession}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default MyMindView;
