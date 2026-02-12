import { useState, useEffect, useCallback } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, useNavigate, useParams } from 'react-router-dom';
import Sidebar from './Sidebar';
import ChatInput from './ChatInput';
import MessageList from './MessageList';
import JobsList from './JobsList';
import JobEdit from './JobEdit';
import type { Session, Message } from './api';
import { 
  listSessions, 
  getSession, 
  createSession, 
  sendMessage,
  deleteSession 
} from './api';
import './App.css';

// ChatView component
function ChatView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [currentSession, setCurrentSession] = useState<Session | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load sessions on mount
  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
      setError('Failed to connect to server. Is the aagent server running?');
    }
  };

  const handleSelectSession = useCallback(async (sessionId: string) => {
    try {
      setIsLoading(true);
      setError(null);
      const session = await getSession(sessionId);
      setCurrentSession(session);
      setMessages(session.messages || []);
    } catch (err) {
      console.error('Failed to load session:', err);
      setError('Failed to load session');
    } finally {
      setIsLoading(false);
    }
    // Note: navigation to /chat is handled by Sidebar when needed
  }, []);

  const handleCreateSession = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);
      const response = await createSession({ agent_id: 'build' });
      await loadSessions();
      await handleSelectSession(response.id);
    } catch (err) {
      console.error('Failed to create session:', err);
      setError('Failed to create session');
    } finally {
      setIsLoading(false);
    }
  }, [handleSelectSession]);

  const handleDeleteSession = useCallback(async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      if (currentSession?.id === sessionId) {
        setCurrentSession(null);
        setMessages([]);
      }
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
      setError('Failed to delete session');
    }
  }, [currentSession?.id]);

  const handleSendMessage = async (message: string) => {
    if (!currentSession) {
      // Create a new session if none is selected
      try {
        setIsLoading(true);
        const response = await createSession({ agent_id: 'build', task: message });
        await loadSessions();
        
        // Get the session with the initial message
        const session = await getSession(response.id);
        setCurrentSession(session);
        setMessages(session.messages || []);
        
        // Now send the message to trigger the agent
        const chatResponse = await sendMessage(response.id, message);
        setMessages(chatResponse.messages);
        
        // Refresh session list to update titles
        await loadSessions();
      } catch (err) {
        console.error('Failed to send message:', err);
        setError(err instanceof Error ? err.message : 'Failed to send message');
      } finally {
        setIsLoading(false);
      }
      return;
    }

    // Add user message optimistically
    const userMessage: Message = {
      role: 'user',
      content: message,
      timestamp: new Date().toISOString(),
    };
    setMessages(prev => [...prev, userMessage]);
    setIsLoading(true);
    setError(null);

    try {
      const response = await sendMessage(currentSession.id, message);
      setMessages(response.messages);
      
      // Update current session status
      setCurrentSession(prev => prev ? { ...prev, status: response.status } : null);
      
      // Refresh sessions to update titles
      await loadSessions();
    } catch (err) {
      console.error('Failed to send message:', err);
      setError(err instanceof Error ? err.message : 'Failed to send message');
      // Remove the optimistic message on error
      setMessages(prev => prev.slice(0, -1));
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <>
      <Sidebar 
        sessions={sessions}
        currentSessionId={currentSession?.id}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        currentPage="chat"
      />
      <div className="main-content">
        <div className="top-bar">
          <div className="session-info">
            {currentSession ? (
              <>
                <span className="session-title">{currentSession.title || 'Untitled Session'}</span>
                <span className={`session-status status-${currentSession.status}`}>
                  {currentSession.status}
                </span>
              </>
            ) : (
              <span className="session-title">No session selected</span>
            )}
          </div>
          <div className="search-container">
            <svg className="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              className="search-input"
              placeholder="Search conversations..."
            />
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
            <MessageList messages={messages} isLoading={isLoading} />
          ) : (
            <div className="empty-state">
              <h2>Welcome to A2gent</h2>
              <p>Start a new conversation or select an existing session from the sidebar.</p>
              {!currentSession && (
                <button onClick={handleCreateSession} className="create-session-btn">
                  New Session
                </button>
              )}
            </div>
          )}
        </div>
        
        <ChatInput onSend={handleSendMessage} disabled={isLoading} />
      </div>
    </>
  );
}

// JobsView component
function JobsView() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const navigate = useNavigate();

  useEffect(() => {
    loadSessions();
  }, []);

  const loadSessions = async () => {
    try {
      const data = await listSessions();
      setSessions(data);
    } catch (err) {
      console.error('Failed to load sessions:', err);
    }
  };

  const handleSelectSession = async (_sessionId: string) => {
    // Navigate to chat view with this session
    navigate('/chat');
  };

  const handleCreateSession = async () => {
    try {
      await createSession({ agent_id: 'build' });
      await loadSessions();
      navigate('/chat');
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    try {
      await deleteSession(sessionId);
      await loadSessions();
    } catch (err) {
      console.error('Failed to delete session:', err);
    }
  };

  return (
    <>
      <Sidebar 
        sessions={sessions}
        currentSessionId={undefined}
        onSelectSession={handleSelectSession}
        onCreateSession={handleCreateSession}
        onDeleteSession={handleDeleteSession}
        currentPage="jobs"
      />
      <div className="main-content jobs-page">
        <Routes>
          <Route path="/" element={<JobsListWrapper />} />
          <Route path="/new" element={<JobEditWrapper />} />
          <Route path="/edit/:jobId" element={<JobEditWrapper />} />
        </Routes>
      </div>
    </>
  );
}

function JobsListWrapper() {
  const navigate = useNavigate();
  
  return (
    <JobsList 
      onCreateJob={() => navigate('/agent/jobs/new')}
      onEditJob={(jobId) => navigate(`/agent/jobs/edit/${jobId}`)}
    />
  );
}

function JobEditWrapper() {
  const navigate = useNavigate();
  const { jobId } = useParams();
  
  return (
    <JobEdit 
      jobId={jobId}
      onSave={() => navigate('/agent/jobs')}
      onCancel={() => navigate('/agent/jobs')}
    />
  );
}

// Main App component
function App() {
  return (
    <Router>
      <div className="app-container">
        <Routes>
          <Route path="/" element={<Navigate to="/chat" replace />} />
          <Route path="/chat/*" element={<ChatView />} />
          <Route path="/agent/jobs/*" element={<JobsView />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
