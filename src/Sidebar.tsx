import React, { useState } from 'react';

interface NavItem {
  id: string;
  label: string;
  path: string;
  subItems?: NavItem[];
}

const navItems: NavItem[] = [
  { id: 'mind', label: 'My mind', path: '/mind' },
  { id: 'projects', label: 'Projects', path: '/projects' },
  {
    id: 'agent',
    label: 'Agent',
    path: '/agent',
    subItems: [
      { id: 'thoughts', label: 'Thoughts', path: '/agent/thoughts' },
      { id: 'jobs', label: 'Recurring jobs', path: '/agent/jobs' },
      { id: 'datasources', label: 'Datasources', path: '/agent/datasources' },
    ],
  },
];

const Sidebar: React.FC = () => {
  const [expandedItem, setExpandedItem] = useState<string | null>('agent'); // 'agent' expanded by default for demo

  const toggleExpand = (itemId: string) => {
    setExpandedItem(expandedItem === itemId ? null : itemId);
  };

  const renderNavItems = (items: NavItem[], isSub?: boolean) => {
    return (
      <ul style={{ listStyle: 'none', paddingLeft: isSub ? '20px' : '0', margin: '0' }}>
        {items.map(item => (
          <li key={item.id} style={{ marginBottom: '2px' }}>
            <div
              style={{
                cursor: 'pointer',
                fontWeight: item.subItems ? 'bold' : 'normal',
                padding: '8px 5px',
                borderRadius: '4px',
                backgroundColor: isSub ? '#3a3a3a' : 'inherit',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
              onClick={() => item.subItems ? toggleExpand(item.id) : console.log(\`Navigating to \${item.path}\`)}
            >
              {item.label}
              {item.subItems && (
                <span style={{ marginLeft: '10px', transition: 'transform 0.2s', fontSize: '12px' }}>
                  {expandedItem === item.id ? '▼' : '▶'}
                </span>
              )}
            </div>
            {item.subItems && expandedItem === item.id && (
              renderNavItems(item.subItems, true)
            )}
          </li>
        ))}
      </ul>
    );
  };

  return (
    <div style={{ 
        width: '250px', 
        backgroundColor: '#242424', 
        color: 'white', 
        height: '100vh', 
        padding: '20px 10px', 
        boxSizing: 'border-box', 
        borderRight: '1px solid #333'
    }}>
      <h2 style={{ borderBottom: '1px solid #333', paddingBottom: '15px', marginTop: '0', fontSize: '1.5em', textAlign: 'center' }}>A2gent App</h2>
      <nav>
        {renderNavItems(navItems)}
      </nav>
    </div>
  );
};

export default Sidebar;
