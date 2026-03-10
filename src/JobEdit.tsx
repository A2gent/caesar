import { useState, useEffect } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { createJob, updateJob, getJob, type CreateJobRequest } from './api';
import SoulFilePickerDialog from './SoulFilePickerDialog';
import { DEFAULT_WORKFLOW_ID, listWorkflows, type WorkflowDefinition } from './workflows';

type TaskPromptSource = 'text' | 'file';

function buildFileTaskPrompt(path: string): string {
  return `Load and follow instructions from this file path: ${path}`;
}

function buildWorkflowSessionMetadata(workflow: WorkflowDefinition): Record<string, unknown> {
  return {
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    workflow_definition: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      entryNodeId: workflow.entryNodeId,
      policy: workflow.policy,
      nodes: workflow.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        ref: node.kind === 'subagent'
          ? (node.subAgentId || '')
          : node.kind === 'local'
            ? (node.localAgentId || '')
            : node.kind === 'external'
              ? (node.externalAgentId || '')
              : '',
        subAgentId: node.subAgentId,
        localAgentId: node.localAgentId,
        externalAgentId: node.externalAgentId,
      })),
      edges: workflow.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        mode: edge.mode,
      })),
    },
  };
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
  const [workflowOptions, setWorkflowOptions] = useState<WorkflowDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(DEFAULT_WORKFLOW_ID);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [isSoulPickerOpen, setIsSoulPickerOpen] = useState(false);

  const isEditMode = !!jobId;

  useEffect(() => {
    void loadWorkflowOptions();
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

  const loadWorkflowOptions = async () => {
    try {
      const available = await listWorkflows();
      setWorkflowOptions(available);
      if (!available.some((workflow) => workflow.id === selectedWorkflowId)) {
        setSelectedWorkflowId(DEFAULT_WORKFLOW_ID);
      }
    } catch (err) {
      console.error('Failed to load workflows:', err);
      setWorkflowOptions([]);
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
      setSelectedWorkflowId((job.workflow_id || '').trim() || DEFAULT_WORKFLOW_ID);
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
      const selectedWorkflow = workflowOptions.find((workflow) => workflow.id === selectedWorkflowId) || null;
      const workflowMetadata = selectedWorkflow ? buildWorkflowSessionMetadata(selectedWorkflow) : null;
      if (isEditMode && jobId) {
        await updateJob(jobId, {
          name: name.trim(),
          schedule_text: scheduleText.trim(),
          task_prompt: normalizedSource === 'file' ? buildFileTaskPrompt(normalizedTaskPromptFile) : normalizedTaskPrompt,
          task_prompt_source: normalizedSource,
          task_prompt_file: normalizedSource === 'file' ? normalizedTaskPromptFile : '',
          workflow_id: workflowMetadata ? String(workflowMetadata.workflow_id || '') : '',
          workflow_name: workflowMetadata ? String(workflowMetadata.workflow_name || '') : '',
          workflow_definition: workflowMetadata?.workflow_definition as Record<string, unknown> | undefined,
          enabled,
        });
      } else {
        const request: CreateJobRequest = {
          name: name.trim(),
          schedule_text: scheduleText.trim(),
          task_prompt: normalizedSource === 'file' ? buildFileTaskPrompt(normalizedTaskPromptFile) : normalizedTaskPrompt,
          task_prompt_source: normalizedSource,
          task_prompt_file: normalizedSource === 'file' ? normalizedTaskPromptFile : '',
          workflow_id: workflowMetadata ? String(workflowMetadata.workflow_id || '') : '',
          workflow_name: workflowMetadata ? String(workflowMetadata.workflow_name || '') : '',
          workflow_definition: workflowMetadata?.workflow_definition as Record<string, unknown> | undefined,
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
        <h2>{isEditMode ? 'Edit Recurring Job' : 'Create Recurring Job'}</h2>
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
          <label htmlFor="job-workflow">Workflow</label>
          <select
            id="job-workflow"
            value={selectedWorkflowId}
            onChange={(event) => setSelectedWorkflowId(event.target.value)}
            disabled={saving || workflowOptions.length === 0}
          >
            {workflowOptions.map((workflow) => (
              <option key={workflow.id} value={workflow.id}>
                {workflow.name}{workflow.builtIn ? ' (Built-in)' : ''}
              </option>
            ))}
          </select>
          <p className="help-text">
            Recurring runs use the selected workflow to orchestrate one or more agents.
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

        <div className="form-group checkbox">
          <label htmlFor="job-enabled-switch">Enabled</label>
          <button
            type="button"
            id="job-enabled-switch"
            className={`ios-switch ${enabled ? 'on' : ''}`}
            role="switch"
            aria-checked={enabled}
            aria-label="Enable recurring job"
            onClick={() => setEnabled((prev) => !prev)}
            disabled={saving}
          >
            <span className="ios-switch-thumb" aria-hidden="true" />
          </button>
        </div>

        <div className="form-actions">
          <button
            type="button"
            onClick={() => navigate(jobId ? `/agent/jobs/${jobId}` : '/agent/jobs')}
            className="settings-add-btn"
            disabled={saving}
          >
            Cancel
          </button>
          <button type="submit" className="settings-save-btn" disabled={saving}>
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
