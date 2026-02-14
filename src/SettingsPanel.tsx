import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { listSpeechVoices, type ElevenLabsVoice } from './api';

interface SettingsPanelProps {
  settings: Record<string, string>;
  isSaving: boolean;
  onSave: (settings: Record<string, string>) => Promise<void>;
}

interface CustomRow {
  id: string;
  key: string;
  value: string;
}

type CompletionAudioMode = 'off' | 'system' | 'elevenlabs';
type CompletionAudioContent = 'status' | 'final_response';

const ELEVENLABS_API_KEY = 'ELEVENLABS_API_KEY';
const ELEVENLABS_VOICE_ID = 'ELEVENLABS_VOICE_ID';
const ELEVENLABS_SPEED = 'ELEVENLABS_SPEED';
const COMPLETION_AUDIO_MODE = 'AAGENT_COMPLETION_AUDIO_MODE';
const COMPLETION_AUDIO_CONTENT = 'AAGENT_COMPLETION_AUDIO_CONTENT';
const SPEECH_ENABLED_KEY = 'AAGENT_SPEECH_ENABLED';
const CONTEXT_COMPACTION_TRIGGER_PERCENT = 'AAGENT_CONTEXT_COMPACTION_TRIGGER_PERCENT';
const CONTEXT_COMPACTION_PROMPT = 'AAGENT_CONTEXT_COMPACTION_PROMPT';
const ELEVENLABS_SPEED_OPTIONS = ['0.5', '0.8', '1.0', '1.5', '2.0'] as const;
const DEFAULT_COMPACTION_TRIGGER = '80';
const DEFAULT_COMPACTION_PROMPT = 'Create a concise continuation summary preserving goals, progress, constraints, and next actions.';

const MANAGED_KEYS = [
  ELEVENLABS_API_KEY,
  ELEVENLABS_VOICE_ID,
  ELEVENLABS_SPEED,
  COMPLETION_AUDIO_MODE,
  COMPLETION_AUDIO_CONTENT,
  SPEECH_ENABLED_KEY,
  CONTEXT_COMPACTION_TRIGGER_PERCENT,
  CONTEXT_COMPACTION_PROMPT,
  'SAG_VOICE_ID',
  'AAGENT_SAY_VOICE',
] as const;

const HIDDEN_CUSTOM_KEYS = new Set<string>([...MANAGED_KEYS]);
const REMOVED_ENV_KEYS = new Set<string>(['KIMI_API_KEY', 'ANTHROPIC_API_KEY', 'OPENROUTER_API_KEY']);

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.includes('KEY') || upper.includes('TOKEN') || upper.includes('SECRET') || upper.includes('PASSWORD');
}

function shouldShowCustomKey(key: string): boolean {
  return !HIDDEN_CUSTOM_KEYS.has(key) && !REMOVED_ENV_KEYS.has(key);
}

function isTruthySetting(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseCompletionAudioMode(settings: Record<string, string>): CompletionAudioMode {
  const mode = (settings[COMPLETION_AUDIO_MODE] || '').trim().toLowerCase();
  if (mode === 'off' || mode === 'system' || mode === 'elevenlabs') {
    return mode;
  }
  return isTruthySetting(settings[SPEECH_ENABLED_KEY] || '') ? 'system' : 'off';
}

function parseCompletionAudioContent(settings: Record<string, string>): CompletionAudioContent {
  const content = (settings[COMPLETION_AUDIO_CONTENT] || '').trim().toLowerCase();
  if (content === 'status' || content === 'final_response') {
    return content;
  }
  return 'status';
}

function speedToOptionIndex(speed: string): number {
  const parsed = Number.parseFloat(speed);
  if (!Number.isFinite(parsed)) {
    return ELEVENLABS_SPEED_OPTIONS.indexOf('1.0');
  }

  let closestIndex = 0;
  let minDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < ELEVENLABS_SPEED_OPTIONS.length; i += 1) {
    const optionValue = Number.parseFloat(ELEVENLABS_SPEED_OPTIONS[i]);
    const distance = Math.abs(optionValue - parsed);
    if (distance < minDistance) {
      minDistance = distance;
      closestIndex = i;
    }
  }
  return closestIndex;
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, isSaving, onSave }) => {
  const [customRows, setCustomRows] = useState<CustomRow[]>(() => {
    const rows: CustomRow[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (shouldShowCustomKey(key)) {
        rows.push({ id: crypto.randomUUID(), key, value });
      }
    }
    return rows;
  });

  const [completionAudioMode, setCompletionAudioMode] = useState<CompletionAudioMode>(() => parseCompletionAudioMode(settings));
  const [completionAudioContent, setCompletionAudioContent] = useState<CompletionAudioContent>(() => parseCompletionAudioContent(settings));
  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState(settings[ELEVENLABS_VOICE_ID] || '');
  const [elevenLabsSpeed, setElevenLabsSpeed] = useState(settings[ELEVENLABS_SPEED] || '1.0');
  const [compactionTriggerPercent, setCompactionTriggerPercent] = useState(settings[CONTEXT_COMPACTION_TRIGGER_PERCENT] || DEFAULT_COMPACTION_TRIGGER);
  const [compactionPrompt, setCompactionPrompt] = useState(settings[CONTEXT_COMPACTION_PROMPT] || DEFAULT_COMPACTION_PROMPT);
  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [hasAttemptedVoiceLoad, setHasAttemptedVoiceLoad] = useState(false);

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    const rows: CustomRow[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (shouldShowCustomKey(key)) {
        rows.push({ id: crypto.randomUUID(), key, value });
      }
    }
    setCustomRows(rows);

    setCompletionAudioMode(parseCompletionAudioMode(settings));
    setCompletionAudioContent(parseCompletionAudioContent(settings));
    setElevenLabsVoiceId(settings[ELEVENLABS_VOICE_ID] || '');
    setElevenLabsSpeed(settings[ELEVENLABS_SPEED] || '1.0');
    setCompactionTriggerPercent(settings[CONTEXT_COMPACTION_TRIGGER_PERCENT] || DEFAULT_COMPACTION_TRIGGER);
    setCompactionPrompt(settings[CONTEXT_COMPACTION_PROMPT] || DEFAULT_COMPACTION_PROMPT);
  }, [settings]);

  const loadVoices = async () => {
    setVoicesError(null);

    setIsLoadingVoices(true);
    try {
      const loadedVoices = await listSpeechVoices();
      const nextVoices = loadedVoices.slice().sort((a, b) => a.name.localeCompare(b.name));
      setVoices(nextVoices);
      setHasAttemptedVoiceLoad(true);

      if (nextVoices.length === 0) {
        setVoicesError('No voices found for this ElevenLabs account.');
        return;
      }

      const hasCurrentVoice = nextVoices.some((voice) => voice.voice_id === elevenLabsVoiceId);
      if (!hasCurrentVoice) {
        setElevenLabsVoiceId(nextVoices[0].voice_id);
      }
    } catch (error) {
      setVoices([]);
      setHasAttemptedVoiceLoad(true);
      setVoicesError(error instanceof Error ? error.message : 'Failed to load voices');
    } finally {
      setIsLoadingVoices(false);
    }
  };

  useEffect(() => {
    if (completionAudioMode !== 'elevenlabs') {
      return;
    }
    if (voices.length > 0 || isLoadingVoices || hasAttemptedVoiceLoad) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      loadVoices();
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [completionAudioMode, voices.length, isLoadingVoices, hasAttemptedVoiceLoad]);

  const handlePlayPreview = async (voice: ElevenLabsVoice | undefined) => {
    if (!voice || !voice.preview_url) {
      setVoicesError('Preview is unavailable for the selected voice.');
      return;
    }

    setVoicesError(null);
    try {
      if (audioElement) {
        audioElement.pause();
      }
      const nextAudio = new Audio(voice.preview_url);
      setAudioElement(nextAudio);
      setPlayingVoiceId(voice.voice_id);
      nextAudio.onended = () => setPlayingVoiceId(null);
      await nextAudio.play();
    } catch (error) {
      setPlayingVoiceId(null);
      setVoicesError(error instanceof Error ? error.message : 'Failed to play voice preview');
    }
  };

  useEffect(() => {
    return () => {
      if (audioElement) {
        audioElement.pause();
      }
    };
  }, [audioElement]);

  const canSave = useMemo(() => {
    return !isSaving;
  }, [isSaving]);

  const addRow = () => {
    setCustomRows((prev) => [...prev, { id: crypto.randomUUID(), key: '', value: '' }]);
  };

  const updateRow = (id: string, field: 'key' | 'value', next: string) => {
    setCustomRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: next } : row)));
  };

  const removeRow = (id: string) => {
    setCustomRows((prev) => prev.filter((row) => row.id !== id));
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(null);

    const payload: Record<string, string> = {};

    payload[COMPLETION_AUDIO_MODE] = completionAudioMode;
    payload[COMPLETION_AUDIO_CONTENT] = completionAudioContent;
    payload[SPEECH_ENABLED_KEY] = completionAudioMode === 'off' ? 'false' : 'true';

    const compactionTrigger = Number.parseFloat(compactionTriggerPercent.trim());
    if (!Number.isFinite(compactionTrigger) || compactionTrigger <= 0 || compactionTrigger > 100) {
      setSaveError('Context compaction trigger must be a number between 0 and 100.');
      return;
    }
    payload[CONTEXT_COMPACTION_TRIGGER_PERCENT] = String(compactionTrigger);

    const trimmedCompactionPrompt = compactionPrompt.trim();
    if (trimmedCompactionPrompt === '') {
      setSaveError('Context compaction prompt is required.');
      return;
    }
    payload[CONTEXT_COMPACTION_PROMPT] = trimmedCompactionPrompt;

    const voiceId = elevenLabsVoiceId.trim();
    if (voiceId !== '') {
      payload[ELEVENLABS_VOICE_ID] = voiceId;
    }
    const speed = ELEVENLABS_SPEED_OPTIONS[speedToOptionIndex(elevenLabsSpeed)];
    payload[ELEVENLABS_SPEED] = speed;

    for (const row of customRows) {
      const key = row.key.trim();
      if (!key || REMOVED_ENV_KEYS.has(key)) {
        continue;
      }
      payload[key] = row.value.trim();
    }

    try {
      await onSave(payload);
      if (completionAudioMode === 'elevenlabs') {
        setHasAttemptedVoiceLoad(false);
        await loadVoices();
      }
      setSaveSuccess('Settings saved and synced to backend.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
    }
  };

  return (
    <>
      <div className="settings-panel settings-audio-panel">
        <h2>Completion audio</h2>
        <p className="settings-help">
          Choose where completion speech comes from. Web app playback uses your current browser/device audio output.
        </p>

        <div className="audio-mode-options">
          <label className="audio-mode-option">
            <input
              type="radio"
              name="completion-audio-mode"
              value="off"
              checked={completionAudioMode === 'off'}
              onChange={() => setCompletionAudioMode('off')}
            />
            <span>Off</span>
          </label>
          <label className="audio-mode-option">
            <input
              type="radio"
              name="completion-audio-mode"
              value="system"
              checked={completionAudioMode === 'system'}
              onChange={() => setCompletionAudioMode('system')}
            />
            <span>System voice</span>
          </label>
          <label className="audio-mode-option">
            <input
              type="radio"
              name="completion-audio-mode"
              value="elevenlabs"
              checked={completionAudioMode === 'elevenlabs'}
              onChange={() => setCompletionAudioMode('elevenlabs')}
            />
            <span>ElevenLabs</span>
          </label>
        </div>

        <div className="settings-group">
          <label className="settings-field">
            <span>When a session finishes</span>
            <select
              value={completionAudioContent}
              onChange={(e) => setCompletionAudioContent(e.target.value as CompletionAudioContent)}
            >
              <option value="status">Announce session status changes</option>
              <option value="final_response">Speak final agent response</option>
            </select>
          </label>

          <label className="settings-field">
            <span>Voice</span>
            <div className="elevenlabs-voice-row">
              <select
                value={elevenLabsVoiceId}
                onChange={(e) => setElevenLabsVoiceId(e.target.value)}
              >
                {voices.length === 0 ? (
                  <option value="">
                    {isLoadingVoices ? 'Loading voices...' : 'API key required in Integrations'}
                  </option>
                ) : (
                  voices.map((voice) => (
                    <option key={voice.voice_id} value={voice.voice_id}>
                      {voice.name}
                    </option>
                  ))
                )}
              </select>
              <button
                type="button"
                onClick={() => handlePlayPreview(voices.find((voice) => voice.voice_id === elevenLabsVoiceId))}
                className="elevenlabs-preview-btn"
                disabled={!elevenLabsVoiceId || voices.length === 0}
                title="Play selected voice preview"
                aria-label="Play selected voice preview"
              >
                {playingVoiceId === elevenLabsVoiceId ? '...' : '▶'}
              </button>
            </div>
          </label>

          <label className="settings-field">
            <span>Voice speed</span>
            <div className="elevenlabs-speed-control">
              <input
                className="elevenlabs-speed-slider"
                type="range"
                min="0"
                max={String(ELEVENLABS_SPEED_OPTIONS.length - 1)}
                step="1"
                value={String(speedToOptionIndex(elevenLabsSpeed))}
                onChange={(e) => {
                  const nextIndex = Number.parseInt(e.target.value, 10);
                  setElevenLabsSpeed(ELEVENLABS_SPEED_OPTIONS[nextIndex] || ELEVENLABS_SPEED_OPTIONS[0]);
                }}
              />
              <div className="settings-help">Selected: {ELEVENLABS_SPEED_OPTIONS[speedToOptionIndex(elevenLabsSpeed)]}x</div>
            </div>
          </label>
        </div>

        {completionAudioMode === 'elevenlabs' && !isLoadingVoices && voices.length === 0 && (
          <p className="settings-help">
            ElevenLabs API key is configured in <Link to="/integrations">Integrations</Link>. Add an enabled ElevenLabs integration to load voices.
          </p>
        )}

        {voicesError && <div className="settings-error">{voicesError}</div>}
      </div>

      <div className="settings-panel">
        <h2>Context compaction</h2>
        <p className="settings-help">
          Automatically compact conversation context when usage is high, then continue from a fresh context window.
        </p>
        <div className="settings-group">
          <label className="settings-field">
            <span>Trigger at context usage (%)</span>
            <div className="compaction-slider-wrap">
              <input
                className="compaction-slider"
                type="range"
                min="1"
                max="100"
                step="0.5"
                value={compactionTriggerPercent}
                onChange={(e) => setCompactionTriggerPercent(e.target.value)}
              />
              <div className="compaction-slider-value">{Number.parseFloat(compactionTriggerPercent || '0').toFixed(1)}%</div>
            </div>
          </label>
          <label className="settings-field">
            <span>Compaction prompt</span>
            <textarea
              className="compaction-prompt"
              value={compactionPrompt}
              onChange={(e) => setCompactionPrompt(e.target.value)}
              placeholder="How the model should summarize before resetting context"
              rows={6}
            />
          </label>
        </div>
      </div>

      <div className="settings-panel">
        <h2>Environment variables</h2>
        <p className="settings-help">
          Values are stored in backend SQLite and synced into backend environment variables for agent/tool commands.
        </p>

        <div className="settings-custom-header">
          <h3>Environment variables</h3>
          <button type="button" onClick={addRow} className="settings-add-btn">Add</button>
        </div>

        <div className="settings-custom-list">
          {customRows.map((row) => (
            <div key={row.id} className="settings-custom-row">
              <input
                type="text"
                value={row.key}
                onChange={(e) => updateRow(row.id, 'key', e.target.value)}
                placeholder="ENV_VAR_NAME"
                autoComplete="off"
              />
              <input
                type={isSecretKey(row.key) ? 'password' : 'text'}
                value={row.value}
                onChange={(e) => updateRow(row.id, 'value', e.target.value)}
                placeholder="value"
                autoComplete="off"
              />
              <button type="button" onClick={() => removeRow(row.id)} className="settings-remove-btn">Remove</button>
            </div>
          ))}
        </div>

        {saveError && <div className="settings-error">{saveError}</div>}
        {saveSuccess && <div className="settings-success">{saveSuccess}</div>}

        <button type="button" onClick={handleSave} className="settings-save-btn" disabled={!canSave}>
          {isSaving ? 'Saving...' : 'Save settings'}
        </button>
      </div>
    </>
  );
};

export default SettingsPanel;
