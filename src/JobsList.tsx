import { useState, useEffect, useCallback } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { deleteJob, getSettings, listJobs, runJobNow, type RecurringJob } from './api';
import { THINKING_JOB_ID_SETTING_KEY } from './thinking';

function JobsList() {
  const navigate = useNavigate();
  const [jobs, setJobs] = useState<RecurringJob[]>([]);
  const [thinkingJobID, setThinkingJobID] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const [data, settings] = await Promise.all([listJobs(), getSettings()]);
      setJobs(data);
      setThinkingJobID((settings[THINKING_JOB_ID_SETTING_KEY] || '').trim());
    } catch (err) {
      console.error('Failed to load jobs:', err);
      setError(err instanceof Error ? err.message : 'Failed to load jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    // Refresh jobs every 30 seconds
    const interval = setInterval(loadJobs, 30000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleDeleteJob = async (jobId: string, jobName: string) => {
    if (jobId === thinkingJobID) {
      navigate('/thinking');
      return;
    }
    if (!confirm(`Delete job "${jobName}"?`)) return;
    
    try {
      await deleteJob(jobId);
      await loadJobs();
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

  const handleRunNow = async (jobId: string) => {
    try {
      await runJobNow(jobId);
      alert('Job started. Check executions for results.');
    } catch (err) {
      console.error('Failed to run job:', err);
      setError(err instanceof Error ? err.message : 'Failed to run job');
    }
  };

  if (loading) {
    return <div className="jobs-loading">Loading jobs...</div>;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Recurring Jobs</h1>
        <button type="button" onClick={() => navigate('/agent/jobs/new')} className="settings-save-btn">
          + New Job
        </button>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content settings-sections jobs-list-container">
        {jobs.length === 0 ? (
          <div className="jobs-empty">
            <p>No recurring jobs yet.</p>
            <p>Create a job to schedule automated agent tasks.</p>
            <button onClick={() => navigate('/agent/jobs/new')} className="btn btn-primary">
              Create Your First Job
            </button>
          </div>
        ) : (
          <div className="jobs-list">
            {jobs.map((job) => {
              const isThinkingJob = job.id === thinkingJobID;
              const jobLinkTarget = isThinkingJob ? '/thinking' : `/agent/jobs/${job.id}`;
              return (
                <div key={job.id} className={`job-card ${!job.enabled ? 'job-disabled' : ''}`}>
                  <div className="job-card-row">
                    <span
                      className={`job-status-indicator ${job.enabled ? 'status-enabled' : 'status-disabled'}`}
                    />

                    <div className="job-card-body">
                      <h3 className="job-name">
                        <Link to={jobLinkTarget} className="job-name-link">
                          {job.name}
                        </Link>
                      </h3>
                      <div className="job-primary-schedule" title={job.schedule_human}>
                        {job.schedule_human}
                      </div>
                    </div>

                    <div className="job-actions">
                      <button
                        onClick={() => {
                          if (isThinkingJob) {
                            navigate('/thinking');
                            return;
                          }
                          void handleRunNow(job.id);
                        }}
                        className="btn btn-secondary"
                        disabled={!isThinkingJob && !job.enabled}
                      >
                        Run Now
                      </button>
                      {isThinkingJob ? (
                        <button onClick={() => navigate('/thinking')} className="btn btn-secondary">
                          Manage in Thinking
                        </button>
                      ) : (
                        <button onClick={() => handleDeleteJob(job.id, job.name)} className="btn btn-danger">
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

export default JobsList;
