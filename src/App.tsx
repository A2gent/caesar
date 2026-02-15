import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import SessionsList from './SessionsList';
import JobsList from './JobsList';
import JobEdit from './JobEdit';
import JobDetail from './JobDetail';
import ChatView from './ChatView';
import IntegrationsView from './IntegrationsView';
import MCPServersView from './MCPServersView';
import ProviderEditView from './ProviderEditView';
import ProvidersView from './ProvidersView';
import FallbackAggregateCreateView from './FallbackAggregateCreateView';
import SettingsView from './SettingsView';
import MyMindView from './MyMindView';
import ThinkingView from './ThinkingView';
import SkillsView from './SkillsView';
import ToolsView from './ToolsView';
import { buildImageAssetUrl, fetchSpeechClip, getAppTitle, getSession, listSessions, setAppTitle as persistAppTitle } from './api';
import { THINKING_PROJECT_ID } from './thinking';
import { readWebAppNotification } from './toolResultEvents';
import { webAppNotificationEventName, type WebAppNotificationEventDetail } from './webappNotifications';
import './App.css';

const MOBILE_BREAKPOINT = 900;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = 'a2gent.sidebar.width';
const SIDEBAR_OPEN_STORAGE_KEY = 'a2gent.sidebar.open';

interface CompletionNotification {
  id: string;
  sessionId: string;
  title: string;
  status: string;
  createdAt: string;
  message?: string;
  imageUrl?: string;
  audioClipId?: string;
}

type NotificationAudioState = 'idle' | 'loading' | 'playing' | 'paused' | 'error';

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

function isTerminalSessionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'completed' || normalized === 'failed';
}

// Wrapper component to use navigate hook
function SessionsListWrapper() {
  const navigate = useNavigate();

  const handleSelectSession = (sessionId: string, initialMessage?: string) => {
    navigate(`/chat/${sessionId}`, {
      state: initialMessage ? { initialMessage } : undefined,
    });
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
  const seenWebAppNotificationIDsRef = useRef<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<CompletionNotification[]>([]);
  const [notificationAudioStates, setNotificationAudioStates] = useState<Record<string, NotificationAudioState>>({});
  const notificationAudioMapRef = useRef<Map<string, { audio: HTMLAudioElement; objectUrl: string }>>(new Map());
  const [appTitle, setAppTitle] = useState(() => getAppTitle());

  const isSidebarOpen = isMobile ? isMobileSidebarOpen : isDesktopSidebarOpen;

  useEffect(() => {
    document.title = appTitle;
  }, [appTitle]);

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

  const setNotificationAudioState = useCallback((id: string, next: NotificationAudioState) => {
    setNotificationAudioStates((prev) => ({
      ...prev,
      [id]: next,
    }));
  }, []);

  const stopOtherNotificationAudio = useCallback((exceptID: string) => {
    for (const [id, entry] of notificationAudioMapRef.current.entries()) {
      if (id === exceptID) {
        continue;
      }
      entry.audio.pause();
      entry.audio.currentTime = 0;
      setNotificationAudioState(id, 'idle');
    }
  }, [setNotificationAudioState]);

  const ensureNotificationAudio = useCallback(async (id: string, clipID: string): Promise<HTMLAudioElement> => {
    const existing = notificationAudioMapRef.current.get(id);
    if (existing) {
      return existing.audio;
    }

    setNotificationAudioState(id, 'loading');
    const blob = await fetchSpeechClip(clipID);
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.onended = () => {
      audio.currentTime = 0;
      setNotificationAudioState(id, 'idle');
    };
    audio.onpause = () => {
      if (!audio.ended && audio.currentTime > 0) {
        setNotificationAudioState(id, 'paused');
      }
    };
    audio.onerror = () => {
      setNotificationAudioState(id, 'error');
    };
    notificationAudioMapRef.current.set(id, { audio, objectUrl });
    return audio;
  }, [setNotificationAudioState]);

  const playNotificationAudio = useCallback(async (id: string, clipID: string) => {
    try {
      stopOtherNotificationAudio(id);
      const audio = await ensureNotificationAudio(id, clipID);
      await audio.play();
      setNotificationAudioState(id, 'playing');
    } catch (error) {
      console.error('Failed to play notification audio:', error);
      setNotificationAudioState(id, 'error');
    }
  }, [ensureNotificationAudio, setNotificationAudioState, stopOtherNotificationAudio]);

  const pauseNotificationAudio = useCallback((id: string) => {
    const entry = notificationAudioMapRef.current.get(id);
    if (!entry) {
      return;
    }
    entry.audio.pause();
    setNotificationAudioState(id, 'paused');
  }, [setNotificationAudioState]);

  const stopNotificationAudio = useCallback((id: string) => {
    const entry = notificationAudioMapRef.current.get(id);
    if (!entry) {
      return;
    }
    entry.audio.pause();
    entry.audio.currentTime = 0;
    setNotificationAudioState(id, 'idle');
  }, [setNotificationAudioState]);

  const disposeNotificationAudio = useCallback((id: string) => {
    const entry = notificationAudioMapRef.current.get(id);
    if (!entry) {
      setNotificationAudioStates((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      return;
    }

    entry.audio.pause();
    entry.audio.onended = null;
    entry.audio.onpause = null;
    entry.audio.onerror = null;
    URL.revokeObjectURL(entry.objectUrl);
    notificationAudioMapRef.current.delete(id);
    setNotificationAudioStates((prev) => {
      const next = { ...prev };
      delete next[id];
      return next;
    });
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
        const sessions = await listSessions();
        if (cancelled) {
          return;
        }

        const nextSignature = new Map<string, string>();
        const sessionsToRefresh: string[] = [];
        for (const session of sessions) {
          const signature = `${session.status}|${session.updated_at}`;
          nextSignature.set(session.id, signature);

          const previous = previousSessionSignatureRef.current.get(session.id);
          if (session.project_id === THINKING_PROJECT_ID) {
            continue;
          }

          if (hasInitializedCompletionPollRef.current && (!previous || previous !== signature)) {
            sessionsToRefresh.push(session.id);
          }

          if (!hasInitializedCompletionPollRef.current) {
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
        }

        previousSessionSignatureRef.current = nextSignature;
        hasInitializedCompletionPollRef.current = true;

        if (sessionsToRefresh.length > 0) {
          const refreshedSessions = await Promise.all(
            sessionsToRefresh.map(async (sessionID) => {
              try {
                return await getSession(sessionID);
              } catch (error) {
                console.error('Failed to refresh session for webapp notifications:', error);
                return null;
              }
            }),
          );

          if (cancelled) {
            return;
          }

          for (const refreshed of refreshedSessions) {
            if (!refreshed || !Array.isArray(refreshed.messages)) {
              continue;
            }
            for (const message of refreshed.messages) {
              const toolResults = message.tool_results || [];
              for (const result of toolResults) {
                if (result.is_error) {
                  continue;
                }
                const payload = readWebAppNotification(result);
                if (!payload) {
                  continue;
                }

                const notificationID = `${message.timestamp}:${result.tool_call_id}`;
                if (seenWebAppNotificationIDsRef.current.has(notificationID)) {
                  continue;
                }

                window.dispatchEvent(new CustomEvent<WebAppNotificationEventDetail>(webAppNotificationEventName, {
                  detail: {
                    id: notificationID,
                    title: payload.title || 'Agent notification',
                    message: payload.message,
                    level: payload.level,
                    createdAt: message.timestamp,
                    sessionId: refreshed.id,
                    imageUrl: payload.imageUrl || (payload.imagePath ? buildImageAssetUrl(payload.imagePath) : ''),
                    audioClipId: payload.audioClipId,
                    autoPlayAudio: payload.autoPlayAudio,
                  },
                }));
              }
            }
          }
        }
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
    };
  }, []);

  useEffect(() => {
    const onWebAppNotification = (event: Event) => {
      const detail = (event as CustomEvent<WebAppNotificationEventDetail>).detail;
      if (!detail || !detail.id) {
        return;
      }
      if (seenWebAppNotificationIDsRef.current.has(detail.id)) {
        return;
      }
      seenWebAppNotificationIDsRef.current.add(detail.id);
      setNotifications((prev) => {
        if (prev.some((item) => item.id === detail.id)) {
          return prev;
        }
        const next = [
          {
            id: detail.id,
            sessionId: detail.sessionId,
            title: detail.title,
            status: detail.level,
            createdAt: detail.createdAt,
            message: detail.message,
            imageUrl: detail.imageUrl,
            audioClipId: detail.audioClipId,
          },
          ...prev,
        ];
        return next.slice(0, 6);
      });

      if (detail.audioClipId && detail.autoPlayAudio !== false) {
        void playNotificationAudio(detail.id, detail.audioClipId);
      }
    };

    window.addEventListener(webAppNotificationEventName, onWebAppNotification as EventListener);
    return () => {
      window.removeEventListener(webAppNotificationEventName, onWebAppNotification as EventListener);
    };
  }, [playNotificationAudio]);

  useEffect(() => {
    const activeIDs = new Set(notifications.map((item) => item.id));
    for (const id of notificationAudioMapRef.current.keys()) {
      if (!activeIDs.has(id)) {
        disposeNotificationAudio(id);
      }
    }
  }, [notifications, disposeNotificationAudio]);

  useEffect(() => {
    return () => {
      const ids = Array.from(notificationAudioMapRef.current.keys());
      for (const id of ids) {
        disposeNotificationAudio(id);
      }
    };
  }, [disposeNotificationAudio]);

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

  const handleAppTitleChange = useCallback((nextTitle: string) => {
    const savedTitle = persistAppTitle(nextTitle);
    setAppTitle(savedTitle);
  }, []);

  const openNotificationSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  const removeNotification = (id: string) => {
    disposeNotificationAudio(id);
    setNotifications((prev) => prev.filter((item) => item.id !== id));
  };

  return (
    <div
      className={`app-container ${isSidebarOpen ? 'sidebar-open' : 'sidebar-closed'} ${isMobile ? 'mobile-layout' : 'desktop-layout'}`}
      style={
        {
          '--sidebar-width': `${sidebarWidth}px`,
        } as CSSProperties
      }
    >
      {isMobile ? (
        <button
          type="button"
          className="sidebar-toggle sidebar-toggle-mobile"
          onClick={handleToggleSidebar}
          aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
          title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
        >
          {isSidebarOpen ? '←' : '☰'}
        </button>
      ) : null}

      {isMobile && isSidebarOpen ? (
        <button
          type="button"
          className="sidebar-backdrop"
          onClick={() => setIsMobileSidebarOpen(false)}
          aria-label="Close sidebar"
        />
      ) : null}

      <div className="sidebar-shell">
        <Sidebar title={appTitle} onTitleChange={handleAppTitleChange} onNavigate={handleSidebarNavigate} />
      </div>

      {!isMobile ? (
        <div
          className={`sidebar-resize-handle ${isSidebarOpen ? 'can-resize' : ''}`}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize sidebar"
          onPointerDown={isSidebarOpen ? handleStartResize : undefined}
        >
          <button
            type="button"
            className="sidebar-toggle sidebar-toggle-handle"
            onClick={handleToggleSidebar}
            aria-label={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            title={isSidebarOpen ? 'Hide sidebar' : 'Show sidebar'}
            onPointerDown={(event) => event.stopPropagation()}
          >
            {isSidebarOpen ? '◀' : '▶'}
          </button>
        </div>
      ) : null}

      {notifications.length > 0 && (
        <div className="completion-notification-stack" aria-live="polite" aria-atomic="false">
          {notifications.map((notification) => (
            <div key={notification.id} className="completion-notification-card">
              {(() => {
                const audioState = notificationAudioStates[notification.id] || 'idle';
                const hasAudio = typeof notification.audioClipId === 'string' && notification.audioClipId.trim() !== '';
                return (
                  <>
              <div className="completion-notification-title-row">
                <strong>{notification.title}</strong>
                <span className={`completion-notification-status status-${notification.status}`}>
                  {notification.status}
                </span>
              </div>
              <div className="completion-notification-meta">
                {new Date(notification.createdAt).toLocaleTimeString()}
              </div>
              {notification.message ? <div className="completion-notification-meta">{notification.message}</div> : null}
              {notification.imageUrl ? (
                <img className="completion-notification-image" src={notification.imageUrl} alt="Notification" loading="lazy" />
              ) : null}
              {hasAudio ? (
                <div className="completion-notification-meta">Audio: {audioState}</div>
              ) : null}
              <div className="completion-notification-actions">
                {notification.sessionId ? (
                  <button type="button" className="settings-add-btn" onClick={() => openNotificationSession(notification.sessionId)}>
                    Open
                  </button>
                ) : null}
                {hasAudio ? (
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => void playNotificationAudio(notification.id, notification.audioClipId || '')}
                    disabled={audioState === 'loading' || audioState === 'playing'}
                    aria-label={audioState === 'paused' ? 'Resume audio' : 'Play audio'}
                    title={audioState === 'paused' ? 'Resume audio' : 'Play audio'}
                  >
                    {audioState === 'loading' ? '...' : '▶'}
                  </button>
                ) : null}
                {hasAudio ? (
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => pauseNotificationAudio(notification.id)}
                    disabled={audioState !== 'playing'}
                    aria-label="Pause audio"
                    title="Pause audio"
                  >
                    ⏸
                  </button>
                ) : null}
                {hasAudio ? (
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => stopNotificationAudio(notification.id)}
                    disabled={audioState !== 'playing' && audioState !== 'paused'}
                    aria-label="Stop audio"
                    title="Stop audio"
                  >
                    ■
                  </button>
                ) : null}
                <button type="button" className="settings-remove-btn" onClick={() => removeNotification(notification.id)}>
                  Dismiss
                </button>
              </div>
                  </>
                );
              })()}
            </div>
          ))}
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
          <Route path="/mcp" element={<MCPServersView />} />
          <Route path="/my-mind" element={<MyMindView />} />
          <Route path="/thinking" element={<ThinkingView />} />
          <Route path="/providers" element={<ProvidersView />} />
          <Route path="/providers/fallback-aggregates/new" element={<FallbackAggregateCreateView />} />
          <Route path="/providers/:providerType" element={<ProviderEditView />} />
          <Route path="/tools" element={<ToolsView />} />
          <Route path="/skills" element={<SkillsView />} />
          <Route path="/settings" element={<SettingsView />} />
        </Routes>
      </div>
    </div>
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
