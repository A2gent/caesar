// API client for aagent HTTP server

const API_BASE_URL_STORAGE_KEY = 'a2gent.api_base_url';
const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
const APP_TITLE_STORAGE_KEY = 'a2gent.app_title';
const DEFAULT_APP_TITLE = '🤖 A2';

function normalizeApiBaseUrl(url: string): string {
  return url.trim().replace(/\/$/, '');
}

async function buildApiError(response: Response, fallback: string): Promise<Error> {
  const statusDetail = `${response.status} ${response.statusText}`.trim();
  let body = '';
  try {
    body = await response.text();
  } catch {
    body = '';
  }

  if (body) {
    try {
      const parsed = JSON.parse(body) as { error?: string; message?: string };
      const message = parsed.error || parsed.message;
      if (message && message.trim() !== '') {
        return new Error(message);
      }
    } catch {
      // Ignore parse errors and use body fallback.
    }
    return new Error(`${fallback}: ${body}`);
  }

  return new Error(`${fallback}: ${statusDetail}`);
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

function normalizeAppTitle(title: string): string {
  return title.trim();
}

export function getDefaultAppTitle(): string {
  return DEFAULT_APP_TITLE;
}

export function getAppTitle(): string {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_TITLE;
  }

  const stored = window.localStorage.getItem(APP_TITLE_STORAGE_KEY);
  const normalized = normalizeAppTitle(stored || '');
  if (normalized !== '') {
    return normalized;
  }

  return DEFAULT_APP_TITLE;
}

export function setAppTitle(title: string): string {
  if (typeof window === 'undefined') {
    return DEFAULT_APP_TITLE;
  }

  const normalized = normalizeAppTitle(title);
  if (normalized === '') {
    window.localStorage.removeItem(APP_TITLE_STORAGE_KEY);
    return DEFAULT_APP_TITLE;
  }

  window.localStorage.setItem(APP_TITLE_STORAGE_KEY, normalized);
  return normalized;
}

// Types matching the Go server responses
export interface Session {
  id: string;
  agent_id: string;
  parent_id?: string;
  project_id?: string;
  provider?: string;
  model?: string;
  routed_provider?: string;
  routed_model?: string;
  title: string;
  status: string;
  total_tokens?: number;
  run_duration_seconds?: number;
  created_at: string;
  updated_at: string;
  messages?: Message[];
  system_prompt_snapshot?: SystemPromptSnapshot;
}

export interface SystemPromptSnapshot {
  base_prompt: string;
  combined_prompt: string;
  base_estimated_tokens?: number;
  combined_estimated_tokens?: number;
  blocks: SystemPromptBlockSnapshot[];
}

export interface SystemPromptBlockSnapshot {
  type: string;
  value: string;
  enabled: boolean;
  resolved_content?: string;
  source_path?: string;
  error?: string;
  estimated_tokens?: number;
}

export interface InstructionEstimateResponse {
  snapshot: SystemPromptSnapshot;
}

export interface Message {
  role: 'user' | 'assistant' | 'tool' | 'system';
  content: string;
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  metadata?: Record<string, unknown>;
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

export type ChatStreamEvent =
  | { type: 'status'; status: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'done'; content: string; messages: Message[]; status: string; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; error: string; status?: string };

export interface CreateSessionRequest {
  agent_id?: string;
  task?: string;
  provider?: string;
  model?: string;
  project_id?: string;
}

export interface CreateSessionResponse {
  id: string;
  agent_id: string;
  project_id?: string;
  provider?: string;
  model?: string;
  status: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  folders: string[];
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  name: string;
  folders: string[];
}

export interface UpdateProjectRequest {
  name?: string;
  folders?: string[];
}

export interface SettingsResponse {
  settings: Record<string, string>;
}

export interface MindConfigResponse {
  root_folder: string;
}

export interface MindTreeEntry {
  name: string;
  path: string;
  type: 'directory' | 'file';
  has_child?: boolean;
}

export interface MindTreeResponse {
  root_folder: string;
  path: string;
  entries: MindTreeEntry[];
}

export interface SkillBrowseResponse {
  path: string;
  entries: MindTreeEntry[];
}

export interface SkillFile {
  name: string;
  path: string;
  relative_path: string;
}

export interface SkillDiscoverResponse {
  folder: string;
  skills: SkillFile[];
}

export interface BuiltInSkill {
  id: string;
  name: string;
  kind: string;
  description: string;
}

export interface BuiltInSkillsResponse {
  skills: BuiltInSkill[];
}

export interface IntegrationBackedTool {
  name: string;
  description: string;
  input_schema?: Record<string, unknown>;
}

export interface IntegrationBackedSkill {
  id: string;
  name: string;
  provider: string;
  mode: string;
  enabled: boolean;
  tools: IntegrationBackedTool[];
}

export interface IntegrationBackedSkillsResponse {
  skills: IntegrationBackedSkill[];
}

export interface MindFileResponse {
  root_folder: string;
  path: string;
  content: string;
}

export interface ElevenLabsVoice {
  voice_id: string;
  name: string;
  preview_url?: string;
}

export type LLMProviderType = string;

export interface FallbackChainNode {
  provider: LLMProviderType;
  model: string;
}

export interface RouterRule {
  match: string;
  provider: LLMProviderType;
  model?: string;
}

export interface ProviderConfig {
  type: LLMProviderType;
  display_name: string;
  default_url: string;
  requires_key: boolean;
  default_model: string;
  context_window: number;
  is_active: boolean;
  configured: boolean;
  has_api_key: boolean;
  base_url: string;
  model: string;
  fallback_chain?: FallbackChainNode[];
  router_provider?: LLMProviderType;
  router_model?: string;
  router_rules?: RouterRule[];
}

export interface UpdateProviderRequest {
  name?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
  fallback_chain?: FallbackChainNode[];
  router_provider?: LLMProviderType;
  router_model?: string;
  router_rules?: RouterRule[];
  active?: boolean;
}

export interface CreateFallbackAggregateRequest {
  name: string;
  fallback_chain: FallbackChainNode[];
  active?: boolean;
}

export interface ProviderModelsResponse {
  models: string[];
}

function normalizeLMStudioBaseUrl(raw?: string): string {
  if (!raw) return '';
  let base = raw.trim().replace(/\/+$/, '');
  if (base.endsWith('/models')) {
    base = base.slice(0, -'/models'.length);
  } else if (base.endsWith('/chat/completions')) {
    base = base.slice(0, -'/chat/completions'.length);
  }
  return base;
}

export type IntegrationProvider =
  | 'telegram'
  | 'slack'
  | 'discord'
  | 'whatsapp'
  | 'webhook'
  | 'google_calendar'
  | 'elevenlabs'
  | 'perplexity'
  | 'brave_search';
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

export type MCPTransport = 'stdio' | 'http';

export interface MCPServer {
  id: string;
  name: string;
  transport: MCPTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout_seconds: number;
  last_test_at?: string;
  last_test_success?: boolean;
  last_test_message?: string;
  last_estimated_tokens?: number;
  last_tool_count?: number;
  created_at: string;
  updated_at: string;
}

export interface MCPServerRequest {
  name: string;
  transport: MCPTransport;
  enabled: boolean;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  cwd?: string;
  url?: string;
  headers?: Record<string, string>;
  timeout_seconds: number;
}

export interface MCPTool {
  name: string;
  description?: string;
  input_schema?: Record<string, unknown>;
  raw?: Record<string, unknown>;
}

export interface MCPServerTestResponse {
  success: boolean;
  message: string;
  transport: MCPTransport;
  duration_ms: number;
  server_info?: Record<string, unknown>;
  capabilities?: Record<string, unknown>;
  tools: MCPTool[];
  tool_count: number;
  estimated_tokens: number;
  estimated_metadata_tokens: number;
  estimated_tools_tokens: number;
  logs: string[];
}

export interface TelegramChatCandidate {
  chat_id: string;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface TelegramChatDiscoveryResponse {
  chats: TelegramChatCandidate[];
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
    throw await buildApiError(response, 'Failed to create session');
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
    throw await buildApiError(response, 'Failed to send message');
  }
  return response.json();
}

export async function updateSessionProject(sessionId: string, projectId?: string): Promise<Session> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/project`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ project_id: projectId ?? null }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to update session project');
  }
  return response.json();
}

export async function listProjects(): Promise<Project[]> {
  const response = await fetch(`${getApiBaseUrl()}/projects`);
  if (!response.ok) {
    throw new Error(`Failed to list projects: ${response.statusText}`);
  }
  return response.json();
}

export async function getProject(projectId: string): Promise<Project> {
  const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}`);
  if (!response.ok) {
    throw new Error(`Failed to get project: ${response.statusText}`);
  }
  return response.json();
}

export async function createProject(request: CreateProjectRequest): Promise<Project> {
  const response = await fetch(`${getApiBaseUrl()}/projects`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create project');
  }
  return response.json();
}

export async function updateProject(projectId: string, request: UpdateProjectRequest): Promise<Project> {
  const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to update project');
  }
  return response.json();
}

export async function deleteProject(projectId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/projects/${projectId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw new Error(`Failed to delete project: ${response.statusText}`);
  }
}

export async function* sendMessageStream(
  sessionId: string,
  message: string,
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({ message }),
  });

  if (!response.ok) {
    throw await buildApiError(response, 'Failed to send message');
  }

  if (!response.body) {
    throw new Error('Streaming response body is unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) {
        continue;
      }
      let event: ChatStreamEvent;
      try {
        event = JSON.parse(trimmed) as ChatStreamEvent;
      } catch {
        continue;
      }
      yield event;
    }
  }

  const tail = buffer.trim();
  if (tail) {
    try {
      yield JSON.parse(tail) as ChatStreamEvent;
    } catch {
      // Ignore malformed tail chunks.
    }
  }
}

export async function cancelSessionRun(sessionId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/cancel`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to cancel session');
  }
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
  task_prompt_source?: 'text' | 'file';
  task_prompt_file?: string;
  llm_provider?: LLMProviderType;
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
  task_prompt_source?: 'text' | 'file';
  task_prompt_file?: string;
  llm_provider?: LLMProviderType;
  enabled: boolean;
}

export interface UpdateJobRequest {
  name?: string;
  schedule_text?: string;
  task_prompt?: string;
  task_prompt_source?: 'text' | 'file';
  task_prompt_file?: string;
  llm_provider?: LLMProviderType | '';
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
    throw await buildApiError(response, 'Failed to delete job');
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

export async function estimateInstructionPrompt(settings: Record<string, string>): Promise<InstructionEstimateResponse> {
  const response = await fetch(`${getApiBaseUrl()}/settings/instruction-estimate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ settings }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to estimate instruction prompt');
  }
  return response.json();
}

// --- My Mind API ---

export async function getMindConfig(): Promise<MindConfigResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/config`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load My Mind configuration');
  }
  return response.json();
}

export async function updateMindConfig(rootFolder: string): Promise<MindConfigResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/config`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ root_folder: rootFolder }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to update My Mind configuration');
  }
  return response.json();
}

export async function browseMindDirectories(path: string): Promise<MindTreeResponse> {
  const query = path.trim() === '' ? '' : `?path=${encodeURIComponent(path)}`;
  const response = await fetch(`${getApiBaseUrl()}/mind/browse${query}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to browse directories');
  }
  return response.json();
}

export async function browseSkillDirectories(path: string): Promise<SkillBrowseResponse> {
  const query = path.trim() === '' ? '' : `?path=${encodeURIComponent(path)}`;
  const response = await fetch(`${getApiBaseUrl()}/skills/browse${query}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to browse skill directories');
  }
  return response.json();
}

export async function discoverSkills(folder: string): Promise<SkillDiscoverResponse> {
  const response = await fetch(`${getApiBaseUrl()}/skills/discover?folder=${encodeURIComponent(folder)}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to discover markdown skills');
  }
  return response.json();
}

export async function listBuiltInSkills(): Promise<BuiltInSkill[]> {
  const response = await fetch(`${getApiBaseUrl()}/skills/builtin`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list built-in skills');
  }
  const data: BuiltInSkillsResponse = await response.json();
  return data.skills || [];
}

export async function listIntegrationBackedSkills(): Promise<IntegrationBackedSkill[]> {
  const response = await fetch(`${getApiBaseUrl()}/skills/integration-backed`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list integration-backed skills');
  }
  const data: IntegrationBackedSkillsResponse = await response.json();
  return data.skills || [];
}

export async function listMindTree(path = ''): Promise<MindTreeResponse> {
  const query = path.trim() === '' ? '' : `?path=${encodeURIComponent(path)}`;
  const response = await fetch(`${getApiBaseUrl()}/mind/tree${query}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list My Mind tree');
  }
  return response.json();
}

export async function getMindFile(path: string): Promise<MindFileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/file?path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load markdown file');
  }
  return response.json();
}

export async function saveMindFile(path: string, content: string): Promise<MindFileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/file`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, content }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to save markdown file');
  }
  return response.json();
}

export async function deleteMindFile(path: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/mind/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to delete markdown file');
  }
}

export async function listSpeechVoices(): Promise<ElevenLabsVoice[]> {
  const response = await fetch(`${getApiBaseUrl()}/speech/voices`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load speech voices');
  }
  return response.json();
}

export async function synthesizeCompletionAudio(text: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/speech/completion`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to synthesize completion audio');
  }
  return response.blob();
}

export async function fetchSpeechClip(clipID: string): Promise<Blob> {
  const response = await fetch(`${getApiBaseUrl()}/speech/clips/${encodeURIComponent(clipID)}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load generated speech clip');
  }
  return response.blob();
}

// --- Provider API ---

export async function listProviders(): Promise<ProviderConfig[]> {
  const response = await fetch(`${getApiBaseUrl()}/providers`);
  if (!response.ok) {
    throw new Error(`Failed to list providers: ${response.statusText}`);
  }
  return response.json();
}

export async function updateProvider(providerType: LLMProviderType, payload: UpdateProviderRequest): Promise<ProviderConfig[]> {
  const response = await fetch(`${getApiBaseUrl()}/providers/${encodeURIComponent(providerType)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to update provider: ${response.statusText}`);
  }
  return response.json();
}

export async function createFallbackAggregate(payload: CreateFallbackAggregateRequest): Promise<ProviderConfig[]> {
  const response = await fetch(`${getApiBaseUrl()}/providers/fallback-aggregates`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to create fallback aggregate: ${response.statusText}`);
  }
  return response.json();
}

export async function deleteProvider(providerType: LLMProviderType): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/providers/${encodeURIComponent(providerType)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to delete provider');
  }
}

export async function setActiveProvider(providerType: LLMProviderType): Promise<ProviderConfig[]> {
  const response = await fetch(`${getApiBaseUrl()}/providers/active`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider: providerType }),
  });
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || `Failed to set active provider: ${response.statusText}`);
  }
  return response.json();
}

export async function listLMStudioModels(baseURL?: string): Promise<string[]> {
  const url = new URL(`${getApiBaseUrl()}/providers/lmstudio/models`);
  const normalizedBaseURL = normalizeLMStudioBaseUrl(baseURL);
  if (normalizedBaseURL) {
    url.searchParams.set('base_url', normalizedBaseURL);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    // Backward compatibility: if backend doesn't yet expose /providers/lmstudio/models,
    // query LM Studio directly from the browser.
    if (response.status === 404 && normalizedBaseURL) {
      const directResponse = await fetch(`${normalizedBaseURL}/models`);
      if (!directResponse.ok) {
        throw await buildApiError(directResponse, 'Failed to load LM Studio models');
      }
      const directData = await directResponse.json() as { data?: Array<{ id?: string }> };
      return (directData.data || [])
        .map((item) => (item.id || '').trim())
        .filter((id) => id !== '');
    }
    throw await buildApiError(response, 'Failed to load LM Studio models');
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models || [];
}

export async function listKimiModels(baseURL?: string): Promise<string[]> {
  const url = new URL(`${getApiBaseUrl()}/providers/kimi/models`);
  const normalizedBaseURL = normalizeLMStudioBaseUrl(baseURL);
  if (normalizedBaseURL) {
    url.searchParams.set('base_url', normalizedBaseURL);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load Kimi models');
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models || [];
}

export async function listGoogleModels(baseURL?: string): Promise<string[]> {
  const url = new URL(`${getApiBaseUrl()}/providers/google/models`);
  const normalizedBaseURL = normalizeLMStudioBaseUrl(baseURL);
  if (normalizedBaseURL) {
    url.searchParams.set('base_url', normalizedBaseURL);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load Google Gemini models');
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models || [];
}

export async function listOpenAIModels(baseURL?: string): Promise<string[]> {
  const url = new URL(`${getApiBaseUrl()}/providers/openai/models`);
  const normalizedBaseURL = normalizeLMStudioBaseUrl(baseURL);
  if (normalizedBaseURL) {
    url.searchParams.set('base_url', normalizedBaseURL);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load OpenAI models');
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models || [];
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

export async function discoverTelegramChats(botToken: string): Promise<TelegramChatDiscoveryResponse> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/telegram/chat-ids`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ bot_token: botToken }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to discover Telegram chat IDs');
  }
  return response.json();
}

// --- MCP Servers API ---

export async function listMCPServers(): Promise<MCPServer[]> {
  const response = await fetch(`${getApiBaseUrl()}/mcp/servers`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list MCP servers');
  }
  return response.json();
}

export async function createMCPServer(payload: MCPServerRequest): Promise<MCPServer> {
  const response = await fetch(`${getApiBaseUrl()}/mcp/servers`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create MCP server');
  }
  return response.json();
}

export async function updateMCPServer(serverId: string, payload: MCPServerRequest): Promise<MCPServer> {
  const response = await fetch(`${getApiBaseUrl()}/mcp/servers/${serverId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to update MCP server');
  }
  return response.json();
}

export async function deleteMCPServer(serverId: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/mcp/servers/${serverId}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to delete MCP server');
  }
}

export async function testMCPServer(serverId: string): Promise<MCPServerTestResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mcp/servers/${serverId}/test`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to test MCP server');
  }
  return response.json();
}
