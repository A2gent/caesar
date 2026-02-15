import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useParams, useNavigate } from 'react-router-dom';
import { deleteJob, getJob, getSettings, listJobSessions, runJobNow, type RecurringJob, type Session } from './api';
import { THINKING_JOB_ID_SETTING_KEY } from './thinking';
import { buildOpenInMyMindUrl } from './myMindNavigation';

const SESSION_POLL_INTERVAL_MS = 1500;

function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<RecurringJob | null>(null);
  const [thinkingJobID, setThinkingJobID] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [isRunningNow, setIsRunningNow] = useState(false);
  const [pendingRunStartedAt, setPendingRunStartedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadSessions = useCallback(async (id: string): Promise<Session[]> => {
    const sessionsData = await listJobSessions(id);
    setSessions(sessionsData);
    return sessionsData;
  }, []);

  const loadJob = useCallback(async (id: string) => {
    const [jobData, sessionsData] = await Promise.all([
      getJob(id),
      listJobSessions(id),
    ]);
    const settings = await getSettings();
    setJob(jobData);
    setSessions(sessionsData);
    setThinkingJobID((settings[THINKING_JOB_ID_SETTING_KEY] || '').trim());
  }, []);

  useEffect(() => {
    if (jobId) {
      void (async () => {
        try {
          setLoading(true);
          setError(null);
          await loadJob(jobId);
        } catch (err) {
          console.error('Failed to load job:', err);
          setError(err instanceof Error ? err.message : 'Failed to load job');
        } finally {
          setLoading(false);
        }
      })();
    }
  }, [jobId, loadJob]);

  useEffect(() => {
    if (!loading && jobId && thinkingJobID !== '' && jobId === thinkingJobID) {
      navigate('/thinking', { replace: true });
    }
  }, [jobId, loading, navigate, thinkingJobID]);

  useEffect(() => {
    if (!jobId) return;
    const shouldPoll = isRunningNow || sessions.some((session) => session.status === 'running');
    if (!shouldPoll) return;

    const intervalId = window.setInterval(() => {
      void loadSessions(jobId).catch((err) => {
        console.error('Failed to refresh job sessions:', err);
      });
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [isRunningNow, jobId, loadSessions, sessions]);

  useEffect(() => {
    if (!pendingRunStartedAt) return;
    const startedAtMs = Date.parse(pendingRunStartedAt);
    const hasLikelyNewSession = sessions.some((session) => Date.parse(session.created_at) >= startedAtMs - 5000);
    if (hasLikelyNewSession || !isRunningNow) {
      setPendingRunStartedAt(null);
    }
  }, [isRunningNow, pendingRunStartedAt, sessions]);

  const handleRunNow = async () => {
    if (!jobId || isRunningNow) return;
    const startedAt = new Date().toISOString();
    setIsRunningNow(true);
    setPendingRunStartedAt(startedAt);
    setError(null);

    try {
      // Trigger an immediate refresh while the run request is in-flight so new session appears ASAP.
      void loadSessions(jobId).catch((err) => {
        console.error('Failed to refresh sessions after run start:', err);
      });
      await runJobNow(jobId);
      const [updatedJob] = await Promise.all([
        getJob(jobId),
        loadSessions(jobId),
      ]);
      setJob(updatedJob);
    } catch (err) {
      console.error('Failed to run job:', err);
      setError(err instanceof Error ? err.message : 'Failed to run job');
      setPendingRunStartedAt(null);
    } finally {
      setIsRunningNow(false);
    }
  };

  const handleDelete = async () => {
    if (!jobId || !job) return;
    if (jobId === thinkingJobID) {
      navigate('/thinking');
      return;
    }
    if (!confirm(`Delete job "${job.name}"?`)) return;
    
    try {
      await deleteJob(jobId);
      navigate('/agent/jobs');
    } catch (err) {
      console.error('Failed to delete job:', err);
      const message = err instanceof Error ? err.message : 'Failed to delete job';
      if (message.toLowerCase().includes('thinking')) {
        navigate('/thinking');
        return;
      }
      setError(message);
    }
  };

  const formatTimeAgo = (dateString?: string) => {
    if (!dateString) return 'Never';
    const date = new Date(dateString);
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

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const formatStatusLabel = (status: string): string => {
    if (!status) return 'Unknown';
    return status.charAt(0).toUpperCase() + status.slice(1);
  };

  const optimisticSession = useMemo<Session | null>(() => {
    if (!pendingRunStartedAt) return null;
    return {
      id: `optimistic-run-${pendingRunStartedAt}`,
      agent_id: 'job-runner',
      title: 'Starting execution...',
      status: 'running',
      created_at: pendingRunStartedAt,
      updated_at: pendingRunStartedAt,
    };
  }, [pendingRunStartedAt]);

  const displayedSessions = optimisticSession ? [optimisticSession, ...sessions] : sessions;

  if (loading) {
    return <div className="job-detail-loading">Loading job...</div>;
  }

  if (!job) {
    return <div className="job-detail-error">Job not found</div>;
  }

  const isThinkingJob = job.id === thinkingJobID;
  const instructionFilePath = (job.task_prompt_file || '').trim();
  const canOpenInstructionFile = job.task_prompt_source === 'file' && instructionFilePath !== '';

  return (
    <div className="job-detail-container">
      <div className="job-detail-header">
        <div className="header-left">
          <button onClick={() => navigate('/agent/jobs')} className="btn btn-secondary">
            ← Back
          </button>
          <h2>{job.name}</h2>
        </div>
        <div className="header-actions">
          <button 
            onClick={() => navigate(`/agent/jobs/edit/${job.id}`)} 
            className="btn btn-secondary"
          >
            Edit
          </button>
          <button 
            onClick={handleRunNow} 
            className="btn btn-primary"
            disabled={!job.enabled || isRunningNow}
          >
            {isRunningNow ? 'Running...' : 'Run Now'}
          </button>
          {isThinkingJob ? (
            <button onClick={() => navigate('/thinking')} className="btn btn-secondary">
              Manage in Thinking
            </button>
          ) : (
            <button onClick={handleDelete} className="btn btn-danger">
              Delete
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="job-detail-content">
        <div className="job-info-section">
          <h3>Configuration</h3>
          <div className="job-info-grid">
            <div className="info-item">
              <span className="info-label">Status:</span>
              <span className={`info-value status-${job.enabled ? 'enabled' : 'disabled'}`}>
                {job.enabled ? 'Enabled' : 'Disabled'}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Schedule:</span>
              <span className="info-value">{job.schedule_human}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Provider:</span>
              <span className="info-value">{job.llm_provider || 'Default active provider'}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Cron:</span>
              <code>{job.schedule_cron}</code>
            </div>
            <div className="info-item">
              <span className="info-label">Last run:</span>
              <span className="info-value">{formatTimeAgo(job.last_run_at)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Next run:</span>
              <span className="info-value">{job.next_run_at ? formatTimeAgo(job.next_run_at) : 'Not scheduled'}</span>
            </div>
          </div>
        </div>

        <div className="job-task-section">
          <h3>Task Instructions</h3>
          {canOpenInstructionFile ? (
            <div className="job-task-path-row">
              <span className="info-label">Instruction file:</span>{' '}
              <Link
                to={buildOpenInMyMindUrl(instructionFilePath)}
                className="tool-path-link"
                title={`Open ${instructionFilePath} in My Mind`}
              >
                {instructionFilePath}
              </Link>
            </div>
          ) : null}
          <pre className="task-prompt">{job.task_prompt}</pre>
        </div>

        <div className="job-sessions-section">
          <h3>Execution Sessions ({displayedSessions.length})</h3>
          {displayedSessions.length === 0 ? (
            <p className="no-sessions">No executions yet. Run the job to see sessions here.</p>
          ) : (
            <div className="sessions-list">
              {displayedSessions.map((session) => (
                <div 
                  key={session.id} 
                  className="session-card"
                  onClick={() => {
                    if (session.id.startsWith('optimistic-run-')) {
                      return;
                    }
                    navigate(`/chat/${session.id}`);
                  }}
                >
                  <div className="session-card-row">
                    <div className="session-name-wrap">
                      <span
                        className={`session-status-dot status-${session.status}`}
                        title={`Status: ${formatStatusLabel(session.status)}`}
                        aria-label={`Status: ${formatStatusLabel(session.status)}`}
                      />
                      <h3 className="session-name">
                      {session.title || `Session ${session.id.substring(0, 8)}`}
                      </h3>
                    </div>
                    <div className="session-row-right">
                      <div className="session-meta">
                        <span className={`status-badge status-${session.status}`}>
                          {formatStatusLabel(session.status)}
                        </span>
                        <span className="session-date">{formatDate(session.updated_at || session.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default JobDetail;
