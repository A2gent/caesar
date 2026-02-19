import { useState, useEffect, useCallback } from 'react';
import ChatInput from './ChatInput';
import {
  createSession,
  deleteSession,
  getSession,
  listProjects,
  listProviders,
  listSessions,
  startSession,
  type LLMProviderType,
  type Project,
  type ProviderConfig,
  type Session,
} from './api';
import { EmptyState, EmptyStateTitle, EmptyStateHint } from './EmptyState';

const LAST_PROVIDER_STORAGE_KEY = 'a2gent.sessions.lastProvider';

interface SessionsListProps {
  onSelectSession: (sessionId: string, initialMessage?: string) => void;
  projectId?: string; // If provided, only show sessions for this project
  title?: string; // Optional title override
}

function SessionsList({ onSelectSession, projectId, title }: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [isCreatingSession, setIsCreatingSession] = useState(false);
  const [isQueuingSession, setIsQueuingSession] = useState(false);
  const [duplicatingSessionID, setDuplicatingSessionID] = useState<string | null>(null);
  const [startingSessionID, setStartingSessionID] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');
  const [hasLoadedProviders, setHasLoadedProviders] = useState(false);
  const [projects, setProjects] = useState<Project[]>([]);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listSessions();
      // Filter by project if specified
      if (projectId) {
        setSessions(data.filter((s) => s.project_id === projectId));
      } else {
        // Show only ungrouped sessions (no project)
        setSessions(data.filter((s) => !s.project_id));
      }
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

  const loadProjects = useCallback(async () => {
    try {
      const data = await listProjects();
      setProjects(data);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    }
  }, []);

  useEffect(() => {
    loadProjects();
  }, [loadProjects]);

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

  useEffect(() => {
    if (!hasLoadedProviders) {
      return;
    }
    try {
      if (selectedProvider) {
        localStorage.setItem(LAST_PROVIDER_STORAGE_KEY, selectedProvider);
      } else {
        localStorage.removeItem(LAST_PROVIDER_STORAGE_KEY);
      }
    } catch {
      // Ignore storage failures.
    }
  }, [hasLoadedProviders, selectedProvider]);

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
      onSelectSession(created.id, message);
    } catch (err) {
      console.error('Failed to create session from sessions list:', err);
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setIsCreatingSession(false);
    }
  };

  const handleQueueSession = async (message: string) => {
    setIsQueuingSession(true);
    setError(null);

    try {
      await createSession({
        agent_id: 'build',
        task: message,
        provider: selectedProvider || undefined,
        project_id: projectId || undefined,
        queued: true,
      });
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
      await startSession(session.id);
      onSelectSession(session.id);
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
      onSelectSession(created.id);
    } catch (err) {
      console.error('Failed to duplicate session:', err);
      setError(err instanceof Error ? err.message : 'Failed to duplicate session');
    } finally {
      setDuplicatingSessionID((current) => (current === sourceSession.id ? null : current));
    }
  };

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
    if (session.title) {
      return session.title;
    }
    return `Session ${session.id.substring(0, 8)}`;
  };

  const formatStatusLabel = (status: string) => {
    const normalized = status.trim();
    if (normalized.length === 0) {
      return 'Unknown';
    }
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

    if (days > 0) {
      return `${days}d ${hours}h`;
    }
    if (hours > 0) {
      return `${hours}h ${minutes}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${secs}s`;
    }
    return `${secs}s`;
  };

  const getProjectName = (projectId?: string) => {
    if (!projectId) return null;
    const project = projects.find((p) => p.id === projectId);
    return project?.name || null;
  };

  // Sort sessions: queued first, then by updated_at descending (most recent first)
  const sortedSessions = [...sessions].sort((a, b) => {
    const aIsQueued = a.status === 'queued';
    const bIsQueued = b.status === 'queued';
    if (aIsQueued && !bIsQueued) return -1;
    if (!aIsQueued && bIsQueued) return 1;
    return new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime();
  });

  // Get display title
  const displayTitle = title || (projectId ? getProjectName(projectId) : 'Sessions') || 'Sessions';

  if (loading) {
    return <div className="sessions-loading">Loading sessions...</div>;
  }

  return (
    <div className="page-shell sessions-page-shell">
      <div className="page-header">
        <h1>{displayTitle}</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="sessions-layout">
        <div className="page-content sessions-list-container">
          {sessions.length === 0 ? (
            <EmptyState className="sessions-empty">
              <EmptyStateTitle>No sessions yet.</EmptyStateTitle>
              <EmptyStateHint>Start speaking or typing below to create one.</EmptyStateHint>
            </EmptyState>
          ) : (
            <div className="sessions-list">
              {sortedSessions.map((session) => {
                const isQueued = session.status === 'queued';
                return (
                  <div
                    key={session.id}
                    className={`session-card ${isQueued ? 'session-queued' : ''}`}
                    onClick={() => onSelectSession(session.id)}
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
                          {!isQueued && (
                            <span
                              className="session-token-count"
                              title={`Ran for ${formatDurationSeconds(session.run_duration_seconds ?? 0)}`}
                            >
                              {formatTokenCount(session.total_tokens ?? 0)}
                            </span>
                          )}
                          <span className="session-date">{formatDate(session.updated_at)}</span>
                        </div>
                        <div className="session-actions">
                          {isQueued ? (
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
        </div>

        <div className="sessions-composer">
          <div className="page-content sessions-composer-inner">
            <ChatInput
              onSend={handleStartSession}
              onQueue={handleQueueSession}
              disabled={isCreatingSession || isQueuingSession}
              autoFocus
              showQueueButton={true}
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
      </div>
    </div>
  );
}

export default SessionsList;
