import { Link, useLocation } from 'react-router-dom';

interface NavItem {
  id: string;
  label: string;
  path: string;
}

interface SidebarProps {
  onNavigate?: () => void;
}

const navItems: NavItem[] = [
  { id: 'sessions', label: 'Sessions', path: '/sessions' },
  { id: 'my-mind', label: 'My Mind', path: '/my-mind' },
  { id: 'jobs', label: 'Recurring jobs', path: '/agent/jobs' },
  { id: 'settings', label: 'Settings', path: '/settings' },
  { id: 'integrations', label: 'Integrations', path: '/integrations' },
  { id: 'providers', label: 'LLM providers', path: '/providers' },
];

function Sidebar({ onNavigate }: SidebarProps) {
  const location = useLocation();

  return (
    <div className="sidebar">
      <Link to="/" className="sidebar-title-link" onClick={onNavigate}>
        <h2 className="sidebar-title">A2gent</h2>
      </Link>

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
