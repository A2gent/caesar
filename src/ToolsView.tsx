import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  browseSkillDirectories,
  getApiBaseUrl,
  getSettings,
  listProviders,
  listCameraDevices,
  listBuiltInSkills,
  listIntegrationBackedSkills,
  listPiperVoices,
  listSpeechVoices,
  type BuiltInSkill,
  type CameraDeviceInfo,
  type ElevenLabsVoice,
  type IntegrationBackedSkill,
  type MindTreeEntry,
  type PiperVoiceOption,
  updateSettings,
  getBrowserChromeProfileStatus,
  launchBrowserChrome,
  type ProviderConfig,
  type BrowserChromeProfileStatus,
} from './api';
import { EmptyState, EmptyStateTitle } from './EmptyState';
import {
  CAMERA_INDEX,
  CAMERA_OUTPUT_DIR,
  CHROME_HEADLESS,
  ELEVENLABS_SPEED,
  ELEVENLABS_SPEED_OPTIONS,
  ELEVENLABS_VOICE_ID,
  PIPER_MODEL,
  WHISPER_LANGUAGE,
  WHISPER_TRANSLATE,
  SCREENSHOT_DISPLAY_INDEX,
  SCREENSHOT_OUTPUT_DIR,
  GIT_COMMIT_PROMPT_TEMPLATE,
  GIT_COMMIT_PROVIDER,
  speedToOptionIndex,
} from './skills';
import { IntegrationProviderIcon, integrationProviderLabel } from './integrationMeta';
import {
  toolIconForName,
  getToolCategory,
  TOOL_CATEGORIES,
  type ToolCategory,
} from './toolIcons';
import { ToolIcon } from './ToolIcon';

const DEFAULT_GIT_COMMIT_PROMPT_TEMPLATE = [
  'Generate one concise Git commit message in imperative mood.',
  'Return only the commit message text, no quotes, no bullets, no explanation.',
  '',
  'Changed files:',
  '{{files}}',
  '',
  'Diff snippets:',
  '{{diffs}}',
].join('\n');

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

interface BrowserCameraInfo {
  deviceId: string;
  label: string;
}

function normalizeCameraName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

function scoreCameraMatch(browserLabel: string, backendName: string): number {
  const browserNorm = normalizeCameraName(browserLabel);
  const backendNorm = normalizeCameraName(backendName);
  if (browserNorm === '' || backendNorm === '') {
    return 0;
  }
  if (browserNorm === backendNorm) {
    return 100;
  }
  if (browserNorm.includes(backendNorm) || backendNorm.includes(browserNorm)) {
    return 70;
  }
  const backendTokens = backendNorm.split(' ').filter(Boolean);
  let matched = 0;
  for (const token of backendTokens) {
    if (browserNorm.includes(token)) {
      matched += 1;
    }
  }
  return matched * 10;
}

function likelySameMachine(apiBaseUrl: string): boolean {
  if (typeof window === 'undefined') {
    return true;
  }
  try {
    const api = new URL(apiBaseUrl);
    const ui = new URL(window.location.href);
    const localHosts = new Set(['localhost', '127.0.0.1', '::1']);
    if (api.hostname === ui.hostname) {
      return true;
    }
    if (localHosts.has(api.hostname) && localHosts.has(ui.hostname)) {
      return true;
    }
    return false;
  } catch {
    return true;
  }
}

function ToolsView() {
  const [settings, setSettings] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [elevenLabsVoiceId, setElevenLabsVoiceId] = useState('');
  const [elevenLabsSpeed, setElevenLabsSpeed] = useState('1.0');
  const [piperModel, setPiperModel] = useState('en_US-lessac-medium');
  const [whisperLanguage, setWhisperLanguage] = useState('auto');
  const [whisperTranslateToEnglish, setWhisperTranslateToEnglish] = useState(false);
  const [screenshotOutputDir, setScreenshotOutputDir] = useState('/tmp');
  const [screenshotDisplayIndex, setScreenshotDisplayIndex] = useState('');
  const [cameraOutputDir, setCameraOutputDir] = useState('/tmp');
  const [cameraIndex, setCameraIndex] = useState('');
  const [backendCameras, setBackendCameras] = useState<CameraDeviceInfo[]>([]);
  const [isLoadingBackendCameras, setIsLoadingBackendCameras] = useState(false);
  const [backendCamerasError, setBackendCamerasError] = useState<string | null>(null);
  const [browserCameras, setBrowserCameras] = useState<BrowserCameraInfo[]>([]);
  const [selectedBrowserCameraId, setSelectedBrowserCameraId] = useState('');
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [isStartingPreview, setIsStartingPreview] = useState(false);
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const previewStreamRef = useRef<MediaStream | null>(null);
  const [piperVoices, setPiperVoices] = useState<PiperVoiceOption[]>([]);
  const [isLoadingPiperVoices, setIsLoadingPiperVoices] = useState(false);
  const [piperVoicesError, setPiperVoicesError] = useState<string | null>(null);

  const [voices, setVoices] = useState<ElevenLabsVoice[]>([]);
  const [isLoadingVoices, setIsLoadingVoices] = useState(false);
  const [voicesError, setVoicesError] = useState<string | null>(null);
  const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(null);
  const [hasAttemptedVoiceLoad, setHasAttemptedVoiceLoad] = useState(false);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pickerTarget, setPickerTarget] = useState<'screenshot' | 'camera'>('screenshot');
  const [browsePath, setBrowsePath] = useState('');
  const [browseEntries, setBrowseEntries] = useState<MindTreeEntry[]>([]);
  const [isLoadingBrowse, setIsLoadingBrowse] = useState(false);

  const [builtInSkills, setBuiltInSkills] = useState<BuiltInSkill[]>([]);
  const [integrationSkills, setIntegrationSkills] = useState<IntegrationBackedSkill[]>([]);

  // Group built-in skills by category
  const groupedBuiltInSkills = useMemo(() => {
    const groups = new Map<ToolCategory, BuiltInSkill[]>();
    // Initialize all categories in order
    for (const cat of TOOL_CATEGORIES) {
      groups.set(cat.id, []);
    }
    groups.set('other', []);

    for (const skill of builtInSkills) {
      const category = getToolCategory(skill.name);
      const list = groups.get(category) || [];
      list.push(skill);
      groups.set(category, list);
    }
    const systemTools = groups.get('system') || [];
    if (!systemTools.some((skill) => skill.name === 'git_integration')) {
      systemTools.push({
        id: 'tool:git_integration',
        name: 'git_integration',
        kind: 'tool',
        description: 'Configure commit-message generation provider/model/prompt used by Git integration in project commit dialog.',
      });
      groups.set('system', systemTools);
    }

    // Return only non-empty groups in category order
    return TOOL_CATEGORIES
      .map((cat) => ({ category: cat, skills: groups.get(cat.id) || [] }))
      .filter((g) => g.skills.length > 0);
  }, [builtInSkills]);

  // Browser Chrome state
  const [chromeHeadless, setChromeHeadless] = useState(false);
  const [browserChromeProfile, setBrowserChromeProfile] = useState<BrowserChromeProfileStatus | null>(null);
  const [isLoadingBrowserChromeProfile, setIsLoadingBrowserChromeProfile] = useState(false);
  const [isLaunchingBrowserChrome, setIsLaunchingBrowserChrome] = useState(false);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [gitCommitProvider, setGitCommitProvider] = useState('');
  const [gitCommitPromptTemplate, setGitCommitPromptTemplate] = useState('');
  const hasBrowserChromeTool = builtInSkills.some((skill) => skill.name === 'browser_chrome');

  const hasElevenLabsSkill = integrationSkills.some((integration) => integration.provider === 'elevenlabs');
  const hasPiperTool = builtInSkills.some((skill) => skill.name === 'piper_tts');
  const hasCameraTool = builtInSkills.some((skill) => skill.name === 'take_camera_photo_tool');
  const isLikelySameHost = useMemo(() => likelySameMachine(getApiBaseUrl()), []);
  const piperVoiceOptions = (() => {
    const map = new Map<string, PiperVoiceOption>();
    for (const voice of piperVoices) {
      map.set(voice.id, voice);
    }
    const current = piperModel.trim();
    if (current !== '' && !map.has(current)) {
      map.set(current, { id: current, installed: false });
    }
    return Array.from(map.values()).sort((a, b) => {
      if (a.installed !== b.installed) {
        return a.installed ? -1 : 1;
      }
      return a.id.localeCompare(b.id);
    });
  })();
  const selectedBrowserCamera = browserCameras.find((camera) => camera.deviceId === selectedBrowserCameraId);
  const suggestedBackendCamera = useMemo(() => {
    if (!selectedBrowserCamera || backendCameras.length === 0) {
      return null;
    }
    let best: CameraDeviceInfo | null = null;
    let bestScore = 0;
    for (const camera of backendCameras) {
      const score = scoreCameraMatch(selectedBrowserCamera.label, camera.name);
      if (score > bestScore) {
        best = camera;
        bestScore = score;
      }
    }
    if (!best || bestScore < 20) {
      return null;
    }
    return best;
  }, [selectedBrowserCamera, backendCameras]);

  const loadSettings = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const loaded = await getSettings();
      setSettings(loaded);
      setElevenLabsVoiceId(loaded[ELEVENLABS_VOICE_ID] || '');
      setElevenLabsSpeed(loaded[ELEVENLABS_SPEED] || '1.0');
      setPiperModel(loaded[PIPER_MODEL] || 'en_US-lessac-medium');
      setWhisperLanguage((loaded[WHISPER_LANGUAGE] || 'auto').trim() || 'auto');
      setWhisperTranslateToEnglish((loaded[WHISPER_TRANSLATE] || '').trim().toLowerCase() === 'true');
      setScreenshotOutputDir(loaded[SCREENSHOT_OUTPUT_DIR] || '/tmp');
      setScreenshotDisplayIndex(loaded[SCREENSHOT_DISPLAY_INDEX] || '');
      setCameraOutputDir(loaded[CAMERA_OUTPUT_DIR] || '/tmp');
      setCameraIndex(loaded[CAMERA_INDEX] || '');
      setChromeHeadless((loaded[CHROME_HEADLESS] || '').trim().toLowerCase() === 'true');
      setGitCommitProvider((loaded[GIT_COMMIT_PROVIDER] || '').trim());
      setGitCommitPromptTemplate(loaded[GIT_COMMIT_PROMPT_TEMPLATE] || DEFAULT_GIT_COMMIT_PROMPT_TEMPLATE);
    } catch (loadError) {
      console.error('Failed to load tools settings:', loadError);
      setError(loadError instanceof Error ? loadError.message : 'Failed to load tools settings');
    } finally {
      setIsLoading(false);
    }
  };

  const loadProvidersList = async () => {
    try {
      const loadedProviders = await listProviders();
      setProviders(loadedProviders);
      if (gitCommitProvider.trim() === '') {
        const active = loadedProviders.find((provider) => provider.is_active);
        if (active) {
          setGitCommitProvider(active.type);
        }
      }
    } catch (loadError) {
      console.error('Failed to load providers for Git tool:', loadError);
    }
  };

  const loadPiperVoices = async () => {
    setPiperVoicesError(null);
    setIsLoadingPiperVoices(true);
    try {
      const items = await listPiperVoices();
      const next = items.slice().sort((a, b) => {
        if (a.installed !== b.installed) {
          return a.installed ? -1 : 1;
        }
        return a.id.localeCompare(b.id);
      });
      setPiperVoices(next);
    } catch (loadError) {
      setPiperVoices([]);
      setPiperVoicesError(loadError instanceof Error ? loadError.message : 'Failed to load Piper voices');
    } finally {
      setIsLoadingPiperVoices(false);
    }
  };

  const loadBackendCameras = async () => {
    setBackendCamerasError(null);
    setIsLoadingBackendCameras(true);
    try {
      const devices = await listCameraDevices();
      const sorted = devices.slice().sort((a, b) => a.index - b.index);
      setBackendCameras(sorted);
    } catch (loadError) {
      setBackendCameras([]);
      setBackendCamerasError(loadError instanceof Error ? loadError.message : 'Failed to load backend cameras');
    } finally {
      setIsLoadingBackendCameras(false);
    }
  };

  const stopCameraPreview = () => {
    const stream = previewStreamRef.current;
    if (stream) {
      for (const track of stream.getTracks()) {
        track.stop();
      }
    }
    previewStreamRef.current = null;
    if (previewVideoRef.current) {
      previewVideoRef.current.srcObject = null;
    }
  };

  const loadBrowserCameras = async () => {
    if (!navigator.mediaDevices?.enumerateDevices) {
      throw new Error('This browser does not support media device enumeration.');
    }
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cameras = devices
      .filter((device) => device.kind === 'videoinput')
      .map((device) => ({
        deviceId: device.deviceId,
        label: device.label || `Camera ${device.deviceId.slice(0, 6)}`,
      }));
    setBrowserCameras(cameras);
    return cameras;
  };

  const startCameraPreview = async (deviceId: string) => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setPreviewError('This browser does not support camera preview.');
      return;
    }
    setPreviewError(null);
    setIsStartingPreview(true);
    try {
      stopCameraPreview();
      const constraints: MediaStreamConstraints = {
        video: deviceId ? { deviceId: { exact: deviceId } } : true,
        audio: false,
      };
      const stream = await navigator.mediaDevices.getUserMedia(constraints);
      previewStreamRef.current = stream;
      if (previewVideoRef.current) {
        previewVideoRef.current.srcObject = stream;
        await previewVideoRef.current.play().catch(() => undefined);
      }
      const cameras = await loadBrowserCameras();
      if (cameras.length > 0 && selectedBrowserCameraId.trim() === '') {
        setSelectedBrowserCameraId(cameras[0].deviceId);
      }
    } catch (startError) {
      stopCameraPreview();
      setPreviewError(startError instanceof Error ? startError.message : 'Failed to start camera preview');
    } finally {
      setIsStartingPreview(false);
    }
  };

  useEffect(() => {
    void loadSettings();
  }, []);

  useEffect(() => {
    void loadProvidersList();
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

  useEffect(() => {
    if (!hasPiperTool || isLoadingPiperVoices || piperVoices.length > 0) {
      return;
    }
    void loadPiperVoices();
  }, [hasPiperTool, isLoadingPiperVoices, piperVoices.length]);

  useEffect(() => {
    if (!hasCameraTool || isLoadingBackendCameras || backendCameras.length > 0) {
      return;
    }
    void loadBackendCameras();
  }, [hasCameraTool, isLoadingBackendCameras, backendCameras.length]);

  // Load Browser Chrome profile status
  const loadBrowserChromeProfile = async () => {
    if (!hasBrowserChromeTool) return;
    setIsLoadingBrowserChromeProfile(true);
    try {
      const status = await getBrowserChromeProfileStatus();
      setBrowserChromeProfile(status);
    } catch (err) {
      console.error('Failed to load browser chrome profile:', err);
    } finally {
      setIsLoadingBrowserChromeProfile(false);
    }
  };

  const handleLaunchBrowserChrome = async () => {
    setIsLaunchingBrowserChrome(true);
    try {
      const result = await launchBrowserChrome();
      setSuccess(`Chrome launched with agent profile (PID: ${result.pid})`);
      // Refresh profile status after launch
      await loadBrowserChromeProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to launch Chrome');
    } finally {
      setIsLaunchingBrowserChrome(false);
    }
  };

  useEffect(() => {
    if (!hasBrowserChromeTool || isLoadingBrowserChromeProfile || browserChromeProfile !== null) {
      return;
    }
    void loadBrowserChromeProfile();
  }, [hasBrowserChromeTool, isLoadingBrowserChromeProfile, browserChromeProfile]);

  useEffect(() => {
    return () => {
      stopCameraPreview();
    };
  }, []);

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

  const openPicker = async (target: 'screenshot' | 'camera') => {
    setPickerTarget(target);
    setIsPickerOpen(true);
    const targetPath = target === 'camera' ? cameraOutputDir : screenshotOutputDir;
    await loadBrowse(targetPath || browsePath);
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
    const trimmedPiperModel = piperModel.trim();
    if (trimmedPiperModel === '') {
      delete payload[PIPER_MODEL];
    } else {
      payload[PIPER_MODEL] = trimmedPiperModel;
    }
    const selectedWhisperLang = whisperLanguage.trim().toLowerCase();
    if (selectedWhisperLang === '' || selectedWhisperLang === 'auto') {
      delete payload[WHISPER_LANGUAGE];
    } else {
      payload[WHISPER_LANGUAGE] = selectedWhisperLang;
    }
    payload[WHISPER_TRANSLATE] = whisperTranslateToEnglish ? 'true' : 'false';
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
    const camDir = cameraOutputDir.trim();
    if (camDir === '') {
      delete payload[CAMERA_OUTPUT_DIR];
    } else {
      payload[CAMERA_OUTPUT_DIR] = camDir;
    }
    const camIndex = cameraIndex.trim();
    if (camIndex === '') {
      delete payload[CAMERA_INDEX];
    } else if (!/^[1-9]\d*$/.test(camIndex)) {
      setError('Camera default index must be a positive integer.');
      setIsSaving(false);
      return;
    } else {
      payload[CAMERA_INDEX] = camIndex;
    }
    payload[CHROME_HEADLESS] = chromeHeadless ? 'true' : 'false';
    const gitProvider = gitCommitProvider.trim();
    if (gitProvider === '') {
      delete payload[GIT_COMMIT_PROVIDER];
    } else {
      payload[GIT_COMMIT_PROVIDER] = gitProvider;
    }
    const gitPromptTemplate = gitCommitPromptTemplate.trim();
    if (gitPromptTemplate === '') {
      delete payload[GIT_COMMIT_PROMPT_TEMPLATE];
    } else {
      payload[GIT_COMMIT_PROMPT_TEMPLATE] = gitPromptTemplate;
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
              {groupedBuiltInSkills.length === 0 ? (
                <div className="sessions-loading">Loading skills...</div>
              ) : (
                <div className="skills-categories">
                  {groupedBuiltInSkills.map(({ category, skills }) => (
                    <div key={category.id} className="skill-category-section">
                      <div className="skill-category-header">
                        <span className="skill-category-icon" aria-hidden="true">{category.icon}</span>
                        <div className="skill-category-title">
                          <h3>{category.label}</h3>
                          <p className="skill-category-description">{category.description}</p>
                        </div>
                      </div>
                      <div className="skills-grid">
                        {skills.map((skill) => (
                          <div key={skill.id} className="skill-card skill-card-builtin">
                            <div className="skill-card-title-row">
                              <h3 className="skill-title-with-icon">
                                {skill.name === 'browser_chrome' ? (
                                  <ToolIcon toolName={skill.name} />
                                ) : (
                                  <span className="tool-icon" aria-hidden="true">{toolIconForName(skill.name)}</span>
                                )}
                                <span>{skill.name}</span>
                              </h3>
                              <span className="skill-badge">{skill.kind === 'tool' ? 'Tool' : 'Built-in'}</span>
                            </div>
                            <p>{skill.description}</p>
                            {skill.name === 'take_screenshot_tool' ? (
                              <details className="skill-tool-details">
                                <summary>Configure defaults</summary>
                                <p>Defaults used by this tool when no output path/display is passed.</p>
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
                                      <button type="button" className="settings-add-btn" onClick={() => void openPicker('screenshot')}>
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
                              </details>
                            ) : null}
                            {skill.name === 'take_camera_photo_tool' ? (
                              <details className="skill-tool-details">
                                <summary>Configure defaults</summary>
                                <p>Defaults used by this tool when no output path/camera index is passed.</p>
                                <div className="settings-group">
                                  <label className="settings-field">
                                    <span>Default output directory</span>
                                    <div className="tool-folder-picker-row">
                                      <input
                                        type="text"
                                        value={cameraOutputDir}
                                        onChange={(event) => setCameraOutputDir(event.target.value)}
                                        placeholder="/tmp"
                                        autoComplete="off"
                                      />
                                      <button type="button" className="settings-add-btn" onClick={() => void openPicker('camera')}>
                                        Browse
                                      </button>
                                    </div>
                                  </label>
                                  <label className="settings-field">
                                    <span>Default backend camera</span>
                                    <div className="tool-folder-picker-row">
                                      <select value={cameraIndex} onChange={(event) => setCameraIndex(event.target.value)}>
                                        <option value="">Auto (index 1)</option>
                                        {backendCameras.map((camera) => (
                                          <option key={`${camera.index}:${camera.id || camera.name}`} value={String(camera.index)}>
                                            #{camera.index} {camera.name}
                                          </option>
                                        ))}
                                      </select>
                                      <button
                                        type="button"
                                        className="settings-add-btn"
                                        onClick={() => void loadBackendCameras()}
                                        disabled={isLoadingBackendCameras}
                                      >
                                        {isLoadingBackendCameras ? 'Loading...' : 'Refresh'}
                                      </button>
                                    </div>
                                    <div className="settings-help">
                                      Uses backend camera index for <code>take_camera_photo_tool</code>.
                                    </div>
                                  </label>
                                  {backendCamerasError ? <div className="settings-error">{backendCamerasError}</div> : null}
                                  {!isLikelySameHost ? (
                                    <div className="settings-help">
                                      Browser and backend appear to be on different hosts, so browser preview devices may not match backend camera indices.
                                    </div>
                                  ) : (
                                    <div className="settings-help">
                                      Browser and backend look like the same host, so camera mapping should usually align.
                                    </div>
                                  )}
                                  <div className="settings-field">
                                    <span>Browser camera preview</span>
                                    <div className="tool-folder-picker-row">
                                      <button
                                        type="button"
                                        className="settings-add-btn"
                                        onClick={() => void startCameraPreview(selectedBrowserCameraId)}
                                        disabled={isStartingPreview}
                                      >
                                        {isStartingPreview ? 'Starting...' : 'Enable preview'}
                                      </button>
                                      <button type="button" className="settings-remove-btn" onClick={() => stopCameraPreview()}>
                                        Stop preview
                                      </button>
                                    </div>
                                    <select
                                      value={selectedBrowserCameraId}
                                      onChange={(event) => {
                                        const deviceId = event.target.value;
                                        setSelectedBrowserCameraId(deviceId);
                                        if (deviceId.trim() !== '') {
                                          void startCameraPreview(deviceId);
                                        }
                                      }}
                                      disabled={browserCameras.length === 0}
                                    >
                                      {browserCameras.length === 0 ? (
                                        <option value="">Enable preview to list browser cameras</option>
                                      ) : (
                                        browserCameras.map((camera) => (
                                          <option key={camera.deviceId} value={camera.deviceId}>
                                            {camera.label}
                                          </option>
                                        ))
                                      )}
                                    </select>
                                    <video ref={previewVideoRef} className="tool-camera-preview" playsInline muted />
                                    {previewError ? <div className="settings-error">{previewError}</div> : null}
                                    {selectedBrowserCamera && suggestedBackendCamera ? (
                                      <div className="settings-help">
                                        Suggested backend camera: #{suggestedBackendCamera.index} {suggestedBackendCamera.name}{' '}
                                        <button
                                          type="button"
                                          className="settings-add-btn"
                                          onClick={() => setCameraIndex(String(suggestedBackendCamera.index))}
                                        >
                                          Use suggestion
                                        </button>
                                      </div>
                                    ) : null}
                                    {selectedBrowserCamera && !suggestedBackendCamera ? (
                                      <div className="settings-help">
                                        Could not confidently map this browser camera to a backend camera index. Pick backend camera manually.
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </details>
                            ) : null}
                            {skill.name === 'piper_tts' ? (
                              <details className="skill-tool-details">
                                <summary>Configure defaults</summary>
                                <p>Defaults used by <code>piper_tts</code> when no model/voice is explicitly passed.</p>
                                <div className="settings-group">
                                  <label className="settings-field">
                                    <span>Default Piper voice/model ID</span>
                                    <select
                                      value={piperModel}
                                      onChange={(event) => setPiperModel(event.target.value)}
                                      disabled={isLoadingPiperVoices && piperVoiceOptions.length === 0}
                                    >
                                      {piperVoiceOptions.length === 0 ? (
                                        <option value="en_US-lessac-medium">
                                          {isLoadingPiperVoices ? 'Loading Piper voices...' : 'en_US-lessac-medium'}
                                        </option>
                                      ) : (
                                        piperVoiceOptions.map((voice) => (
                                          <option key={voice.id} value={voice.id}>
                                            {voice.id}{voice.installed ? ' (installed)' : ''}
                                          </option>
                                        ))
                                      )}
                                    </select>
                                    <div className="settings-help">
                                      Saved as <code>PIPER_MODEL</code>. Pick a multilingual voice/model (for example <code>ru_RU-ruslan-medium</code> for Russian).
                                    </div>
                                  </label>
                                  <div className="settings-help">
                                    {isLoadingPiperVoices ? 'Loading Piper voices...' : `Loaded ${piperVoiceOptions.length} Piper voice options.`}
                                  </div>
                                  {piperVoices.some((voice) => voice.installed) ? (
                                    <div className="settings-help">
                                      Installed voices:{' '}
                                      {piperVoices
                                        .filter((voice) => voice.installed)
                                        .map((voice) => voice.id)
                                        .join(', ')}
                                    </div>
                                  ) : null}
                                  {piperVoicesError ? <div className="settings-error">{piperVoicesError}</div> : null}
                                </div>
                              </details>
                            ) : null}
                            {skill.name === 'whisper_stt' ? (
                              <details className="skill-tool-details">
                                <summary>Configure defaults</summary>
                                <p>Defaults used by <code>whisper_stt</code> and mic transcription.</p>
                                <div className="settings-group">
                                  <label className="settings-field">
                                    <span>Default transcription language</span>
                                    <select
                                      value={whisperLanguage}
                                      onChange={(event) => setWhisperLanguage(event.target.value)}
                                    >
                                      <option value="auto">Auto-detect</option>
                                      <option value="en">English</option>
                                      <option value="ru">Russian</option>
                                      <option value="uk">Ukrainian</option>
                                      <option value="de">German</option>
                                      <option value="fr">French</option>
                                      <option value="es">Spanish</option>
                                      <option value="it">Italian</option>
                                      <option value="pt">Portuguese</option>
                                      <option value="pl">Polish</option>
                                      <option value="tr">Turkish</option>
                                      <option value="ja">Japanese</option>
                                      <option value="ko">Korean</option>
                                      <option value="zh">Chinese</option>
                                    </select>
                                    <div className="settings-help">
                                      Saved as <code>AAGENT_WHISPER_LANGUAGE</code>. Use <code>ru</code> to keep Russian text in Russian.
                                    </div>
                                  </label>
                                  <label className="settings-field settings-checkbox">
                                    <span>Translate transcript to English</span>
                                    <input
                                      type="checkbox"
                                      checked={whisperTranslateToEnglish}
                                      onChange={(event) => setWhisperTranslateToEnglish(event.target.checked)}
                                    />
                                    <div className="settings-help">
                                      Saved as <code>AAGENT_WHISPER_TRANSLATE</code>. Turn this off to keep original language output.
                                    </div>
                                  </label>
                                </div>
                              </details>
                            ) : null}
                            {skill.name === 'browser_chrome' ? (
                              <details className="skill-tool-details">
                                <summary>Configure browser</summary>
                                <p>Settings for Chrome browser automation.</p>
                                <div className="settings-group">
                                  <label className="settings-field settings-checkbox">
                                    <span>Headless mode (no GUI)</span>
                                    <input
                                      type="checkbox"
                                      checked={chromeHeadless}
                                      onChange={(event) => setChromeHeadless(event.target.checked)}
                                    />
                                    <div className="settings-help">
                                      Run Chrome without visible window. Faster but cannot see or interact with the browser manually.
                                    </div>
                                  </label>
                                  <div className="settings-field">
                                    <span>Agent Profile</span>
                                    <div className="tool-folder-picker-row">
                                      {isLoadingBrowserChromeProfile ? (
                                        <span>Loading...</span>
                                      ) : (
                                        <button
                                          type="button"
                                          className="settings-add-btn"
                                          onClick={() => void handleLaunchBrowserChrome()}
                                          disabled={isLaunchingBrowserChrome}
                                        >
                                          {isLaunchingBrowserChrome ? 'Opening...' : (browserChromeProfile?.exists ? 'Open Agent Profile' : 'Create & Open Agent Profile')}
                                        </button>
                                      )}
                                    </div>
                                    <div className="settings-help" style={{ marginTop: '8px' }}>
                                      Opens a new Chrome window with the agent profile as a separate "person".
                                      You can have both your main profile and agent profile open at the same time.
                                      Log in to websites in the agent window - the agent will use these sessions.
                                    </div>
                                    {browserChromeProfile?.exists ? (
                                      <div className="settings-help" style={{ marginTop: '8px' }}>
                                        <div>Profile exists at: <code>~/Library/Application Support/Google/Chrome/AgentProfile</code></div>
                                        {browserChromeProfile.lastUsed && (
                                          <div>Last modified: {new Date(browserChromeProfile.lastUsed).toLocaleString()}</div>
                                        )}
                                      </div>
                                    ) : null}
                                  </div>
                                </div>
                              </details>
                            ) : null}
                            {skill.name === 'git_integration' ? (
                              <details className="skill-tool-details" open>
                                <summary>Configure commit message generation</summary>
                                <p>Controls how commit message suggestions are generated in Project Git commit dialog.</p>
                                <div className="settings-group">
                                  <label className="settings-field">
                                    <span>LLM provider</span>
                                    <select
                                      value={gitCommitProvider}
                                      onChange={(event) => setGitCommitProvider(event.target.value)}
                                    >
                                      <option value="">Use active provider</option>
                                      {providers.map((provider) => (
                                        <option key={provider.type} value={provider.type}>
                                          {provider.display_name}
                                        </option>
                                      ))}
                                    </select>
                                    <div className="settings-help">
                                      Saved as <code>{GIT_COMMIT_PROVIDER}</code>. Leave empty to use currently active provider.
                                    </div>
                                  </label>
                                  <label className="settings-field">
                                    <span>Prompt template</span>
                                    <textarea
                                      value={gitCommitPromptTemplate}
                                      onChange={(event) => setGitCommitPromptTemplate(event.target.value)}
                                      rows={10}
                                      spellCheck={false}
                                    />
                                    <div className="settings-help">
                                      Saved as <code>{GIT_COMMIT_PROMPT_TEMPLATE}</code>. Available placeholders: <code>{'{{files}}'}</code>, <code>{'{{diffs}}'}</code>.
                                    </div>
                                  </label>
                                </div>
                              </details>
                            ) : null}
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
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
                        <details className="skill-tool-details">
                          <summary>Configure defaults</summary>
                          <p>Defaults used by <code>elevenlabs_tts</code> when voice/speed are not explicitly passed.</p>
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
                        </details>
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
        <div className="mind-picker-overlay" role="dialog" aria-modal="true" aria-label="Choose tool output folder">
          <div className="mind-picker-dialog">
            <h2>Choose output folder</h2>
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
                  if (pickerTarget === 'camera') {
                    setCameraOutputDir(browsePath);
                  } else {
                    setScreenshotOutputDir(browsePath);
                  }
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
              {!isLoadingBrowse && browseEntries.length === 0 ? (
              <EmptyState className="sessions-empty">
                <EmptyStateTitle>No folders found.</EmptyStateTitle>
              </EmptyState>
            ) : null}
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
