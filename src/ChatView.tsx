import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import QuestionPrompt from './QuestionPrompt';
import { EmptyState, EmptyStateTitle, EmptyStateHint } from './EmptyState';
import { TaskProgressPanel } from './TaskProgressPanel';
import { 
  getSession, 
  cancelSessionRun,
  listProviders,
  getProject,
  sendMessageStream,
  getPendingQuestion,
  answerQuestion,
  type LLMProviderType,
  type ProviderConfig,
  type Session, 
  type Message,
  type ChatStreamEvent,
  type PendingQuestion,
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
  const [questionAnswer, setQuestionAnswer] = useState<string>('');
  const [projectName, setProjectName] = useState<string | null>(null);

  const SESSION_POLL_INTERVAL_MS = 2000; // Poll every 2 seconds for active sessions
  
  const activeSessionId = urlSessionId;
  const locationState = (location.state || {}) as ChatLocationState;
  const sessionFailureReason = useMemo(
    () => deriveSessionFailureReason(session, error),
    [session, error],
  );
  const systemPromptSnapshot = session?.system_prompt_snapshot;
  const routedTarget = useMemo(() => routedTargetLabel(session), [session]);

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
      setQuestionAnswer('');
      return;
    }

    const loadQuestion = async () => {
      try {
        const question = await getPendingQuestion(session.id);
        setPendingQuestion(question);
        setQuestionAnswer(''); // Clear previous answer
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



  const sendMessageWithStreaming = async (targetSessionId: string, message: string) => {
    setActiveRequestSessionId(targetSessionId);
    
    // Check if the message already exists (e.g., for queued sessions)
    const lastUserMessage = messages.filter(m => m.role === 'user').pop();
    const messageAlreadyExists = lastUserMessage?.content === message;
    
    if (!messageAlreadyExists) {
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
    const controller = new AbortController();
    activeStreamAbortRef.current = controller;

    try {
      for await (const event of sendMessageStream(targetSessionId, message, controller.signal)) {
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

    if (event.type === 'done') {
      setMessages(event.messages);
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
      setError(normalizeFailureReason(event.error || 'Failed to send message'));
      if (typeof event.status === 'string' && event.status.trim() !== '') {
        setSession(prev => (prev && prev.id === targetSessionId ? { ...prev, status: event.status as string } : prev));
      }
    }
  };



  const handleSendMessage = async (message: string) => {
    setError(null);
    
    // If there's a pending question, treat the message as an answer
    if (session && pendingQuestion) {
      await handleAnswerQuestion(message);
      return;
    }
    
    if (!session) {
      return;
    }
    
    await sendMessageWithStreaming(session.id, message);
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
      setQuestionAnswer('');
      
      // Reload session to continue execution
      const fresh = await getSession(session.id);
      setSession(fresh);
      setMessages(fresh.messages || []);
      
      // If session is running again, start polling or streaming
      if (fresh.status === 'running') {
        setActiveRequestSessionId(fresh.id);
        // The existing polling mechanism will handle updates
      }
    } catch (err) {
      console.error('Failed to answer question:', err);
      setError(err instanceof Error ? err.message : 'Failed to answer question');
    } finally {
      setIsLoading(false);
    }
  };

  const handleSelectQuestionOption = (answer: string) => {
    setQuestionAnswer(answer);
  };

  const isActiveRequest = Boolean(session && activeRequestSessionId === session.id);
  const inputDisabled = isLoading && !session;

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
                {session.provider ? <span className="session-provider-chip">{session.provider}</span> : null}
                {session.model ? <span className="session-provider-chip">{session.model}</span> : null}
                {session.provider === 'automatic_router' && routedTarget ? (
                  <span className="session-provider-chip session-routed-chip" title={`Routed target: ${routedTarget}`}>
                    Routed to {routedTarget}
                  </span>
                ) : null}
                {session.task_progress ? (
                  <TaskProgressPanel taskProgress={session.task_progress} />
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
              {session.status === 'failed' && sessionFailureReason ? (
                <div className="session-failure-reason" title={sessionFailureReason}>
                  Failure reason: {sessionFailureReason}
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
            messages={messages} 
            isLoading={isLoading} 
            sessionId={session?.id || null}
            projectId={session?.project_id || null}
            systemPromptSnapshot={systemPromptSnapshot}
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
          selectedOption={questionAnswer}
        />
      )}
      
      <ChatInput
        onSend={handleSendMessage}
        disabled={inputDisabled}
        onStop={() => void handleCancelSession()}
        showStopButton={Boolean(session && isActiveRequest)}
        canStop={Boolean(session)}
        value={questionAnswer}
        onValueChange={setQuestionAnswer}
        placeholder={pendingQuestion ? "Type your answer or select an option above..." : undefined}
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
        ) : queuedMessages.length > 0 ? (
          <span className="chat-provider-select" title={queuedMessages.join('\n')}>
            Queued: {queuedMessages.length}
          </span>
        ) : null}
      />

    </>
  );
}

export default ChatView;
