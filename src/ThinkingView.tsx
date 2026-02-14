import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { createJob, getJob, getSettings, updateJob, updateSettings } from './api';
import {
  buildThinkingFileTaskPrompt,
  THINKING_FILE_PATH_SETTING_KEY,
  THINKING_FREQUENCY_HOURS_SETTING_KEY,
  THINKING_FREQUENCY_MINUTES_SETTING_KEY,
  THINKING_JOB_ID_SETTING_KEY,
  THINKING_SCHEDULE_TEXT_SETTING_KEY,
  THINKING_SOURCE_SETTING_KEY,
  THINKING_TEXT_SETTING_KEY,
  toThinkingSchedule,
  type ThinkingInstructionsSource,
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
  const [source, setSource] = useState<ThinkingInstructionsSource>('text');
  const [instructionsText, setInstructionsText] = useState('');
  const [instructionsFilePath, setInstructionsFilePath] = useState('');

  const loadThinkingConfig = useCallback(async () => {
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const settings = await getSettings();
      const configuredJobID = (settings[THINKING_JOB_ID_SETTING_KEY] || '').trim();
      const configuredSource = (settings[THINKING_SOURCE_SETTING_KEY] || '').trim();
      const scheduleTextFromSettings = (settings[THINKING_SCHEDULE_TEXT_SETTING_KEY] || '').trim();
      const minutesFromSettings = (settings[THINKING_FREQUENCY_MINUTES_SETTING_KEY] || '').trim();
      const hoursFromLegacySettings = (settings[THINKING_FREQUENCY_HOURS_SETTING_KEY] || '').trim();
      const scheduleTextFromLegacyFrequency = minutesFromSettings !== ''
        ? toThinkingSchedule(toPositiveIntOrDefault(minutesFromSettings, 60))
        : toThinkingSchedule(toPositiveIntOrDefault(hoursFromLegacySettings, 1) * 60);
      const configuredText = settings[THINKING_TEXT_SETTING_KEY] || '';
      const configuredFilePath = settings[THINKING_FILE_PATH_SETTING_KEY] || '';

      const prefillFile = (searchParams.get('prefillFile') || '').trim();
      const shouldApplyPrefill = prefillFile !== '' && configuredFilePath.trim() === '';

      setThinkingJobID(configuredJobID);
      setSource(configuredSource === 'file' ? 'file' : 'text');
      setInstructionsText(configuredText);
      setInstructionsFilePath(shouldApplyPrefill ? prefillFile : configuredFilePath);
      setScheduleText(
        scheduleTextFromSettings !== ''
          ? scheduleTextFromSettings
          : scheduleTextFromLegacyFrequency || DEFAULT_THINKING_SCHEDULE_TEXT,
      );

      if (shouldApplyPrefill) {
        setSource('file');
      }

      if (configuredJobID !== '') {
        try {
          const existingJob = await getJob(configuredJobID);
          setEnabled(existingJob.enabled);
          if (scheduleTextFromSettings === '' && existingJob.schedule_human.trim() !== '') {
            setScheduleText(existingJob.schedule_human.trim());
          }
        } catch {
          // Keep editable settings even if referenced job no longer exists.
          setThinkingJobID('');
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

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    const normalizedScheduleText = scheduleText.trim();
    if (normalizedScheduleText === '') {
      setError('Schedule is required.');
      return;
    }

    const textValue = instructionsText.trim();
    const fileValue = instructionsFilePath.trim();

    if (source === 'text' && textValue === '') {
      setError('Instructions text is required when text mode is selected.');
      return;
    }
    if (source === 'file' && fileValue === '') {
      setError('Instructions file path is required when file mode is selected.');
      return;
    }

    setSaving(true);
    try {
      const taskPrompt = source === 'file' ? buildThinkingFileTaskPrompt(fileValue) : textValue;
      let jobID = thinkingJobID.trim();

      if (jobID === '') {
        const created = await createJob({
          name: 'Thinking',
          schedule_text: normalizedScheduleText,
          task_prompt: taskPrompt,
          enabled,
        });
        jobID = created.id;
      } else {
        try {
          await updateJob(jobID, {
            name: 'Thinking',
            schedule_text: normalizedScheduleText,
            task_prompt: taskPrompt,
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
            enabled,
          });
          jobID = created.id;
        }
      }

      const currentSettings = await getSettings();
      const {
        [THINKING_FREQUENCY_HOURS_SETTING_KEY]: _legacyHoursSetting,
        [THINKING_FREQUENCY_MINUTES_SETTING_KEY]: _legacyMinutesSetting,
        ...settingsWithoutLegacyFrequency
      } = currentSettings;
      const nextSettings = {
        ...settingsWithoutLegacyFrequency,
        [THINKING_JOB_ID_SETTING_KEY]: jobID,
        [THINKING_SOURCE_SETTING_KEY]: source,
        [THINKING_SCHEDULE_TEXT_SETTING_KEY]: normalizedScheduleText,
        [THINKING_TEXT_SETTING_KEY]: source === 'text' ? textValue : '',
        [THINKING_FILE_PATH_SETTING_KEY]: source === 'file' ? fileValue : '',
      };

      await updateSettings(nextSettings);
      setThinkingJobID(jobID);
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

          <div className="thinking-source-toggle">
            <label>
              <input
                type="radio"
                name="thinking-source"
                checked={source === 'text'}
                onChange={() => setSource('text')}
                disabled={saving}
              />
              <span>Text instructions</span>
            </label>
            <label>
              <input
                type="radio"
                name="thinking-source"
                checked={source === 'file'}
                onChange={() => setSource('file')}
                disabled={saving}
              />
              <span>File path instructions</span>
            </label>
          </div>

          {source === 'text' ? (
            <label className="thinking-field">
              <span>Instructions</span>
              <textarea
                value={instructionsText}
                onChange={(event) => setInstructionsText(event.target.value)}
                rows={10}
                placeholder="Describe what the agent should do during Thinking runs..."
                disabled={saving}
              />
            </label>
          ) : (
            <label className="thinking-field">
              <span>Instructions file path</span>
              <input
                type="text"
                value={instructionsFilePath}
                onChange={(event) => setInstructionsFilePath(event.target.value)}
                placeholder="notes/thinking.md"
                disabled={saving}
              />
            </label>
          )}

          <p className="thinking-note">
            Saving creates or updates a protected recurring job. Disable it here when you want to stop it.
          </p>

          <div className="thinking-actions">
            <button type="button" className="btn btn-primary" onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default ThinkingView;
