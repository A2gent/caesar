import { useState, useEffect, useCallback } from 'react';
import { listSessions, deleteSession, type Session } from './api';

interface SessionsListProps {
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
}

function SessionsList({ onSelectSession, onCreateSession }: SessionsListProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError(err instanceof Error ? err.message : 'Failed to load sessions');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSessions();
  }, [loadSessions]);

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
      return session.title.length > 50 
        ? session.title.substring(0, 50) + '...' 
        : session.title;
    }
    return `Session ${session.id.substring(0, 8)}`;
  };

  if (loading) {
    return <div className="sessions-loading">Loading sessions...</div>;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Sessions</h1>
        <button onClick={onCreateSession} className="btn btn-primary">
          + New Session
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content sessions-list-container">
        {sessions.length === 0 ? (
          <div className="sessions-empty">
            <p>No sessions yet.</p>
            <p>Start a new conversation to begin.</p>
            <button onClick={onCreateSession} className="btn btn-primary">
              Create Your First Session
            </button>
          </div>
        ) : (
          <div className="sessions-list">
            {sessions.map(session => (
              <div 
                key={session.id} 
                className="session-card"
                onClick={() => onSelectSession(session.id)}
              >
                <div className="session-card-header">
                  <h3 className="session-name">{formatSessionTitle(session)}</h3>
                  <button 
                    className="session-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteSession(session.id);
                    }}
                    title="Delete session"
                    aria-label={`Delete ${formatSessionTitle(session)}`}
                  >
                    Delete
                  </button>
                </div>
                <div className="session-meta">
                  <span className={`status-badge status-${session.status}`}>
                    {session.status}
                  </span>
                  <span className="session-date">{formatDate(session.updated_at)}</span>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default SessionsList;
