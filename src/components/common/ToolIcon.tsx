export function ToolIcon({ toolName, label }: { toolName: string; label?: string }) {
    const normalized = toolName.trim().toLowerCase();
    const title = label || toolName;
    const commonProps = { className: 'tool-icon-svg', viewBox: '0 0 24 24', 'aria-hidden': true as const };

    switch (normalized) {
        case 'browser_chrome':
            return (
                <span className="tool-icon-component tool-icon-browser-chrome" title={title}>
                    <svg {...commonProps}>
                        <circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
                        <circle cx="12" cy="12" r="3.5" fill="currentColor" />
                        <path d="M12 3v6M12 15v6M3 12h6M15 12h6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
                        <path d="M6.3 6.3l4.2 4.2M13.5 13.5l4.2 4.2M6.3 17.7l4.2-4.2M13.5 10.5l4.2-4.2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" opacity="0.6" />
                    </svg>
                </span>
            );
        default:
            return null;
    }
}
