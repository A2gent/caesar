import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { FileDiff, type FileDiffMetadata } from '@pierre/diffs/react';
import { parsePatchFiles } from '@pierre/diffs';
import {
  commitProjectGit,
  generateProjectGitCommitMessage,
  getProjectGitFileDiff,
  getProjectGitStatus,
  stageProjectGitFile,
  unstageProjectGitFile,
  type ProjectGitChangedFile,
} from '../api';

const TERMINAL_SESSION_STATUSES = new Set(['completed', 'failed']);

export function isTerminalSessionStatusValue(status: string | null | undefined): boolean {
  const normalized = (status || '').trim().toLowerCase();
  return TERMINAL_SESSION_STATUSES.has(normalized);
}

type InlineSessionGitSummaryProps = {
  projectId: string;
  sessionStatus: string;
  isWorkflowSession?: boolean;
  onOpenFile: (path: string) => void;
};

type FileDiffState = {
  loading: boolean;
  error: string;
  rawDiff: string;
};

function mapGitStatusLabel(file: ProjectGitChangedFile): string {
  if (file.untracked) return 'Untracked';
  const status = (file.status || '').trim().toUpperCase();
  switch (status) {
    case 'A':
      return 'Added';
    case 'M':
      return 'Modified';
    case 'D':
      return 'Deleted';
    case 'R':
      return 'Renamed';
    case 'C':
      return 'Copied';
    default:
      return status || 'Changed';
  }
}

function parseDiffFile(raw: string): FileDiffMetadata | null {
  if (!raw) return null;
  try {
    const parsed = parsePatchFiles(raw);
    const files = parsed.flatMap((patch) => patch.files || []) as FileDiffMetadata[];
    return files[0] || null;
  } catch {
    return null;
  }
}

export default function InlineSessionGitSummary(props: InlineSessionGitSummaryProps) {
  const { projectId, sessionStatus, onOpenFile, isWorkflowSession = false } = props;
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [files, setFiles] = useState<ProjectGitChangedFile[]>([]);
  const [openDiffs, setOpenDiffs] = useState<Record<string, boolean>>({});
  const [diffs, setDiffs] = useState<Record<string, FileDiffState>>({});
  const [commitMessage, setCommitMessage] = useState('');
  const [isCommitting, setIsCommitting] = useState(false);
  const [isSuggesting, setIsSuggesting] = useState(false);
  const [commitError, setCommitError] = useState('');
  const [commitSuccess, setCommitSuccess] = useState('');
  const requestRef = useRef(0);

  const canShow = useMemo(() => {
    return Boolean(projectId && isTerminalSessionStatusValue(sessionStatus));
  }, [projectId, sessionStatus]);

  const stagedCount = useMemo(() => files.filter((f) => f.staged).length, [files]);

  const loadStatus = useCallback(async () => {
    if (!projectId) return;
    const rid = requestRef.current + 1;
    requestRef.current = rid;
    setLoading(true);
    setError('');
    try {
      const status = await getProjectGitStatus(projectId);
      if (rid !== requestRef.current) return;
      setFiles(status.files || []);
    } catch (e) {
      if (rid !== requestRef.current) return;
      setError(e instanceof Error ? e.message : 'Failed to load changed files');
    } finally {
      if (rid !== requestRef.current) return;
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    if (expanded) {
      void loadStatus();
    }
  }, [expanded, loadStatus]);

  const toggleExpanded = useCallback(async () => {
    setExpanded((prev) => !prev);
  }, []);

  const toggleStageFile = useCallback(async (file: ProjectGitChangedFile) => {
    try {
      if (file.staged) {
        await unstageProjectGitFile(projectId, file.path);
      } else {
        await stageProjectGitFile(projectId, file.path);
      }
      await loadStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to update staged state');
    }
  }, [projectId, loadStatus]);

  const toggleFileDiff = useCallback(async (path: string) => {
    const nextOpen = !openDiffs[path];
    setOpenDiffs((prev) => ({ ...prev, [path]: nextOpen }));
    if (!nextOpen) return;
    if (diffs[path]?.rawDiff || diffs[path]?.loading) return;

    setDiffs((prev) => ({ ...prev, [path]: { loading: true, error: '', rawDiff: '' } }));
    try {
      const response = await getProjectGitFileDiff(projectId, path);
      setDiffs((prev) => ({ ...prev, [path]: { loading: false, error: '', rawDiff: response.preview || '' } }));
    } catch (e) {
      setDiffs((prev) => ({
        ...prev,
        [path]: { loading: false, error: e instanceof Error ? e.message : 'Failed to load diff', rawDiff: '' },
      }));
    }
  }, [openDiffs, diffs, projectId]);

  const handleSuggestMessage = useCallback(async () => {
    if (!projectId) return;
    setIsSuggesting(true);
    setCommitError('');
    try {
      const suggestion = await generateProjectGitCommitMessage(projectId);
      setCommitMessage((suggestion || '').trim());
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'Failed to suggest commit message');
    } finally {
      setIsSuggesting(false);
    }
  }, [projectId]);

  const handleCommit = useCallback(async () => {
    if (!projectId) return;
    const message = commitMessage.trim();
    if (!message) {
      setCommitError('Commit message is required');
      return;
    }
    setIsCommitting(true);
    setCommitError('');
    setCommitSuccess('');
    try {
      const result = await commitProjectGit(projectId, message);
      setCommitSuccess(`Committed ${result.files_committed} file(s): ${result.commit}`);
      setCommitMessage('');
      setOpenDiffs({});
      setDiffs({});
      await loadStatus();
    } catch (e) {
      setCommitError(e instanceof Error ? e.message : 'Failed to commit changes');
    } finally {
      setIsCommitting(false);
    }
  }, [projectId, commitMessage, loadStatus]);

  if (!canShow) {
    return null;
  }

  return (
    <details className="session-inline-git-card" open={expanded}>
      <summary className="session-inline-git-summary" onClick={(event) => {
        event.preventDefault();
        void toggleExpanded();
      }}>
        <span>Changed files{files.length > 0 ? ` (${files.length})` : ''}</span>
        {stagedCount > 0 ? <span className="session-inline-git-chip">Staged: {stagedCount}</span> : null}
      </summary>
      {expanded ? (
        <div className="session-inline-git-body">
          {isWorkflowSession ? (
            <p className="session-inline-git-note">Includes changes from workflow child sessions in this project.</p>
          ) : null}

          {loading ? <p className="session-inline-git-empty">Loading changed files…</p> : null}
          {!loading && error ? <p className="session-inline-git-error">{error}</p> : null}
          {!loading && !error && files.length === 0 ? (
            <p className="session-inline-git-empty">No uncommitted changes.</p>
          ) : null}

          {!loading && !error && files.length > 0 ? (
            <div className="session-inline-git-files">
              {files.map((file) => {
                const fileDiff = diffs[file.path];
                const parsedDiff = parseDiffFile(fileDiff?.rawDiff || '');
                return (
                  <div key={file.path} className="session-inline-git-file">
                    <div className="session-inline-git-file-row">
                      <button className="session-inline-git-expand" type="button" onClick={() => void toggleFileDiff(file.path)}>
                        {openDiffs[file.path] ? '▾' : '▸'}
                      </button>
                      <button
                        className="session-inline-git-file-link"
                        type="button"
                        onClick={() => onOpenFile(file.path)}
                        title="Open in Explorer"
                      >
                        {file.path}
                      </button>
                      <span className="session-inline-git-status">{mapGitStatusLabel(file)}</span>
                      <button className="session-inline-git-stage" type="button" onClick={() => void toggleStageFile(file)}>
                        {file.staged ? 'Unstage' : 'Stage'}
                      </button>
                    </div>
                    {openDiffs[file.path] ? (
                      <div className="session-inline-git-diff">
                        {fileDiff?.loading ? <p>Loading diff…</p> : null}
                        {fileDiff?.error ? <p className="session-inline-git-error">{fileDiff.error}</p> : null}
                        {!fileDiff?.loading && !fileDiff?.error && parsedDiff ? (
                          <FileDiff fileDiff={parsedDiff} options={{
                            theme: { light: 'pierre-light', dark: 'pierre-dark' },
                            themeType: 'dark',
                            diffStyle: 'unified',
                            diffIndicators: 'classic',
                            hunkSeparators: 'line-info',
                            lineDiffType: 'word',
                            overflow: 'scroll',
                          }} />
                        ) : null}
                        {!fileDiff?.loading && !fileDiff?.error && !parsedDiff ? (
                          <p className="session-inline-git-empty">No preview available.</p>
                        ) : null}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="session-inline-git-commit">
            <textarea
              className="session-inline-git-commit-message"
              placeholder="Commit message"
              value={commitMessage}
              onChange={(event) => setCommitMessage(event.target.value)}
              rows={2}
            />
            <div className="session-inline-git-commit-actions">
              <button type="button" onClick={() => void handleSuggestMessage()} disabled={isSuggesting || isCommitting}>
                {isSuggesting ? 'Suggesting…' : 'Suggest'}
              </button>
              <button type="button" onClick={() => void handleCommit()} disabled={isCommitting || commitMessage.trim() === ''}>
                {isCommitting ? 'Committing…' : 'Commit'}
              </button>
            </div>
            {commitError ? <p className="session-inline-git-error">{commitError}</p> : null}
            {commitSuccess ? <p className="session-inline-git-success">{commitSuccess}</p> : null}
          </div>
        </div>
      ) : null}
    </details>
  );
}
