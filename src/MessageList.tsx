import React, { useEffect, useMemo, useRef } from 'react';
import { fetchSpeechClip, type Message, type ToolCall, type ToolResult } from './api';
import { IntegrationProviderIcon, integrationProviderForToolName, integrationProviderLabel } from './integrationMeta';
import { renderMarkdownToHtml } from './markdown';

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
}

const audioClipMarker = /A2_AUDIO_CLIP_ID:([a-zA-Z0-9-]+)/;

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, sessionId }) => {
  const endRef = useRef<HTMLDivElement>(null);
  const playedClipIdsRef = useRef<Set<string>>(new Set());
  const playbackQueueRef = useRef(Promise.resolve());
  const currentAudioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    playedClipIdsRef.current.clear();
    playbackQueueRef.current = Promise.resolve();
    if (currentAudioRef.current) {
      currentAudioRef.current.pause();
      currentAudioRef.current = null;
    }
  }, [sessionId]);

  useEffect(() => {
    const pendingClipIDs: string[] = [];
    for (const message of messages) {
      const toolResults = message.tool_results ?? [];
      for (const result of toolResults) {
        if (result.is_error) {
          continue;
        }
        const match = audioClipMarker.exec(result.content || '');
        if (!match || !match[1]) {
          continue;
        }
        const clipID = match[1].trim();
        if (clipID === '' || playedClipIdsRef.current.has(clipID)) {
          continue;
        }
        playedClipIdsRef.current.add(clipID);
        pendingClipIDs.push(clipID);
      }
    }

    for (const clipID of pendingClipIDs) {
      playbackQueueRef.current = playbackQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          const blob = await fetchSpeechClip(clipID);
          const objectURL = URL.createObjectURL(blob);
          const audio = new Audio(objectURL);
          currentAudioRef.current = audio;
          try {
            await audio.play();
            await new Promise<void>((resolve) => {
              audio.onended = () => resolve();
              audio.onerror = () => resolve();
            });
          } finally {
            URL.revokeObjectURL(objectURL);
            if (currentAudioRef.current === audio) {
              currentAudioRef.current = null;
            }
          }
        })
        .catch((error) => {
          console.error('Failed to play tool-generated speech clip:', error);
        });
    }
  }, [messages]);

  useEffect(() => {
    return () => {
      if (currentAudioRef.current) {
        currentAudioRef.current.pause();
        currentAudioRef.current = null;
      }
    };
  }, []);

  const renderMessageContent = (message: Message) => {
    const html = renderMarkdownToHtml(message.content);
    return <div className="message-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const renderToolExecutionCard = (toolCall: ToolCall, result: ToolResult | undefined, timestamp: string, key: string) => {
    const provider = integrationProviderForToolName(toolCall.name);
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
            <span className="tool-name">{toolCall.name}</span>
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
        </div>
      </details>
    );
  };

  const renderStandaloneToolResultCard = (result: ToolResult, timestamp: string, key: string) => {
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
