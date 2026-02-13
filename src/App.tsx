import { useEffect, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent as ReactPointerEvent } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import Sidebar from './Sidebar';
import SessionsList from './SessionsList';
import JobsList from './JobsList';
import JobEdit from './JobEdit';
import JobDetail from './JobDetail';
import ChatView from './ChatView';
import IntegrationsView from './IntegrationsView';
import SettingsView from './SettingsView';
import './App.css';

const MOBILE_BREAKPOINT = 900;
const DEFAULT_SIDEBAR_WIDTH = 280;
const MIN_SIDEBAR_WIDTH = 220;
const MAX_SIDEBAR_WIDTH = 480;
const SIDEBAR_WIDTH_STORAGE_KEY = 'a2gent.sidebar.width';
const SIDEBAR_OPEN_STORAGE_KEY = 'a2gent.sidebar.open';

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

// Wrapper component to use navigate hook
function SessionsListWrapper() {
  const navigate = useNavigate();

  const handleSelectSession = (sessionId: string) => {
    navigate(`/chat/${sessionId}`);
  };

  const handleCreateSession = () => {
    navigate('/chat');
  };

  return (
    <SessionsList
      onSelectSession={handleSelectSession}
      onCreateSession={handleCreateSession}
    />
  );
}

function App() {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth <= MOBILE_BREAKPOINT);
  const [isDesktopSidebarOpen, setIsDesktopSidebarOpen] = useState(readStoredOpenState);
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [sidebarWidth, setSidebarWidth] = useState(readStoredWidth);
  const resizeStartRef = useRef<{ startX: number; startWidth: number } | null>(null);

  const isSidebarOpen = isMobile ? isMobileSidebarOpen : isDesktopSidebarOpen;

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

  return (
    <Router>
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

        <div className="main-content">
          <Routes>
            {/* Redirect root to sessions */}
            <Route path="/" element={<Navigate to="/sessions" replace />} />

            {/* Sessions List */}
            <Route path="/sessions" element={<SessionsListWrapper />} />

            {/* Chat View - for a specific session or new session */}
            <Route
              path="/chat/:sessionId?"
              element={<ChatView />}
            />

            {/* Jobs Routes */}
            <Route path="/agent/jobs" element={<JobsList />} />
            <Route path="/agent/jobs/new" element={<JobEdit />} />
            <Route path="/agent/jobs/edit/:jobId" element={<JobEdit />} />
            <Route path="/agent/jobs/:jobId" element={<JobDetail />} />

            {/* Integrations */}
            <Route path="/integrations" element={<IntegrationsView />} />

            {/* Settings */}
            <Route path="/settings" element={<SettingsView />} />
          </Routes>
        </div>
      </div>
    </Router>
  );
}

export default App;
