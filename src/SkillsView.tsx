import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  browseSkillDirectories,
  discoverSkills,
  getSettings,
  listBuiltInSkills,
  listIntegrationBackedSkills,
  listSpeechVoices,
  type BuiltInSkill,
  type ElevenLabsVoice,
  type IntegrationBackedSkill,
  type MindTreeEntry,
  type SkillFile,
  updateSettings,
} from './api';
import {
  ELEVENLABS_SPEED,
  ELEVENLABS_SPEED_OPTIONS,
  ELEVENLABS_VOICE_ID,
  SKILLS_FOLDER_KEY,
  speedToOptionIndex,
} from './skills';
import { IntegrationProviderIcon, integrationProviderLabel } from './integrationMeta';

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

function SkillsView() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('');
  const [elevenLabsSpeed, setElevenLabsSpeed] = useState('1.0');

  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [hasAttemptedVoiceLoad, setHasAttemptedVoiceLoad] = useState(false);

  const [connectedFolder, setConnectedFolder] = useState('');
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);

  const [discoveredSkills, setDiscoveredSkills] = useState<SkillFile[]>([]);
  const [isDiscoveringSkills, setIsDiscoveringSkills] = useState(false);
  const [builtInSkills, setBuiltInSkills] = useState<BuiltInSkill[]>([]);
  const [integrationSkills, setIntegrationSkills] = useState<IntegrationBackedSkill[]>([]);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loaded = await getSettings();
      setSettings(loaded);
      setElevenLabsVoiceId(loaded[ELEVENLABS_VOICE_ID] || '');
      setElevenLabsSpeed(loaded[ELEVENLABS_SPEED] || '1.0');
      setConnectedFolder((loaded[SKILLS_FOLDER_KEY] || '').trim());
    } catch (loadError) {
      console.error('Failed to load skills settings:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load skills settings');
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
    if (voices.length > 0 || isLoadingVoices || hasAttemptedVoiceLoad) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      void loadVoices();
    }, 500);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [voices.length, isLoadingVoices, hasAttemptedVoiceLoad]);

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
    await loadBrowse(connectedFolder || browsePath);
  };

  useEffect(() => {
    const folder = connectedFolder.trim();
    if (folder === '') {
      setDiscoveredSkills([]);
      return;
    }

    let isActive = true;
    const runDiscovery = async () => {
      setIsDiscoveringSkills(true);
      try {
        const response = await discoverSkills(folder);
        if (!isActive) {
          return;
        }
        setDiscoveredSkills(response.skills);
      } catch (discoverError) {
        if (!isActive) {
          return;
        }
        setDiscoveredSkills([]);
        setError(discoverError instanceof Error ? discoverError.message : 'Failed to discover markdown skills');
      } finally {
        if (isActive) {
          setIsDiscoveringSkills(false);
        }
      }
    };

    void runDiscovery();
    return () => {
      isActive = false;
    };
  }, [connectedFolder]);

  const saveSkillsSettings = async () => {
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

    const folder = connectedFolder.trim();
    if (folder === '') {
      delete payload[SKILLS_FOLDER_KEY];
    } else {
      payload[SKILLS_FOLDER_KEY] = folder;
    }

    try {
      const saved = await updateSettings(payload);
      setSettings(saved);
      setSuccess('Skills settings saved.');
      setHasAttemptedVoiceLoad(false);
      await loadVoices();
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save skills settings');
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Skills</h1>
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
          <div className="sessions-loading">Loading skills...</div>
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
                      <h3>{skill.name}</h3>
                      <span className="skill-badge">{skill.kind === 'tool' ? 'Tool' : 'Built-in'}</span>
                    </div>
                    <p>{skill.description}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="settings-panel settings-audio-panel">
              <h2>Audio defaults</h2>
              <p className="settings-help">
                Configure defaults used by audio tools (for example, `elevenlabs_tts`). Audio is only generated when the agent explicitly calls a tool.
              </p>

              <div className="settings-group">
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
              </div>

              {!isLoadingVoices && voices.length === 0 ? (
                <p className="settings-help">
                  Add an enabled ElevenLabs integration in <Link to="/integrations">Integrations</Link> to load voices.
                </p>
              ) : null}

              {voicesError ? <div className="settings-error">{voicesError}</div> : null}
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
                              <summary>{tool.name}</summary>
                              <p>{tool.description}</p>
                              {tool.input_schema ? (
                                <pre className="skill-tool-schema">{JSON.stringify(tool.input_schema, null, 2)}</pre>
                              ) : null}
                            </details>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="settings-panel">
              <h2>External markdown skills</h2>
              <p className="settings-help">
                Connect a folder that contains skill Markdown files (`.md`, `.markdown`). These files are discovered and exposed as external skills.
              </p>
              <div className="settings-group">
                <label className="settings-field">
                  <span>Connected folder</span>
                  <input
                    type="text"
                    value={connectedFolder}
                    onChange={(event) => setConnectedFolder(event.target.value)}
                    placeholder="/absolute/path/to/skills"
                    autoComplete="off"
                  />
                </label>
              </div>
              <div className="settings-actions">
                <button type="button" className="settings-add-btn" onClick={() => void openPicker()}>
                  Browse folders
                </button>
                <button
                  type="button"
                  className="settings-remove-btn"
                  onClick={() => setConnectedFolder('')}
                  disabled={connectedFolder.trim() === ''}
                >
                  Disconnect folder
                </button>
              </div>
              <div className="settings-help">
                {connectedFolder.trim() === '' ? 'No folder connected.' : `Connected: ${connectedFolder}`}
              </div>

              <div className="skills-discovery-list">
                <h3>Discovered markdown skills</h3>
                {isDiscoveringSkills ? <div className="sessions-loading">Scanning folder...</div> : null}
                {!isDiscoveringSkills && discoveredSkills.length === 0 ? (
                  <p className="settings-help">No markdown skills found in the connected folder.</p>
                ) : null}
                {!isDiscoveringSkills && discoveredSkills.length > 0 ? (
                  <div className="skills-external-grid">
                    {discoveredSkills.map((skill) => (
                      <div key={skill.path} className="skill-card skill-card-external">
                        <div className="skill-card-title-row">
                          <h3>{skill.name}</h3>
                          <span className="skill-badge skill-badge-external">Folder</span>
                        </div>
                        <div className="skill-card-meta">{skill.relative_path}</div>
                      </div>
                    ))}
                  </div>
                ) : null}
              </div>
            </div>

            <div className="settings-panel">
              <button type="button" className="settings-save-btn" onClick={() => void saveSkillsSettings()} disabled={isSaving}>
                {isSaving ? 'Saving...' : 'Save skills'}
              </button>
            </div>
          </>
        )}
      </div>

      {isPickerOpen ? (
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose Skills folder">
          <div className="mind-picker-dialog">
            <h2>Choose skills folder</h2>
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
                  setConnectedFolder(browsePath);
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

export default SkillsView;
