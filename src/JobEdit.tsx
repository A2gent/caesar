import { useState, useEffect } from 'react';
import { createJob, updateJob, getJob, type CreateJobRequest } from './api';

interface JobEditProps {
  jobId?: string; // If provided, edit mode; otherwise, create mode
  onSave: () => void;
  onCancel: () => void;
}

function JobEdit({ jobId, onSave, onCancel }: JobEditProps) {
  const [name, setName] = useState('');
  const [scheduleText, setScheduleText] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isEditMode = !!jobId;

  useEffect(() => {
    if (isEditMode && jobId) {
      loadJob(jobId);
    }
  }, [isEditMode, jobId]);

  const loadJob = async (id: string) => {
    try {
      setLoading(true);
      const job = await getJob(id);
      setName(job.name);
      setScheduleText(job.schedule_human);
      setTaskPrompt(job.task_prompt);
      setEnabled(job.enabled);
    } catch (err) {
      console.error('Failed to load job:', err);
      setError(err instanceof Error ? err.message : 'Failed to load job');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!name.trim()) {
      setError('Name is required');
      return;
    }
    if (!scheduleText.trim()) {
      setError('Schedule is required');
      return;
    }
    if (!taskPrompt.trim()) {
      setError('Task instructions are required');
      return;
    }

    setSaving(true);
    setError(null);

    try {
      if (isEditMode && jobId) {
        await updateJob(jobId, {
          name: name.trim(),
          schedule_text: scheduleText.trim(),
          task_prompt: taskPrompt.trim(),
          enabled,
        });
      } else {
        const request: CreateJobRequest = {
          name: name.trim(),
          schedule_text: scheduleText.trim(),
          task_prompt: taskPrompt.trim(),
          enabled,
        };
        await createJob(request);
      }
      onSave();
    } catch (err) {
      console.error('Failed to save job:', err);
      setError(err instanceof Error ? err.message : 'Failed to save job');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="job-edit-loading">Loading job...</div>;
  }

  return (
    <div className="job-edit-container">
      <div className="job-edit-header">
        <h2>{isEditMode ? 'Edit Job' : 'Create New Job'}</h2>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <form onSubmit={handleSubmit} className="job-edit-form">
        <div className="form-group">
          <label htmlFor="name">Job Name</label>
          <input
            type="text"
            id="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., Daily X Digest"
            disabled={saving}
          />
        </div>

        <div className="form-group">
          <label htmlFor="schedule">Schedule (natural language)</label>
          <input
            type="text"
            id="schedule"
            value={scheduleText}
            onChange={(e) => setScheduleText(e.target.value)}
            placeholder="e.g., every day at 7pm"
            disabled={saving}
          />
          <p className="help-text">
            Examples: &quot;every day at 7pm&quot;, &quot;every Monday at 9am&quot;, &quot;every hour&quot;, &quot;every weekday at 8:30am&quot;
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="task">Task Instructions</label>
          <textarea
            id="task"
            value={taskPrompt}
            onChange={(e) => setTaskPrompt(e.target.value)}
            placeholder="Describe what the agent should do when this job runs..."
            rows={10}
            disabled={saving}
          />
          <p className="help-text">
            These instructions will be given to the agent each time the job runs.
          </p>
        </div>

        <div className="form-group checkbox">
          <label>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={saving}
            />
            Enabled
          </label>
        </div>

        <div className="form-actions">
          <button type="button" onClick={onCancel} className="btn btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : isEditMode ? 'Update Job' : 'Create Job'}
          </button>
        </div>
      </form>
    </div>
  );
}

export default JobEdit;
