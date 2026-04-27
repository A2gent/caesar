import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
// noop touch to satisfy workflow: ensuring latest edit pass for duration rendering fixes
import { Link } from 'react-router-dom';
import { buildImageAssetUrl, buildSpeechClipUrl, type Message, type MessageImage, type Session, type SubAgent, type SystemPromptSnapshot, type ToolCall, type ToolResult } from './api';
import { IntegrationProviderIcon, integrationProviderForToolName, integrationProviderLabel } from './integrationMeta';
import { renderMarkdownToHtml } from './markdown';
import { buildOpenInMyMindUrl, extractToolFilePath, isSupportedFileTool } from './myMindNavigation';
import { readImagePreviewEvent, readWebAppNotification } from './toolResultEvents';
import { toolIconForName } from './toolIcons';
import { ToolIcon } from './ToolIcon';
import { emitWebAppNotification } from './webappNotifications';
import SystemPromptMessage from './SystemPromptMessage';
import { getStoredA2ARegistryOwnerEmail } from './a2aIdentity';
import { getAgentEmoji } from './agentVisuals';
import { buildGravatarUrl } from './gravatar';

const copyToClipboard = async (text: string, onSuccess: () => void): Promise<void> => {
  try {
    await navigator.clipboard.writeText(text);
    onSuccess();
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
  }
};

const CopyButton: React.FC<{ text: string }> = ({ text }) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    if (!text) return;
    copyToClipboard(text, () => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  if (!text) return null;

  return (
    <button
      type="button"
      className="message-copy"
      onClick={handleCopy}
      title="Copy to clipboard"
      aria-label="Copy to clipboard"
    >
      {copied ? '✓' : '📋'}
    </button>
  );
};

interface MessageListProps {
  messages: Message[];
  isLoading: boolean;
  sessionId: string | null;
  projectId?: string | null;
  systemPromptSnapshot?: SystemPromptSnapshot | null;
  session?: Session | null;
  childSessions?: Session[];
  subAgents?: SubAgent[];
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
const MIN_SLOWEST_PARALLEL_DURATION_MS = 1;

type TimelineEntry = {
  time: number;
  order: number;
  node: React.ReactNode;
};

type ParallelStepResult = {
  step?: number;
  tool?: string;
  success?: boolean;
  output?: string;
  error?: string;
  duration_ms?: number;
  metadata?: Record<string, unknown>;
};

type ParallelStepView = {
  index: number;
  toolName: string;
  input: Record<string, unknown>;
  result?: ToolResult;
};

const SlowestDurationIcon: React.FC = () => (
  <span className="tool-slowest-badge" title="Slowest operation" aria-label="Slowest operation">
    <svg viewBox="0 0 24 24" className="tool-slowest-icon" aria-hidden="true" focusable="false">
      <path d="M5 17.5h9.5c2.5 0 4.5-2 4.5-4.5v-.6c0-1.3 1.1-2.4 2.4-2.4" />
      <path d="M5 17.5c-1.4 0-2.5-1.1-2.5-2.5s1.1-2.5 2.5-2.5h3" />
      <path d="M8.5 12.5a5 5 0 1 1 5 5" />
      <path d="M8.5 12.5a2.7 2.7 0 1 1 2.7 2.7" />
      <path d="M18.8 10.4l-1.4-3.1" />
      <path d="M21 10l.9-3.2" />
      <path d="M17.2 7.1h.1" />
      <path d="M21.9 6.6h.1" />
    </svg>
  </span>
);

function timestampMs(value: string | undefined): number {
  if (!value) {
    return 0;
  }
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : 0;
}

function childSessionWorkflowLabel(child: Session): string {
  const metadata = (child.metadata || {}) as Record<string, unknown>;
  const nodeLabel = typeof metadata.workflow_node_label === 'string' ? metadata.workflow_node_label.trim() : '';
  const workflowName = typeof metadata.workflow_name === 'string' ? metadata.workflow_name.trim() : '';
  if (nodeLabel && workflowName) {
    return `${workflowName} / ${nodeLabel}`;
  }
  return nodeLabel || workflowName || 'Child session';
}

function stringMetadata(message: Message, key: string): string {
  const value = message.metadata?.[key];
  return typeof value === 'string' ? value.trim() : '';
}

function numberMetadata(message: Message, key: string): number | undefined {
  const value = message.metadata?.[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function formatDurationMs(durationMs: number | undefined | null): string {
  if (durationMs === null || durationMs === undefined || !Number.isFinite(durationMs) || durationMs < 0) {
    return '';
  }
  if (durationMs === 0) {
    return '<1 ms';
  }
  if (durationMs < 1000) {
    return `${Math.round(durationMs)} ms`;
  }
  return `${(durationMs / 1000).toFixed(durationMs < 10000 ? 2 : 1)} s`;
}

function promptLine(content: string, label: string): string {
  const prefix = `${label}:`;
  return content
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line.startsWith(prefix))
    ?.slice(prefix.length)
    .trim() || '';
}

const isFiniteDuration = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

const toolResultCompletenessScore = (result: ToolResult): number => {
  let score = 0;
  if (isFiniteDuration(result.duration_ms)) score += 4;
  if ((result.content || '').trim() !== '') score += 2;
  return score;
};

const pickBetterToolResult = (prev: ToolResult, next: ToolResult): ToolResult => {
  const prevHasDuration = isFiniteDuration(prev.duration_ms);
  const nextHasDuration = isFiniteDuration(next.duration_ms);
  if (!prevHasDuration && nextHasDuration) return next;
  if (prevHasDuration && !nextHasDuration) return prev;

  const prevScore = toolResultCompletenessScore(prev);
  const nextScore = toolResultCompletenessScore(next);
  if (nextScore > prevScore) return next;
  return prev;
};

function internalHandoffLabel(message: Message): string {
  if (message.role !== 'user') return '';
  const metadata = message.metadata || {};
  const kind = typeof metadata.internal_handoff_kind === 'string' ? metadata.internal_handoff_kind : '';
  if (kind === 'workflow_handoff') {
    const workflowName = stringMetadata(message, 'workflow_name');
    const nodeLabel = stringMetadata(message, 'workflow_node_label') || promptLine(message.content, 'Node');
    return [workflowName, nodeLabel].filter(Boolean).join(' / ') || 'Workflow handoff';
  }
  if (kind === 'subagent_delegation') {
    const subAgentName = stringMetadata(message, 'sub_agent_name');
    return subAgentName ? `Delegated to ${subAgentName}` : 'Sub-agent delegation';
  }
  return '';
}

function isInternalHandoffMessage(message: Message): boolean {
  return message.role === 'user' && (
    message.metadata?.internal_handoff === true
    || internalHandoffLabel(message) !== ''
  );
}

const MessageList: React.FC<MessageListProps> = ({ messages, isLoading, sessionId, projectId, systemPromptSnapshot, session, childSessions = [], subAgents = [] }) => {
  const userAvatarUrl = buildGravatarUrl(getStoredA2ARegistryOwnerEmail(), 40);
  const assistantEmoji = useMemo(() => {
    const metadata = (session?.metadata ?? null) as Record<string, unknown> | null;
    const subAgentID = typeof metadata?.sub_agent_id === 'string' ? metadata.sub_agent_id.trim() : '';
    if (subAgentID !== '') {
      return getAgentEmoji('subagent', subAgentID);
    }
    if (session?.a2a_source_agent_id && session.a2a_source_agent_id.trim() !== '') {
      return getAgentEmoji('local', session.a2a_source_agent_id);
    }
    if (session?.a2a_target_agent_id && session.a2a_target_agent_id.trim() !== '') {
      return getAgentEmoji('local', session.a2a_target_agent_id);
    }
    return getAgentEmoji('main');
  }, [session?.a2a_source_agent_id, session?.a2a_target_agent_id, session?.metadata]);

  const subAgentIdSet = useMemo(() => new Set(subAgents.map((agent) => agent.id)), [subAgents]);

  const childSessionEmoji = useCallback((child: Session): string => {
    const metadata = (child.metadata || {}) as Record<string, unknown>;
    const subAgentID = typeof metadata.sub_agent_id === 'string' ? metadata.sub_agent_id.trim() : '';
    if (subAgentID !== '') {
      if (subAgentIdSet.size === 0 || subAgentIdSet.has(subAgentID)) {
        return getAgentEmoji('subagent', subAgentID);
      }
      return getAgentEmoji('subagent');
    }
    if (child.a2a_source_agent_id && child.a2a_source_agent_id.trim() !== '') {
      return getAgentEmoji('local', child.a2a_source_agent_id);
    }
    if (child.a2a_target_agent_id && child.a2a_target_agent_id.trim() !== '') {
      return getAgentEmoji('local', child.a2a_target_agent_id);
    }
    return getAgentEmoji('subagent');
  }, [subAgentIdSet]);

  const withSpeakerVisual = (message: Message, key: string, content: React.ReactNode): React.ReactNode => {
    if (isInternalHandoffMessage(message)) {
      return <React.Fragment key={key}>{content}</React.Fragment>;
    }
    if (message.role === 'user' && userAvatarUrl !== '') {
      return (
        <div key={key} className="message-row message-row-user">
          {content}
          <img className="message-avatar message-avatar-user" src={userAvatarUrl} alt="User avatar" loading="lazy" />
        </div>
      );
    }
    if (message.role === 'assistant' && assistantEmoji.trim() !== '') {
      return (
        <div key={key} className="message-row message-row-assistant">
          <div className="message-avatar message-avatar-agent" aria-hidden="true">{assistantEmoji}</div>
          {content}
        </div>
      );
    }
    return <React.Fragment key={key}>{content}</React.Fragment>;
  };

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
    if (
      normalizedToolName === 'take_camera_photo_tool' ||
      normalizedToolName === 'take_screenshot_tool' ||
      normalizedToolName === 'leonardo_generate_image'
    ) {
      return true;
    }
    const metadata = (result.metadata || {}) as Record<string, unknown>;
    const imageFile = metadata.image_file as Record<string, unknown> | undefined;
    const sourceTool = typeof imageFile?.source_tool === 'string' ? imageFile.source_tool.trim().toLowerCase() : '';
    const imageAction = typeof imageFile?.action === 'string' ? imageFile.action.trim().toLowerCase() : '';
    return (
      sourceTool === 'take_camera_photo_tool' ||
      sourceTool === 'take_screenshot_tool' ||
      sourceTool === 'leonardo_generate_image' ||
      (sourceTool === 'browser_chrome' && imageAction === 'screenshot')
    );
  };

  const toolResultSourceToolName = (result: ToolResult | undefined): string => {
    if (!result) {
      return '';
    }
    const directName = (result.name || '').trim();
    if (directName !== '') {
      return directName;
    }
    const metadata = (result.metadata || {}) as Record<string, unknown>;
    const imageFile = metadata.image_file as Record<string, unknown> | undefined;
    const sourceTool = typeof imageFile?.source_tool === 'string' ? imageFile.source_tool.trim() : '';
    return sourceTool;
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
    if (message.metadata?.provider_failure === true) {
      const payload = message.metadata?.provider_failure_json;
      const jsonPayload = typeof payload === 'string' ? payload.trim() : '';
      if (jsonPayload !== '') {
        return (
          <div className="message-provider-failure-content">
            <div className="message-markdown">{message.content}</div>
            <details className="provider-failure-json">
              <summary>Show error JSON</summary>
              <pre>{jsonPayload}</pre>
            </details>
          </div>
        );
      }
    }
    const html = renderMarkdownToHtml(message.content);
    return <div className="message-markdown" dangerouslySetInnerHTML={{ __html: html }} />;
  };

  const messageImages = (message: Message): MessageImage[] => {
    if (Array.isArray(message.images) && message.images.length > 0) {
      return message.images;
    }
    const metadataImages = (message.metadata?.images ?? null) as MessageImage[] | null;
    return Array.isArray(metadataImages) ? metadataImages : [];
  };

  const imageSource = (image: MessageImage): string => {
    const url = (image.url || '').trim();
    if (url !== '') {
      return url;
    }
    const mediaType = (image.media_type || '').trim();
    const data = (image.data_base64 || '').trim();
    if (mediaType !== '' && data !== '') {
      return `data:${mediaType};base64,${data}`;
    }
    return '';
  };

  const renderMessageImages = (message: Message) => {
    const images = messageImages(message);
    if (images.length === 0) {
      return null;
    }
    return (
      <div className="message-image-grid">
        {images.map((image, idx) => {
          const src = imageSource(image);
          if (!src) {
            return null;
          }
          return (
            <img
              key={`${message.timestamp}-${idx}`}
              src={src}
              alt={image.name || `Message image ${idx + 1}`}
              loading="lazy"
            />
          );
        })}
      </div>
    );
  };

  const messageAudioClipUrl = (message: Message): string => {
    const directClip = (message.metadata?.audio_clip ?? null) as Record<string, unknown> | null;
    if (directClip) {
      const clipID = typeof directClip.clip_id === 'string' ? directClip.clip_id.trim() : '';
      if (clipID !== '') {
        return buildSpeechClipUrl(clipID);
      }
    }
    const clip = (message.metadata?.inbound_audio_clip ?? null) as Record<string, unknown> | null;
    if (!clip) {
      return '';
    }
    const clipID = typeof clip.clip_id === 'string' ? clip.clip_id.trim() : '';
    if (clipID === '') {
      return '';
    }
    return buildSpeechClipUrl(clipID);
  };

  const toolResultAudioClipUrl = (result: ToolResult | undefined): string => {
    const clip = (result?.metadata?.audio_clip ?? null) as Record<string, unknown> | null;
    if (!clip) {
      return '';
    }
    const clipID = typeof clip.clip_id === 'string' ? clip.clip_id.trim() : '';
    if (clipID === '') {
      return '';
    }
    return buildSpeechClipUrl(clipID);
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

      case 'browser_chrome': {
        const action = typeof input.action === 'string' ? input.action.trim() : '';
        if (action === 'navigate' && typeof input.url === 'string' && input.url.trim() !== '') {
          return input.url.trim();
        }
        if ((action === 'click' || action === 'type' || action === 'scroll') && typeof input.selector === 'string' && input.selector.trim() !== '') {
          return `${action}: ${input.selector.trim()}`;
        }
        if (action === 'click_at') {
          return `click_at: ${input.x}, ${input.y}`;
        }
        return action || null;
      }
      
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

  const parseParallelSteps = (toolCall: ToolCall, result: ToolResult | undefined): ParallelStepView[] => {
    const rawSteps = Array.isArray(toolCall.input?.steps) ? toolCall.input.steps : [];
    let resultSteps: ParallelStepResult[] = [];
    if (result?.content) {
      try {
        const parsed = JSON.parse(result.content) as unknown;
        if (Array.isArray(parsed)) {
          resultSteps = parsed.filter((item): item is ParallelStepResult => item !== null && typeof item === 'object');
        }
      } catch {
        resultSteps = [];
      }
    }

    return rawSteps
      .map((rawStep, index): ParallelStepView | null => {
        if (!rawStep || typeof rawStep !== 'object') {
          return null;
        }
        const step = rawStep as Record<string, unknown>;
        const toolName = typeof step.tool === 'string' ? step.tool.trim() : '';
        if (toolName === '') {
          return null;
        }
        let input: Record<string, unknown> = {};
        const rawArgs = step.args;
        if (rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)) {
          input = rawArgs as Record<string, unknown>;
        } else {
          input = Object.fromEntries(
            Object.entries(step).filter(([key]) => key !== 'tool' && key !== 'args'),
          );
        }
        const stepResult = resultSteps.find((item) => item.step === index + 1) || resultSteps[index];
        const childResult: ToolResult | undefined = stepResult ? {
          tool_call_id: `${toolCall.id}:${index + 1}`,
          name: toolName,
          content: stepResult.success === false
            ? (stepResult.error || stepResult.output || '')
            : (stepResult.output || stepResult.error || ''),
          is_error: stepResult.success === false,
          metadata: stepResult.metadata,
          duration_ms: stepResult.duration_ms,
        } : undefined;
        return {
          index,
          toolName,
          input,
          result: childResult,
        };
      })
      .filter((step): step is ParallelStepView => step !== null);
  };

  const renderDurationChip = (durationMs: number | undefined | null, label = 'Duration') => {
    const formatted = formatDurationMs(durationMs);
    if (!formatted) {
      return null;
    }
    return (
      <span className="tool-duration" title={`${label}: ${Math.round(durationMs || 0)} ms`}>
        {formatted}
      </span>
    );
  };

  const renderLlmDurationChip = (message: Message) => {
    if (message.role !== 'assistant') {
      return null;
    }
    return renderDurationChip(numberMetadata(message, 'llm_duration_ms'), 'LLM response');
  };

  const renderSubAgentDelegation = (toolCall: ToolCall, result: ToolResult | undefined, timestamp: string, key: string) => {
    let taskDescription = '';
    let subAgentName = '';
    let childSessionId = '';
    let responseText = '';

    try {
      if (toolCall.input) {
        const input = typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input;
        taskDescription = input.task || '';
        subAgentName = ''; // Will be overridden by result
      }
    } catch { /* ignore */ }

    if (result) {
      // Try metadata first (always populated by backend, even on errors)
      if (result.metadata?.sub_agent_name) {
        subAgentName = String(result.metadata.sub_agent_name);
      }
      if (result.metadata?.child_session_id) {
        childSessionId = String(result.metadata.child_session_id);
      }

      if (!result.is_error) {
        try {
          const output = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;
          subAgentName = output.sub_agent_name || subAgentName;
          childSessionId = output.child_session_id || childSessionId;
          responseText = output.response || '';
        } catch { /* ignore */ }
      } else {
        // Extract name from error message like "sub-agent 'File manager' failed: ..."
        if (!subAgentName) {
          const nameMatch = (result.content || '').match(/sub-agent '([^']+)'/);
          if (nameMatch) {
            subAgentName = nameMatch[1];
          }
        }
      }
    }

    const truncatedTask = taskDescription.length > 120 ? taskDescription.slice(0, 120) + '...' : taskDescription;
    const truncatedResponse = responseText.length > 500 ? responseText.slice(0, 500) + '...' : responseText;

    return (
      <div key={key} className="tool-execution-stack tool-execution-stack-offset">
        <details className={`message message-tool tool-execution-card tool-card-collapsed${result?.is_error ? ' tool-execution-card-error' : ''}`}>
          <summary className="tool-card-summary">
            <span className="tool-summary-name">
              <span className="tool-name tool-name-with-icon">
                <span className="tool-icon" aria-hidden="true">🤖</span>
                <span>Sub-agent: {subAgentName || 'unknown'}</span>
              </span>
              {truncatedTask ? (
                <>
                  <span className="tool-inline-separator">&middot;</span>
                  <span className="tool-details">{truncatedTask}</span>
                </>
              ) : null}
            </span>
            <span className="message-meta-right">
              {childSessionId ? (
                <Link
                  to={`/chat/${childSessionId}`}
                  className="tool-path-link"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  title="Open sub-agent session"
                >
                  Open session
                </Link>
              ) : null}
              {renderDurationChip(result?.duration_ms)}
              <span className="message-time" title={new Date(timestamp).toLocaleString()}>🕐</span>
            </span>
          </summary>
          <div className="tool-card-body">
            {taskDescription ? (
              <div className="tool-execution-block">
                <div className="tool-execution-label">Task</div>
                <pre className="tool-input">{taskDescription}</pre>
              </div>
            ) : null}
            <div className="tool-execution-block">
              <div className={`tool-execution-label ${result?.is_error ? 'result-icon-error' : 'result-icon'}`}>
                {result?.is_error ? 'Error' : 'Response'}
              </div>
              <pre className="tool-result-content">{result?.is_error ? result.content : (truncatedResponse || 'Waiting for result...')}</pre>
            </div>
            {childSessionId ? (
              <div className="tool-execution-block">
                <Link to={`/chat/${childSessionId}`} style={{ color: 'var(--link-color, #6eb5ff)' }}>
                  View full sub-agent session &rarr;
                </Link>
              </div>
            ) : null}
          </div>
        </details>
      </div>
    );
  };

  const renderExternalAgentDelegation = (toolCall: ToolCall, result: ToolResult | undefined, timestamp: string, key: string) => {
    let taskDescription = '';
    let externalAgentName = '';
    let externalAgentId = '';
    let childSessionId = '';
    let responseText = '';

    try {
      if (toolCall.input) {
        const input = typeof toolCall.input === 'string' ? JSON.parse(toolCall.input) : toolCall.input;
        taskDescription = String(input.task || '');
        externalAgentName = String(input.target_agent_name || '');
        externalAgentId = String(input.target_agent_id || '');
      }
    } catch { /* ignore */ }

    if (result) {
      if (result.metadata?.external_agent_name) {
        externalAgentName = String(result.metadata.external_agent_name);
      }
      if (result.metadata?.external_agent_id) {
        externalAgentId = String(result.metadata.external_agent_id);
      }
      if (result.metadata?.child_session_id) {
        childSessionId = String(result.metadata.child_session_id);
      }
      if (!result.is_error) {
        try {
          const output = typeof result.content === 'string' ? JSON.parse(result.content) : result.content;
          externalAgentName = String(output.external_agent_name || externalAgentName);
          externalAgentId = String(output.external_agent_id || externalAgentId);
          childSessionId = String(output.child_session_id || childSessionId);
          responseText = String(output.response || '');
        } catch { /* ignore */ }
      }
    }

    const label = externalAgentName || externalAgentId || 'external agent';
    const truncatedTask = taskDescription.length > 120 ? taskDescription.slice(0, 120) + '...' : taskDescription;
    const truncatedResponse = responseText.length > 500 ? responseText.slice(0, 500) + '...' : responseText;

    return (
      <div key={key} className="tool-execution-stack tool-execution-stack-offset">
        <details className={`message message-tool tool-execution-card tool-card-collapsed${result?.is_error ? ' tool-execution-card-error' : ''}`}>
          <summary className="tool-card-summary">
            <span className="tool-summary-name">
              <span className="tool-name tool-name-with-icon">
                <span className="tool-icon" aria-hidden="true">🌐</span>
                <span>External: {label}</span>
              </span>
              {truncatedTask ? (
                <>
                  <span className="tool-inline-separator">&middot;</span>
                  <span className="tool-details">{truncatedTask}</span>
                </>
              ) : null}
            </span>
            <span className="message-meta-right">
              {childSessionId ? (
                <Link
                  to={`/chat/${childSessionId}`}
                  className="tool-path-link"
                  onClick={(event) => event.stopPropagation()}
                  onMouseDown={(event) => event.stopPropagation()}
                  title="Open external-agent session"
                >
                  Open session
                </Link>
              ) : null}
              {renderDurationChip(result?.duration_ms)}
              <span className="message-time" title={new Date(timestamp).toLocaleString()}>🕐</span>
            </span>
          </summary>
          <div className="tool-card-body">
            {taskDescription ? (
              <div className="tool-execution-block">
                <div className="tool-execution-label">Task</div>
                <pre className="tool-input">{taskDescription}</pre>
              </div>
            ) : null}
            <div className="tool-execution-block">
              <div className={`tool-execution-label ${result?.is_error ? 'result-icon-error' : 'result-icon'}`}>
                {result?.is_error ? 'Error' : 'Response'}
              </div>
              <pre className="tool-result-content">{result?.is_error ? result.content : (truncatedResponse || 'Waiting for result...')}</pre>
            </div>
            {externalAgentId ? (
              <div className="tool-execution-block">
                <div className="tool-execution-label">Agent ID</div>
                <pre className="tool-result-content">{externalAgentId}</pre>
              </div>
            ) : null}
            {childSessionId ? (
              <div className="tool-execution-block">
                <Link to={`/chat/${childSessionId}`} style={{ color: 'var(--link-color, #6eb5ff)' }}>
                  View full external-agent session &rarr;
                </Link>
              </div>
            ) : null}
          </div>
        </details>
      </div>
    );
  };

  const renderToolExecutionCard = (toolCall: ToolCall, result: ToolResult | undefined, timestamp: string, key: string) => {
    const isParallelTool = toolCall.name === 'parallel';
    const provider = integrationProviderForToolName(toolCall.name);
    const filePath = isSupportedFileTool(toolCall.name) ? extractToolFilePath(toolCall.input) : null;
    const editInput = toolCall.name === 'edit' ? parseEditToolInput(toolCall.input) : null;
    const imageUrl = resolveImageUrl(result);
    const keepPreviewVisible = imageUrl !== '' && isPinnedImageToolResult(result, toolCall.name);
    const toolIcon = toolIconForName(toolCall.name);
    const toolDetails = !filePath ? extractToolDetails(toolCall.name, toolCall.input) : null;
    const hasTokens = (toolCall.input_tokens ?? 0) > 0 || (toolCall.output_tokens ?? 0) > 0;
    const totalTokens = (toolCall.input_tokens ?? 0) + (toolCall.output_tokens ?? 0);
    const toolAudioClipUrl = toolResultAudioClipUrl(result);
    const parallelSteps = isParallelTool ? parseParallelSteps(toolCall, result) : [];
    const parallelDurations = parallelSteps
      .map((step) => step.result?.duration_ms)
      .filter(isFiniteDuration);
    const slowestParallelDuration = parallelDurations.length > 0 ? Math.max(...parallelDurations) : null;
    return (
      <div key={key} className="tool-execution-stack tool-execution-stack-offset">
        <details open={isParallelTool} className={`message message-tool tool-execution-card tool-card-collapsed${isParallelTool ? ' tool-parallel-card' : ''}${result?.is_error ? ' tool-execution-card-error' : ''}`}>
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
                    to={buildOpenInMyMindUrl(filePath, projectId || undefined)}
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
            <span className="message-meta-right">
              {hasTokens ? (
                <span className="message-tokens" title={`Input: ${toolCall.input_tokens ?? 0} tokens, Output: ${toolCall.output_tokens ?? 0} tokens`}>
                  {totalTokens} tok
                </span>
              ) : null}
              {renderDurationChip(result?.duration_ms)}
              <CopyButton text={toolCall.input ? JSON.stringify(toolCall.input, null, 2) : ''} />
              <span className="message-time" title={new Date(timestamp).toLocaleString()}>🕐</span>
            </span>
          </summary>
          <div className="tool-card-body">
            {isParallelTool ? (
              <div className="parallel-tool-tree" aria-label="Parallel tool calls">
                {parallelSteps.map((step) => {
                  const childDetails = extractToolDetails(step.toolName, step.input);
                  const isSlowestStep =
                    slowestParallelDuration !== null
                    && slowestParallelDuration >= MIN_SLOWEST_PARALLEL_DURATION_MS
                    && isFiniteDuration(step.result?.duration_ms)
                    && step.result.duration_ms === slowestParallelDuration;
                  return (
                    <details key={`${toolCall.id}-parallel-${step.index}`} className={`tool-nested-card${step.result?.is_error ? ' tool-nested-card-error' : ''}${isSlowestStep ? ' tool-nested-card-slowest' : ''}`}>
                      <summary className={`tool-nested-summary${isSlowestStep ? ' tool-nested-summary-slowest' : ''}`}>
                        <span className="parallel-branch" aria-hidden="true">↳</span>
                        <span className="tool-name tool-name-with-icon">
                          <span className="tool-icon" aria-hidden="true">{toolIconForName(step.toolName)}</span>
                          <span>{step.toolName}</span>
                        </span>
                        {childDetails ? (
                          <>
                            <span className="tool-inline-separator">·</span>
                            <span className="tool-details">{childDetails}</span>
                          </>
                        ) : null}
                        <span className="tool-nested-meta">
                          {isSlowestStep ? <SlowestDurationIcon /> : null}
                          {renderDurationChip(step.result?.duration_ms)}
                        </span>
                      </summary>
                      <div className="tool-nested-body">
                        <div className="tool-execution-block">
                          <div className="tool-execution-label">Input</div>
                          <pre className="tool-input">{JSON.stringify(step.input, null, 2)}</pre>
                        </div>
                        <div className="tool-execution-block">
                          <div className={`tool-execution-label ${step.result?.is_error ? 'result-icon-error' : 'result-icon'}`}>
                            {step.result?.is_error ? 'Error' : 'Result'}
                          </div>
                          <pre className="tool-result-content">{step.result?.content || 'Waiting for result...'}</pre>
                        </div>
                      </div>
                    </details>
                  );
                })}
                {parallelSteps.length === 0 ? (
                  <pre className="tool-result-content">{result?.content || 'Waiting for result...'}</pre>
                ) : null}
              </div>
            ) : (
              <>
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
                  {toolAudioClipUrl ? (
                    <div className="message-audio-wrap">
                      <audio className="message-audio-player" controls preload="metadata" src={toolAudioClipUrl} />
                    </div>
                  ) : null}
                </div>
              </>
            )}
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
    const toolAudioClipUrl = toolResultAudioClipUrl(result);
    const sourceToolName = toolResultSourceToolName(result);
    const provider = sourceToolName !== '' ? integrationProviderForToolName(sourceToolName) : null;
    return (
      <div key={key} className="tool-execution-stack tool-execution-stack-offset">
        <details className={`message message-tool tool-execution-card tool-card-collapsed${result.is_error ? ' tool-execution-card-error' : ''}`}>
          <summary className="tool-card-summary">
            <span className="tool-summary-name">
              {provider ? (
                <span className="tool-provider-chip">
                  <IntegrationProviderIcon provider={provider} />
                  <span>{integrationProviderLabel(provider)}</span>
                </span>
              ) : null}
              <span className="tool-name tool-name-with-icon">
                <span className="tool-icon" aria-hidden="true">{toolIconForName(sourceToolName || 'result')}</span>
                <span>{sourceToolName || 'Tool result'}</span>
              </span>
            </span>
            <span className="message-meta-right">
              {renderDurationChip(result.duration_ms)}
              <CopyButton text={result.content} />
              <span className="message-time" title={new Date(timestamp).toLocaleString()}>🕐</span>
            </span>
          </summary>
          <div className="tool-card-body">
            <div className="tool-execution-block">
              <div className={`tool-execution-label ${result.is_error ? 'result-icon-error' : 'result-icon'}`}>
                {result.is_error ? 'Error' : 'Result'}
              </div>
              <pre className="tool-result-content">{result.content}</pre>
              {toolAudioClipUrl ? (
                <div className="message-audio-wrap">
                  <audio className="message-audio-player" controls preload="metadata" src={toolAudioClipUrl} />
                </div>
              ) : null}
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
            <div className="tool-execution-label">{sourceToolName === 'leonardo_generate_image' ? 'Generated image' : 'Preview'}</div>
            <img className="tool-result-image" src={imageUrl} alt={sourceToolName === 'leonardo_generate_image' ? 'Leonardo generated image' : 'Camera preview'} loading="lazy" />
          </div>
        ) : null}
      </div>
    );
  };

  const renderedMessages = useMemo(() => {
    const entries: TimelineEntry[] = [];
    let order = 0;
    const pushEntry = (node: React.ReactNode, timestamp: string | undefined) => {
      entries.push({
        time: timestampMs(timestamp),
        order,
        node,
      });
      order += 1;
    };

    for (let index = 0; index < messages.length; index += 1) {
      const message = messages[index];
      const toolCalls = message.tool_calls ?? [];
      const toolResults = message.tool_results ?? [];
      const isProviderFailure = message.metadata?.provider_failure === true;

      if (message.role === 'assistant' && toolCalls.length > 0) {
        // First, render the assistant's text content if present
        if (message.content?.trim()) {
          const hasTokens = (message.input_tokens ?? 0) > 0 || (message.output_tokens ?? 0) > 0;
          const totalTokens = (message.input_tokens ?? 0) + (message.output_tokens ?? 0);
          pushEntry(withSpeakerVisual(
            message,
            `assistant-${index}`,
            <div
              className={`message message-assistant${isCompactionMessage(message) ? ' message-compaction' : ''}`}
            >
              <div className="message-content">
                {renderMessageContent(message)}
                {renderMessageImages(message)}
              </div>
              <div className="message-footer">
                {hasTokens ? (
                  <span className="message-tokens" title={`Input: ${message.input_tokens ?? 0} tokens, Output: ${message.output_tokens ?? 0} tokens`}>
                    {totalTokens} tok
                  </span>
                ) : null}
                {renderLlmDurationChip(message)}
                <CopyButton text={message.content || ''} />
                <span className="message-time" title={new Date(message.timestamp).toLocaleString()}>🕐</span>
              </div>
            </div>,
          ), message.timestamp);
        }

        // Then render tool execution cards
        let mergedResults = [...toolResults];
        let timestamp = message.timestamp;
        const next = messages[index + 1];
        if (next?.role === 'tool' && (next.tool_results?.length ?? 0) > 0) {
          mergedResults = mergedResults.concat(next.tool_results || []);
          timestamp = next.timestamp;
          index += 1;
        }
        const resultByCallID = new Map<string, ToolResult>();
        for (const result of mergedResults) {
          const prev = resultByCallID.get(result.tool_call_id);
          if (!prev) {
            resultByCallID.set(result.tool_call_id, result);
            continue;
          }
          resultByCallID.set(result.tool_call_id, pickBetterToolResult(prev, result));
        }
        for (const toolCall of toolCalls) {
          if (toolCall.name === 'delegate_to_subagent') {
            pushEntry(renderSubAgentDelegation(toolCall, resultByCallID.get(toolCall.id), timestamp, `tool-exec-${index}-${toolCall.id}`), timestamp);
          } else if (toolCall.name === 'delegate_to_external_agent') {
            pushEntry(renderExternalAgentDelegation(toolCall, resultByCallID.get(toolCall.id), timestamp, `tool-exec-${index}-${toolCall.id}`), timestamp);
          } else {
            pushEntry(renderToolExecutionCard(toolCall, resultByCallID.get(toolCall.id), timestamp, `tool-exec-${index}-${toolCall.id}`), timestamp);
          }
        }
        continue;
      }

      if (message.role === 'tool') {
        if (toolResults.length > 0) {
          for (const result of toolResults) {
            pushEntry(renderStandaloneToolResultCard(result, message.timestamp, `tool-result-${index}-${result.tool_call_id}`), message.timestamp);
          }
        } else if (message.content.trim() !== '') {
          const hasTokens = (message.input_tokens ?? 0) > 0 || (message.output_tokens ?? 0) > 0;
          const totalTokens = (message.input_tokens ?? 0) + (message.output_tokens ?? 0);
          pushEntry(
            <div
              key={index}
              className={`message message-${message.role}${isCompactionMessage(message) ? ' message-compaction' : ''}`}
            >
              <div className="message-content">{renderMessageContent(message)}</div>
              {renderMessageImages(message)}
              <div className="message-footer">
                {hasTokens ? (
                  <span className="message-tokens" title={`Input: ${message.input_tokens ?? 0} tokens, Output: ${message.output_tokens ?? 0} tokens`}>
                    {totalTokens} tok
                  </span>
                ) : null}
                {renderLlmDurationChip(message)}
                <CopyButton text={message.content || ''} />
                <span className="message-time" title={new Date(message.timestamp).toLocaleString()}>🕐</span>
              </div>
            </div>,
            message.timestamp,
          );
        }
        continue;
      }

      // Skip empty assistant messages (tool-only responses without text content)
      if (message.role === 'assistant' && !message.content?.trim() && messageImages(message).length === 0 && !isCompactionMessage(message)) {
        continue;
      }

      // Skip synthetic continuation messages (auto-generated after compaction)
      if (isSyntheticContinuation(message)) {
        continue;
      }

      const hasTokens = (message.input_tokens ?? 0) > 0 || (message.output_tokens ?? 0) > 0;
      const totalTokens = (message.input_tokens ?? 0) + (message.output_tokens ?? 0);
      const clipUrl = messageAudioClipUrl(message);
      const hasImages = messageImages(message).length > 0;
      const handoffLabel = internalHandoffLabel(message);
      const isInternalHandoff = handoffLabel !== '';

      pushEntry(withSpeakerVisual(
        message,
        `message-${index}`,
        <div
          className={`message message-${message.role}${isCompactionMessage(message) ? ' message-compaction' : ''}${isProviderFailure ? ' message-provider-failure' : ''}${isInternalHandoff ? ' message-internal-handoff' : ''}`}
        >
          {isInternalHandoff ? (
            <div className="message-handoff-label">
              <span>Internal handoff</span>
              <strong>{handoffLabel}</strong>
            </div>
          ) : null}
          {(message.content || clipUrl || hasImages) && (
            <div className="message-content">
              {message.content ? renderMessageContent(message) : null}
              {renderMessageImages(message)}
              {clipUrl ? (
                <div className="message-audio-wrap">
                  <audio className="message-audio-player" controls preload="metadata" src={clipUrl} />
                </div>
              ) : null}
            </div>
          )}

          <div className="message-footer">
            {hasTokens ? (
              <span className="message-tokens" title={`Input: ${message.input_tokens ?? 0} tokens, Output: ${message.output_tokens ?? 0} tokens`}>
                {totalTokens} tok
              </span>
            ) : null}
            {renderLlmDurationChip(message)}
            <CopyButton text={message.content || ''} />
            <span
              className="message-time"
              title={new Date(message.timestamp).toLocaleString()}
            >
              🕐
            </span>
          </div>
        </div>,
      ), message.timestamp);
    }

    for (const child of childSessions) {
      pushEntry(
        <Link
          key={`child-session-${child.id}`}
          to={`/chat/${child.id}`}
          className="inline-child-session"
          title={`Open child session ${child.id}`}
        >
          <span className="inline-child-session-emoji" aria-hidden="true">{childSessionEmoji(child)}</span>
          <span className={`inline-child-session-dot status-${child.status}`} aria-hidden="true" />
          <span className="inline-child-session-main">
            <span className="inline-child-session-title">
              {child.title || `Session ${child.id.slice(0, 8)}`}
            </span>
            <span className="inline-child-session-subtitle">
              {childSessionWorkflowLabel(child)}
            </span>
          </span>
          <span className="inline-child-session-status">{child.status}</span>
        </Link>,
        child.created_at || child.updated_at,
      );
    }

    if (isLoading) {
      pushEntry(
        <div key="message-loading" className="message message-loading">
          <span className="message-loading-spinner" aria-hidden="true" />
          <span>Agent is thinking...</span>
        </div>,
        new Date().toISOString(),
      );
    }

    return entries
      .sort((a, b) => {
        if (a.time !== b.time) {
          return a.time - b.time;
        }
        return a.order - b.order;
      })
      .map((entry) => entry.node);
  }, [messages, userAvatarUrl, assistantEmoji, childSessions, childSessionEmoji, isLoading]);

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
