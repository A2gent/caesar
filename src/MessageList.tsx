import React, { useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import { buildImageAssetUrl, type Message, type ToolCall, type ToolResult } from './api';
import { IntegrationProviderIcon, integrationProviderForToolName, integrationProviderLabel } from './integrationMeta';
import { renderMarkdownToHtml } from './markdown';
import { buildOpenInMyMindUrl, extractToolFilePath, isSupportedFileTool } from './myMindNavigation';
import { readImagePreviewEvent, readWebAppNotification } from './toolResultEvents';
import { toolIconForName } from './toolIcons';
import { emitWebAppNotification } from './webappNotifications';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
}

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, sessionId }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const emittedNotificationIDsRef = useRef<Set<string>>(new Set());
  const hasBaselineHydratedRef = useRef(false);

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

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    emittedNotificationIDsRef.current.clear();
    hasBaselineHydratedRef.current = false;
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

  const renderToolExecutionCard = (toolCall: ToolCall, result: ToolResult | undefined, timestamp: string, key: string) => {
    const provider = integrationProviderForToolName(toolCall.name);
    const filePath = isSupportedFileTool(toolCall.name) ? extractToolFilePath(toolCall.input) : null;
    const imageUrl = resolveImageUrl(result);
    const toolIcon = toolIconForName(toolCall.name);
    return (
      <details key={key} className={`message message-tool tool-execution-card tool-card-collapsed${result?.is_error ? ' tool-execution-card-error' : ''}`}>
        <summary className="tool-card-summary">
          <span className="message-role">Tool</span>
          <span className="tool-summary-name">
            {provider ? (
              <span className="tool-provider-chip">
                <IntegrationProviderIcon provider={provider} />
                <span>{integrationProviderLabel(provider)}</span>
              </span>
            ) : null}
            <span className="tool-name tool-name-with-icon">
              <span className="tool-icon" aria-hidden="true">{toolIcon}</span>
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
            ) : null}
          </span>
          <span className="message-time">{new Date(timestamp).toLocaleTimeString()}</span>
        </summary>
        <div className="tool-card-body">
          <div className="tool-execution-block">
            <div className="tool-execution-label">Input</div>
            <pre className="tool-input">{JSON.stringify(toolCall.input, null, 2)}</pre>
          </div>
          <div className="tool-execution-block">
            <div className={`tool-execution-label ${result?.is_error ? 'result-icon-error' : 'result-icon'}`}>
              {result?.is_error ? 'Error' : 'Result'}
            </div>
            <pre className="tool-result-content">{result?.content || 'Waiting for result...'}</pre>
          </div>
          {imageUrl ? (
            <div className="tool-execution-block">
              <div className="tool-execution-label">Preview</div>
              <img className="tool-result-image" src={imageUrl} alt="Tool-generated image" loading="lazy" />
            </div>
          ) : null}
        </div>
      </details>
    );
  };

  const renderStandaloneToolResultCard = (result: ToolResult, timestamp: string, key: string) => {
    const imageUrl = resolveImageUrl(result);
    return (
      <details key={key} className={`message message-tool tool-execution-card tool-card-collapsed${result.is_error ? ' tool-execution-card-error' : ''}`}>
        <summary className="tool-card-summary">
          <span className="message-role">Tool</span>
          <span className="tool-summary-name">
            <span className="tool-name">Tool result</span>
          </span>
          <span className="message-time">{new Date(timestamp).toLocaleTimeString()}</span>
        </summary>
        <div className="tool-card-body">
          <div className="tool-execution-block">
            <div className={`tool-execution-label ${result.is_error ? 'result-icon-error' : 'result-icon'}`}>
              {result.is_error ? 'Error' : 'Result'}
            </div>
            <pre className="tool-result-content">{result.content}</pre>
          </div>
          {imageUrl ? (
            <div className="tool-execution-block">
              <div className="tool-execution-label">Preview</div>
              <img className="tool-result-image" src={imageUrl} alt="Tool-generated image" loading="lazy" />
            </div>
          ) : null}
        </div>
      </details>
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
                <span className="message-role">Tool</span>
                <span className="message-time">{new Date(message.timestamp).toLocaleTimeString()}</span>
              </div>
              <div className="message-content">{renderMessageContent(message)}</div>
            </div>,
          );
        }
        continue;
      }

      nodes.push(
        <div
          key={index}
          className={`message message-${message.role}${isCompactionMessage(message) ? ' message-compaction' : ''}`}
        >
          <div className="message-header">
            <span className="message-role">
              {isCompactionMessage(message)
                ? 'Compaction'
                : message.role === 'user'
                  ? 'You'
                  : message.role === 'assistant'
                    ? 'Agent'
                    : 'System'}
            </span>
            <span className="message-time">
              {new Date(message.timestamp).toLocaleTimeString()}
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

  return (
    <div className="message-list">
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
