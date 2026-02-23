import { useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  createJob,
  getJob,
  getSettings,
  listProviders,
  runJobNow,
  updateJob,
  updateSettings,
  type LLMProviderType,
  type ProviderConfig,
  type RecurringJob,
} from './api';
import InstructionBlocksEditor from './InstructionBlocksEditor';
import { serializeInstructionBlocksSetting, type InstructionBlock, type InstructionBlockType } from './instructionBlocks';
import {
  buildThinkingTaskPrompt,
  THINKING_FREQUENCY_HOURS_SETTING_KEY,
  THINKING_FREQUENCY_MINUTES_SETTING_KEY,
  THINKING_INSTRUCTION_BLOCKS_SETTING_KEY,
  THINKING_JOB_ID_SETTING_KEY,
  THINKING_SCHEDULE_TEXT_SETTING_KEY,
  THINKING_FILE_PATH_SETTING_KEY,
  THINKING_TEXT_SETTING_KEY,
  THINKING_SOURCE_SETTING_KEY,
  resolveThinkingInstructionBlocks,
  toThinkingSchedule,
} from './thinking';

const DEFAULT_THINKING_SCHEDULE_TEXT = 'every 60 minutes from 8:00 to 23:00';

function toPositiveIntOrDefault(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return fallback;
  }
  return parsed;
}

function ThinkingView() {
  const [searchParams] = useSearchParams();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [thinkingJobID, setThinkingJobID] = useState('');
  const [enabled, setEnabled] = useState(true);
  const [scheduleText, setScheduleText] = useState(DEFAULT_THINKING_SCHEDULE_TEXT);
  const [instructionBlocks, setInstructionBlocks] = useState<InstructionBlock[]>([]);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [llmProvider, setLLMProvider] = useState<LLMProviderType>('openai');
  const [thinkingJob, setThinkingJob] = useState<RecurringJob | null>(null);
  const [runningNow, setRunningNow] = useState(false);

  const loadThinkingConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const [settings, availableProviders] = await Promise.all([getSettings(), listProviders()]);
      const normalizedProviders = availableProviders.filter((provider) => provider.type !== 'fallback_chain');
      setProviders(normalizedProviders);
      const activeProvider = (availableProviders.find((provider) => provider.is_active)?.type || 'openai') as LLMProviderType;
      const configuredJobID = (settings[THINKING_JOB_ID_SETTING_KEY] || '').trim();
      const scheduleTextFromSettings = (settings[THINKING_SCHEDULE_TEXT_SETTING_KEY] || '').trim();
      const minutesFromSettings = (settings[THINKING_FREQUENCY_MINUTES_SETTING_KEY] || '').trim();
      const hoursFromLegacySettings = (settings[THINKING_FREQUENCY_HOURS_SETTING_KEY] || '').trim();
      const scheduleTextFromLegacyFrequency = minutesFromSettings !== ''
        ? toThinkingSchedule(toPositiveIntOrDefault(minutesFromSettings, 60))
        : toThinkingSchedule(toPositiveIntOrDefault(hoursFromLegacySettings, 1) * 60);
      const configuredBlocks = resolveThinkingInstructionBlocks(settings);

      const prefillFile = (searchParams.get('prefillFile') || '').trim();
      const hasConfiguredFileBlock = configuredBlocks.some((block) => block.type === 'file');
      const shouldApplyPrefill = prefillFile !== '' && !hasConfiguredFileBlock;
      const blocksWithPrefill = shouldApplyPrefill
        ? [...configuredBlocks, { type: 'file' as const, value: prefillFile, enabled: true }]
        : configuredBlocks;

      setThinkingJobID(configuredJobID);
      setLLMProvider(activeProvider);
      setInstructionBlocks(blocksWithPrefill);
      setThinkingJob(null);
      setScheduleText(
        scheduleTextFromSettings !== ''
          ? scheduleTextFromSettings
          : scheduleTextFromLegacyFrequency || DEFAULT_THINKING_SCHEDULE_TEXT,
      );

      if (configuredJobID !== '') {
        try {
          const existingJob = await getJob(configuredJobID);
          setThinkingJob(existingJob);
          setEnabled(existingJob.enabled);
          if (existingJob.llm_provider) {
            setLLMProvider(existingJob.llm_provider);
          }
          if (scheduleTextFromSettings === '' && existingJob.schedule_human.trim() !== '') {
            setScheduleText(existingJob.schedule_human.trim());
          }
        } catch {
          // Keep editable settings even if referenced job no longer exists.
          setThinkingJobID('');
          setThinkingJob(null);
        }
      }
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load Thinking settings');
    } finally {
      setLoading(false);
    }
  }, [searchParams]);

  useEffect(() => {
    void loadThinkingConfig();
  }, [loadThinkingConfig]);

  const handleRunNow = async () => {
    const jobID = thinkingJobID.trim();
    if (jobID === '') {
      setError('Save Thinking settings first to create its recurring job.');
      return;
    }

    setError(null);
    setSuccess(null);
    setRunningNow(true);
    try {
      await runJobNow(jobID);
      setSuccess('Thinking run started.');
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : 'Failed to run Thinking now');
    } finally {
      setRunningNow(false);
    }
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    const normalizedScheduleText = scheduleText.trim();
    if (normalizedScheduleText === '') {
      setError('Schedule is required.');
      return;
    }

    const normalizedBlocks = instructionBlocks
      .map((block): InstructionBlock => ({
        type: (
          block.type === 'file'
            ? 'file'
            : block.type === 'project_agents_md'
              ? 'project_agents_md'
              : 'text'
        ) as InstructionBlockType,
        value: block.value.trim(),
        enabled: block.enabled !== false,
      }))
      .filter((block) => block.enabled && (block.type === 'project_agents_md' || block.value !== ''));

    setSaving(true);
    try {
      const taskPrompt = buildThinkingTaskPrompt(normalizedBlocks);
      let jobID = thinkingJobID.trim();

      if (jobID === '') {
        const created = await createJob({
          name: 'Thinking',
          schedule_text: normalizedScheduleText,
          task_prompt: taskPrompt,
          llm_provider: llmProvider,
          enabled,
        });
        jobID = created.id;
      } else {
        try {
          await updateJob(jobID, {
            name: 'Thinking',
            schedule_text: normalizedScheduleText,
            task_prompt: taskPrompt,
            llm_provider: llmProvider,
            enabled,
          });
        } catch (updateError) {
          const message = updateError instanceof Error ? updateError.message.toLowerCase() : '';
          if (!message.includes('not found')) {
            throw updateError;
          }
          const created = await createJob({
            name: 'Thinking',
            schedule_text: normalizedScheduleText,
            task_prompt: taskPrompt,
            llm_provider: llmProvider,
            enabled,
          });
          jobID = created.id;
        }
      }

      const currentSettings = await getSettings();
      const settingsWithoutLegacyFrequency = { ...currentSettings };
      delete settingsWithoutLegacyFrequency[THINKING_FREQUENCY_HOURS_SETTING_KEY];
      delete settingsWithoutLegacyFrequency[THINKING_FREQUENCY_MINUTES_SETTING_KEY];
      const primaryBlock = normalizedBlocks[0];
      const nextSettings = {
        ...settingsWithoutLegacyFrequency,
        [THINKING_JOB_ID_SETTING_KEY]: jobID,
        [THINKING_SOURCE_SETTING_KEY]: primaryBlock?.type || 'text',
        [THINKING_SCHEDULE_TEXT_SETTING_KEY]: normalizedScheduleText,
        [THINKING_TEXT_SETTING_KEY]: primaryBlock?.type === 'text' ? primaryBlock.value : '',
        [THINKING_FILE_PATH_SETTING_KEY]: primaryBlock?.type === 'file' ? primaryBlock.value : '',
        [THINKING_INSTRUCTION_BLOCKS_SETTING_KEY]: serializeInstructionBlocksSetting(normalizedBlocks),
      };

      await updateSettings(nextSettings);
      setThinkingJobID(jobID);
      const latestJob = await getJob(jobID);
      setThinkingJob(latestJob);
      setSuccess('Thinking settings saved.');
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save Thinking settings');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <div className="jobs-loading">Loading Thinking settings...</div>;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Thinking</h1>
      </div>

      {error ? (
        <div className="error-banner">
          {error}
          <button type="button" className="error-dismiss" onClick={() => setError(null)}>×</button>
        </div>
      ) : null}

      {success ? (
        <div className="success-banner">
          {success}
          <button type="button" className="error-dismiss" onClick={() => setSuccess(null)}>×</button>
        </div>
      ) : null}

      <div className="page-content thinking-content">
        <div className="thinking-card">
          <label className="thinking-checkbox-row">
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} disabled={saving} />
            <span>Enabled</span>
          </label>

          <label className="thinking-field">
            <span>Schedule</span>
            <input
              type="text"
              value={scheduleText}
              onChange={(event) => setScheduleText(event.target.value)}
              placeholder={DEFAULT_THINKING_SCHEDULE_TEXT}
              disabled={saving}
            />
            <p className="thinking-note">
              Use natural language, for example: every 60 minutes from 8:00 to 23:00
            </p>
          </label>

          <label className="thinking-field">
            <span>LLM Provider</span>
            <select value={llmProvider} onChange={(event) => setLLMProvider(event.target.value as LLMProviderType)} disabled={saving || providers.length === 0}>
              {providers.map((provider) => (
                <option key={provider.type} value={provider.type}>{provider.display_name}</option>
              ))}
            </select>
            <p className="thinking-note">
              This provider is used only for Thinking job runs.
            </p>
          </label>

          <div className="thinking-field">
            <span>Thinking instruction blocks</span>
            <div className="thinking-global-instructions">
              <div className="thinking-global-instructions-title">Global agent instructions are always applied first.</div>
              <div className="thinking-global-instructions-body">
                Configure global instructions in <Link to="/settings">Settings</Link>.
              </div>
            </div>
            <InstructionBlocksEditor
              blocks={instructionBlocks}
              onChange={setInstructionBlocks}
              disabled={saving}
              textPlaceholder="Describe what the agent should do during Thinking runs..."
              filePlaceholder="notes/thinking.md"
              emptyStateText="No blocks yet. Add text and/or file blocks. Blocks are executed in order."
              showOpenInMyMind
            />
            <p className="thinking-note">
              These blocks are Thinking-specific and run after your global agent instruction settings.
            </p>
          </div>

          <p className="thinking-note">
            Saving creates or updates a protected recurring job. Disable it here when you want to stop it.
          </p>

          <div className="thinking-actions">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => void handleRunNow()}
              disabled={saving || runningNow || thinkingJobID.trim() === ''}
            >
              {runningNow ? 'Starting...' : 'Run Now'}
            </button>
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        <div className="job-task-section">
          <h3>Task Instructions</h3>
          <pre className="task-prompt">{thinkingJob?.task_prompt || 'No generated task instructions yet. Save Thinking settings first.'}</pre>
        </div>

      </div>
    </div>
  );
}

export default ThinkingView;
