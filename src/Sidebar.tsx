import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';

interface NavItem {
  id: string;
  label: string;
  path: string;
}

interface SidebarProps {
  title: string;
  onTitleChange: (title: string) => void;
  onNavigate?: () => void;
}

const navItems: NavItem[] = [
  { id: 'sessions', label: '💬 Sessions', path: '/sessions' },
  { id: 'my-mind', label: '🧠 My Mind', path: '/my-mind' },
  { id: 'thinking', label: '🤔 Thinking', path: '/thinking' },
  { id: 'jobs', label: '🗓️ Recurring jobs', path: '/agent/jobs' },
  { id: 'skills', label: '🧰 Skills', path: '/skills' },
  { id: 'settings', label: '⚙️ Settings', path: '/settings' },
  { id: 'integrations', label: '🔌 Integrations', path: '/integrations' },
  { id: 'providers', label: '🤖 LLM providers', path: '/providers' },
];

function Sidebar({ title, onTitleChange, onNavigate }: SidebarProps) {
  const location = useLocation();
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    setTitleDraft(title);
  }, [title]);

  useEffect(() => {
    if (!isEditingTitle) {
      return;
    }
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, [isEditingTitle]);

  const commitTitleEdit = () => {
    onTitleChange(titleDraft);
    setIsEditingTitle(false);
  };

  const cancelTitleEdit = () => {
    setTitleDraft(title);
    setIsEditingTitle(false);
  };

  return (
    <div className="sidebar">
      <div className="sidebar-title-wrap">
        {isEditingTitle ? (
          <input
            ref={titleInputRef}
            className="sidebar-title-input"
            value={titleDraft}
            onChange={(event) => setTitleDraft(event.target.value)}
            onBlur={commitTitleEdit}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                commitTitleEdit();
              } else if (event.key === 'Escape') {
                event.preventDefault();
                cancelTitleEdit();
              }
            }}
            aria-label="Edit app title"
          />
        ) : (
          <button
            type="button"
            className="sidebar-title-button"
            onClick={() => setIsEditingTitle(true)}
            title="Click to rename app title"
          >
            <h2 className="sidebar-title">{title}</h2>
          </button>
        )}
      </div>

      <nav className="sidebar-nav">
        <ul className="nav-list">
          {navItems.map(item => (
            <li key={item.id} className="nav-item">
              <Link
                to={item.path}
                className={`nav-link ${location.pathname.startsWith(item.path) ? 'active' : ''}`}
                onClick={onNavigate}
              >
                {item.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

export default Sidebar;
