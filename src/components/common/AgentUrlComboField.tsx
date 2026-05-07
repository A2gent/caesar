import { useEffect, useRef, useState } from 'react';

interface AgentUrlComboFieldProps {
  value: string;
  history: string[];
  onChange: (value: string) => void;
  onRemoveFromHistory: (url: string) => void;
  placeholder?: string;
}

function AgentUrlComboField({
  value,
  history,
  onChange,
  onRemoveFromHistory,
  placeholder = 'http://localhost:8080',
}: AgentUrlComboFieldProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const historyWithoutCurrent = history.filter((u) => u !== value);
  const hasHistory = historyWithoutCurrent.length > 0;

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleSelect = (url: string) => {
    onChange(url);
    setOpen(false);
  };

  const handleRemove = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    onRemoveFromHistory(url);
  };

  return (
    <div className="agent-url-combo" ref={containerRef}>
      <div className="agent-url-combo-input-row">
        <input
          type="text"
          className="agent-url-combo-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          autoComplete="off"
        />
        {hasHistory && (
          <button
            type="button"
            className="agent-url-combo-toggle"
            onClick={() => setOpen((v) => !v)}
            title="Show saved agent URLs"
            aria-expanded={open}
          >
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
              <path d="M2 4.5L7 9.5L12 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>
      {open && hasHistory && (
        <ul className="agent-url-combo-dropdown" role="listbox">
          {historyWithoutCurrent.map((url) => (
            <li
              key={url}
              className="agent-url-combo-option"
              role="option"
              aria-selected={false}
            >
              <button
                type="button"
                className="agent-url-combo-option-select"
                onClick={() => handleSelect(url)}
                title={url}
              >
                {url}
              </button>
              <button
                type="button"
                className="agent-url-combo-option-remove"
                onClick={(e) => handleRemove(e, url)}
                title="Remove this URL from history"
                aria-label={`Remove ${url}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default AgentUrlComboField;
