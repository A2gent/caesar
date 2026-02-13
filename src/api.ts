// API client for aagent HTTP server

const API_BASE_URL_STORAGE_KEY = 'a2gent.api_base_url';
const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';

function normalizeApiBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

export function getApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
  }

  const stored = window.localStorage.getItem(API_BASE_URL_STORAGE_KEY);
  if (stored && stored.trim() !== '') {
    return normalizeApiBaseUrl(stored);
  }

  return normalizeApiBaseUrl(DEFAULT_API_BASE_URL);
}

export function setApiBaseUrl(url: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalized = normalizeApiBaseUrl(url);
  if (normalized === '') {
    window.localStorage.removeItem(API_BASE_URL_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(API_BASE_URL_STORAGE_KEY, normalized);
}

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

export interface SettingsResponse {
  settings: Record<string, string>;
}

export type IntegrationProvider = 'telegram' | 'slack' | 'discord' | 'whatsapp' | 'webhook';
export type IntegrationMode = 'notify_only' | 'duplex';

export interface Integration {
  id: string;
  provider: IntegrationProvider;
  name: string;
  mode: IntegrationMode;
  enabled: boolean;
  config: Record<string, string>;
  created_at: string;
  updated_at: string;
}

export interface IntegrationRequest {
  provider: IntegrationProvider;
  name: string;
  mode: IntegrationMode;
  enabled: boolean;
  config: Record<string, string>;
}

export interface IntegrationTestResponse {
  success: boolean;
  message: string;
}

// API client functions
export async function listSessions(): Promise<Session[]> {
  const response = await fetch(`${getApiBaseUrl()}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list sessions: ${response.statusText}`);
  }
  return response.json();
}

export async function getSession(sessionId: string): Promise<Session> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}`);
  if (!response.ok) {
    throw new Error(`Failed to get session: ${response.statusText}`);
  }
  return response.json();
}

export async function createSession(request: CreateSessionRequest = {}): Promise<CreateSessionResponse> {
  const response = await fetch(`${getApiBaseUrl()}/sessions`, {
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
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete session: ${response.statusText}`);
  }
}

export async function sendMessage(sessionId: string, message: string): Promise<ChatResponse> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/chat`, {
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
    const response = await fetch(`${getApiBaseUrl()}/health`);
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
  const response = await fetch(`${getApiBaseUrl()}/jobs`);
  if (!response.ok) {
    throw new Error(`Failed to list jobs: ${response.statusText}`);
  }
  return response.json();
}

export async function getJob(jobId: string): Promise<RecurringJob> {
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}`);
  if (!response.ok) {
    throw new Error(`Failed to get job: ${response.statusText}`);
  }
  return response.json();
}

export async function createJob(request: CreateJobRequest): Promise<RecurringJob> {
  const response = await fetch(`${getApiBaseUrl()}/jobs`, {
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
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}`, {
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
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete job: ${response.statusText}`);
  }
}

export async function runJobNow(jobId: string): Promise<JobExecution> {
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}/run`, {
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
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}/executions${query}`);
  if (!response.ok) {
    throw new Error(`Failed to list job executions: ${response.statusText}`);
  }
  return response.json();
}

export async function listJobSessions(jobId: string): Promise<Session[]> {
  const response = await fetch(`${getApiBaseUrl()}/jobs/${jobId}/sessions`);
  if (!response.ok) {
    throw new Error(`Failed to list job sessions: ${response.statusText}`);
  }
  return response.json();
}

// --- Settings API ---

export async function getSettings(): Promise<Record<string, string>> {
  const response = await fetch(`${getApiBaseUrl()}/settings`);
  if (!response.ok) {
    throw new Error(`Failed to get settings: ${response.statusText}`);
  }
  const data: SettingsResponse = await response.json();
  return data.settings || {};
}

export async function updateSettings(settings: Record<string, string>): Promise<Record<string, string>> {
  const response = await fetch(`${getApiBaseUrl()}/settings`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ settings }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to update settings: ${response.statusText}`);
  }
  const data: SettingsResponse = await response.json();
  return data.settings || {};
}

// --- Integrations API ---

export async function listIntegrations(): Promise<Integration[]> {
  const response = await fetch(`${getApiBaseUrl()}/integrations`);
  if (!response.ok) {
    throw new Error(`Failed to list integrations: ${response.statusText}`);
  }
  return response.json();
}

export async function createIntegration(payload: IntegrationRequest): Promise<Integration> {
  const response = await fetch(`${getApiBaseUrl()}/integrations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create integration: ${response.statusText}`);
  }
  return response.json();
}

export async function updateIntegration(integrationId: string, payload: IntegrationRequest): Promise<Integration> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/${integrationId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to update integration: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteIntegration(integrationId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/${integrationId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete integration: ${response.statusText}`);
  }
}

export async function testIntegration(integrationId: string): Promise<IntegrationTestResponse> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/${integrationId}/test`, {
    method: 'POST',
  });
  const data: IntegrationTestResponse = await response.json();
  if (!response.ok) {
    throw new Error(data.message || `Failed to test integration: ${response.statusText}`);
  }
  return data;
}
