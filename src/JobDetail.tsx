import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { deleteJob, getJob, getSettings, listJobSessions, runJobNow, type RecurringJob, type Session } from './api';
import { THINKING_JOB_ID_SETTING_KEY } from './thinking';

function JobDetail() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [job, setJob] = useState<RecurringJob | null>(null);
  const [thinkingJobID, setThinkingJobID] = useState('');
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (jobId) {
      loadJob(jobId);
    }
  }, [jobId]);

  const loadJob = async (id: string) => {
    try {
      setLoading(true);
      setError(null);
      const [jobData, sessionsData] = await Promise.all([
        getJob(id),
        listJobSessions(id)
      ]);
      const settings = await getSettings();
      setJob(jobData);
      setSessions(sessionsData);
      setThinkingJobID((settings[THINKING_JOB_ID_SETTING_KEY] || '').trim());
    } catch (err) {
      console.error('Failed to load job:', err);
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  const handleRunNow = async () => {
    if (!jobId) return;
    try {
      await runJobNow(jobId);
      alert('Job started. Refresh to see new sessions.');
    } catch (err) {
      console.error('Failed to run job:', err);
      setError(err instanceof Error ? err.message : 'Failed to run job');
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

  if (loading) {
    return <div className="job-detail-loading">Loading job...</div>;
  }

  if (!job) {
    return <div className="job-detail-error">Job not found</div>;
  }

  const isThinkingJob = job.id === thinkingJobID;

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
            disabled={!job.enabled}
          >
            Run Now
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
          <pre className="task-prompt">{job.task_prompt}</pre>
        </div>

        <div className="job-sessions-section">
          <h3>Execution Sessions ({sessions.length})</h3>
          {sessions.length === 0 ? (
            <p className="no-sessions">No executions yet. Run the job to see sessions here.</p>
          ) : (
            <div className="sessions-list">
              {sessions.map(session => (
                <div 
                  key={session.id} 
                  className="session-card"
                  onClick={() => navigate(`/chat/${session.id}`)}
                >
                  <div className="session-card-header">
                    <span className="session-title">
                      {session.title || `Session ${session.id.substring(0, 8)}`}
                    </span>
                    <span className={`status-badge status-${session.status}`}>
                      {session.status}
                    </span>
                  </div>
                  <div className="session-meta">
                    <span>{formatDate(session.created_at)}</span>
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
