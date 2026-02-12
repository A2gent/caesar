import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import type { Session } from './api';

interface NavItem {
  id: string;
  label: string;
  path: string;
}

interface SidebarProps {
  sessions: Session[];
  currentSessionId?: string;
  onSelectSession: (sessionId: string) => void;
  onCreateSession: () => void;
  onDeleteSession: (sessionId: string) => void;
  currentPage?: 'chat' | 'jobs';
}

const navItems: NavItem[] = [
  { id: 'jobs', label: 'Recurring jobs', path: '/agent/jobs' },
];

function Sidebar({ 
  sessions, 
  currentSessionId, 
  onSelectSession, 
  onCreateSession,
  onDeleteSession,
  currentPage = 'chat'
}: SidebarProps) {
  const [expandedItem, setExpandedItem] = useState<string | null>('sessions');
  const navigate = useNavigate();
  const location = useLocation();

  const toggleExpand = (itemId: string) => {
    setExpandedItem(expandedItem === itemId ? null : itemId);
  };

  const formatSessionTitle = (session: Session) => {
    if (session.title) {
      return session.title.length > 25 
        ? session.title.substring(0, 25) + '...' 
        : session.title;
    }
    return `Session ${session.id.substring(0, 8)}`;
  };

  const formatDate = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString();
  };

  const handleSessionClick = (sessionId: string) => {
    onSelectSession(sessionId);
    if (currentPage !== 'chat') {
      navigate('/chat');
    }
  };

  return (
    <div className="sidebar">
      <Link to="/" className="sidebar-title-link">
        <h2 className="sidebar-title">A2gent</h2>
      </Link>
      
      {/* Sessions Section */}
      <div className="sidebar-section">
        <div 
          className="sidebar-section-header"
          onClick={() => toggleExpand('sessions')}
        >
          <span>Sessions</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <button 
              className="new-session-btn"
              onClick={(e) => {
                e.stopPropagation();
                onCreateSession();
              }}
              title="New Session"
            >
              +
            </button>
            <span style={{ fontSize: '12px' }}>
              {expandedItem === 'sessions' ? '▼' : '▶'}
            </span>
          </div>
        </div>
        
        {expandedItem === 'sessions' && (
          <ul className="session-list">
            {sessions.length === 0 ? (
              <li className="session-item empty">No sessions yet</li>
            ) : (
              sessions.map(session => (
                <li 
                  key={session.id} 
                  className={`session-item ${currentSessionId === session.id && currentPage === 'chat' ? 'active' : ''}`}
                >
                  <div 
                    className="session-item-content"
                    onClick={() => handleSessionClick(session.id)}
                  >
                    <span className="session-item-title">{formatSessionTitle(session)}</span>
                    <span className="session-item-meta">
                      <span className={`status-dot status-${session.status}`}></span>
                      {formatDate(session.updated_at)}
                    </span>
                  </div>
                  <button 
                    className="session-delete-btn"
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this session?')) {
                        onDeleteSession(session.id);
                      }
                    }}
                    title="Delete session"
                  >
                    ×
                  </button>
                </li>
              ))
            )}
          </ul>
        )}
      </div>

      {/* Navigation Section */}
      <div className="sidebar-section">
        <nav>
          <ul className="nav-list" style={{ listStyle: 'none', padding: '0', margin: '0' }}>
            {navItems.map(item => (
              <li key={item.id} className="nav-item">
                <Link 
                  to={item.path}
                  className={`nav-link ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
                >
                  {item.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
    </div>
  );
}

export default Sidebar;
