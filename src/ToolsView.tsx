import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  browseSkillDirectories,
  getSettings,
  listBuiltInSkills,
  listIntegrationBackedSkills,
  listSpeechVoices,
  type BuiltInSkill,
  type ElevenLabsVoice,
  type IntegrationBackedSkill,
  type MindTreeEntry,
  updateSettings,
} from './api';
import {
  ELEVENLABS_SPEED,
  ELEVENLABS_SPEED_OPTIONS,
  ELEVENLABS_VOICE_ID,
  SCREENSHOT_DISPLAY_INDEX,
  SCREENSHOT_OUTPUT_DIR,
  speedToOptionIndex,
} from './skills';
import { IntegrationProviderIcon, integrationProviderLabel } from './integrationMeta';
import { toolIconForName } from './toolIcons';

function getParentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  if (trimmed === '' || trimmed === '/') {
    return '/';
  }

  const windowsRootMatch = /^[a-zA-Z]:$/.exec(trimmed);
  if (windowsRootMatch) {
    return `${trimmed}\\`;
  }

  const separatorIndex = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (separatorIndex < 0) {
    return trimmed;
  }

  if (separatorIndex === 0) {
    return '/';
  }

  return trimmed.slice(0, separatorIndex);
}

function ToolsView() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('');
  const [elevenLabsSpeed, setElevenLabsSpeed] = useState('1.0');
  const [screenshotOutputDir, setScreenshotOutputDir] = useState('/tmp');
  const [screenshotDisplayIndex, setScreenshotDisplayIndex] = useState('');

  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [hasAttemptedVoiceLoad, setHasAttemptedVoiceLoad] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);

  const [builtInSkills, setBuiltInSkills] = useState<BuiltInSkill[]>([]);
  const [integrationSkills, setIntegrationSkills] = useState<IntegrationBackedSkill[]>([]);
  const hasElevenLabsSkill = integrationSkills.some((integration) => integration.provider === 'elevenlabs');

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loaded = await getSettings();
      setSettings(loaded);
      setElevenLabsVoiceId(loaded[ELEVENLABS_VOICE_ID] || '');
      setElevenLabsSpeed(loaded[ELEVENLABS_SPEED] || '1.0');
      setScreenshotOutputDir(loaded[SCREENSHOT_OUTPUT_DIR] || '/tmp');
      setScreenshotDisplayIndex(loaded[SCREENSHOT_DISPLAY_INDEX] || '');
    } catch (loadError) {
      console.error('Failed to load tools settings:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load tools settings');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    const loadBuiltInAndIntegrationSkills = async () => {
      try {
        const [builtIn, integrations] = await Promise.all([listBuiltInSkills(), listIntegrationBackedSkills()]);
        setBuiltInSkills(builtIn);
        setIntegrationSkills(integrations);
      } catch (loadError) {
        console.error('Failed to load built-in/integration skills:', loadError);
      }
    };
    void loadBuiltInAndIntegrationSkills();
  }, []);

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
    } catch (loadError) {
      setVoices([]);
      setHasAttemptedVoiceLoad(true);
      setVoicesError(loadError instanceof Error ? loadError.message : 'Failed to load voices');
    } finally {
      setIsLoadingVoices(false);
    }
  };

  useEffect(() => {
    if (!hasElevenLabsSkill) {
      return;
    }

    if (voices.length > 0 || isLoadingVoices || hasAttemptedVoiceLoad) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadVoices();
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [hasElevenLabsSkill, voices.length, isLoadingVoices, hasAttemptedVoiceLoad]);

  const loadBrowse = async (path: string) => {
    setIsLoadingBrowse(true);
    setError(null);
    try {
      const response = await browseSkillDirectories(path);
      setBrowsePath(response.path);
      setBrowseEntries(response.entries);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to browse directories');
    } finally {
      setIsLoadingBrowse(false);
    }
  };

  const openPicker = async () => {
    setIsPickerOpen(true);
    await loadBrowse(screenshotOutputDir || browsePath);
  };

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
    } catch (playError) {
      setPlayingVoiceId(null);
      setVoicesError(playError instanceof Error ? playError.message : 'Failed to play voice preview');
    }
  };

  useEffect(() => {
    return () => {
      if (audioElement) {
        audioElement.pause();
      }
    };
  }, [audioElement]);

  const saveToolsSettings = async () => {
    setIsSaving(true);
    setError(null);
    setSuccess(null);

    const payload: Record<string, string> = { ...settings };
    const voiceId = elevenLabsVoiceId.trim();

    if (voiceId === '') {
      delete payload[ELEVENLABS_VOICE_ID];
    } else {
      payload[ELEVENLABS_VOICE_ID] = voiceId;
    }
    payload[ELEVENLABS_SPEED] = ELEVENLABS_SPEED_OPTIONS[speedToOptionIndex(elevenLabsSpeed)];
    const screenshotDir = screenshotOutputDir.trim();
    if (screenshotDir === '') {
      delete payload[SCREENSHOT_OUTPUT_DIR];
    } else {
      payload[SCREENSHOT_OUTPUT_DIR] = screenshotDir;
    }
    const displayIndex = screenshotDisplayIndex.trim();
    if (displayIndex === '') {
      delete payload[SCREENSHOT_DISPLAY_INDEX];
    } else if (!/^[1-9]\d*$/.test(displayIndex)) {
      setError('Screenshot default display index must be a positive integer.');
      setIsSaving(false);
      return;
    } else {
      payload[SCREENSHOT_DISPLAY_INDEX] = displayIndex;
    }

    try {
      const saved = await updateSettings(payload);
      setSettings(saved);
      setSuccess('Tools settings saved.');
      setHasAttemptedVoiceLoad(false);
      await loadVoices();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save tools settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Tools</h1>
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

      <div className="page-content page-content-narrow settings-sections">
        {isLoading ? (
          <div className="sessions-loading">Loading tools...</div>
        ) : (
          <>
            <div className="settings-panel">
              <h2>Built-in skills</h2>
              <p className="settings-help">
                Built-in skills are always available to the agent. They can be invoked by agent logic as part of the session flow.
              </p>
              <div className="skills-grid">
                {builtInSkills.map((skill) => (
                  <div key={skill.id} className="skill-card skill-card-builtin">
                    <div className="skill-card-title-row">
                      <h3 className="skill-title-with-icon">
                        <span className="tool-icon" aria-hidden="true">{toolIconForName(skill.name)}</span>
                        <span>{skill.name}</span>
                      </h3>
                      <span className="skill-badge">{skill.kind === 'tool' ? 'Tool' : 'Built-in'}</span>
                    </div>
                    <p>{skill.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-panel">
              <h2>Screenshot defaults</h2>
              <p className="settings-help">
                Configure defaults used by <code>take_screenshot_tool</code> when no output path is provided.
              </p>
              <div className="settings-group">
                <label className="settings-field">
                  <span>Default output directory</span>
                  <div className="tool-folder-picker-row">
                    <input
                      type="text"
                      value={screenshotOutputDir}
                      onChange={(event) => setScreenshotOutputDir(event.target.value)}
                      placeholder="/tmp"
                      autoComplete="off"
                    />
                    <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                      Browse
                    </button>
                  </div>
                </label>
                <label className="settings-field">
                  <span>Default display index (optional)</span>
                  <input
                    type="text"
                    value={screenshotDisplayIndex}
                    onChange={(event) => setScreenshotDisplayIndex(event.target.value)}
                    placeholder="1"
                    autoComplete="off"
                  />
                  <div className="settings-help">
                    1-based monitor index used by <code>take_screenshot_tool</code> when no explicit target/display is passed.
                  </div>
                </label>
              </div>
            </div>

            <div className="settings-panel">
              <h2>Integration-backed skills</h2>
              <p className="settings-help">
                Integrations store credentials and connectivity. Provider-specific tools below are what the agent can call during execution.
                Integration mode controls transport behavior and does not hide tool APIs.
              </p>
              {integrationSkills.length === 0 ? (
                <p className="settings-help">
                  No integrations connected. Configure one in <Link to="/integrations">Integrations</Link>.
                </p>
              ) : (
                <div className="skills-grid">
                  {integrationSkills.map((integration) => (
                    <div key={integration.id} className="skill-card skill-card-external">
                      <div className="skill-card-title-row">
                        <h3>{integration.name}</h3>
                        <span className={`skill-badge ${integration.enabled ? 'skill-badge-external' : ''}`}>
                          {integration.enabled ? 'Enabled' : 'Disabled'}
                        </span>
                      </div>
                      <p className="skill-integration-meta">
                        <span className="integration-provider-label">
                          <IntegrationProviderIcon provider={integration.provider} label={integrationProviderLabel(integration.provider)} />
                          <span>{integrationProviderLabel(integration.provider)}</span>
                        </span>
                        <span className="settings-help">mode: {integration.mode}</span>
                      </p>
                      {integration.tools.length === 0 ? (
                        <div className="skill-card-meta">No tool API is currently exposed for this integration.</div>
                      ) : (
                        <div className="skill-tool-list">
                          {integration.tools.map((tool) => (
                            <details key={`${integration.id}:${tool.name}`} className="skill-tool-details">
                              <summary className="skill-tool-summary-with-icon">
                                <span className="tool-icon" aria-hidden="true">{toolIconForName(tool.name)}</span>
                                <span>{tool.name}</span>
                              </summary>
                              <p>{tool.description}</p>
                              {tool.input_schema ? (
                                <pre className="skill-tool-schema">{JSON.stringify(tool.input_schema, null, 2)}</pre>
                              ) : null}
                            </details>
                          ))}
                        </div>
                      )}
                      {integration.provider === 'elevenlabs' ? (
                        <div className="settings-group skill-card-elevenlabs-defaults">
                          <label className="settings-field">
                            <span>Voice</span>
                            <div className="elevenlabs-voice-row">
                              <select
                                value={elevenLabsVoiceId}
                                onChange={(event) => setElevenLabsVoiceId(event.target.value)}
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
                            <div className="settings-help">Default voice used by <code>elevenlabs_tts</code>.</div>
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
                                onChange={(event) => {
                                  const nextIndex = Number.parseInt(event.target.value, 10);
                                  setElevenLabsSpeed(ELEVENLABS_SPEED_OPTIONS[nextIndex] || ELEVENLABS_SPEED_OPTIONS[0]);
                                }}
                              />
                              <div className="settings-help">Selected: {ELEVENLABS_SPEED_OPTIONS[speedToOptionIndex(elevenLabsSpeed)]}x</div>
                            </div>
                          </label>

                          {!isLoadingVoices && voices.length === 0 ? (
                            <p className="settings-help">
                              Add an enabled ElevenLabs integration in <Link to="/integrations">Integrations</Link> to load voices.
                            </p>
                          ) : null}

                          {voicesError ? <div className="settings-error">{voicesError}</div> : null}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settings-panel">
              <button type="button" className="settings-save-btn" onClick={() => void saveToolsSettings()} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save tools'}
              </button>
            </div>
          </>
        )}
      </div>

      {isPickerOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose screenshot output folder">
          <div className="mind-picker-dialog">
            <h2>Choose screenshot output folder</h2>
            <div className="mind-picker-path">{browsePath || 'Loading...'}</div>
            <div className="mind-picker-actions">
              <button
                type="button"
                className="settings-add-btn"
                onClick={() => void loadBrowse(getParentPath(browsePath))}
                disabled={isLoadingBrowse || browsePath.trim() === '' || getParentPath(browsePath) === browsePath}
              >
                Up
              </button>
              <button
                type="button"
                className="settings-save-btn"
                onClick={() => {
                  setScreenshotOutputDir(browsePath);
                  setIsPickerOpen(false);
                }}
                disabled={isLoadingBrowse || browsePath.trim() === ''}
              >
                Use this folder
              </button>
              <button type="button" className="settings-remove-btn" onClick={() => setIsPickerOpen(false)}>
                Cancel
              </button>
            </div>
            <div className="mind-picker-list">
              {!isLoadingBrowse && browseEntries.length === 0 ? <div className="sessions-empty">No folders found.</div> : null}
              {browseEntries.map((entry) => (
                <button
                  type="button"
                  key={entry.path}
                  className="mind-picker-item"
                  onClick={() => void loadBrowse(entry.path)}
                >
                  📁 {entry.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default ToolsView;
