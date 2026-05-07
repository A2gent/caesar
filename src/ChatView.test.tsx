import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import ChatView from './ChatView';

const {
  getSessionMock,
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

vi.mock('./api', () => ({
  getSession: getSessionMock,
  cancelSessionRun: cancelSessionRunMock,
  listSessions: listSessionsMock,
  listProviders: listProvidersMock,
  getProject: getProjectMock,
  sendMessageStream: sendMessageStreamMock,
  getPendingQuestion: getPendingQuestionMock,
  answerQuestion: answerQuestionMock,
  createSession: createSessionMock,
  listSubAgents: listSubAgentsMock,
}));

beforeEach(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
});

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
});
