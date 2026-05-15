import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from './ChatView';

const {
  getSessionMock,
  getSessionSummaryMock,
  cancelSessionRunMock,
  listSessionsMock,
  listProvidersMock,
  getProjectMock,
  sendMessageStreamMock,
  getPendingQuestionMock,
  answerQuestionMock,
  createSessionMock,
  listSubAgentsMock,
} = vi.hoisted(() => ({
  getSessionMock: vi.fn(),
  getSessionSummaryMock: vi.fn(async (sessionId: string) => ({
    id: sessionId,
    agent_id: 'build',
    title: 'Session',
    status: 'completed',
    created_at: '2026-04-16T10:00:00Z',
    updated_at: '2026-04-16T10:00:00Z',
    messages: [] as unknown[],
    metadata: {} as Record<string, unknown>,
  })),
  cancelSessionRunMock: vi.fn(),
  listSessionsMock: vi.fn(),
  listProvidersMock: vi.fn(),
  getProjectMock: vi.fn(),
  sendMessageStreamMock: vi.fn(),
  getPendingQuestionMock: vi.fn(),
  answerQuestionMock: vi.fn(),
  createSessionMock: vi.fn(),
  listSubAgentsMock: vi.fn(),
}));

vi.mock('../../api', () => ({
  getSession: getSessionMock,
  getSessionSummary: getSessionSummaryMock,
  cancelSessionRun: cancelSessionRunMock,
  listSessions: listSessionsMock,
  listProviders: listProvidersMock,
  getProject: getProjectMock,
  sendMessageStream: sendMessageStreamMock,
  getPendingQuestion: getPendingQuestionMock,
  answerQuestion: answerQuestionMock,
  createSession: createSessionMock,
  listSubAgents: listSubAgentsMock,
  buildImageAssetUrl: (path: string) => `/assets/images?path=${encodeURIComponent(path)}`,
  buildSpeechClipUrl: (clipID: string) => `/speech/clips/${encodeURIComponent(clipID)}`,
  attachToolCallsToCurrentAssistant: (messages: unknown[], _toolCalls: unknown[], message?: unknown) => (
    message ? [...messages, message] : messages
  ),
  mergeStreamMessage: (messages: unknown[], message?: unknown) => (
    message ? [...messages, message] : messages
  ),
}));

const OpenOldSessionButton = () => {
  const navigate = useNavigate();
  return (
    <button type="button" onClick={() => navigate('/chat/session-old')}>
      Open old session
    </button>
  );
};

describe('ChatView pending question flow', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'build',
      title: 'Question session',
      status: 'input_required',
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
      messages: [],
      metadata: {},
    });
    listSessionsMock.mockResolvedValue([]);
    listProvidersMock.mockResolvedValue([]);
    listSubAgentsMock.mockResolvedValue([]);
    getProjectMock.mockResolvedValue(null);
    sendMessageStreamMock.mockImplementation(async function* emptyStream() {});
    getPendingQuestionMock.mockResolvedValue({
      header: 'Need input',
      question: 'Which option should I use?',
      options: [
        { label: 'Option A', description: 'Use the safe path' },
        { label: 'Option B', description: 'Use the fast path' },
      ],
      multiple: false,
      custom: false,
    });
    answerQuestionMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(null);
    cancelSessionRunMock.mockResolvedValue(undefined);
  });

  it('keeps the send button available while waiting for a question answer', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('Need input');
    await waitFor(() => {
      expect(screen.queryByLabelText('Stop run')).not.toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: /option a/i }));
    expect(screen.getByDisplayValue('Option A')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Send message'));

    await waitFor(() => {
      expect(answerQuestionMock).toHaveBeenCalledWith('session-1', 'Option A');
    });
  });
});


describe('ChatView workflow review loop rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'build',
      title: 'Workflow session',
      status: 'running',
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
      messages: [],
      metadata: {
        workflow_definition: {
          nodes: [
            {
              id: 'review-loop',
              kind: 'review_loop',
              label: 'Review loop',
              workerLabel: 'Writer',
              reviewerLabel: 'Reviewer',
              workerSubAgentId: 'writer-agent',
              reviewerSubAgentId: 'reviewer-agent',
            },
          ],
        },
        workflow_state: {
          workflowName: 'Complex workflow',
          status: 'running',
          updatedAt: '2026-04-16T10:00:00Z',
          nodes: {
            'review-loop__critic': { status: 'pending' },
            'review-loop__worker': { status: 'running' },
          },
        },
      },
    });
    listSessionsMock.mockResolvedValue([]);
    listProvidersMock.mockResolvedValue([]);
    listSubAgentsMock.mockResolvedValue([]);
    getProjectMock.mockResolvedValue(null);
    sendMessageStreamMock.mockImplementation(async function* emptyStream() {});
    getPendingQuestionMock.mockResolvedValue(null);
    answerQuestionMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(null);
    cancelSessionRunMock.mockResolvedValue(undefined);
  });

  it('shows worker then reviewer labels and hides raw runtime ids', async () => {
    const { container } = render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    await screen.findByText('🔀 Complex workflow');

    const nodeLabels = Array.from(container.querySelectorAll('.session-workflow-node-id')).map((el) => el.textContent || '');
    expect(nodeLabels.length).toBeGreaterThanOrEqual(2);

    const writerIndex = nodeLabels.findIndex((label) => label.includes('Writer'));
    const reviewerIndex = nodeLabels.findIndex((label) => label.includes('Reviewer'));
    expect(writerIndex).toBeGreaterThanOrEqual(0);
    expect(reviewerIndex).toBeGreaterThanOrEqual(0);
    expect(writerIndex).toBeLessThan(reviewerIndex);

    expect(screen.queryByText('review-loop__worker')).not.toBeInTheDocument();
    expect(screen.queryByText('review-loop__critic')).not.toBeInTheDocument();
  });

  it('renders workflow child tool calls in the parent session timeline', async () => {
    const parentSession = {
      id: 'session-1',
      agent_id: 'build',
      title: 'Workflow session',
      status: 'running',
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
      messages: [],
      metadata: {
        workflow_definition: {
          nodes: [
            {
              id: 'review-loop',
              kind: 'review_loop',
              label: 'Review loop',
              workerLabel: 'Writer',
              reviewerLabel: 'Reviewer',
            },
          ],
        },
        workflow_state: {
          workflowName: 'Complex workflow',
          status: 'running',
          updatedAt: '2026-04-16T10:00:00Z',
          nodes: {
            'review-loop__worker': {
              status: 'running',
              childSessionId: 'child-worker',
              startedAt: '2026-04-16T10:00:30Z',
            },
          },
        },
      },
    };
    const childSession = {
      id: 'child-worker',
      agent_id: 'build',
      parent_id: 'session-1',
      title: 'Writer',
      status: 'running',
      created_at: '2026-04-16T10:00:30Z',
      updated_at: '2026-04-16T10:00:35Z',
      messages: [
        {
          role: 'assistant',
          content: '',
          timestamp: '2026-04-16T10:00:31Z',
          tool_calls: [
            {
              id: 'call-1',
              name: 'bash',
              input: { cmd: 'make test' },
            },
          ],
        },
        {
          role: 'tool',
          content: '',
          timestamp: '2026-04-16T10:00:35Z',
          tool_results: [
            {
              tool_call_id: 'call-1',
              name: 'bash',
              content: 'ran focused tests',
              is_error: false,
              duration_ms: 42,
            },
          ],
        },
      ],
      metadata: {},
    };
    getSessionMock.mockImplementation(async (sessionId: string) => (
      sessionId === 'child-worker' ? childSession : parentSession
    ));
    listSessionsMock.mockResolvedValue([childSession]);

    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText('Child session activity')).toBeInTheDocument();
    expect(await screen.findByText('bash')).toBeInTheDocument();
    expect(await screen.findByText('ran focused tests')).toBeInTheDocument();
  });
});


describe('ChatView session header project link', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'build',
      title: 'Linked project session',
      status: 'completed',
      project_id: 'project-123',
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
      messages: [],
      metadata: {},
    });
    listSessionsMock.mockResolvedValue([]);
    listProvidersMock.mockResolvedValue([]);
    listSubAgentsMock.mockResolvedValue([]);
    getProjectMock.mockResolvedValue({
      id: 'project-123',
      name: 'Project Alpha',
      path: '/tmp/project-alpha',
      created_at: '2026-04-15T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
    });
    sendMessageStreamMock.mockImplementation(async function* emptyStream() {});
    getPendingQuestionMock.mockResolvedValue(null);
    answerQuestionMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(null);
    cancelSessionRunMock.mockResolvedValue(undefined);
  });

  it('renders project name as link to project sessions list', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    const projectLink = await screen.findByRole('link', { name: 'Project Alpha' });
    expect(projectLink).toHaveAttribute('href', '/projects/project-123/explorer');
  });
});


describe('ChatView initial session loading', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockReturnValue(new Promise(() => {}));
    listSessionsMock.mockResolvedValue([]);
    listProvidersMock.mockResolvedValue([]);
    listSubAgentsMock.mockResolvedValue([]);
    getProjectMock.mockResolvedValue(null);
    sendMessageStreamMock.mockImplementation(async function* emptyStream() {});
    getPendingQuestionMock.mockResolvedValue(null);
    answerQuestionMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(null);
    cancelSessionRunMock.mockResolvedValue(undefined);
  });

  it('does not present a URL-backed session as a new empty session while loading', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getAllByText(/Loading session/).length).toBeGreaterThan(0);
    expect(screen.queryByText('New Session')).not.toBeInTheDocument();
    expect(screen.queryByText('Start a conversation')).not.toBeInTheDocument();
  });
});

describe('ChatView session transcript isolation', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    const sessions = {
      'session-new': {
        id: 'session-new',
        agent_id: 'build',
        title: 'New running session',
        status: 'running',
        created_at: '2026-04-16T10:00:00Z',
        updated_at: '2026-04-16T10:00:00Z',
        messages: [],
        metadata: {},
      },
      'session-old': {
        id: 'session-old',
        agent_id: 'build',
        title: 'Old completed session',
        status: 'completed',
        created_at: '2026-04-15T10:00:00Z',
        updated_at: '2026-04-15T10:01:00Z',
        messages: [
          {
            role: 'assistant',
            content: 'old session answer',
            timestamp: '2026-04-15T10:01:00Z',
          },
        ],
        metadata: {},
      },
    };

    getSessionMock.mockImplementation(async (sessionId: string) => sessions[sessionId as keyof typeof sessions] || sessions['session-old']);
    getSessionSummaryMock.mockImplementation(async (sessionId: string) => sessions[sessionId as keyof typeof sessions] || sessions['session-old']);
    listSessionsMock.mockResolvedValue(Object.values(sessions));
    listProvidersMock.mockResolvedValue([]);
    listSubAgentsMock.mockResolvedValue([]);
    getProjectMock.mockResolvedValue(null);
    getPendingQuestionMock.mockResolvedValue(null);
    answerQuestionMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(null);
    cancelSessionRunMock.mockResolvedValue(undefined);
  });

  it('does not render stream updates for a session after navigating to another session', async () => {
    let releaseStream: (() => void) | undefined;
    let resolveStreamFinished: () => void = () => {};
    const streamFinished = new Promise<void>((resolve) => {
      resolveStreamFinished = resolve;
    });

    sendMessageStreamMock.mockImplementation(async function* stream() {
      await new Promise<void>((resolve) => {
        releaseStream = resolve;
      });

      yield { type: 'assistant_delta', delta: 'new session answer' };
      yield {
        type: 'done',
        content: 'new session answer',
        status: 'completed',
        messages: [
          {
            role: 'user',
            content: 'start new session',
            timestamp: '2026-04-16T10:00:30Z',
          },
          {
            role: 'assistant',
            content: 'new session answer',
            timestamp: '2026-04-16T10:01:00Z',
          },
        ],
      };
      resolveStreamFinished();
    });

    render(
      <MemoryRouter initialEntries={[{ pathname: '/chat/session-new', state: { initialMessage: 'start new session' } }]}>
        <Routes>
          <Route
            path="/chat/:sessionId"
            element={(
              <>
                <ChatView />
                <OpenOldSessionButton />
              </>
            )}
          />
        </Routes>
      </MemoryRouter>,
    );

    await waitFor(() => {
      expect(releaseStream).toBeDefined();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Open old session' }));
    });
    expect(await screen.findByText('old session answer')).toBeInTheDocument();

    await act(async () => {
      releaseStream?.();
      await streamFinished;
    });

    expect(screen.getByText('old session answer')).toBeInTheDocument();
    expect(screen.queryByText('new session answer')).not.toBeInTheDocument();
  });
});


describe('ChatView provider failure details', () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'build',
      title: 'Failed Codex session',
      status: 'failed',
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
      messages: [
        {
          role: 'assistant',
          content: 'Request failed: LLM error: failed to read Codex response: stream error: stream ID 21; INTERNAL_ERROR; received from peer',
          timestamp: '2026-04-16T10:01:00Z',
        },
      ],
      provider_failures: [
        {
          provider: 'openai_codex',
          model: 'gpt-5.4',
          phase: 'retry_layer_failed',
          attempt: 1,
          max_attempts: 4,
          reason: 'failed to read Codex response: stream error: stream ID 21; INTERNAL_ERROR; received from peer',
          timestamp: '2026-04-16T10:01:00Z',
        },
      ],
      metadata: {},
    });
    listSessionsMock.mockResolvedValue([]);
    listProvidersMock.mockResolvedValue([]);
    listSubAgentsMock.mockResolvedValue([]);
    getProjectMock.mockResolvedValue(null);
    sendMessageStreamMock.mockImplementation(async function* emptyStream() {});
    getPendingQuestionMock.mockResolvedValue(null);
    answerQuestionMock.mockResolvedValue(undefined);
    createSessionMock.mockResolvedValue(null);
    cancelSessionRunMock.mockResolvedValue(undefined);
  });

  it('classifies Codex HTTP/2 stream resets as network/provider reachability failures', async () => {
    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect(await screen.findByText(/Failure reason: Provider is unreachable:/)).toBeInTheDocument();
    expect((await screen.findAllByText(/\[network\] openai_codex\/gpt-5\.4/)).length).toBeGreaterThan(0);
  });

  it('links expired OpenAI Codex auth failures to provider settings', async () => {
    const expiredReason = 'LLM error: OpenAI Codex error (401): { "error": { "message": "Provided authentication token is expired. Please try signing in again.", "code": "token_expired" }, "status": 401 }';
    getSessionMock.mockResolvedValue({
      id: 'session-1',
      agent_id: 'build',
      title: 'Failed Codex session',
      status: 'failed',
      created_at: '2026-04-16T10:00:00Z',
      updated_at: '2026-04-16T10:00:00Z',
      messages: [
        {
          role: 'assistant',
          content: `Request failed: ${expiredReason}`,
          timestamp: '2026-04-16T10:01:00Z',
        },
      ],
      provider_failures: [
        {
          provider: 'openai_codex',
          model: 'gpt-5.4',
          phase: 'retry_layer_failed',
          attempt: 1,
          max_attempts: 4,
          reason: expiredReason,
          timestamp: '2026-04-16T10:01:00Z',
        },
      ],
      metadata: {},
    });

    render(
      <MemoryRouter initialEntries={['/chat/session-1']}>
        <Routes>
          <Route path="/chat/:sessionId" element={<ChatView />} />
        </Routes>
      </MemoryRouter>,
    );

    expect((await screen.findAllByText(/OpenAI Codex authentication expired/)).length).toBeGreaterThan(0);
    const settingsLinks = await screen.findAllByRole('link', { name: 'Open provider settings' });
    expect(settingsLinks[0]).toHaveAttribute('href', '/providers/openai_codex');
  });
});
