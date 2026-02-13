import { useState, useEffect } from 'react';
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

  const activeSessionId = urlSessionId;
  const locationState = (location.state || {}) as ChatLocationState;

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
      setError(err instanceof Error ? err.message : 'Failed to send message');
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
      return;
    }

    if (event.type === 'error') {
      setError(event.error || 'Failed to send message');
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
            <>
              <span className="session-title">{session.title || 'Untitled Session'}</span>
              {session.provider ? <span className="session-provider-chip">{session.provider}</span> : null}
              {session.model ? <span className="session-provider-chip">{session.model}</span> : null}
              <span className={`session-status status-${session.status}`}>
                {session.status}
              </span>
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
