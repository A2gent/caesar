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
