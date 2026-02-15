import { useEffect, useMemo, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import { 
  getSession, 
  createSession, 
  listProviders,
  sendMessageStream,
  type LLMProviderType,
  type ProviderConfig,
  type Session, 
  type Message,
  type ChatStreamEvent,
} from './api';

type ChatLocationState = {
  initialMessage?: string;
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
  const [showSystemPromptDetails, setShowSystemPromptDetails] = useState(false);

  const activeSessionId = urlSessionId;
  const locationState = (location.state || {}) as ChatLocationState;
  const sessionFailureReason = useMemo(
    () => deriveSessionFailureReason(session, error),
    [session, error],
  );
  const systemPromptSnapshot = session?.system_prompt_snapshot;
  const hasSystemPromptBlocks = (systemPromptSnapshot?.blocks?.length || 0) > 0;
  const routedTarget = useMemo(() => routedTargetLabel(session), [session]);

  useEffect(() => {
    setShowSystemPromptDetails(false);
  }, [session?.id]);

  useEffect(() => {
    if (activeSessionId) {
      loadSession(activeSessionId);
    } else {
      setSession(null);
      setMessages([]);
    }
  }, [activeSessionId]);

  useEffect(() => {
    const initialMessage = locationState.initialMessage?.trim();
    if (!initialMessage || !activeSessionId || !session) {
      return;
    }
    if (activeRequestSessionId === activeSessionId) {
      return;
    }

    navigate(location.pathname, { replace: true, state: {} });
    void sendMessageWithStreaming(activeSessionId, initialMessage);
  }, [locationState.initialMessage, activeSessionId, activeRequestSessionId, session, navigate, location.pathname]);

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

  const sendMessageWithStreaming = async (targetSessionId: string, message: string) => {
    setActiveRequestSessionId(targetSessionId);
    const userMessage: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    const assistantMessage: Message = {
      role: 'assistant',
      content: '',
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage, assistantMessage]);
    setIsLoading(true);
    setError(null);

    try {
      for await (const event of sendMessageStream(targetSessionId, message)) {
        handleStreamEvent(event, targetSessionId);
      }
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(normalizeFailureReason(err instanceof Error ? err.message : 'Failed to send message'));
      setMessages(prev => prev.slice(0, -2));
    } finally {
      setIsLoading(false);
      setActiveRequestSessionId(prev => prev === targetSessionId ? null : prev);
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

    if (event.type === 'done') {
      setMessages(event.messages);
      setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, status: event.status } : prev));
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
      setError(normalizeFailureReason(event.error || 'Failed to send message'));
      if (typeof event.status === 'string' && event.status.trim() !== '') {
        setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, status: event.status as string } : prev));
      }
    }
  };

  const handleSendMessage = async (message: string) => {
    if (!session) {
      setIsLoading(true);
      setError(null);
      try {
        const created = await createSession({
          agent_id: 'build',
          provider: selectedProvider || undefined,
        });
        navigate(`/chat/${created.id}`, {
          replace: true,
          state: { initialMessage: message } satisfies ChatLocationState,
        });
      } catch (err) {
        console.error('Failed to create session:', err);
        setError(err instanceof Error ? err.message : 'Failed to create session');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    await sendMessageWithStreaming(session.id, message);
  };

  return (
    <>
      <div className="top-bar">
        <div className="top-bar-left">
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => navigate('/sessions')}
          >
            Back to Sessions
          </button>
        </div>

        <div className="session-info">
          {session ? (
            <div className="session-meta-stack">
              <div className="session-meta-row">
                <span className="session-title">{session.title || 'Untitled Session'}</span>
                {session.provider ? <span className="session-provider-chip">{session.provider}</span> : null}
                {session.model ? <span className="session-provider-chip">{session.model}</span> : null}
                {session.provider === 'automatic_router' && routedTarget ? (
                  <span className="session-provider-chip session-routed-chip" title={`Routed target: ${routedTarget}`}>
                    Routed to {routedTarget}
                  </span>
                ) : null}
                <span className={`session-status status-${session.status}`}>
                  {session.status}
                </span>
              </div>
              {session.status === 'failed' && sessionFailureReason ? (
                <div className="session-failure-reason" title={sessionFailureReason}>
                  Failure reason: {sessionFailureReason}
                </div>
              ) : null}
              {systemPromptSnapshot ? (
                <div className="session-system-prompt-row">
                  <button
                    type="button"
                    className={`session-system-prompt-pill${showSystemPromptDetails ? ' open' : ''}`}
                    onClick={() => setShowSystemPromptDetails((prev) => !prev)}
                    title="View the exact system prompt snapshot used for this session"
                  >
                    {hasSystemPromptBlocks ? 'System prompt used' : 'Default system prompt'}
                  </button>
                  {showSystemPromptDetails ? (
                    <div className="session-system-prompt-panel">
                      <div className="session-system-prompt-summary">
                        {hasSystemPromptBlocks
                          ? `${systemPromptSnapshot.blocks.length} instruction block(s) captured for this session.`
                          : 'No custom instruction blocks were captured for this session.'}
                      </div>
                      {systemPromptSnapshot.blocks.length > 0 ? (
                        <div className="session-system-prompt-blocks">
                          {systemPromptSnapshot.blocks.map((block, index) => (
                            <div className="session-system-prompt-block" key={`session-prompt-block-${index}`}>
                              <div className="session-system-prompt-block-header">
                                #{index + 1} {block.type || 'text'} {block.enabled ? '' : '(disabled)'}
                              </div>
                              {block.value ? <div className="session-system-prompt-block-meta">Configured value: {block.value}</div> : null}
                              {block.source_path ? <div className="session-system-prompt-block-meta">Source file: {block.source_path}</div> : null}
                              {block.error ? <div className="session-system-prompt-block-error">Error: {block.error}</div> : null}
                              {block.resolved_content ? <pre className="session-system-prompt-block-content">{block.resolved_content}</pre> : null}
                            </div>
                          ))}
                        </div>
                      ) : null}
                      <details className="session-system-prompt-full">
                        <summary>Full composed system prompt</summary>
                        <pre className="session-system-prompt-full-content">{systemPromptSnapshot.combined_prompt}</pre>
                      </details>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </div>
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
        {messages.length > 0 ? (
          <MessageList messages={messages} isLoading={isLoading} sessionId={session?.id || null} />
        ) : (
          <div className="empty-state">
            <h2>Start a Conversation</h2>
            <p>Type a message below to begin chatting with the agent.</p>
          </div>
        )}
      </div>
      
      <ChatInput
        onSend={handleSendMessage}
        disabled={isLoading}
        actionControls={!session && providers.length > 0 ? (
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
        ) : null}
      />
    </>
  );
}

export default ChatView;
