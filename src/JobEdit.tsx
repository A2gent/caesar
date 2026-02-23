import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { createJob, updateJob, getJob, listProviders, type CreateJobRequest, type LLMProviderType, type ProviderConfig } from './api';
import SoulFilePickerDialog from './SoulFilePickerDialog';

type TaskPromptSource = 'text' | 'file';

function buildFileTaskPrompt(path: string): string {
  return `Load and follow instructions from this file path: ${path}`;
}

function JobEdit() {
  const { jobId } = useParams<{ jobId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState('');
  const [scheduleText, setScheduleText] = useState('');
  const [taskPrompt, setTaskPrompt] = useState('');
  const [taskPromptSource, setTaskPromptSource] = useState<TaskPromptSource>('text');
  const [taskPromptFile, setTaskPromptFile] = useState('');
  const [llmProvider, setLLMProvider] = useState<LLMProviderType>('openai');
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isSoulPickerOpen, setIsSoulPickerOpen] = useState(false);

  const isEditMode = !!jobId;

  useEffect(() => {
    void loadProviders();
  }, []);

  useEffect(() => {
    if (isEditMode && jobId) {
      void loadJob(jobId);
    }
  }, [isEditMode, jobId]);

  useEffect(() => {
    if (isEditMode) {
      return;
    }
    const prefillPath = (searchParams.get('prefillInstructionFile') || '').trim();
    if (prefillPath === '') {
      return;
    }
    setTaskPromptSource('file');
    setTaskPromptFile(prefillPath);
    setTaskPrompt(buildFileTaskPrompt(prefillPath));
  }, [isEditMode, searchParams]);

  const loadProviders = async () => {
    try {
      const data = await listProviders();
      const selectable = data.filter((provider) => provider.type !== 'fallback_chain');
      setProviders(selectable);
      const active = selectable.find((provider) => provider.is_active);
      if (active) {
        setLLMProvider(active.type);
      }
    } catch (err) {
      console.error('Failed to load providers:', err);
    }
  };

  const loadJob = async (id: string) => {
    try {
      setLoading(true);
      const job = await getJob(id);
      setName(job.name);
      setScheduleText(job.schedule_human);
      setTaskPrompt(job.task_prompt);
      setTaskPromptSource(job.task_prompt_source === 'file' ? 'file' : 'text');
      setTaskPromptFile(job.task_prompt_file || '');
      if (job.llm_provider) {
        setLLMProvider(job.llm_provider);
      }
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
    const normalizedSource: TaskPromptSource = taskPromptSource === 'file' ? 'file' : 'text';
    const normalizedTaskPrompt = taskPrompt.trim();
    const normalizedTaskPromptFile = taskPromptFile.trim();
    if (normalizedSource === 'file') {
      if (!normalizedTaskPromptFile) {
        setError('Instruction file path is required');
        return;
      }
    } else if (!normalizedTaskPrompt) {
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
          task_prompt: normalizedSource === 'file' ? buildFileTaskPrompt(normalizedTaskPromptFile) : normalizedTaskPrompt,
          task_prompt_source: normalizedSource,
          task_prompt_file: normalizedSource === 'file' ? normalizedTaskPromptFile : '',
          llm_provider: llmProvider,
          enabled,
        });
      } else {
        const request: CreateJobRequest = {
          name: name.trim(),
          schedule_text: scheduleText.trim(),
          task_prompt: normalizedSource === 'file' ? buildFileTaskPrompt(normalizedTaskPromptFile) : normalizedTaskPrompt,
          task_prompt_source: normalizedSource,
          task_prompt_file: normalizedSource === 'file' ? normalizedTaskPromptFile : '',
          llm_provider: llmProvider,
          enabled,
        };
        await createJob(request);
      }
      navigate(isEditMode ? `/agent/jobs/${jobId}` : '/agent/jobs');
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
          <label htmlFor="task-source">Task Instructions Source</label>
          <select
            id="task-source"
            value={taskPromptSource}
            onChange={(event) => setTaskPromptSource(event.target.value as TaskPromptSource)}
            disabled={saving}
          >
            <option value="text">Text</option>
            <option value="file">File path</option>
          </select>
        </div>

        <div className="form-group">
          <label htmlFor="task">Task Instructions</label>
          {taskPromptSource === 'file' ? (
            <div className="job-file-picker-row">
              <input
                type="text"
                id="task"
                value={taskPromptFile}
                onChange={(event) => {
                  setTaskPromptFile(event.target.value);
                  setTaskPrompt(buildFileTaskPrompt(event.target.value.trim()));
                }}
                placeholder="/absolute/path/to/instructions.md"
                disabled={saving}
              />
              <button
                type="button"
                className="settings-add-btn"
                onClick={() => setIsSoulPickerOpen(true)}
                disabled={saving}
                title="Choose instruction file from Soul"
              >
                Choose From Soul
              </button>
            </div>
          ) : (
            <textarea
              id="task"
              value={taskPrompt}
              onChange={(e) => setTaskPrompt(e.target.value)}
              placeholder="Describe what the agent should do when this job runs..."
              rows={10}
              disabled={saving}
            />
          )}
          <p className="help-text">
            {taskPromptSource === 'file'
              ? 'The file will be read at runtime and its content will be used as the job instructions.'
              : 'These instructions will be given to the agent each time the job runs.'}
          </p>
        </div>

        <div className="form-group">
          <label htmlFor="llm-provider">LLM Provider</label>
          <select
            id="llm-provider"
            value={llmProvider}
            onChange={(e) => setLLMProvider(e.target.value as LLMProviderType)}
            disabled={saving || providers.length === 0}
          >
            {providers.map((provider) => (
              <option key={provider.type} value={provider.type}>
                {provider.display_name}
              </option>
            ))}
          </select>
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
          <button type="button" onClick={() => navigate(jobId ? `/agent/jobs/${jobId}` : '/agent/jobs')} className="btn btn-secondary" disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving...' : isEditMode ? 'Update Job' : 'Create Job'}
          </button>
        </div>
      </form>

      <SoulFilePickerDialog
        open={isSoulPickerOpen}
        onClose={() => setIsSoulPickerOpen(false)}
        onPick={(absolutePath) => {
          setTaskPromptFile(absolutePath);
          setTaskPrompt(buildFileTaskPrompt(absolutePath));
          setIsSoulPickerOpen(false);
        }}
        title="Choose Job Instruction File From Soul"
      />
    </div>
  );
}

export default JobEdit;
