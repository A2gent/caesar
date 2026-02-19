import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
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
import ProjectView from './ProjectView';
import ThinkingView from './ThinkingView';
import SkillsView from './SkillsView';
import ToolsView from './ToolsView';
import NotificationsView from './NotificationsView';
import { buildImageAssetUrl, fetchAgentName, fetchSpeechClip, getSession, listSessions, saveAgentName } from './api';
import { THINKING_PROJECT_ID } from './thinking';
import { SYSTEM_PROJECT_KB_ID, SYSTEM_PROJECT_AGENT_ID } from './Sidebar';
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

function activeChatSessionIdFromPath(pathname: string): string | null {
  const match = pathname.match(/^\/chat\/([^/]+)$/);
  if (!match || !match[1]) {
    return null;
  }
  return decodeURIComponent(match[1]);
}

function AppLayout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(readStoredOpenState);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);
  const previousSessionSignatureRef = useRef<Map<string, string>>(new Map());
  const hasInitializedCompletionPollRef = useRef(false);
  const seenWebAppNotificationIDsRef = useRef<Set<string>>(new Set());
  const [notifications, setNotifications] = useState<CompletionNotification[]>([]);
  const notificationAudioMapRef = useRef<Map<string, { audio: HTMLAudioElement; objectUrl: string }>>(new Map());
  const [appTitle, setAppTitle] = useState('🤖 A2');
  const [newestNotificationID, setNewestNotificationID] = useState<string | null>(null);
  const [toastNotifications, setToastNotifications] = useState<CompletionNotification[]>([]);
  const toastTimeoutsRef = useRef<Map<string, number>>(new Map());

  const isSidebarOpen = isMobile ? isMobileSidebarOpen : isDesktopSidebarOpen;

  const refreshAgentName = useCallback(async () => {
    const name = await fetchAgentName();
    setAppTitle(name);
  }, []);

  useEffect(() => {
    void refreshAgentName();
  }, [refreshAgentName]);

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

  const NOTIFICATIONS_STORAGE_KEY = 'a2gent.notifications';
  const SEEN_NOTIFICATION_IDS_KEY = 'a2gent.seen-notification-ids';

  // Load notifications and seen IDs from localStorage on mount
  useEffect(() => {
    const stored = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        setNotifications(parsed);
      } catch {
        // Invalid JSON, ignore
      }
    }

    const storedSeenIds = localStorage.getItem(SEEN_NOTIFICATION_IDS_KEY);
    if (storedSeenIds) {
      try {
        const parsed = JSON.parse(storedSeenIds);
        if (Array.isArray(parsed)) {
          parsed.forEach(id => seenWebAppNotificationIDsRef.current.add(id));
        }
      } catch {
        // Invalid JSON, ignore
      }
    }
  }, []);

  // Persist notifications to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
  }, [notifications]);

  // Persist seen notification IDs to localStorage
  const persistSeenNotificationIds = useCallback(() => {
    const ids = Array.from(seenWebAppNotificationIDsRef.current);
    // Keep only the most recent 100 IDs to prevent storage bloat
    const recentIds = ids.slice(-100);
    localStorage.setItem(SEEN_NOTIFICATION_IDS_KEY, JSON.stringify(recentIds));
  }, []);

  const pushNotification = useCallback((notification: CompletionNotification) => {
    let inserted = false;
    setNotifications((prev) => {
      if (prev.some((item) => item.id === notification.id)) {
        return prev;
      }
      inserted = true;
      return [notification, ...prev].slice(0, 50); // Max 50 notifications stored
    });

    if (!inserted) {
      return;
    }
    setNewestNotificationID(notification.id);
    
    // Add to toast notifications for bottom-left display
    setToastNotifications(prev => {
      const newToasts = [notification, ...prev].slice(0, 5); // Max 5 toasts
      return newToasts;
    });
    
    // Set up auto-dismiss timer for this notification
    const timeoutId = window.setTimeout(() => {
      setToastNotifications(prev => prev.filter(n => n.id !== notification.id));
      toastTimeoutsRef.current.delete(notification.id);
    }, 10000); // 10 seconds
    
    toastTimeoutsRef.current.set(notification.id, timeoutId);
  }, []);

  const clearAllNotifications = useCallback(() => {
    setNotifications([]);
    localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
    // Also clear seen notification IDs so old notifications can appear again if needed
    seenWebAppNotificationIDsRef.current.clear();
    localStorage.removeItem(SEEN_NOTIFICATION_IDS_KEY);
  }, []);

  const dismissNotification = useCallback((id: string) => {
    setNotifications(prev => prev.filter(n => n.id !== id));
  }, []);

  const stopOtherNotificationAudio = useCallback((exceptID: string) => {
    for (const [id, entry] of notificationAudioMapRef.current.entries()) {
      if (id === exceptID) {
        continue;
      }
      entry.audio.pause();
      entry.audio.currentTime = 0;
    }
  }, []);

  const ensureNotificationAudio = useCallback(async (id: string, clipID: string): Promise<HTMLAudioElement> => {
    const existing = notificationAudioMapRef.current.get(id);
    if (existing) {
      return existing.audio;
    }

    const blob = await fetchSpeechClip(clipID);
    const objectUrl = URL.createObjectURL(blob);
    const audio = new Audio(objectUrl);
    audio.onended = () => {
      audio.currentTime = 0;
    };
    notificationAudioMapRef.current.set(id, { audio, objectUrl });
    return audio;
  }, []);

  const playNotificationAudio = useCallback(async (id: string, clipID: string) => {
    try {
      stopOtherNotificationAudio(id);
      const audio = await ensureNotificationAudio(id, clipID);
      await audio.play();
    } catch (error) {
      console.error('Failed to play notification audio:', error);
    }
  }, [ensureNotificationAudio, stopOtherNotificationAudio]);

  const disposeNotificationAudio = useCallback((id: string) => {
    const entry = notificationAudioMapRef.current.get(id);
    if (!entry) {
      return;
    }

    entry.audio.pause();
    entry.audio.onended = null;
    URL.revokeObjectURL(entry.objectUrl);
    notificationAudioMapRef.current.delete(id);
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
      if (!resizeStartRef.current) return;
      const delta = event.clientX - resizeStartRef.current.startX;
      const newWidth = Math.min(MAX_SIDEBAR_WIDTH, Math.max(MIN_SIDEBAR_WIDTH, resizeStartRef.current.startWidth + delta));
      setSidebarWidth(newWidth);
    };

    const handlePointerUp = () => {
      if (resizeStartRef.current) {
        resizeStartRef.current = null;
        document.body.classList.remove('sidebar-resizing');
        document.body.style.userSelect = '';
      }
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
          const activeChatSessionId = activeChatSessionIdFromPath(location.pathname);
          const isViewingCompletedSession = session.status === 'completed' && activeChatSessionId === session.id;
          if (isViewingCompletedSession) {
            continue;
          }

          const notificationId = `${session.id}:${session.updated_at}`;
          pushNotification({
            id: notificationId,
            sessionId: session.id,
            title: session.title?.trim() || `Session ${session.id.slice(0, 8)}`,
            status: session.status,
            createdAt: session.updated_at,
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
  }, [location.pathname, pushNotification]);

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
      persistSeenNotificationIds();
      pushNotification({
        id: detail.id,
        sessionId: detail.sessionId,
        title: detail.title,
        status: detail.level,
        createdAt: detail.createdAt,
        message: detail.message,
        imageUrl: detail.imageUrl,
        audioClipId: detail.audioClipId,
      });

      if (detail.audioClipId && detail.autoPlayAudio !== false) {
        void playNotificationAudio(detail.id, detail.audioClipId);
      }
    };

    window.addEventListener(webAppNotificationEventName, onWebAppNotification as EventListener);
    return () => {
      window.removeEventListener(webAppNotificationEventName, onWebAppNotification as EventListener);
    };
  }, [playNotificationAudio, pushNotification, persistSeenNotificationIds]);

  useEffect(() => {
    if (!newestNotificationID) {
      return;
    }
    const timeoutID = window.setTimeout(() => {
      setNewestNotificationID((current) => (current === newestNotificationID ? null : current));
    }, 1200);
    return () => {
      window.clearTimeout(timeoutID);
    };
  }, [newestNotificationID]);

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
      // Clear all toast timeouts
      for (const timeoutId of toastTimeoutsRef.current.values()) {
        window.clearTimeout(timeoutId);
      }
      toastTimeoutsRef.current.clear();
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
    const trimmed = nextTitle.trim() || '🤖 A2';
    setAppTitle(trimmed);
    void saveAgentName(trimmed);
  }, []);

  const openNotificationSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  const dismissToast = (id: string) => {
    const timeoutId = toastTimeoutsRef.current.get(id);
    if (timeoutId) {
      window.clearTimeout(timeoutId);
      toastTimeoutsRef.current.delete(id);
    }
    setToastNotifications(prev => prev.filter(n => n.id !== id));
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
        <Sidebar 
          title={appTitle} 
          onTitleChange={handleAppTitleChange} 
          onNavigate={handleSidebarNavigate}
          notificationCount={notifications.length}
        />
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

      {/* Toast Notifications Container */}
      <div className="toast-notifications-container">
        {toastNotifications.map((notification, index) => (
          <div
            key={notification.id}
            className={`toast-notification ${notification.id === newestNotificationID ? 'is-new' : ''}`}
            style={{ '--toast-index': index } as CSSProperties}
          >
            <button
              type="button"
              className="toast-dismiss-btn"
              onClick={() => dismissToast(notification.id)}
              aria-label="Dismiss notification"
            >
              ×
            </button>
            <div className="toast-content">
              <div className="toast-title-row">
                <strong className="toast-title">{notification.title}</strong>
                <span className={`toast-status status-${notification.status}`}>
                  {notification.status}
                </span>
              </div>
              {notification.message ? (
                <div className="toast-message">{notification.message}</div>
              ) : null}
              {notification.imageUrl ? (
                <img 
                  className="toast-image" 
                  src={notification.imageUrl} 
                  alt="Notification" 
                  loading="lazy" 
                />
              ) : null}
              <div className="toast-actions">
                {notification.sessionId ? (
                  <button 
                    type="button" 
                    className="toast-action-btn"
                    onClick={() => {
                      openNotificationSession(notification.sessionId);
                      dismissToast(notification.id);
                    }}
                  >
                    Open
                  </button>
                ) : null}
                {notification.audioClipId ? (
                  <button
                    type="button"
                    className="toast-action-btn"
                    onClick={() => void playNotificationAudio(notification.id, notification.audioClipId || '')}
                  >
                    ▶
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="main-content">
        <Routes>
          <Route path="/" element={<Navigate to={`/projects/${SYSTEM_PROJECT_KB_ID}`} replace />} />
          {/* Legacy routes - redirect to project routes */}
          <Route path="/sessions" element={<Navigate to={`/projects/${SYSTEM_PROJECT_KB_ID}`} replace />} />
          <Route path="/agent/sessions" element={<Navigate to={`/projects/${SYSTEM_PROJECT_AGENT_ID}`} replace />} />
          <Route path="/my-mind" element={<Navigate to={`/projects/${SYSTEM_PROJECT_KB_ID}`} replace />} />
          <Route path="/chat/:sessionId?" element={<ChatView />} />
          <Route path="/agent/jobs" element={<JobsList />} />
          <Route path="/agent/jobs/new" element={<JobEdit />} />
          <Route path="/agent/jobs/edit/:jobId" element={<JobEdit />} />
          <Route path="/agent/jobs/:jobId" element={<JobDetail />} />
          <Route path="/integrations" element={<IntegrationsView />} />
          <Route path="/mcp" element={<MCPServersView />} />
          <Route path="/thinking" element={<ThinkingView />} />
          <Route path="/providers" element={<ProvidersView />} />
          <Route path="/providers/fallback-aggregates/new" element={<FallbackAggregateCreateView />} />
          <Route path="/providers/:providerType" element={<ProviderEditView />} />
          <Route path="/tools" element={<ToolsView />} />
          <Route path="/notifications" element={<NotificationsView notifications={notifications} onClearAll={clearAllNotifications} onDismiss={dismissNotification} />} />
          <Route path="/skills" element={<SkillsView />} />
          <Route path="/settings" element={<SettingsView onAgentNameRefresh={refreshAgentName} />} />
          <Route path="/projects/:projectId" element={<ProjectView />} />
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
