import { useCallback, useEffect, useMemo, useState } from 'react';
import { EmptyState, EmptyStateTitle } from './EmptyState';
import { listProjectTree, type MindTreeEntry } from './api';

interface SoulFilePickerDialogProps {
  open: boolean;
  onClose: () => void;
  onPick: (absolutePath: string, relativePath: string) => void;
  title?: string;
}

function joinSoulPath(rootFolder: string, relativePath: string): string {
  const cleanRoot = rootFolder.trim().replace(/[\\/]+$/, '');
  const cleanRelative = relativePath.trim().replace(/^[\\/]+/, '');
  if (cleanRelative === '') {
    return cleanRoot;
  }
  const separator = cleanRoot.includes('\\') ? '\\' : '/';
  const normalizedRelative = cleanRelative.replace(/[\\/]+/g, separator);
  return `${cleanRoot}${separator}${normalizedRelative}`;
}

function parentPath(path: string): string {
  const trimmed = path.trim().replace(/\/+$/, '');
  if (trimmed === '') {
    return '';
  }
  const index = trimmed.lastIndexOf('/');
  if (index < 0) {
    return '';
  }
  return trimmed.slice(0, index);
}

function SoulFilePickerDialog({
  open,
  onClose,
  onPick,
  title = 'Choose File From Soul',
}: SoulFilePickerDialogProps) {
  const [path, setPath] = useState('');
  const [entries, setEntries] = useState<MindTreeEntry[]>([]);
  const [rootFolder, setRootFolder] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadPath = useCallback(async (nextPath: string) => {
    setLoading(true);
    setError(null);
    try {
      const response = await listProjectTree('system-soul', nextPath);
      setPath(response.path || '');
      setEntries(response.entries || []);
      setRootFolder(response.root_folder || '');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load Soul files');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void loadPath('');
  }, [open, loadPath]);

  const sortedEntries = useMemo(() => {
    return [...entries].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1;
      }
      return a.name.localeCompare(b.name);
    });
  }, [entries]);

  if (!open) return null;

  return (
    <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mind-picker-dialog">
        <h2>{title}</h2>
        <div className="mind-picker-path">{rootFolder ? joinSoulPath(rootFolder, path) : 'Loading...'}</div>
        {error ? <p className="settings-error">{error}</p> : null}
        <div className="mind-picker-actions">
          <button
            type="button"
            className="settings-add-btn"
            onClick={() => void loadPath(parentPath(path))}
            disabled={loading || path.trim() === ''}
          >
            Up
          </button>
          <button type="button" className="settings-remove-btn" onClick={onClose} disabled={loading}>
            Cancel
          </button>
        </div>
        <div className="mind-picker-list">
          {loading ? <div className="sessions-loading">Loading Soul files...</div> : null}
          {!loading && sortedEntries.length === 0 ? (
            <EmptyState className="sessions-empty">
              <EmptyStateTitle>No files found.</EmptyStateTitle>
            </EmptyState>
          ) : null}
          {!loading
            ? sortedEntries.map((entry) => (
              <button
                key={entry.path}
                type="button"
                className="mind-picker-item"
                onClick={() => {
                  if (entry.type === 'directory') {
                    void loadPath(entry.path);
                    return;
                  }
                  if (!rootFolder) return;
                  onPick(joinSoulPath(rootFolder, entry.path), entry.path);
                }}
              >
                <span className="mind-tree-icon" aria-hidden="true">{entry.type === 'directory' ? '📁' : '📄'}</span>
                <span>{entry.name}</span>
              </button>
            ))
            : null}
        </div>
      </div>
    </div>
  );
}

export default SoulFilePickerDialog;

