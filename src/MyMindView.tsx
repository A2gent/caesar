import { useCallback, useEffect, useMemo, useState } from 'react';
import type { ReactElement } from 'react';
import {
  browseMindDirectories,
  getMindConfig,
  getMindFile,
  listMindTree,
  updateMindConfig,
  type MindTreeEntry,
} from './api';

type MarkdownMode = 'preview' | 'source';

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
  text = text.replace(/\[([^\]]+)\]\(([^\)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer noopener">$1</a>');
  return text;
}

function renderMarkdownToHtml(markdown: string): string {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const html: string[] = [];
  let inList = false;
  let inCodeFence = false;

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
      html.push(`<h${level}>${renderInlineMarkdown(headingMatch[2])}</h${level}>`);
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

function MyMindView() {
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
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [markdownMode, setMarkdownMode] = useState<MarkdownMode>('preview');

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
    } catch (loadError) {
      setSelectedFileContent('');
      setError(loadError instanceof Error ? loadError.message : 'Failed to load markdown file');
    } finally {
      setIsLoadingFile(false);
    }
  };

  const markdownHtml = useMemo(() => renderMarkdownToHtml(selectedFileContent), [selectedFileContent]);

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
                {isExpanded ? renderTree(entry.path, depth + 1) : null}
              </div>
            );
          }

          return (
            <button
              key={entry.path}
              type="button"
              className={`mind-tree-item mind-tree-file ${selectedFilePath === entry.path ? 'active' : ''}`}
              style={{ paddingLeft: `${12 + depth * 18}px` }}
              onClick={() => void openFile(entry.path)}
            >
              <span className="mind-tree-icon" aria-hidden="true">📄</span>
              <span className="mind-tree-label">{entry.name}</span>
            </button>
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
              <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                Change root folder
              </button>
            </div>

            <div className="mind-layout">
              <div className="mind-tree-panel">{renderTree('')}</div>
              <div className="mind-viewer-panel">
                <div className="mind-viewer-header">
                  <div className="mind-viewer-path">{selectedFilePath || 'Select a markdown file from the tree'}</div>
                  <div className="mind-viewer-mode">
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
                    <pre className="mind-markdown-source">{selectedFileContent}</pre>
                  ) : null}
                  {!isLoadingFile && selectedFilePath && markdownMode === 'preview' ? (
                    <div className="mind-markdown-preview" dangerouslySetInnerHTML={{ __html: markdownHtml }} />
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
      </div>
    </div>
  );
}

export default MyMindView;
