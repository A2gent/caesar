import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import SessionsList from './SessionsList';
import JobsList from './JobsList';
import JobEdit from './JobEdit';
import JobDetail from './JobDetail';
import ChatView from './ChatView';
import IntegrationsView from './IntegrationsView';
import ProviderEditView from './ProviderEditView';
import ProvidersView from './ProvidersView';
import SettingsView from './SettingsView';
import MyMindView from './MyMindView';
import ThinkingView from './ThinkingView';
import { getSession, getSettings, listSessions, synthesizeCompletionAudio, type Message, type Session } from './api';
import { AudioPlaybackContext, defaultAudioPlaybackState, type AudioPlaybackState } from './audioPlayback';
import { THINKING_PROJECT_ID } from './thinking';
import './App.css';

const MOBILE_BREAKPOINT = 900;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = 'a2gent.sidebar.width';
const SIDEBAR_OPEN_STORAGE_KEY = 'a2gent.sidebar.open';

const COMPLETION_AUDIO_MODE = 'AAGENT_COMPLETION_AUDIO_MODE';
const COMPLETION_AUDIO_CONTENT = 'AAGENT_COMPLETION_AUDIO_CONTENT';
const SPEECH_ENABLED_KEY = 'AAGENT_SPEECH_ENABLED';
type CompletionAudioMode = 'off' | 'system' | 'elevenlabs';
type CompletionAudioContent = 'status' | 'final_response';

interface CompletionNotification {
  id: string;
  sessionId: string;
  title: string;
  status: string;
  createdAt: string;
  error?: string;
}

const readStoredWidth = () => {
  const rawWidth = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
  const parsed = rawWidth ? Number.parseInt(rawWidth, 10) : NaN;

  if (Number.isNaN(parsed)) {
    return DEFAULT_SIDEBAR_WIDTH;
  }

  return Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, parsed));
};

const readStoredOpenState = () => {
  const stored = localStorage.getItem(SIDEBAR_OPEN_STORAGE_KEY);

  if (stored === null) {
    return true;
  }

  return stored === '1';
};

function isTruthy(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function completionAudioMode(settings: Record<string, string>): 'off' | 'system' | 'elevenlabs' {
  const mode = (settings[COMPLETION_AUDIO_MODE] || '').trim().toLowerCase();
  if (mode === 'off' || mode === 'system' || mode === 'elevenlabs') {
    return mode;
  }
  return isTruthy(settings[SPEECH_ENABLED_KEY] || '') ? 'system' : 'off';
}

interface AudioPlaybackTracker {
  onStart: (mode: CompletionAudioMode) => void;
  onProgress: (charIndex: number, progress: number) => void;
  onPause: () => void;
  onResume: () => void;
  onEnd: () => void;
  onError: () => void;
}

function completionAudioContent(settings: Record<string, string>): CompletionAudioContent {
  const content = (settings[COMPLETION_AUDIO_CONTENT] || '').trim().toLowerCase();
  if (content === 'status' || content === 'final_response') {
    return content;
  }
  return 'status';
}

function isTerminalSessionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'completed' || normalized === 'failed';
}

function formatCompletionText(session: Session): string {
  const title = session.title?.trim() || `Session ${session.id.slice(0, 8)}`;
  return session.status === 'failed' ? `${title} failed.` : `${title} completed.`;
}

function findLastAssistantText(messages: Message[] | undefined): string {
  if (!messages || messages.length === 0) {
    return '';
  }
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.role !== 'assistant') {
      continue;
    }
    const content = message.content.trim();
    if (content !== '') {
      return content;
    }
  }
  return '';
}

async function playElevenLabsCompletionAudio(
  text: string,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  tracker: AudioPlaybackTracker,
): Promise<void> {
  const blob = await synthesizeCompletionAudio(text);
  const objectUrl = URL.createObjectURL(blob);
  const audio = new Audio(objectUrl);

  audioRef.current = audio;

  await new Promise<void>((resolve, reject) => {
    const pushProgress = () => {
      if (!Number.isFinite(audio.duration) || audio.duration <= 0) {
        tracker.onProgress(0, 0);
        return;
      }
      const progress = Math.min(1, Math.max(0, audio.currentTime / audio.duration));
      const charIndex = Math.min(text.length, Math.floor(text.length * progress));
      tracker.onProgress(charIndex, progress);
    };
    const cleanup = () => {
      audio.ontimeupdate = null;
      audio.onpause = null;
      audio.onplay = null;
      audio.onended = null;
      audio.onerror = null;
      if (audioRef.current === audio) {
        audioRef.current = null;
      }
      URL.revokeObjectURL(objectUrl);
    };
    audio.ontimeupdate = pushProgress;
    audio.onpause = () => {
      if (!audio.ended) {
        tracker.onPause();
      }
    };
    audio.onplay = () => {
      if (!audio.ended) {
        tracker.onResume();
      }
    };
    audio.onended = () => {
      tracker.onProgress(text.length, 1);
      tracker.onEnd();
      cleanup();
      resolve();
    };
    audio.onerror = () => {
      tracker.onError();
      cleanup();
      reject(new Error('Failed to play completion audio.'));
    };
    void audio.play().catch((error) => {
      tracker.onError();
      cleanup();
      reject(error instanceof Error ? error : new Error('Failed to play completion audio.'));
    });
    tracker.onStart('elevenlabs');
    pushProgress();
  });
}

function playSystemCompletionAudio(text: string, tracker: AudioPlaybackTracker): Promise<void> {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve, reject) => {
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.onstart = () => {
      tracker.onStart('system');
      tracker.onProgress(0, 0);
    };
    utterance.onboundary = (event) => {
      if (typeof event.charIndex !== 'number') {
        return;
      }
      const charIndex = Math.min(text.length, Math.max(0, event.charIndex));
      const progress = text.length > 0 ? charIndex / text.length : 0;
      tracker.onProgress(charIndex, progress);
    };
    utterance.onpause = () => tracker.onPause();
    utterance.onresume = () => tracker.onResume();
    utterance.onend = () => {
      tracker.onProgress(text.length, 1);
      tracker.onEnd();
      resolve();
    };
    utterance.onerror = () => {
      tracker.onError();
      reject(new Error('System speech playback failed.'));
    };
    window.speechSynthesis.speak(utterance);
  });
}

async function buildCompletionAudioText(session: Session, settings: Record<string, string>): Promise<string> {
  if (completionAudioContent(settings) !== 'final_response' || session.status === 'failed') {
    return formatCompletionText(session);
  }

  let lastAssistantText = findLastAssistantText(session.messages);
  if (lastAssistantText === '') {
    try {
      const fullSession = await getSession(session.id);
      lastAssistantText = findLastAssistantText(fullSession.messages);
    } catch (error) {
      console.error('Failed to load completed session messages for audio:', error);
    }
  }

  if (lastAssistantText === '') {
    return formatCompletionText(session);
  }
  return lastAssistantText;
}

async function playCompletionAudio(
  session: Session,
  settings: Record<string, string>,
  audioRef: React.MutableRefObject<HTMLAudioElement | null>,
  tracker: AudioPlaybackTracker,
  onSourceReady: (mode: CompletionAudioMode, sessionId: string, text: string) => void,
): Promise<void> {
  const mode = completionAudioMode(settings);
  if (mode === 'off') {
    return;
  }

  const text = await buildCompletionAudioText(session, settings);
  onSourceReady(mode, session.id, text);
  if (mode === 'system') {
    await playSystemCompletionAudio(text, tracker);
    return;
  }

  await playElevenLabsCompletionAudio(text, audioRef, tracker);
}

// Wrapper component to use navigate hook
function SessionsListWrapper() {
  const navigate = useNavigate();

  const handleSelectSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  return (
    <SessionsList
      onSelectSession={handleSelectSession}
    />
  );
}

function AppLayout() {
  const navigate = useNavigate();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(readStoredOpenState);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previousSessionSignatureRef = useRef<Map<string, string>>(new Map());
  const hasInitializedCompletionPollRef = useRef(false);
  const completionAudioRef = useRef<HTMLAudioElement | null>(null);
  const completionAudioQueueRef = useRef(Promise.resolve());
  const completionAudioQueueTokenRef = useRef(0);
  const [notifications, setNotifications] = useState<CompletionNotification[]>([]);
  const [completionSettings, setCompletionSettings] = useState<Record<string, string>>({});
  const [audioPlayback, setAudioPlayback] = useState<AudioPlaybackState>(defaultAudioPlaybackState);

  const isSidebarOpen = isMobile ? isMobileSidebarOpen : isDesktopSidebarOpen;

  const stopActivePlayback = useCallback(() => {
    completionAudioQueueTokenRef.current += 1;
    completionAudioQueueRef.current = Promise.resolve();

    if (completionAudioRef.current) {
      completionAudioRef.current.pause();
      completionAudioRef.current.currentTime = 0;
      completionAudioRef.current.dispatchEvent(new Event('ended'));
      completionAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setAudioPlayback(defaultAudioPlaybackState);
  }, []);

  const pauseActivePlayback = useCallback(() => {
    setAudioPlayback((previous) => {
      if (!previous.isActive || previous.isPaused) {
        return previous;
      }
      if (previous.mode === 'system') {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.pause();
        }
      } else if (completionAudioRef.current) {
        completionAudioRef.current.pause();
      }
      return { ...previous, isPaused: true };
    });
  }, []);

  const resumeActivePlayback = useCallback(() => {
    setAudioPlayback((previous) => {
      if (!previous.isActive || !previous.isPaused) {
        return previous;
      }
      if (previous.mode === 'system') {
        if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
          window.speechSynthesis.resume();
        }
      } else if (completionAudioRef.current) {
        void completionAudioRef.current.play().catch((error) => {
          console.error('Failed to resume completion audio:', error);
        });
      }
      return { ...previous, isPaused: false };
    });
  }, []);

  const onPlaybackSourceReady = useCallback((mode: CompletionAudioMode, sessionId: string, text: string) => {
    setAudioPlayback({
      isActive: false,
      isPaused: false,
      mode,
      sessionId,
      text,
      charIndex: 0,
      progress: 0,
    });
  }, []);

  const playbackTracker = useMemo<AudioPlaybackTracker>(() => ({
    onStart: (mode) => {
      setAudioPlayback((previous) => ({
        ...previous,
        mode,
        isActive: true,
        isPaused: false,
      }));
    },
    onProgress: (charIndex, progress) => {
      setAudioPlayback((previous) => ({
        ...previous,
        charIndex: Math.max(0, Math.min(previous.text.length, charIndex)),
        progress: Math.max(0, Math.min(1, progress)),
      }));
    },
    onPause: () => {
      setAudioPlayback((previous) => ({ ...previous, isPaused: true }));
    },
    onResume: () => {
      setAudioPlayback((previous) => ({ ...previous, isPaused: false, isActive: true }));
    },
    onEnd: () => {
      setAudioPlayback((previous) => ({
        ...previous,
        isActive: false,
        isPaused: false,
        charIndex: previous.text.length,
        progress: 1,
      }));
    },
    onError: () => {
      setAudioPlayback((previous) => ({ ...previous, isActive: false, isPaused: false }));
    },
  }), []);

  const audioPlaybackContextValue = useMemo(() => ({
    state: audioPlayback,
    pause: pauseActivePlayback,
    resume: resumeActivePlayback,
    stop: stopActivePlayback,
  }), [audioPlayback, pauseActivePlayback, resumeActivePlayback, stopActivePlayback]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT}px)`);

    const handleMediaChange = (event: MediaQueryListEvent) => {
      setIsMobile(event.matches);
    };

    setIsMobile(mediaQuery.matches);
    mediaQuery.addEventListener('change', handleMediaChange);

    return () => {
      mediaQuery.removeEventListener('change', handleMediaChange);
    };
  }, []);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_OPEN_STORAGE_KEY, isDesktopSidebarOpen ? '1' : '0');
  }, [isDesktopSidebarOpen]);

  useEffect(() => {
    localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
  }, [sidebarWidth]);

  useEffect(() => {
    if (!isMobile) {
      return;
    }

    setIsMobileSidebarOpen(false);
  }, [isMobile]);

  useEffect(() => {
    if (!isMobile || !isMobileSidebarOpen) {
      return;
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileSidebarOpen(false);
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => {
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMobile, isMobileSidebarOpen]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      if (!resizeStartRef.current) {
        return;
      }

      const deltaX = event.clientX - resizeStartRef.current.startX;
      const nextWidth = resizeStartRef.current.startWidth + deltaX;
      const boundedWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, nextWidth));
      setSidebarWidth(Math.round(boundedWidth));
    };

    const handlePointerUp = () => {
      resizeStartRef.current = null;
      document.body.classList.remove('sidebar-resizing');
      document.body.style.userSelect = '';
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);

    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const pollCompletions = async () => {
      try {
        const [sessions, settings] = await Promise.all([listSessions(), getSettings()]);
        if (cancelled) {
          return;
        }

        setCompletionSettings(settings);

        const nextSignature = new Map<string, string>();
        for (const session of sessions) {
          const signature = `${session.status}|${session.updated_at}`;
          nextSignature.set(session.id, signature);

          if (!hasInitializedCompletionPollRef.current) {
            continue;
          }

          const previous = previousSessionSignatureRef.current.get(session.id);
          if (session.project_id === THINKING_PROJECT_ID) {
            continue;
          }
          const isTerminal = isTerminalSessionStatus(session.status);
          const isNewTerminalSession = !previous && isTerminal;
          const isTransitionToTerminal = !!previous && previous !== signature && isTerminal;
          if (!isNewTerminalSession && !isTransitionToTerminal) {
            continue;
          }

          const notificationId = `${session.id}:${session.updated_at}`;
          setNotifications((prev) => {
            if (prev.some((item) => item.id === notificationId)) {
              return prev;
            }
            const next = [
              {
                id: notificationId,
                sessionId: session.id,
                title: session.title?.trim() || `Session ${session.id.slice(0, 8)}`,
                status: session.status,
                createdAt: session.updated_at,
              },
              ...prev,
            ];
            return next.slice(0, 6);
          });

          const queueToken = completionAudioQueueTokenRef.current;
          completionAudioQueueRef.current = completionAudioQueueRef.current
            .catch(() => undefined)
            .then(() => {
              if (queueToken !== completionAudioQueueTokenRef.current) {
                return;
              }
              return playCompletionAudio(session, settings, completionAudioRef, playbackTracker, onPlaybackSourceReady);
            })
            .catch((playbackError) => {
              const message = playbackError instanceof Error ? playbackError.message : 'Failed to play completion audio.';
              console.error('Completion audio playback failed:', playbackError);
              setNotifications((prev) => {
                const existing = prev.find((item) => item.id === notificationId);
                if (!existing) {
                  return prev;
                }
                return prev.map((item) => (item.id === notificationId ? { ...item, error: message } : item));
              });
            });
        }

        previousSessionSignatureRef.current = nextSignature;
        hasInitializedCompletionPollRef.current = true;
      } catch (error) {
        console.error('Failed to poll completion updates:', error);
      }
    };

    void pollCompletions();
    const intervalId = window.setInterval(() => {
      void pollCompletions();
    }, 4000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      stopActivePlayback();
    };
  }, [onPlaybackSourceReady, playbackTracker, stopActivePlayback]);

  const handleToggleSidebar = () => {
    if (isMobile) {
      setIsMobileSidebarOpen((isOpen) => !isOpen);
      return;
    }

    setIsDesktopSidebarOpen((isOpen) => !isOpen);
  };

  const handleStartResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    resizeStartRef.current = {
      startX: event.clientX,
      startWidth: sidebarWidth,
    };

    document.body.classList.add('sidebar-resizing');
    document.body.style.userSelect = 'none';
  };

  const handleSidebarNavigate = () => {
    if (isMobile) {
      setIsMobileSidebarOpen(false);
    }
  };

  const openNotificationSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  const removeNotification = (id: string) => {
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <AudioPlaybackContext.Provider value={audioPlaybackContextValue}>
      <div
      className={`app-container ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${isMobile ? 'mobile-layout' : 'desktop-layout'}`}
      style={
        {
          '--sidebar-width': `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      <button
        type="button"
        className="sidebar-toggle"
        onClick={handleToggleSidebar}
        aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
      >
        {isSidebarOpen ? '←' : '☰'}
      </button>

      {isMobile && isSidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      ) : null}

      <div className="sidebar-shell">
        <Sidebar onNavigate={handleSidebarNavigate} />
      </div>

      {!isMobile && isSidebarOpen ? (
        <div
          className="sidebar-resize-handle"
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={handleStartResize}
        />
      ) : null}

      {notifications.length > 0 && (
        <div className="completion-notification-stack" aria-live="polite" aria-atomic="false">
          {notifications.map((notification) => (
            <div key={notification.id} className="completion-notification-card">
              <div className="completion-notification-title-row">
                <strong>{notification.title}</strong>
                <span className={`completion-notification-status status-${notification.status}`}>
                  {notification.status}
                </span>
              </div>
              <div className="completion-notification-meta">
                {new Date(notification.createdAt).toLocaleTimeString()}
                {completionAudioMode(completionSettings) === 'off' ? ' • Audio off' : ''}
              </div>
              {notification.error ? (
                <div className="completion-notification-error">{notification.error}</div>
              ) : null}
              <div className="completion-notification-actions">
                <button type="button" className="settings-add-btn" onClick={() => openNotificationSession(notification.sessionId)}>
                  Open
                </button>
                <button type="button" className="settings-remove-btn" onClick={() => removeNotification(notification.id)}>
                  Dismiss
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(audioPlayback.isActive || audioPlayback.isPaused) && (
        <div className="global-playback-bar" role="region" aria-label="Audio playback controls">
          <div className="global-playback-main">
            <div className="global-playback-label">
              {audioPlayback.mode === 'system' ? 'System voice' : 'ElevenLabs'} playing
              {audioPlayback.isPaused ? ' (paused)' : ''}
            </div>
            <div className="global-playback-text">
              {audioPlayback.text.slice(0, 160)}
              {audioPlayback.text.length > 160 ? '…' : ''}
            </div>
            <div className="global-playback-progress-track" aria-hidden="true">
              <span className="global-playback-progress-fill" style={{ width: `${Math.round(audioPlayback.progress * 100)}%` }} />
            </div>
          </div>
          <div className="global-playback-actions">
            {audioPlayback.isPaused ? (
              <button type="button" className="settings-add-btn" onClick={resumeActivePlayback}>
                Resume
              </button>
            ) : (
              <button type="button" className="settings-add-btn" onClick={pauseActivePlayback}>
                Pause
              </button>
            )}
            <button type="button" className="settings-remove-btn" onClick={stopActivePlayback}>
              Stop
            </button>
          </div>
        </div>
      )}

      <div className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to="/sessions" replace />} />
          <Route path="/sessions" element={<SessionsListWrapper />} />
          <Route path="/chat/:sessionId?" element={<ChatView />} />
          <Route path="/agent/jobs" element={<JobsList />} />
          <Route path="/agent/jobs/new" element={<JobEdit />} />
          <Route path="/agent/jobs/edit/:jobId" element={<JobEdit />} />
          <Route path="/agent/jobs/:jobId" element={<JobDetail />} />
          <Route path="/integrations" element={<IntegrationsView />} />
          <Route path="/my-mind" element={<MyMindView />} />
          <Route path="/thinking" element={<ThinkingView />} />
          <Route path="/providers" element={<ProvidersView />} />
          <Route path="/providers/:providerType" element={<ProviderEditView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </div>
      </div>
    </AudioPlaybackContext.Provider>
  );
}

function App() {
  return (
    <Router>
      <AppLayout />
    </Router>
  );
}

export default App;
