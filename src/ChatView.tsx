import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ChatInput, { type SlashCommandSelection, type SlashCommand } from './ChatInput';
import MessageList from './MessageList';
import QuestionPrompt from './QuestionPrompt';
import { EmptyState, EmptyStateTitle, EmptyStateHint } from './EmptyState';
import { TaskProgressPanel } from './TaskProgressPanel';
import {
  getSession,
  cancelSessionRun,
  listSessions,
  listProviders,
  getProject,
  sendMessageStream,
  getPendingQuestion,
  answerQuestion,
  createSession,
  listSubAgents,
  type LLMProviderType,
  type ProviderConfig,
  type SubAgent,
  type Session,
  type Message,
  type MessageImage,
  type ChatStreamEvent,
  type PendingQuestion,
  type ProviderFailure,
} from './api';

type ChatLocationState = {
  initialMessage?: string;
  initialImages?: MessageImage[];
};

function firstNonEmpty(value: string | null | undefined): string {
  return (value || '').trim();
}

function routedTargetLabel(session: Session | null): string {
  if (!session) {
    return '';
  }
  const provider = (session.routed_provider || '').trim();
  const model = (session.routed_model || '').trim();
  if (!provider) {
    return '';
  }
  return model ? `${provider} / ${model}` : provider;
}

type WorkflowNodeStateView = {
  id: string;
  status: string;
  childSessionId?: string;
  outputPreview?: string;
  error?: string;
};

type WorkflowStateView = {
  workflowName: string;
  status: string;
  updatedAt: string;
  nodes: WorkflowNodeStateView[];
};

function parseWorkflowState(session: Session | null): WorkflowStateView | null {
  const metadata = session?.metadata;
  if (!metadata || typeof metadata !== 'object') {
    return null;
  }
  const raw = metadata.workflow_state;
  if (!raw || typeof raw !== 'object') {
    return null;
  }
  const state = raw as Record<string, unknown>;
  const nodesRaw = state.nodes;
  if (!nodesRaw || typeof nodesRaw !== 'object') {
    return null;
  }
  const nodeEntries = Object.entries(nodesRaw as Record<string, unknown>);
  const nodes: WorkflowNodeStateView[] = nodeEntries.map(([id, value]) => {
    const row = (value && typeof value === 'object') ? (value as Record<string, unknown>) : {};
    return {
      id,
      status: typeof row.status === 'string' ? row.status : 'pending',
      childSessionId: typeof row.childSessionId === 'string' ? row.childSessionId : undefined,
      outputPreview: typeof row.outputPreview === 'string' ? row.outputPreview : undefined,
      error: typeof row.error === 'string' ? row.error : undefined,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
  return {
    workflowName: typeof state.workflowName === 'string' ? state.workflowName : (typeof metadata.workflow_name === 'string' ? metadata.workflow_name : 'Workflow'),
    status: typeof state.status === 'string' ? state.status : 'running',
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : '',
    nodes,
  };
}

function formatTokenCount(tokens: number | null | undefined): string {
  if (tokens === null || tokens === undefined || tokens === 0) {
    return '0';
  }
  return new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(tokens);
}

function isTerminalSessionStatus(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return normalized === 'completed' || normalized === 'failed';
}

function stripErrorPrefixes(raw: string): string {
  let next = raw.trim();
  const prefixes = [
    'Agent error:',
    'LLM error:',
    'Request failed:',
    'Unable to start request:',
    'Provider configuration error:',
    'Failed to send message:',
  ];

  let changed = true;
  while (changed) {
    changed = false;
    for (const prefix of prefixes) {
      if (next.toLowerCase().startsWith(prefix.toLowerCase())) {
        next = next.slice(prefix.length).trim();
        changed = true;
      }
    }
  }

  return next;
}

function normalizeFailureReason(raw: string): string {
  const cleaned = stripErrorPrefixes(raw);
  const lower = cleaned.toLowerCase();

  if (!cleaned) {
    return 'The request failed, but no details were provided.';
  }

  if (lower.includes('requires an api key') || lower.includes('invalid api key') || lower.includes('unauthorized') || lower.includes('authentication')) {
    return `Authentication failed: ${cleaned}`;
  }

  if (lower.includes('rate limit') || lower.includes('ratelimit') || lower.includes('quota') || lower.includes('insufficient')) {
    return `Provider limit reached: ${cleaned}`;
  }

  if (
    lower.includes('connection refused') ||
    lower.includes('no such host') ||
    lower.includes('dial tcp') ||
    lower.includes('timeout') ||
    lower.includes('failed to connect') ||
    lower.includes('request failed')
  ) {
    return `Provider is unreachable: ${cleaned}`;
  }

  if (lower.includes('fallback chain has no providers')) {
    return 'Fallback provider is active but no fallback nodes are configured.';
  }

  if (lower.includes('context canceled')) {
    return 'Request was canceled before completion.';
  }

  return cleaned;
}

function deriveSessionFailureReason(session: Session | null, runtimeError: string | null): string | null {
  const runtime = firstNonEmpty(runtimeError);
  if (runtime) {
    return normalizeFailureReason(runtime);
  }

  if (!session || session.status !== 'failed' || !Array.isArray(session.messages)) {
    return null;
  }

  for (let i = session.messages.length - 1; i >= 0; i -= 1) {
    const message = session.messages[i];
    if (message.role !== 'assistant' && message.role !== 'system') {
      continue;
    }
    const content = firstNonEmpty(message.content);
    if (!content) {
      continue;
    }
    return normalizeFailureReason(content);
  }

  return 'Session failed without a detailed reason.';
}

function formatProviderTrace(event: Extract<ChatStreamEvent, { type: 'provider_trace' }>): string {
  const trace = event.provider || {};
  const provider = (trace.provider || '').trim();
  const model = (trace.model || '').trim();
  const fallbackTo = (trace.fallback_to || '').trim();
  const fallbackModel = (trace.fallback_model || '').trim();
  const attempt = trace.attempt ?? 0;
  const maxAttempts = trace.max_attempts ?? 0;
  const nodeIndex = trace.node_index ?? 0;
  const totalNodes = trace.total_nodes ?? 0;
  const reason = summarizeTraceReason(trace.reason || '');
  const providerLabel = provider ? (model ? `${provider}/${model}` : provider) : 'provider';

  switch (trace.phase) {
    case 'provider_selected':
      if (nodeIndex > 0 && totalNodes > 0) {
        return `Using ${providerLabel} (node ${nodeIndex}/${totalNodes})`;
      }
      return `Using ${providerLabel}`;
    case 'retrying':
      if (attempt > 0 && maxAttempts > 0) {
        if (reason) {
          return `Retrying ${providerLabel} (${attempt}/${maxAttempts}) after: ${reason}`;
        }
        return `Retrying ${providerLabel} (${attempt}/${maxAttempts})`;
      }
      return reason ? `Retrying ${providerLabel} after: ${reason}` : `Retrying ${providerLabel}`;
    case 'attempt_failed':
    case 'attempt_failed_partial':
    case 'retry_layer_failed':
      return reason ? `${providerLabel} failed: ${reason}` : `${providerLabel} failed`;
    case 'switching_provider': {
      const nextLabel = fallbackTo ? (fallbackModel ? `${fallbackTo}/${fallbackModel}` : fallbackTo) : 'next provider';
      return reason ? `Switching from ${providerLabel} to ${nextLabel}: ${reason}` : `Switching from ${providerLabel} to ${nextLabel}`;
    }
    case 'completed':
    case 'retry_layer_completed':
      return trace.recovered ? `Recovered on ${providerLabel}` : `Completed on ${providerLabel}`;
    default:
      return reason ? `${providerLabel}: ${reason}` : providerLabel;
  }
}

function summarizeTraceReason(reason: string): string {
  const { summary } = formatFailureReasonForMessage(reason);
  const normalized = summary.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 260) {
    return normalized;
  }
  return `${normalized.slice(0, 257)}...`;
}

function formatProviderFailure(item: ProviderFailure): string {
  const provider = (item.provider || '').trim();
  const model = (item.model || '').trim();
  const attempt = item.attempt ?? 0;
  const maxAttempts = item.max_attempts ?? 0;
  const reason = (item.reason || '').trim();
  const phase = (item.phase || '').trim();
  const fallbackTo = (item.fallback_to || '').trim();
  const fallbackModel = (item.fallback_model || '').trim();
  const providerLabel = provider ? (model ? `${provider}/${model}` : provider) : 'provider';
  const prefix = attempt > 0 && maxAttempts > 0 ? `${providerLabel} (attempt ${attempt}/${maxAttempts})` : providerLabel;
  const category = classifyProviderFailureReason(reason);
  const categoryPrefix = category !== 'unknown' ? `[${category}] ` : '';

  if (phase === 'switching_provider') {
    const nextLabel = fallbackTo ? (fallbackModel ? `${fallbackTo}/${fallbackModel}` : fallbackTo) : 'next provider';
    return reason ? `${categoryPrefix}Switching to ${nextLabel}: ${reason}` : `${categoryPrefix}Switching to ${nextLabel}`;
  }
  return reason ? `${categoryPrefix}${prefix}: ${reason}` : `${categoryPrefix}${prefix} failed`;
}

function classifyProviderFailureReason(reason: string): 'billing' | 'auth' | 'rate_limit' | 'timeout' | 'network' | 'provider_error' | 'canceled' | 'unknown' {
  const text = reason.trim().toLowerCase();
  if (text === '') {
    return 'unknown';
  }
  if (
    text.includes('insufficient_quota') ||
    text.includes('billing') ||
    text.includes('credit') ||
    text.includes('payment required') ||
    text.includes('402')
  ) {
    return 'billing';
  }
  if (
    text.includes('unauthorized') ||
    text.includes('authentication') ||
    text.includes('invalid api key') ||
    text.includes('forbidden') ||
    text.includes('401') ||
    text.includes('403')
  ) {
    return 'auth';
  }
  if (text.includes('rate limit') || text.includes('ratelimit') || text.includes('429') || text.includes('quota')) {
    return 'rate_limit';
  }
  if (text.includes('context canceled') || text.includes('request was canceled') || text.includes('abort')) {
    return 'canceled';
  }
  if (text.includes('deadline exceeded') || text.includes('timeout') || text.includes('timed out') || text.includes('504')) {
    return 'timeout';
  }
  if (
    text.includes('failed to connect') ||
    text.includes('connection refused') ||
    text.includes('dial tcp') ||
    text.includes('no such host') ||
    text.includes('connection reset') ||
    text.includes('broken pipe') ||
    text.includes('tls')
  ) {
    return 'network';
  }
  if (
    text.includes('500') ||
    text.includes('502') ||
    text.includes('503') ||
    text.includes('invalid_argument') ||
    text.includes('bad request') ||
    text.includes('request contains an invalid argument')
  ) {
    return 'provider_error';
  }
  return 'unknown';
}

function isProviderFailurePhase(phase: string | undefined): boolean {
  switch ((phase || '').trim()) {
    case 'attempt_failed':
    case 'attempt_failed_partial':
    case 'retry_layer_failed':
    case 'switching_provider':
      return true;
    default:
      return false;
  }
}

function providerFailureToMessage(item: ProviderFailure): Message {
  const { summary, prettyJson } = formatFailureReasonForMessage(item.reason || '');
  const content = `Provider failure: ${formatProviderFailure({ ...item, reason: summary || item.reason })}`;
  return {
    role: 'system',
    content,
    timestamp: item.timestamp || new Date().toISOString(),
    metadata: {
      provider_failure: true,
      provider_failure_json: prettyJson,
      phase: item.phase || '',
      provider: item.provider || '',
      model: item.model || '',
    },
  };
}

function formatFailureReasonForMessage(reason: string): { summary: string; prettyJson: string } {
  const trimmed = reason.trim();
  if (trimmed === '') {
    return { summary: '', prettyJson: '' };
  }
  const idxObject = trimmed.indexOf('{');
  const idxArray = trimmed.indexOf('[');
  let idx = -1;
  if (idxObject >= 0 && idxArray >= 0) {
    idx = Math.min(idxObject, idxArray);
  } else if (idxObject >= 0) {
    idx = idxObject;
  } else if (idxArray >= 0) {
    idx = idxArray;
  }
  if (idx < 0) {
    return { summary: trimmed, prettyJson: '' };
  }

  const prefix = trimmed.slice(0, idx).trim().replace(/\s+/g, ' ');
  const jsonPart = trimmed.slice(idx).trim();
  try {
    const parsed = JSON.parse(jsonPart) as unknown;
    return {
      summary: prefix || trimmed,
      prettyJson: JSON.stringify(parsed, null, 2),
    };
  } catch {
    return { summary: trimmed, prettyJson: '' };
  }
}

function dedupeProviderFailures(items: ProviderFailure[]): ProviderFailure[] {
  const out: ProviderFailure[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    const key = [
      item.phase || '',
      item.provider || '',
      item.model || '',
      item.attempt || 0,
      item.max_attempts || 0,
      item.reason || '',
      item.fallback_to || '',
      item.fallback_model || '',
    ].join('|');
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function linkedSessionDefaultPrompt(linkType: 'review' | 'continuation', sourceSession: Session): string {
  const sourceTitle = (sourceSession.title || `Session ${sourceSession.id.slice(0, 8)}`).trim();
  if (linkType === 'review') {
    return [
      `Review the results of parent session "${sourceTitle}" (${sourceSession.id}).`,
      'Focus on file changes (created, updated, deleted), regressions, correctness risks, and missing tests.',
      'Return findings ordered by severity with concrete file references and concise fix suggestions.',
    ].join(' ');
  }
  return [
    `Continue the implementation from parent session "${sourceTitle}" (${sourceSession.id}).`,
    'Start with a short summary of current state and then proceed with the highest-priority remaining work.',
  ].join(' ');
}

function slugifySlashSegment(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function ChatView() {
  const navigate = useNavigate();
  const location = useLocation();
  const { sessionId: urlSessionId } = useParams<{ sessionId: string }>();
  const [session, setSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<LLMProviderType | ''>('');
  const [activeRequestSessionId, setActiveRequestSessionId] = useState<string | null>(null);
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const queuedMessagesRef = useRef<string[]>([]);
  const activeStreamAbortRef = useRef<AbortController | null>(null);
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null);
  const [projectName, setProjectName] = useState<string | null>(null);
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [linkedSessionType, setLinkedSessionType] = useState<'review' | 'continuation'>('review');
  const [linkedSessionAgent, setLinkedSessionAgent] = useState<string>('build');
  const [composerValue, setComposerValue] = useState<string>('');
  const [isCreatingLinkedSession, setIsCreatingLinkedSession] = useState(false);
  const [providerTrace, setProviderTrace] = useState<string>('');
  const [sessionIndex, setSessionIndex] = useState<Session[]>([]);

  const SESSION_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds for active sessions
  
  const activeSessionId = urlSessionId;
  const locationState = (location.state || {}) as ChatLocationState;
  const sessionFailureReason = useMemo(
    () => deriveSessionFailureReason(session, error),
    [session, error],
  );
  const systemPromptSnapshot = session?.system_prompt_snapshot;
  const workflowState = useMemo(() => parseWorkflowState(session), [session]);
  const routedTarget = useMemo(() => routedTargetLabel(session), [session]);
  const providerFailures = useMemo(() => dedupeProviderFailures(session?.provider_failures || []), [session?.provider_failures]);
  const latestProviderFailure = useMemo(() => (providerFailures.length > 0 ? providerFailures[providerFailures.length - 1] : null), [providerFailures]);
  const messagesWithProviderFailures = useMemo(() => {
    const base = Array.isArray(messages) ? [...messages] : [];
    const failures = providerFailures;
    if (failures.length === 0) {
      return base;
    }
    const synthetic = failures.map(providerFailureToMessage);
    return [...base, ...synthetic].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  }, [messages, providerFailures]);

  useEffect(() => {
    if (activeSessionId) {
      loadSession(activeSessionId);
    } else {
      setSession(null);
      setMessages([]);
      setProjectName(null);
    }
  }, [activeSessionId]);

  useEffect(() => {
    if (!session?.project_id) {
      setProjectName(null);
      return;
    }

    const loadProject = async () => {
      try {
        const project = await getProject(session.project_id!);
        setProjectName(project.name);
      } catch (err) {
        console.error('Failed to load project:', err);
        setProjectName(null);
      }
    };

    loadProject();
  }, [session?.project_id]);

  useEffect(() => {
    const initialMessage = locationState.initialMessage?.trim() || '';
    const initialImages = Array.isArray(locationState.initialImages) ? locationState.initialImages : [];
    if ((!initialMessage && initialImages.length === 0) || !activeSessionId || !session) {
      return;
    }
    if (activeRequestSessionId === activeSessionId) {
      return;
    }

    navigate(location.pathname, { replace: true, state: {} });
    void sendMessageWithStreaming(activeSessionId, initialMessage, initialImages);
  }, [locationState.initialImages, locationState.initialMessage, activeSessionId, activeRequestSessionId, session, navigate, location.pathname]);

  useEffect(() => {
    const loadProviders = async () => {
      try {
        const data = await listProviders();
        setProviders(data);
        const active = data.find((provider) => provider.is_active);
        if (active) {
          setSelectedProvider(active.type);
        }
      } catch (err) {
        console.error('Failed to load providers:', err);
      }
    };
    loadProviders();
  }, []);

  useEffect(() => {
    const loadSubAgents = async () => {
      try {
        const data = await listSubAgents();
        setSubAgents(data);
      } catch (err) {
        console.error('Failed to load sub-agents:', err);
        setSubAgents([]);
      }
    };
    void loadSubAgents();
  }, []);

  useEffect(() => {
    if (!session) {
      setSessionIndex([]);
      return;
    }

    let cancelled = false;
    const refreshSessionIndex = async () => {
      try {
        const rows = await listSessions();
        if (!cancelled) {
          setSessionIndex(rows);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to load session index:', err);
        }
      }
    };

    void refreshSessionIndex();
    const timer = window.setInterval(() => {
      void refreshSessionIndex();
    }, 2500);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [session?.id]);

  // Poll active sessions for real-time updates
  // This handles:
  // 1. Sessions running from external sources (web-app reload, TUI, jobs)
  // 2. Session status changes (input_required, completed, failed)
  // Note: We don't poll during our own active stream (isActiveRequest)
  useEffect(() => {
    if (!session) {
      return;
    }
    if (isTerminalSessionStatus(session.status)) {
      return;
    }
    // Don't poll while we have an active stream - the stream events handle updates
    if (activeRequestSessionId === session.id) {
      return;
    }

    const sessionId = session.id;
    const interval = window.setInterval(() => {
      void getSession(sessionId)
        .then((fresh) => {
          setSession(prev => (prev && prev.id === sessionId ? fresh : prev));
          setMessages(fresh.messages || []);
        })
        .catch((pollError) => {
          console.error('Failed to poll session:', pollError);
        });
    }, SESSION_POLL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [session, activeRequestSessionId, SESSION_POLL_INTERVAL_MS]);

  // Load pending question when session status is input_required
  useEffect(() => {
    if (!session || session.status !== 'input_required') {
      setPendingQuestion(null);
      setComposerValue('');
      return;
    }

    const loadQuestion = async () => {
      try {
        const question = await getPendingQuestion(session.id);
        setPendingQuestion(question);
        setComposerValue(''); // Clear previous answer
      } catch (err) {
        console.error('Failed to load pending question:', err);
        setError(err instanceof Error ? err.message : 'Failed to load question');
      }
    };

    loadQuestion();
  }, [session?.id, session?.status]);

  const loadSession = async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await getSession(id);
      setSession(data);
      setMessages(data.messages || []);
    } catch (err) {
      console.error('Failed to load session:', err);
      setError(err instanceof Error ? err.message : 'Failed to load session');
    } finally {
      setIsLoading(false);
    }
  };



  const sendMessageWithStreaming = async (targetSessionId: string, message: string, images: MessageImage[] = []) => {
    setActiveRequestSessionId(targetSessionId);
    
    // Check if the message already exists (e.g., for queued sessions)
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const lastImages = Array.isArray(lastUserMessage?.images) ? lastUserMessage.images : [];
    const messageAlreadyExists = lastUserMessage?.content === message && JSON.stringify(lastImages) === JSON.stringify(images);
    
    if (!messageAlreadyExists) {
      const userMessage: Message = {
        role: 'user',
        content: message,
        images,
        timestamp: new Date().toISOString(),
      };
      const assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, userMessage, assistantMessage]);
    } else {
      // Just add placeholder for assistant response
      const assistantMessage: Message = {
        role: 'assistant',
        content: '',
        timestamp: new Date().toISOString(),
      };
      setMessages(prev => [...prev, assistantMessage]);
    }
    setIsLoading(true);
    setError(null);
    setProviderTrace('');
    const controller = new AbortController();
    activeStreamAbortRef.current = controller;

    try {
      for await (const event of sendMessageStream(targetSessionId, message, images, controller.signal)) {
        handleStreamEvent(event, targetSessionId);
      }
    } catch (err) {
      const isAbort = err instanceof DOMException && err.name === 'AbortError';
      if (!isAbort) {
        console.error('Failed to send message:', err);
        setError(normalizeFailureReason(err instanceof Error ? err.message : 'Failed to send message'));
        // Remove the placeholder assistant message (and user message if we added it)
        const removeCount = messageAlreadyExists ? 1 : 2;
        setMessages(prev => prev.slice(0, -removeCount));
      }
    } finally {
      setIsLoading(false);
      setActiveRequestSessionId(prev => prev === targetSessionId ? null : prev);
      if (activeStreamAbortRef.current === controller) {
        activeStreamAbortRef.current = null;
      }
    }
  };

  const handleStreamEvent = (event: ChatStreamEvent, targetSessionId: string) => {
    if (event.type === 'assistant_delta') {
      if (!event.delta) {
        return;
      }
      setMessages(prev => {
        if (prev.length === 0) {
          return prev;
        }
        const next = [...prev];
        const last = next[next.length - 1];
        if (last.role !== 'assistant') {
          next.push({
            role: 'assistant',
            content: event.delta,
            timestamp: new Date().toISOString(),
          });
          return next;
        }
        next[next.length - 1] = { ...last, content: `${last.content}${event.delta}` };
        return next;
      });
      return;
    }

    if (event.type === 'status') {
      setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, status: event.status } : prev));
      return;
    }

    if (event.type === 'tool_executing') {
      // Tool calls are now being executed - update messages with tool calls
      // The actual tool call data is in the event, but we'll wait for tool_completed
      // to get the full updated messages including results
      return;
    }

    if (event.type === 'tool_completed') {
      // Update messages with tool calls and results
      setMessages(event.messages);
      setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, status: event.status } : prev));
      return;
    }

    if (event.type === 'step_completed') {
      // Step completed, agent might continue or be done
      return;
    }

    if (event.type === 'provider_trace') {
      setProviderTrace(formatProviderTrace(event));
      if (isProviderFailurePhase(event.provider?.phase)) {
        const now = new Date().toISOString();
        setSession((prev) => {
          if (!prev || prev.id !== targetSessionId) {
            return prev;
          }
          const nextFailure: ProviderFailure = {
            timestamp: now,
            provider: event.provider?.provider,
            model: event.provider?.model,
            attempt: event.provider?.attempt,
            max_attempts: event.provider?.max_attempts,
            node_index: event.provider?.node_index,
            total_nodes: event.provider?.total_nodes,
            phase: event.provider?.phase,
            reason: event.provider?.reason,
            fallback_to: event.provider?.fallback_to,
            fallback_model: event.provider?.fallback_model,
          };
          const existing = prev.provider_failures || [];
          return { ...prev, provider_failures: [...existing, nextFailure] };
        });
      }
      return;
    }

    if (event.type === 'workflow_update') {
      setSession((prev) => {
        if (!prev || prev.id !== targetSessionId) {
          return prev;
        }
        return {
          ...prev,
          metadata: {
            ...(prev.metadata || {}),
            workflow_state: event.workflow,
          },
        };
      });
      return;
    }

    if (event.type === 'done') {
      setMessages(event.messages);
      setProviderTrace('');
      setSession(prev => {
        if (!prev || prev.id !== targetSessionId) {
          return prev;
        }
        const updated = { ...prev, status: event.status };
        if (event.usage) {
          updated.input_tokens = (prev.input_tokens ?? 0) + event.usage.input_tokens;
          updated.output_tokens = (prev.output_tokens ?? 0) + event.usage.output_tokens;
          updated.total_tokens = updated.input_tokens + updated.output_tokens;
        }
        return updated;
      });
      void getSession(targetSessionId)
        .then((fresh) => {
          setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, ...fresh, messages: prev.messages } : prev));
        })
        .catch((refreshErr) => {
          console.error('Failed to refresh session metadata after stream:', refreshErr);
        });
      return;
    }

    if (event.type === 'error') {
      setProviderTrace('');
      setError(normalizeFailureReason(event.error || 'Failed to send message'));
      if (typeof event.status === 'string' && event.status.trim() !== '') {
        setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, status: event.status as string } : prev));
      }
    }
  };



  const handleSendMessage = async (message: string, images: MessageImage[] = []) => {
    setError(null);
    
    // If there's a pending question, treat the message as an answer
    if (session && pendingQuestion) {
      if (images.length > 0) {
        setError('Image attachments are not supported while answering a pending question.');
        return;
      }
      await handleAnswerQuestion(message);
      return;
    }
    
    if (!session) {
      return;
    }
    
    await sendMessageWithStreaming(session.id, message, images);
  };

  const handleCancelSession = async () => {
    if (!session) {
      return;
    }

    activeStreamAbortRef.current?.abort();
    queuedMessagesRef.current = [];
    setQueuedMessages([]);

    try {
      await cancelSessionRun(session.id);
      const fresh = await getSession(session.id);
      setSession(fresh);
      setMessages(fresh.messages || []);
      setProviderTrace('');
      setError('Request was canceled before completion.');
    } catch (err) {
      console.error('Failed to cancel session:', err);
      setError(err instanceof Error ? err.message : 'Failed to cancel session');
    } finally {
      setIsLoading(false);
      setActiveRequestSessionId((prev) => (prev === session.id ? null : prev));
    }
  };

  const handleAnswerQuestion = async (answer: string) => {
    if (!session) {
      return;
    }

    try {
      setIsLoading(true);
      await answerQuestion(session.id, answer);
      setPendingQuestion(null);
      setComposerValue('');
      
      // Reload session to continue execution
      const fresh = await getSession(session.id);
      setSession(fresh);
      setMessages(fresh.messages || []);
      
      // Keep polling enabled for resumed runs from /answer.
      // There is no active stream in this flow.
      setActiveRequestSessionId((prev) => (prev === fresh.id ? null : prev));
    } catch (err) {
      console.error('Failed to answer question:', err);
      setError(err instanceof Error ? err.message : 'Failed to answer question');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectQuestionOption = (answer: string) => {
    setComposerValue(answer);
  };

  const handleCreateLinkedSession = async (options?: { linkType?: 'review' | 'continuation'; promptOverride?: string }) => {
    if (!session) return;
    setIsCreatingLinkedSession(true);
    try {
      const nextType = options?.linkType ?? linkedSessionType;
      const selected = linkedSessionAgent.trim();
      const isSubAgent = selected.startsWith('subagent:');
      const subAgentID = isSubAgent ? selected.slice('subagent:'.length) : undefined;
      const rawPrompt = options?.promptOverride ?? composerValue;
      const prompt = rawPrompt.trim();
      const fallbackPrompt = linkedSessionDefaultPrompt(nextType, session);

      const newSession = await createSession({
        agent_id: 'build',
        parent_id: session.id,
        link_type: nextType,
        project_id: session.project_id,
        sub_agent_id: subAgentID,
        task: prompt || fallbackPrompt,
      });

      navigate(`/chat/${newSession.id}`, {
        state: {
          initialMessage: prompt || fallbackPrompt,
        },
      });
      setComposerValue('');
      setError(null);
    } catch (err) {
      console.error('Failed to create linked session:', err);
      setError(err instanceof Error ? err.message : 'Failed to create linked session');
    } finally {
      setIsCreatingLinkedSession(false);
    }
  };

  const isActiveRequest = Boolean(session && activeRequestSessionId === session.id);
  const inputDisabled = isLoading && !session;
  const linkedPromptForSelectedType = session ? linkedSessionDefaultPrompt(linkedSessionType, session) : '';

  const handleSelectLinkedType = (nextType: 'review' | 'continuation') => {
    if (!session) {
      return;
    }
    const trimmed = composerValue.trim();
    const currentTemplate = linkedSessionDefaultPrompt(linkedSessionType, session);
    if (trimmed.length === 0 || trimmed === currentTemplate) {
      setComposerValue(linkedSessionDefaultPrompt(nextType, session));
    }
    setLinkedSessionType(nextType);
  };

  const linkedAgentOptions = useMemo(
    () => [
      { value: 'build', name: 'Default agent' },
      ...subAgents.map((subAgent) => ({
        value: `subagent:${subAgent.id}`,
        name: subAgent.name,
      })),
    ],
    [subAgents],
  );

  useEffect(() => {
    if (!linkedAgentOptions.some((option) => option.value === linkedSessionAgent)) {
      setLinkedSessionAgent('build');
    }
  }, [linkedAgentOptions, linkedSessionAgent]);

  const selectedLinkedAgentName = useMemo(() => {
    const match = linkedAgentOptions.find((option) => option.value === linkedSessionAgent);
    return match?.name || 'Default agent';
  }, [linkedAgentOptions, linkedSessionAgent]);

  const parentSessionSummary = useMemo(() => {
    if (!session?.parent_id) {
      return null;
    }
    return sessionIndex.find((item) => item.id === session.parent_id) || null;
  }, [session?.parent_id, sessionIndex]);

  const childSessions = useMemo(() => {
    if (!session) {
      return [];
    }
    return sessionIndex
      .filter((item) => item.parent_id === session.id)
      .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  }, [session, sessionIndex]);

  const composerPlaceholder = useMemo(() => {
    if (pendingQuestion) {
      return 'Type your answer or select an option above...';
    }
    if (!session) {
      return undefined;
    }
    if (workflowState?.workflowName) {
      return `Continue in ${workflowState.workflowName}...`;
    }
    const modeLabel = linkedSessionType === 'review' ? 'review' : 'continuation';
    return `Start a new chat (${modeLabel} via ${selectedLinkedAgentName})...`;
  }, [linkedSessionType, pendingQuestion, selectedLinkedAgentName, session, workflowState?.workflowName]);

  const sessionSlashCommands = useMemo<SlashCommand[]>(() => {
    if (!session || pendingQuestion) {
      return [];
    }

    const disabled = isCreatingLinkedSession || isActiveRequest;

    return [
      {
        id: 'linked.help',
        command: 'help',
        title: 'Show slash command help',
        description: 'List available slash commands.',
        aliases: ['h', '?'],
        disabled,
      },
      {
        id: 'linked.type.review',
        command: 'review',
        title: 'Set mode: review',
        description: 'Set linked mode to review.',
        aliases: ['r'],
        disabled,
      },
      {
        id: 'linked.type.continuation',
        command: 'continue',
        title: 'Set mode: continuation',
        description: 'Set linked mode to continuation.',
        aliases: ['cont'],
        disabled,
      },
      {
        id: 'linked.fill',
        command: 'fill',
        title: 'Fill default prompt',
        description: 'Insert default prompt for current mode.',
        aliases: ['f'],
        disabled,
      },
      {
        id: 'linked.create.current',
        command: 'linked',
        title: 'Create linked session',
        description: 'Create linked session (current mode/agent).',
        aliases: ['link', 'new'],
        disabled,
      },
      {
        id: 'linked.create.review',
        command: 'linked-review',
        title: 'Create review linked session',
        description: 'Create linked session in review mode.',
        aliases: ['lr'],
        disabled,
      },
      {
        id: 'linked.create.continuation',
        command: 'linked-continue',
        title: 'Create continuation linked session',
        description: 'Create linked session in continuation mode.',
        aliases: ['lc'],
        disabled,
      },
      {
        id: 'linked.agent.select',
        command: 'agent',
        title: 'Set linked-session agent',
        description: 'Usage: /agent <default|name|id>',
        aliases: ['a'],
        disabled,
      },
    ];
  }, [isActiveRequest, isCreatingLinkedSession, pendingQuestion, session]);

  const handleSlashCommand = async (selection: SlashCommandSelection): Promise<boolean> => {
    if (!session || pendingQuestion) {
      return false;
    }

    if (selection.id === 'linked.agent.select') {
      const rawArg = selection.args.join(' ').trim();
      if (!rawArg) {
        const options = linkedAgentOptions
          .map((option) => `- ${option.name} (${option.value === 'build' ? 'default' : option.value})`)
          .join('\n');
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `Usage: /agent <default|name|id>\nAvailable agents:\n${options}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return true;
      }

      const normalizedArg = rawArg.toLowerCase();
      let match = linkedAgentOptions.find((option) => option.value.toLowerCase() === normalizedArg);
      if (!match && (normalizedArg === 'default' || normalizedArg === 'build')) {
        match = linkedAgentOptions.find((option) => option.value === 'build');
      }
      if (!match) {
        match = linkedAgentOptions.find((option) => option.name.toLowerCase() === normalizedArg);
      }
      if (!match) {
        match = linkedAgentOptions.find((option) => slugifySlashSegment(option.name) === slugifySlashSegment(rawArg));
      }
      if (!match) {
        match = linkedAgentOptions.find((option) => option.name.toLowerCase().includes(normalizedArg));
      }

      if (!match) {
        setError(`Unknown agent "${rawArg}". Use /agent with no arguments to list available agents.`);
        return true;
      }

      setLinkedSessionAgent(match.value);
      setMessages((prev) => [
        ...prev,
        {
          role: 'system',
          content: `Linked-session agent set to ${match?.name || match?.value}.`,
          timestamp: new Date().toISOString(),
        },
      ]);
      setError(null);
      return true;
    }

    switch (selection.id) {
      case 'linked.help': {
        const lines = sessionSlashCommands.map((cmd) => {
          const aliasText = Array.isArray(cmd.aliases) && cmd.aliases.length > 0
            ? ` (aliases: /${cmd.aliases.join(', /')})`
            : '';
          return `/${cmd.command} - ${cmd.title}${aliasText}`;
        });
        setMessages((prev) => [
          ...prev,
          {
            role: 'system',
            content: `Available commands:\n${lines.join('\n')}`,
            timestamp: new Date().toISOString(),
          },
        ]);
        return true;
      }
      case 'linked.type.review':
        handleSelectLinkedType('review');
        if (selection.args.length > 0) {
          setComposerValue(selection.args.join(' ').trim());
        }
        return true;
      case 'linked.type.continuation':
        handleSelectLinkedType('continuation');
        if (selection.args.length > 0) {
          setComposerValue(selection.args.join(' ').trim());
        }
        return true;
      case 'linked.fill':
        setComposerValue(linkedPromptForSelectedType);
        return true;
      case 'linked.create.current':
        await handleCreateLinkedSession({
          promptOverride: selection.args.join(' ').trim() || undefined,
        });
        return true;
      case 'linked.create.review':
        setLinkedSessionType('review');
        await handleCreateLinkedSession({
          linkType: 'review',
          promptOverride: selection.args.join(' ').trim() || undefined,
        });
        return true;
      case 'linked.create.continuation':
        setLinkedSessionType('continuation');
        await handleCreateLinkedSession({
          linkType: 'continuation',
          promptOverride: selection.args.join(' ').trim() || undefined,
        });
        return true;
      default:
        return false;
    }
  };

  return (
    <>
      <div className="top-bar">
        <div className="session-info">
          {session ? (
            <>
              <span
                className={`session-status-dot-large status-${session.status}`}
                title={`Status: ${session.status}`}
                aria-label={`Status: ${session.status}`}
              />
              <div className="session-meta-stack">
                <div className="session-meta-row">
                  {projectName ? (
                    <>
                      <span className="session-project-name">{projectName}</span>
                      <span className="session-title-separator">/</span>
                    </>
                  ) : null}
                  <span className="session-title">{session.title || 'Untitled Session'}</span>
                {session.provider ? (
                  <span
                    className="session-provider-chip"
                    title={session.provider === 'automatic_router' && routedTarget
                      ? `Provider: ${session.provider} → ${routedTarget}`
                      : `Provider: ${session.provider}${session.model ? ` / ${session.model}` : ''}`}
                  >
                    {session.provider === 'automatic_router' && routedTarget
                      ? `→ ${routedTarget}`
                      : session.provider}
                    {session.provider !== 'automatic_router' && session.model ? ` / ${session.model}` : ''}
                  </span>
                ) : null}
                {(session.input_tokens ?? 0) > 0 || (session.output_tokens ?? 0) > 0 ? (
                  <>
                    <span 
                      className="session-token-stats-chip" 
                      title={`Input: ${formatTokenCount(session.input_tokens)} tokens, Output: ${formatTokenCount(session.output_tokens)} tokens, Total: ${formatTokenCount(session.total_tokens)} tokens`}
                    >
                      <span className="token-stat">↑{formatTokenCount(session.input_tokens)}</span>
                      <span className="token-stat-separator">|</span>
                      <span className="token-stat">↓{formatTokenCount(session.output_tokens)}</span>
                      <span className="token-stat-separator">|</span>
                      <span className="token-stat token-stat-total">Σ{formatTokenCount(session.total_tokens)}</span>
                    </span>
                    {session.model_context_window && session.model_context_window > 0 && session.current_context_tokens !== undefined ? (
                      <span 
                        className="session-context-usage-chip"
                        title={`Context usage: ${formatTokenCount(session.current_context_tokens)} / ${formatTokenCount(session.model_context_window)} tokens`}
                      >
                        {Math.round((session.current_context_tokens / session.model_context_window) * 100)}% context
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              {session.task_progress ? (
                <div className="session-task-progress-row">
                  <TaskProgressPanel taskProgress={session.task_progress} />
                </div>
              ) : null}
              {(session.parent_id || childSessions.length > 0) ? (
                <div className="session-relations-panel">
                  {session.parent_id ? (
                    <button
                      type="button"
                      className="session-relation-link parent"
                      onClick={() => navigate(`/chat/${session.parent_id}`)}
                      title={`Open parent session ${session.parent_id}`}
                    >
                      ← Parent: {parentSessionSummary?.title || `Session ${session.parent_id.slice(0, 8)}`}
                    </button>
                  ) : null}
                  {childSessions.length > 0 ? (
                    <div className="session-children-list">
                      {childSessions.map((child) => (
                        <button
                          key={child.id}
                          type="button"
                          className="session-relation-link child"
                          onClick={() => navigate(`/chat/${child.id}`)}
                          title={`Open child session ${child.id}`}
                        >
                          ↳ {child.title || `Session ${child.id.slice(0, 8)}`} ({child.status})
                        </button>
                      ))}
                    </div>
                  ) : null}
                </div>
              ) : null}
              {workflowState ? (
                <div className="session-workflow-panel">
                  <div className="session-workflow-header">
                    <span className="session-workflow-title">🔀 {workflowState.workflowName}</span>
                    <span className={`session-workflow-status status-${workflowState.status}`}>{workflowState.status}</span>
                  </div>
                  <div className="session-workflow-nodes">
                    {workflowState.nodes.map((node) => (
                      <div key={node.id} className={`session-workflow-node status-${node.status}`}>
                        <div className="session-workflow-node-top">
                          <span className="session-workflow-node-id">{node.id}</span>
                          <span className="session-workflow-node-status">{node.status}</span>
                          {node.childSessionId ? (
                            <button
                              type="button"
                              className="session-workflow-node-open"
                              onClick={() => navigate(`/chat/${node.childSessionId}`)}
                              title="Open child session"
                            >
                              Open
                            </button>
                          ) : null}
                        </div>
                        {node.error ? <div className="session-workflow-node-error">{node.error}</div> : null}
                        {node.outputPreview ? <div className="session-workflow-node-preview">{node.outputPreview}</div> : null}
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}
              {session.status === 'failed' && sessionFailureReason ? (
                <div className="session-failure-reason" title={sessionFailureReason}>
                  Failure reason: {sessionFailureReason}
                </div>
              ) : null}
              {providerTrace && isActiveRequest ? (
                <div className="session-provider-trace" title={providerTrace}>
                  {providerTrace}
                </div>
              ) : null}
              {latestProviderFailure && !providerTrace ? (
                <div className="session-provider-failures">
                  <div className="session-provider-failure-row" title={formatProviderFailure(latestProviderFailure)}>
                    {formatProviderFailure(latestProviderFailure)}
                  </div>
                </div>
              ) : null}
              </div>
            </>
          ) : (
            <span className="session-title">New Session</span>
          )}
        </div>
      </div>
      
      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}
      
      <div className="chat-history">
        {messages.length > 0 || systemPromptSnapshot ? (
          <MessageList 
            messages={messagesWithProviderFailures} 
            isLoading={isLoading} 
            sessionId={session?.id || null}
            projectId={session?.project_id || null}
            systemPromptSnapshot={systemPromptSnapshot}
            session={session}
          />
        ) : (
          <EmptyState>
            <EmptyStateTitle>Start a conversation</EmptyStateTitle>
            <EmptyStateHint>Type a message below to begin chatting with the agent.</EmptyStateHint>
          </EmptyState>
        )}
      </div>
      
      {session && pendingQuestion && (
        <QuestionPrompt
          question={pendingQuestion}
          onSelectOption={handleSelectQuestionOption}
          selectedOption={composerValue}
        />
      )}
      
      <ChatInput
        onSend={handleSendMessage}
        disabled={inputDisabled}
        onStop={() => void handleCancelSession()}
        showStopButton={Boolean(session && isActiveRequest)}
        canStop={Boolean(session)}
        value={composerValue}
        onValueChange={setComposerValue}
        slashCommands={sessionSlashCommands}
        onSlashCommand={handleSlashCommand}
        placeholder={composerPlaceholder}
        actionControls={
          !session && providers.length > 0 ? (
            <label className="chat-provider-select">
              <select
                value={selectedProvider}
                onChange={(e) => setSelectedProvider(e.target.value as LLMProviderType)}
                title="Provider"
                aria-label="Provider"
              >
                {providers.map((provider) => (
                  <option key={provider.type} value={provider.type}>
                    {provider.display_name}
                  </option>
                ))}
              </select>
            </label>
          ) : queuedMessages.length > 0 ? (
            <span className="chat-provider-select" title={queuedMessages.join('\n')}>
              Queued: {queuedMessages.length}
            </span>
          ) : null
        }
      />
    </>
  );
}

export default ChatView;
