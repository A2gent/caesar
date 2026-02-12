// API client for aagent HTTP server

const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://jetson-orin:8080';

// Types matching the Go server responses
export interface Session {
  id: string;
  agent_id: string;
  parent_id?: string;
  title: string;
  status: string;
  created_at: string;
  updated_at: string;
  messages?: Message[];
}

export interface Message {
  role: 'user' | 'assistant' | 'tool';
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  timestamp: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error: boolean;
}

export interface ChatResponse {
  content: string;
  messages: Message[];
  status: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
  };
}

export interface CreateSessionRequest {
  agent_id?: string;
  task?: string;
}

export interface CreateSessionResponse {
  id: string;
  agent_id: string;
  status: string;
  created_at: string;
}

// API client functions
export async function listSessions(): Promise<Session[]> {
  const response = await fetch(`${API_BASE_URL}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

export async function getSession(sessionId: string): Promise<Session> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to get session: ${response.statusText}`);
  }
  return response.json();
}

export async function createSession(request: CreateSessionRequest = {}): Promise<CreateSessionResponse> {
  const response = await fetch(`${API_BASE_URL}/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create session: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteSession(sessionId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }
}

export async function sendMessage(sessionId: string, message: string): Promise<ChatResponse> {
  const response = await fetch(`${API_BASE_URL}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to send message: ${response.statusText}`);
  }
  return response.json();
}

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

// --- Recurring Jobs API ---

export interface RecurringJob {
  id: string;
  name: string;
  schedule_human: string;
  schedule_cron: string;
  task_prompt: string;
  enabled: boolean;
  last_run_at?: string;
  next_run_at?: string;
  created_at: string;
  updated_at: string;
}

export interface JobExecution {
  id: string;
  job_id: string;
  session_id?: string;
  status: 'running' | 'success' | 'failed';
  output?: string;
  error?: string;
  started_at: string;
  finished_at?: string;
}

export interface CreateJobRequest {
  name: string;
  schedule_text: string;
  task_prompt: string;
  enabled: boolean;
}

export interface UpdateJobRequest {
  name?: string;
  schedule_text?: string;
  task_prompt?: string;
  enabled?: boolean;
}

export async function listJobs(): Promise<RecurringJob[]> {
  const response = await fetch(`${API_BASE_URL}/jobs`);
  if (!response.ok) {
    throw new Error(`Failed to list jobs: ${response.statusText}`);
  }
  return response.json();
}

export async function getJob(jobId: string): Promise<RecurringJob> {
  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to get job: ${response.statusText}`);
  }
  return response.json();
}

export async function createJob(request: CreateJobRequest): Promise<RecurringJob> {
  const response = await fetch(`${API_BASE_URL}/jobs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create job: ${response.statusText}`);
  }
  return response.json();
}

export async function updateJob(jobId: string, request: UpdateJobRequest): Promise<RecurringJob> {
  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to update job: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteJob(jobId: string): Promise<void> {
  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete job: ${response.statusText}`);
  }
}

export async function runJobNow(jobId: string): Promise<JobExecution> {
  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/run`, {
    method: 'POST',
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to run job: ${response.statusText}`);
  }
  return response.json();
}

export async function listJobExecutions(jobId: string, limit?: number): Promise<JobExecution[]> {
  const query = limit ? `?limit=${limit}` : '';
  const response = await fetch(`${API_BASE_URL}/jobs/${jobId}/executions${query}`);
  if (!response.ok) {
    throw new Error(`Failed to list job executions: ${response.statusText}`);
  }
  return response.json();
}
