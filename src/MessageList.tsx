import React, { useContext, useEffect, useMemo, useRef } from 'react';
import type { Message, ToolCall, ToolResult } from './api';
import { AudioPlaybackContext } from './audioPlayback';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
}

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, sessionId }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const audioPlayback = useContext(AudioPlaybackContext);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const renderToolCalls = (toolCalls: ToolCall[]) => {
    return (
      <div className="tool-calls">
        {toolCalls.map((tc) => (
          <div key={tc.id} className="tool-call">
            <div className="tool-call-header">
              <span className="tool-icon">⚙</span>
              <span className="tool-name">{tc.name}</span>
            </div>
            <pre className="tool-input">{JSON.stringify(tc.input, null, 2)}</pre>
          </div>
        ))}
      </div>
    );
  };

  const renderToolResults = (toolResults: ToolResult[]) => {
    return (
      <div className="tool-results">
        {toolResults.map((tr) => (
          <div key={tr.tool_call_id} className={`tool-result ${tr.is_error ? 'error' : ''}`}>
            <div className="tool-result-header">
              <span className={tr.is_error ? 'result-icon-error' : 'result-icon'}>
                {tr.is_error ? '✗' : '✓'}
              </span>
              <span>Result</span>
            </div>
            <pre className="tool-result-content">{tr.content}</pre>
          </div>
        ))}
      </div>
    );
  };

  const formatContent = (content: string) => {
    const lines = content.split('\n');
    return lines.map((line, i) => (
      <React.Fragment key={i}>
        {line}
        {i < lines.length - 1 && <br />}
      </React.Fragment>
    ));
  };

  const highlightedAssistantIndex = useMemo(() => {
    const active = audioPlayback.state;
    if (!active.text || !active.sessionId || !sessionId || active.sessionId !== sessionId) {
      return -1;
    }
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i];
      if (message.role === 'assistant' && message.content === active.text) {
        return i;
      }
    }
    return -1;
  }, [audioPlayback.state, messages, sessionId]);

  const renderMessageContent = (message: Message, index: number) => {
    const isHighlightedAssistantMessage = index === highlightedAssistantIndex && message.role === 'assistant';
    if (!isHighlightedAssistantMessage) {
      return formatContent(message.content);
    }

    const highlightedChars = Math.max(0, Math.min(message.content.length, audioPlayback.state.charIndex));
    if (highlightedChars <= 0) {
      return formatContent(message.content);
    }

    const spoken = message.content.slice(0, highlightedChars);
    const remaining = message.content.slice(highlightedChars);
    return (
      <>
        <span className="message-spoken-text">{formatContent(spoken)}</span>
        {formatContent(remaining)}
      </>
    );
  };

  return (
    <div className="message-list">
      {messages.map((message, index) => (
        <div key={index} className={`message message-${message.role}`}>
          <div className="message-header">
            <span className="message-role">
              {message.role === 'user' ? 'You' : message.role === 'assistant' ? 'Agent' : 'Tool'}
            </span>
            <span className="message-time">
              {new Date(message.timestamp).toLocaleTimeString()}
            </span>
          </div>
          
          {message.content && (
            <div className="message-content">
              {renderMessageContent(message, index)}
            </div>
          )}
          
          {message.tool_calls && message.tool_calls.length > 0 && renderToolCalls(message.tool_calls)}
          {message.tool_results && message.tool_results.length > 0 && renderToolResults(message.tool_results)}
        </div>
      ))}
      
      {isLoading && (
        <div className="message message-loading">
          <div className="loading-indicator">
            <span className="loading-dot"></span>
            <span className="loading-dot"></span>
            <span className="loading-dot"></span>
          </div>
          <span>Agent is thinking...</span>
        </div>
      )}
      
      <div ref={endRef} />
    </div>
  );
};

export default MessageList;
