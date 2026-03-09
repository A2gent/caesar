import React, { useState } from 'react';
import type { SystemPromptSnapshot } from './api';

interface SystemPromptMessageProps {
  systemPromptSnapshot: SystemPromptSnapshot | null | undefined;
}

const SystemPromptMessage: React.FC<SystemPromptMessageProps> = ({ systemPromptSnapshot }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!systemPromptSnapshot) {
    return null;
  }

  const hasSystemPromptBlocks = (systemPromptSnapshot?.blocks?.length || 0) > 0;

  return (
    <div className="message message-system-prompt">
      <div className="message-header">
        <span className="message-role">System</span>
        <button
          type="button"
          className={`system-prompt-toggle${isExpanded ? ' expanded' : ''}`}
          onClick={() => setIsExpanded((prev) => !prev)}
          title="View the exact system prompt snapshot used for this session"
        >
          {hasSystemPromptBlocks ? 'System prompt used' : 'Default system prompt'}
          <span className="toggle-icon">{isExpanded ? '▼' : '▶'}</span>
        </button>
      </div>

      {isExpanded ? (
        <div className="message-content">
          <div className="system-prompt-panel">
            <p className="system-prompt-summary">
              {hasSystemPromptBlocks
                ? `${systemPromptSnapshot.blocks.length} instruction block(s) captured for this session.`
                : 'No custom instruction blocks were captured for this session.'}
            </p>
            {systemPromptSnapshot.blocks.length > 0 ? (
              <ol className="system-prompt-blocks">
                {systemPromptSnapshot.blocks.map((block, index) => (
                  <li className="system-prompt-block" key={`prompt-block-${index}`}>
                    <p className="system-prompt-block-header">
                      #{index + 1} {block.type || 'text'} {block.enabled ? '' : '(disabled)'}
                    </p>
                    {block.value ? <p className="system-prompt-block-meta">Configured value: {block.value}</p> : null}
                    {block.source_path ? <p className="system-prompt-block-meta">Source file: {block.source_path}</p> : null}
                    {block.error ? <p className="system-prompt-block-error">Error: {block.error}</p> : null}
                    {block.resolved_content ? <pre className="system-prompt-block-content">{block.resolved_content}</pre> : null}
                  </li>
                ))}
              </ol>
            ) : null}
            <details className="system-prompt-full">
              <summary>Full composed system prompt</summary>
              <pre className="system-prompt-full-content">{systemPromptSnapshot.combined_prompt}</pre>
            </details>
          </div>
        </div>
      ) : null}
    </div>
  );
};

export default SystemPromptMessage;
