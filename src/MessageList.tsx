import React, { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { buildImageAssetUrl, type Message, type SystemPromptSnapshot, type ToolCall, type ToolResult } from './api';
import { IntegrationProviderIcon, integrationProviderForToolName, integrationProviderLabel } from './integrationMeta';
import { renderMarkdownToHtml } from './markdown';
import { buildOpenInMyMindUrl, extractToolFilePath, isSupportedFileTool } from './myMindNavigation';
import { readImagePreviewEvent, readWebAppNotification } from './toolResultEvents';
import { toolIconForName } from './toolIcons';
import { ToolIcon } from './ToolIcon';
import { emitWebAppNotification } from './webappNotifications';
import SystemPromptMessage from './SystemPromptMessage';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
  systemPromptSnapshot?: SystemPromptSnapshot | null;
}

interface EditToolInput {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
}

interface DiffRow {
  kind: 'context' | 'add' | 'remove' | 'marker';
  oldLine: number | null;
  newLine: number | null;
  text: string;
}

const DIFF_CONTEXT_LINES = 3;

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, sessionId, systemPromptSnapshot }) => {
  const parseEditToolInput = (input: Record<string, unknown>): EditToolInput | null => {
    const path = input.path;
    const oldString = input.old_string;
    const newString = input.new_string;
    const replaceAll = input.replace_all;
    if (typeof path !== 'string' || typeof oldString !== 'string' || typeof newString !== 'string') {
      return null;
    }
    if (replaceAll !== undefined && typeof replaceAll !== 'boolean') {
      return null;
    }
    return {
      path,
      old_string: oldString,
      new_string: newString,
      replace_all: replaceAll,
    };
  };

  const normalizeLines = (text: string): string[] => text.replace(/\r\n/g, '\n').split('\n');

  const buildEditDiffRows = (oldText: string, newText: string): DiffRow[] => {
    const oldLines = normalizeLines(oldText);
    const newLines = normalizeLines(newText);

    let start = 0;
    const minLength = Math.min(oldLines.length, newLines.length);
    while (start < minLength && oldLines[start] === newLines[start]) {
      start += 1;
    }

    let oldEnd = oldLines.length;
    let newEnd = newLines.length;
    while (oldEnd > start && newEnd > start && oldLines[oldEnd - 1] === newLines[newEnd - 1]) {
      oldEnd -= 1;
      newEnd -= 1;
    }

    const rows: DiffRow[] = [];
    const beforeStart = Math.max(0, start - DIFF_CONTEXT_LINES);
    const afterEnd = Math.min(oldLines.length, oldEnd + DIFF_CONTEXT_LINES);

    if (beforeStart > 0) {
      rows.push({ kind: 'marker', oldLine: null, newLine: null, text: '...' });
    }

    for (let i = beforeStart; i < start; i += 1) {
      rows.push({
        kind: 'context',
        oldLine: i + 1,
        newLine: i + 1,
        text: oldLines[i],
      });
    }

    for (let i = start; i < oldEnd; i += 1) {
      rows.push({
        kind: 'remove',
        oldLine: i + 1,
        newLine: null,
        text: oldLines[i],
      });
    }

    for (let i = start; i < newEnd; i += 1) {
      rows.push({
        kind: 'add',
        oldLine: null,
        newLine: i + 1,
        text: newLines[i],
      });
    }

    for (let i = oldEnd; i < afterEnd; i += 1) {
      const newLineNumber = i - oldEnd + newEnd + 1;
      rows.push({
        kind: 'context',
        oldLine: i + 1,
        newLine: newLineNumber,
        text: oldLines[i],
      });
    }

    if (afterEnd < oldLines.length) {
      rows.push({ kind: 'marker', oldLine: null, newLine: null, text: '...' });
    }

    if (rows.length === 0) {
      rows.push({ kind: 'marker', oldLine: null, newLine: null, text: 'No line-level changes' });
    }

    return rows;
  };

  const renderEditInput = (input: EditToolInput): React.ReactElement => {
    const rows = buildEditDiffRows(input.old_string, input.new_string);
    return (
      <div className="tool-edit-input">
        <div className="tool-edit-meta">
          <span className="tool-edit-path">{input.path}</span>
          {input.replace_all ? <span className="tool-edit-flag">replace_all</span> : null}
        </div>
        <div className="tool-edit-diff" role="table" aria-label="Edit diff preview">
          {rows.map((row, index) => (
            <div key={`diff-${index}`} className={`tool-edit-row tool-edit-row-${row.kind}`} role="row">
              <span className="tool-edit-sign" role="cell">
                {row.kind === 'add' ? '+' : row.kind === 'remove' ? '-' : row.kind === 'marker' ? ' ' : ' '}
              </span>
              <span className="tool-edit-line" role="cell">
                {row.oldLine === null ? '' : row.oldLine}
              </span>
              <span className="tool-edit-line" role="cell">
                {row.newLine === null ? '' : row.newLine}
              </span>
              <span className="tool-edit-code" role="cell">{row.text}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  const endRef = useRef<HTMLDivElement>(null);
  const emittedNotificationIDsRef = useRef<Set<string>>(new Set());
  const hasBaselineHydratedRef = useRef(false);
  const previousMessagesLength = useRef<number>(0);
  const shouldAutoScroll = useRef<boolean>(true);

  const resolveImageUrl = (result: ToolResult | undefined): string => {
    if (!result) {
      return '';
    }
    const imageEvent = readImagePreviewEvent(result);
    if (!imageEvent) {
      return '';
    }
    if (imageEvent.imageUrl !== '') {
      return imageEvent.imageUrl;
    }
    return buildImageAssetUrl(imageEvent.imagePath);
  };

  const isPinnedImageToolResult = (result: ToolResult | undefined, toolName?: string): boolean => {
    if (!result) {
      return false;
    }
    const normalizedToolName = (toolName || '').trim().toLowerCase();
    if (normalizedToolName === 'take_camera_photo_tool' || normalizedToolName === 'take_screenshot_tool') {
      return true;
    }
    const metadata = (result.metadata || {}) as Record<string, unknown>;
    const imageFile = metadata.image_file as Record<string, unknown> | undefined;
    const sourceTool = typeof imageFile?.source_tool === 'string' ? imageFile.source_tool.trim().toLowerCase() : '';
    return sourceTool === 'take_camera_photo_tool' || sourceTool === 'take_screenshot_tool';
  };

  // Check if user is at the bottom of the scrollable container
  const isUserAtBottom = (): boolean => {
    // Find the scrollable parent container (.mind-session-inline-body)
    let container = endRef.current?.parentElement;
    while (container && !container.classList.contains('mind-session-inline-body')) {
      container = container.parentElement;
    }
    
    if (!container) return true;
    
    const threshold = 50; // pixels from bottom
    const { scrollTop, scrollHeight, clientHeight } = container;
    return scrollHeight - scrollTop - clientHeight < threshold;
  };

  // Smart auto-scroll: only auto-scroll when appropriate
  useEffect(() => {
    const currentMessagesLength = messages.length;
    const hasNewMessage = currentMessagesLength > previousMessagesLength.current;
    
    // If messages array length changed, it might be a new message or just polling updates
    if (hasNewMessage) {
      // Only auto-scroll if the user is at the bottom or if this is the first load
      if (shouldAutoScroll.current && (isUserAtBottom() || previousMessagesLength.current === 0)) {
        // Small delay to ensure DOM is updated before scrolling
        setTimeout(() => {
          endRef.current?.scrollIntoView({ behavior: 'smooth' });
        }, 0);
      }
    } else if (currentMessagesLength === previousMessagesLength.current) {
      // Same length - likely just polling updates, don't auto-scroll
      // This prevents the forced scrolling during task progress updates
    }
    
    previousMessagesLength.current = currentMessagesLength;
  }, [messages]);

  useEffect(() => {
    emittedNotificationIDsRef.current.clear();
    hasBaselineHydratedRef.current = false;
    previousMessagesLength.current = 0;
    shouldAutoScroll.current = true;
  }, [sessionId]);

  useEffect(() => {
    if (!hasBaselineHydratedRef.current) {
      for (const message of messages) {
        const toolResults = message.tool_results ?? [];
        for (const result of toolResults) {
          if (result.is_error) {
            continue;
          }
          const notification = readWebAppNotification(result);
          if (notification) {
            const notificationID = `${message.timestamp}:${result.tool_call_id}`;
            emittedNotificationIDsRef.current.add(notificationID);
          }
        }
      }
      hasBaselineHydratedRef.current = true;
      return;
    }

    for (const message of messages) {
      const toolResults = message.tool_results ?? [];
      for (const result of toolResults) {
        if (result.is_error) {
          continue;
        }

        const notification = readWebAppNotification(result);
        if (notification) {
          const notificationID = `${message.timestamp}:${result.tool_call_id}`;
          if (!emittedNotificationIDsRef.current.has(notificationID)) {
            emittedNotificationIDsRef.current.add(notificationID);
            emitWebAppNotification({
              id: notificationID,
              title: notification.title || 'Agent notification',
              message: notification.message,
              level: notification.level,
              createdAt: message.timestamp,
              sessionId: sessionId || '',
              imageUrl: notification.imageUrl || (notification.imagePath ? buildImageAssetUrl(notification.imagePath) : ''),
              audioClipId: notification.audioClipId,
              autoPlayAudio: notification.autoPlayAudio,
            });
          }
        }
      }
    }
  }, [messages]);

  const renderMessageContent = (message: Message) => {
    const html = renderMarkdownToHtml(message.content);
    return <div className="message-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const extractToolDetails = (toolName: string, input: Record<string, unknown>): string | null => {
    // Extract key details based on tool name
    switch (toolName) {
      case 'glob':
      case 'mcp_glob':
        return input.pattern ? `pattern: ${input.pattern}` : null;
      
      case 'grep':
      case 'mcp_grep':
        if (input.pattern && input.path) {
          return `"${input.pattern}" in ${input.path}`;
        }
        return input.pattern ? `pattern: ${input.pattern}` : null;
      
      case 'read':
      case 'mcp_read':
        if (input.filePath) {
          const offset = input.offset ? ` (offset: ${input.offset})` : '';
          return `${input.filePath}${offset}`;
        }
        return null;
      
      case 'edit':
      case 'mcp_edit':
        return input.filePath ? `${input.filePath}` : null;
      
      case 'write':
      case 'mcp_write':
        return input.filePath ? `${input.filePath}` : null;
      
      case 'bash':
      case 'mcp_bash':
        if (input.command && typeof input.command === 'string') {
          const cmd = input.command.trim();
          return cmd.length > 60 ? `${cmd.substring(0, 60)}...` : cmd;
        }
        return null;
      
      case 'task':
      case 'mcp_task':
        return input.description ? `${input.description}` : null;
      
      default:
        // For unknown tools, try to extract path/filePath/pattern/query
        if (input.path) return `path: ${input.path}`;
        if (input.filePath) return `file: ${input.filePath}`;
        if (input.pattern) return `pattern: ${input.pattern}`;
        if (input.query) return `query: ${input.query}`;
        if (input.url) return `${input.url}`;
        return null;
    }
  };

  const renderToolExecutionCard = (toolCall: ToolCall, result: ToolResult | undefined, timestamp: string, key: string) => {
    const provider = integrationProviderForToolName(toolCall.name);
    const filePath = isSupportedFileTool(toolCall.name) ? extractToolFilePath(toolCall.input) : null;
    const editInput = toolCall.name === 'edit' ? parseEditToolInput(toolCall.input) : null;
    const imageUrl = resolveImageUrl(result);
    const keepPreviewVisible = imageUrl !== '' && isPinnedImageToolResult(result, toolCall.name);
    const toolIcon = toolIconForName(toolCall.name);
    const toolDetails = !filePath ? extractToolDetails(toolCall.name, toolCall.input) : null;
    return (
      <div key={key} className="tool-execution-stack">
        <details className={`message message-tool tool-execution-card tool-card-collapsed${result?.is_error ? ' tool-execution-card-error' : ''}`}>
          <summary className="tool-card-summary">
            <span className="tool-summary-name">
              {provider ? (
                <span className="tool-provider-chip">
                  <IntegrationProviderIcon provider={provider} />
                  <span>{integrationProviderLabel(provider)}</span>
                </span>
              ) : null}
              <span className="tool-name tool-name-with-icon">
                {toolCall.name === 'browser_chrome' ? (
                  <ToolIcon toolName={toolCall.name} />
                ) : (
                  <span className="tool-icon" aria-hidden="true">{toolIcon}</span>
                )}
                <span>{toolCall.name}</span>
              </span>
              {filePath ? (
                <>
                  <span className="tool-inline-separator">·</span>
                  <Link
                    to={buildOpenInMyMindUrl(filePath)}
                    className="tool-path-link"
                    onClick={(event) => {
                      event.stopPropagation();
                    }}
                    onMouseDown={(event) => {
                      event.stopPropagation();
                    }}
                    title={`Open ${filePath} in My Mind`}
                  >
                    {filePath}
                  </Link>
                </>
              ) : toolDetails ? (
                <>
                  <span className="tool-inline-separator">·</span>
                  <span className="tool-details">{toolDetails}</span>
                </>
              ) : null}
            </span>
            <span className="message-time" title={new Date(timestamp).toLocaleString()}>🕐</span>
          </summary>
          <div className="tool-card-body">
            <div className="tool-execution-block">
              <div className="tool-execution-label">Input</div>
              {editInput
                ? renderEditInput(editInput)
                : <pre className="tool-input">{JSON.stringify(toolCall.input, null, 2)}</pre>}
            </div>
            <div className="tool-execution-block">
              <div className={`tool-execution-label ${result?.is_error ? 'result-icon-error' : 'result-icon'}`}>
                {result?.is_error ? 'Error' : 'Result'}
              </div>
              <pre className="tool-result-content">{result?.content || 'Waiting for result...'}</pre>
            </div>
            {imageUrl && !keepPreviewVisible ? (
              <div className="tool-execution-block">
                <div className="tool-execution-label">Preview</div>
                <img className="tool-result-image" src={imageUrl} alt="Tool-generated image" loading="lazy" />
              </div>
            ) : null}
          </div>
        </details>
        {imageUrl && keepPreviewVisible ? (
          <div className="tool-execution-card tool-preview-always">
            <div className="tool-execution-label">Preview</div>
            <img className="tool-result-image" src={imageUrl} alt="Camera preview" loading="lazy" />
          </div>
        ) : null}
      </div>
    );
  };

  const renderStandaloneToolResultCard = (result: ToolResult, timestamp: string, key: string) => {
    const imageUrl = resolveImageUrl(result);
    const keepPreviewVisible = imageUrl !== '' && isPinnedImageToolResult(result);
    return (
      <div key={key} className="tool-execution-stack">
        <details className={`message message-tool tool-execution-card tool-card-collapsed${result.is_error ? ' tool-execution-card-error' : ''}`}>
          <summary className="tool-card-summary">
            <span className="tool-summary-name">
              <span className="tool-name">Tool result</span>
            </span>
            <span className="message-time" title={new Date(timestamp).toLocaleString()}>🕐</span>
          </summary>
          <div className="tool-card-body">
            <div className="tool-execution-block">
              <div className={`tool-execution-label ${result.is_error ? 'result-icon-error' : 'result-icon'}`}>
                {result.is_error ? 'Error' : 'Result'}
              </div>
              <pre className="tool-result-content">{result.content}</pre>
            </div>
            {imageUrl && !keepPreviewVisible ? (
              <div className="tool-execution-block">
                <div className="tool-execution-label">Preview</div>
                <img className="tool-result-image" src={imageUrl} alt="Tool-generated image" loading="lazy" />
              </div>
            ) : null}
          </div>
        </details>
        {imageUrl && keepPreviewVisible ? (
          <div className="tool-execution-card tool-preview-always">
            <div className="tool-execution-label">Preview</div>
            <img className="tool-result-image" src={imageUrl} alt="Camera preview" loading="lazy" />
          </div>
        ) : null}
      </div>
    );
  };

  const renderedMessages = useMemo(() => {
    const nodes: React.ReactNode[] = [];

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const toolCalls = message.tool_calls ?? [];
      const toolResults = message.tool_results ?? [];

      if (message.role === 'assistant' && toolCalls.length > 0) {
        let mergedResults = [...toolResults];
        let timestamp = message.timestamp;
        const next = messages[index + 1];
        if (next?.role === 'tool' && (next.tool_results?.length ?? 0) > 0) {
          mergedResults = mergedResults.concat(next.tool_results || []);
          timestamp = next.timestamp;
          index += 1;
        }
        const resultByCallID = new Map(mergedResults.map((result) => [result.tool_call_id, result]));
        for (const toolCall of toolCalls) {
          nodes.push(renderToolExecutionCard(toolCall, resultByCallID.get(toolCall.id), timestamp, `tool-exec-${index}-${toolCall.id}`));
        }
        continue;
      }

      if (message.role === 'tool') {
        if (toolResults.length > 0) {
          for (const result of toolResults) {
            nodes.push(renderStandaloneToolResultCard(result, message.timestamp, `tool-result-${index}-${result.tool_call_id}`));
          }
        } else if (message.content.trim() !== '') {
          nodes.push(
            <div
              key={index}
              className={`message message-${message.role}${isCompactionMessage(message) ? ' message-compaction' : ''}`}
            >
              <div className="message-header">
                <span className="message-time" title={new Date(message.timestamp).toLocaleString()}>🕐</span>
              </div>
              <div className="message-content">{renderMessageContent(message)}</div>
            </div>,
          );
        }
        continue;
      }

      // Skip empty assistant messages (tool-only responses without text content)
      if (message.role === 'assistant' && !message.content?.trim() && !isCompactionMessage(message)) {
        continue;
      }

      // Skip synthetic continuation messages (auto-generated after compaction)
      if (isSyntheticContinuation(message)) {
        continue;
      }

      nodes.push(
        <div
          key={index}
          className={`message message-${message.role}${isCompactionMessage(message) ? ' message-compaction' : ''}`}
        >
          <div className="message-header">
            <span 
              className="message-time" 
              title={new Date(message.timestamp).toLocaleString()}
            >
              🕐
            </span>
          </div>

          {message.content && (
            <div className="message-content">
              {renderMessageContent(message)}
            </div>
          )}
        </div>,
      );
    }

    return nodes;
  }, [messages]);

  // Set up scroll event listener on the scrollable container to track user scroll position
  useEffect(() => {
    let container: Element | null = null;
    
    // Find the scrollable parent container (.mind-session-inline-body)
    const findScrollContainer = (): Element | null => {
      let element: Element | null = endRef.current?.parentElement || null;
      while (element && !element.classList.contains('mind-session-inline-body')) {
        element = element.parentElement;
      }
      return element;
    };
    
    const handleScroll = () => {
      if (!container) return;
      
      const threshold = 50; // pixels from bottom
      const { scrollTop, scrollHeight, clientHeight } = container;
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight;
      
      // Enable auto-scroll when user is near bottom, disable when scrolled up
      shouldAutoScroll.current = distanceFromBottom < threshold;
    };
    
    // Set up scroll listener after component mounts
    setTimeout(() => {
      container = findScrollContainer();
      if (container) {
        container.addEventListener('scroll', handleScroll);
      }
    }, 0);
    
    return () => {
      if (container) {
        container.removeEventListener('scroll', handleScroll);
      }
    };
  }, []);

  return (
    <div className="message-list">
      <SystemPromptMessage systemPromptSnapshot={systemPromptSnapshot} />
      
      {renderedMessages}

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

const isCompactionMessage = (message: Message): boolean => {
  const marker = message.metadata?.context_compaction;
  if (typeof marker === 'boolean') {
    return marker;
  }
  if (typeof marker === 'string') {
    return marker.trim().toLowerCase() === 'true';
  }
  return false;
};

const isSyntheticContinuation = (message: Message): boolean => {
  return message.metadata?.synthetic_continuation === true;
};
