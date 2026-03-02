// API client for aagent HTTP server

const API_BASE_URL_STORAGE_KEY = 'a2gent.api_base_url';
const API_BASE_URL_HISTORY_KEY = 'a2gent.api_base_url_history';
const API_BASE_URL_AGENT_NAME_MAP_KEY = 'a2gent.api_base_url_agent_names';
const DEFAULT_API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8080';
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

export function buildImageAssetUrl(path: string): string {
  const normalized = path.trim();
  if (normalized === '') {
    return '';
  }
  return `${getApiBaseUrl()}/assets/images?path=${encodeURIComponent(normalized)}`;
}

export function buildSpeechClipUrl(clipID: string): string {
  const normalized = clipID.trim();
  if (normalized === '') {
    return '';
  }
  return `${getApiBaseUrl()}/speech/clips/${encodeURIComponent(normalized)}`;
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

export function getApiBaseUrlHistory(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(API_BASE_URL_HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string' && v.trim() !== '');
  } catch {
    return [];
  }
}

export function addApiBaseUrlToHistory(url: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeApiBaseUrl(url);
  if (normalized === '') return;
  const history = getApiBaseUrlHistory();
  const filtered = history.filter((u) => u !== normalized);
  filtered.unshift(normalized);
  window.localStorage.setItem(API_BASE_URL_HISTORY_KEY, JSON.stringify(filtered));
}

export function removeApiBaseUrlFromHistory(url: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeApiBaseUrl(url);
  const history = getApiBaseUrlHistory();
  const filtered = history.filter((u) => u !== normalized);
  window.localStorage.setItem(API_BASE_URL_HISTORY_KEY, JSON.stringify(filtered));
}

function getApiBaseUrlAgentNameMap(): Record<string, string> {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(API_BASE_URL_AGENT_NAME_MAP_KEY);
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const result: Record<string, string> = {};
    for (const [rawUrl, rawName] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof rawUrl !== 'string' || typeof rawName !== 'string') {
        continue;
      }
      const url = normalizeApiBaseUrl(rawUrl);
      const name = rawName.trim();
      if (url !== '' && name !== '') {
        result[url] = name;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function setApiBaseUrlAgentName(url: string, name: string): void {
  if (typeof window === 'undefined') {
    return;
  }

  const normalizedUrl = normalizeApiBaseUrl(url);
  const normalizedName = name.trim();
  if (normalizedUrl === '' || normalizedName === '') {
    return;
  }

  const map = getApiBaseUrlAgentNameMap();
  map[normalizedUrl] = normalizedName;
  window.localStorage.setItem(API_BASE_URL_AGENT_NAME_MAP_KEY, JSON.stringify(map));
}

export function getStoredAgentNameForApiBaseUrl(url: string): string {
  const normalized = normalizeApiBaseUrl(url);
  if (normalized === '') {
    return '';
  }
  const map = getApiBaseUrlAgentNameMap();
  return (map[normalized] || '').trim();
}

export interface StoredAgentEndpoint {
  url: string;
  name: string;
}

export function getStoredAgentEndpoints(): StoredAgentEndpoint[] {
  const current = getApiBaseUrl();
  const history = getApiBaseUrlHistory();
  const urls = [current, ...history].filter((value, index, arr) => value !== '' && arr.indexOf(value) === index);

  return urls.map((url) => {
    const name = getStoredAgentNameForApiBaseUrl(url);
    return {
      url,
      name: name || url,
    };
  });
}

// Types matching the Go server responses
export interface Session {
  id: string;
  agent_id: string;
  parent_id?: string;
  link_type?: 'review' | 'continuation';
  project_id?: string;
  provider?: string;
  model?: string;
  routed_provider?: string;
  routed_model?: string;
  title: string;
  status: string;
  total_tokens?: number;
  input_tokens?: number;
  output_tokens?: number;
  current_context_tokens?: number;
  model_context_window?: number;
  run_duration_seconds?: number;
  task_progress?: string;
  provider_failures?: ProviderFailure[];
  created_at: string;
  updated_at: string;
  messages?: Message[];
  system_prompt_snapshot?: SystemPromptSnapshot;
  // A2A inbound — only present on sessions created from tunnel requests
  a2a_inbound?: boolean;
  a2a_source_agent_id?: string;
  a2a_source_agent_name?: string;
  a2a_outbound?: boolean;
  a2a_target_agent_id?: string;
  a2a_target_agent_name?: string;
}

export interface ProviderFailure {
  timestamp: string;
  provider?: string;
  model?: string;
  attempt?: number;
  max_attempts?: number;
  node_index?: number;
  total_nodes?: number;
  phase?: string;
  reason?: string;
  fallback_to?: string;
  fallback_model?: string;
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
  images?: MessageImage[];
  tool_calls?: ToolCall[];
  tool_results?: ToolResult[];
  metadata?: Record<string, unknown>;
  timestamp: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface MessageImage {
  name?: string;
  media_type?: string;
  data_base64?: string;
  url?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  thought_signature?: string;
  input_tokens?: number;
  output_tokens?: number;
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
  is_error: boolean;
  metadata?: Record<string, unknown>;
}

export interface QuestionOption {
  label: string;
  description: string;
}

export interface PendingQuestion {
  question: string;
  header: string;
  options: QuestionOption[];
  multiple: boolean;
  custom: boolean;
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

export interface StreamToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
  thought_signature?: string;
}

export interface StreamToolResult {
  tool_call_id: string;
  name: string;
  content: string;
  is_error: boolean;
}

export type ChatStreamEvent =
  | { type: 'status'; status: string }
  | { type: 'assistant_delta'; delta: string }
  | { type: 'tool_executing'; step: number; tool_calls: StreamToolCall[] }
  | { type: 'tool_completed'; step: number; messages: Message[]; status: string }
  | { type: 'step_completed'; step: number }
  | {
      type: 'provider_trace';
      step: number;
      provider: {
        provider?: string;
        model?: string;
        attempt?: number;
        max_attempts?: number;
        node_index?: number;
        total_nodes?: number;
        phase?: string;
        reason?: string;
        fallback_to?: string;
        fallback_model?: string;
        recovered?: boolean;
      };
    }
  | { type: 'done'; content: string; messages: Message[]; status: string; usage?: { input_tokens: number; output_tokens: number } }
  | { type: 'error'; error: string; status?: string };

export interface CreateSessionRequest {
  agent_id?: string;
  task?: string;
  images?: MessageImage[];
  parent_id?: string;
  link_type?: 'review' | 'continuation';
  provider?: string;
  model?: string;
  project_id?: string;
  sub_agent_id?: string;
  queued?: boolean;
}

export interface CreateSessionResponse {
  id: string;
  agent_id: string;
  parent_id?: string;
  link_type?: 'review' | 'continuation';
  project_id?: string;
  provider?: string;
  model?: string;
  status: string;
  created_at: string;
}

export interface Project {
  id: string;
  name: string;
  folder?: string;
  is_system: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateProjectRequest {
  name: string;
  folder?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  folder?: string;
}

export interface SettingsResponse {
  settings: Record<string, string>;
  defaultSystemPrompt?: string;
  defaultSystemPromptWithoutBuiltInTools?: string;
}

export interface SettingsPayload {
  settings: Record<string, string>;
  defaultSystemPrompt?: string;
  defaultSystemPromptWithoutBuiltInTools?: string;
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
  description?: string;
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
  enabled?: boolean;
}

export interface BuiltInSkillsResponse {
  skills: BuiltInSkill[];
}

export interface RegistrySkill {
  id: string;
  name: string;
  description: string;
  author: string;
  version: string;
  downloads: number;
  rating: number;
  tags: string[] | null;
  metadata: Record<string, string> | null;
  download_url: string;
}

export interface SkillSearchResponse {
  skills: RegistrySkill[];
  total: number;
  page: number;
  limit: number;
}

export interface SkillInstallRequest {
  skill_id: string;
}

export interface SkillInstallResponse {
  success: boolean;
  message: string;
  name: string;
  path: string;
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

export interface PiperVoiceOption {
  id: string;
  installed: boolean;
  model_path?: string;
}

export interface SpeechTranscriptionResponse {
  text: string;
}

export interface CameraDeviceInfo {
  index: number;
  name: string;
  id?: string;
}

export interface CameraDevicesResponse {
  cameras: CameraDeviceInfo[];
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
  proxy_managed?: boolean;
  proxy_base_url?: string;
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
  | 'brave_search'
  | 'exa'
  | 'a2_registry';
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

export async function listA2AInboundSessions(): Promise<Session[]> {
  const response = await fetch(`${getApiBaseUrl()}/sessions?a2a_inbound=true`);
  if (!response.ok) {
    throw new Error(`Failed to list A2A inbound sessions: ${response.statusText}`);
  }
  return response.json();
}

// ---- A2A tunnel status ----

export type TunnelState = 'disconnected' | 'connecting' | 'connected';

export interface TunnelLogEntry {
  time: string;
  message: string;
}

export interface TunnelStatus {
  state: TunnelState;
  connected_at?: string;
  square_addr: string;
  log: TunnelLogEntry[];
}

export interface CreateA2AOutboundSessionRequest {
  target_agent_id: string;
  target_agent_name?: string;
  project_id?: string;
}

export async function createA2AOutboundSession(request: CreateA2AOutboundSessionRequest): Promise<Session> {
  const response = await fetch(`${getApiBaseUrl()}/a2a/outbound/sessions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create outbound A2A session');
  }
  return response.json();
}

export async function sendA2AOutboundMessage(
  sessionId: string,
  message: string,
  images: MessageImage[] = [],
): Promise<ChatResponse> {
  const response = await fetch(`${getApiBaseUrl()}/a2a/outbound/sessions/${encodeURIComponent(sessionId)}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, images }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to send A2A message');
  }
  return response.json();
}

type A2AOutboundStreamStatusEvent = {
  event: 'status';
  data: {
    state: string;
    error?: string;
    http_status?: number;
  };
};

type A2AOutboundStreamResponseEvent = {
  event: 'response';
  data: ChatResponse;
};

export type A2AOutboundStreamEvent = A2AOutboundStreamStatusEvent | A2AOutboundStreamResponseEvent;

export async function* sendA2AOutboundMessageStream(
  sessionId: string,
  message: string,
  images: MessageImage[] = [],
  signal?: AbortSignal,
): AsyncGenerator<A2AOutboundStreamEvent, void, unknown> {
  const response = await fetch(`${getApiBaseUrl()}/a2a/outbound/sessions/${encodeURIComponent(sessionId)}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({ message, images }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to stream A2A message');
  }
  if (!response.body) {
    throw new Error('Streaming response body is unavailable');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const flushSSEChunk = (chunk: string): A2AOutboundStreamEvent | null => {
    const lines = chunk.split('\n');
    let eventName = '';
    let data = '';
    for (const lineRaw of lines) {
      const line = lineRaw.trim();
      if (!line || line.startsWith(':')) {
        continue;
      }
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim();
      } else if (line.startsWith('data:')) {
        if (data !== '') {
          data += '\n';
        }
        data += line.slice('data:'.length).trim();
      }
    }
    if (eventName === '' || data === '') {
      return null;
    }
    try {
      const parsed = JSON.parse(data) as unknown;
      if (eventName === 'status') {
        return { event: 'status', data: parsed as A2AOutboundStreamStatusEvent['data'] };
      }
      if (eventName === 'response') {
        return { event: 'response', data: parsed as ChatResponse };
      }
      return null;
    } catch {
      return null;
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const chunks = buffer.split('\n\n');
    buffer = chunks.pop() || '';
    for (const chunk of chunks) {
      const event = flushSSEChunk(chunk);
      if (event) {
        yield event;
      }
    }
  }

  const tail = buffer.trim();
  if (tail) {
    const event = flushSSEChunk(tail);
    if (event) {
      yield event;
    }
  }
}

export async function getA2ATunnelStatus(): Promise<TunnelStatus> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/tunnel-status`);
  if (!response.ok) {
    throw new Error(`Failed to get tunnel status: ${response.statusText}`);
  }
  return response.json();
}

/** Returns the SSE URL for live tunnel log streaming. */
export function getA2ATunnelStatusStreamUrl(): string {
  return `${getApiBaseUrl()}/integrations/a2_registry/tunnel-status/stream`;
}

// ---- Local Dockerized A2 agents ----

export interface LocalDockerAgent {
  id: string;
  name: string;
  image: string;
  state: string;
  status: string;
  created_at?: string;
  ports?: string;
  labels?: Record<string, string>;
  managed: boolean;
  running: boolean;
  host_port?: number;
  api_url?: string;
}

export interface LocalDockerAgentsResponse {
  agents: LocalDockerAgent[];
}

export interface CreateLocalDockerAgentRequest {
  name?: string;
  image?: string;
  host_port?: number;
  lm_studio_base_url?: string;
}

export interface BuildLocalDockerAgentImageRequest {
  image?: string;
  no_cache?: boolean;
}

export interface BuildLocalDockerAgentImageResponse {
  status: string;
  image: string;
  dockerfile: string;
  context_dir: string;
  output: string;
}

export interface RegisterLocalDockerAgentRequest {
  registry_url?: string;
  owner_email: string;
  agent_name?: string;
  description?: string;
  configure_container?: boolean;
  square_grpc_addr?: string;
}

export interface RegisterLocalDockerAgentResponse {
  registry_agent_id: string;
  registry_agent_name: string;
  registry_api_key: string;
  registry_url: string;
  container_name: string;
  container_id: string;
  container_host_port: number;
  container_api_url: string;
  container_configured: boolean;
  container_integration_id?: string;
  container_tunnel_state?: string;
  container_tunnel_note?: string;
}

export async function listLocalDockerAgents(): Promise<LocalDockerAgentsResponse> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list local Docker agents');
  }
  return response.json();
}

export async function createLocalDockerAgent(payload: CreateLocalDockerAgentRequest): Promise<LocalDockerAgent> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create local Docker agent');
  }
  return response.json();
}

export async function buildLocalDockerAgentImage(
  payload: BuildLocalDockerAgentImageRequest,
): Promise<BuildLocalDockerAgentImageResponse> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents/build-image`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to build local Docker agent image');
  }
  return response.json();
}

export async function startLocalDockerAgent(containerID: string): Promise<LocalDockerAgent> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents/${encodeURIComponent(containerID)}/start`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to start local Docker agent');
  }
  return response.json();
}

export async function stopLocalDockerAgent(containerID: string): Promise<LocalDockerAgent> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents/${encodeURIComponent(containerID)}/stop`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to stop local Docker agent');
  }
  return response.json();
}

export async function removeLocalDockerAgent(containerID: string, force = false): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents/${encodeURIComponent(containerID)}`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ force }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to remove local Docker agent');
  }
}

export async function getLocalDockerAgentLogs(containerID: string, tail = 200): Promise<{ container: string; tail: number; logs: string }> {
  const params = new URLSearchParams({ tail: String(tail) });
  const response = await fetch(
    `${getApiBaseUrl()}/integrations/a2_registry/local-agents/${encodeURIComponent(containerID)}/logs?${params.toString()}`,
  );
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to read local Docker agent logs');
  }
  return response.json();
}

export async function registerLocalDockerAgent(
  containerID: string,
  payload: RegisterLocalDockerAgentRequest,
): Promise<RegisterLocalDockerAgentResponse> {
  const response = await fetch(`${getApiBaseUrl()}/integrations/a2_registry/local-agents/${encodeURIComponent(containerID)}/register`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to register local Docker agent in A2 registry');
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

export interface TaskProgressResponse {
  content: string;
  total_tasks: number;
  completed_tasks: number;
  progress_pct: number;
}

export async function getSessionTaskProgress(sessionId: string): Promise<TaskProgressResponse> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/task-progress`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to get task progress');
  }
  return response.json();
}

export interface TaskProgressStats {
  total: number;
  completed: number;
  progressPct: number;
}

export function parseTaskProgress(content?: string): TaskProgressStats {
  if (!content) {
    return { total: 0, completed: 0, progressPct: 0 };
  }

  // Normalize line endings
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let total = 0;
  let completed = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    // Handle "- [ ] Task" format (remove "- " prefix first)
    let checkLine = trimmed;
    if (checkLine.startsWith('- ')) {
      checkLine = checkLine.slice(2);
    }
    if (checkLine.startsWith('[ ]')) {
      total++;
    } else if (checkLine.startsWith('[x]') || checkLine.startsWith('[X]')) {
      total++;
      completed++;
    }
  }

  const progressPct = total > 0 ? Math.round((completed * 100) / total) : 0;

  return { total, completed, progressPct };
}

export interface TaskItem {
  id: string;
  text: string;
  completed: boolean;
  level: number;
  children: TaskItem[];
}

export interface TaskProgressDetails {
  tasks: TaskItem[];
  total: number;
  completed: number;
  progressPct: number;
}

export function parseTaskProgressDetails(content?: string): TaskProgressDetails {
  if (!content) {
    return { tasks: [], total: 0, completed: 0, progressPct: 0 };
  }

  // Normalize line endings and split
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  const rootTasks: TaskItem[] = [];
  const stack: TaskItem[] = [];
  let total = 0;
  let completed = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Match "- [ ] Task" or "- [x] Task" format with optional indentation
    // Format: optional spaces, dash, space, bracket, space/x, bracket, space, text
    const match = line.match(/^(\s*)-\s*\[([ xX])\]\s*(.*)$/);
    if (!match) continue;

    const indent = match[1].length;
    const isCompleted = match[2].toLowerCase() === 'x';
    const text = match[3].trim();
    if (!text) continue; // Skip empty tasks

    // 2 spaces = 1 level
    const level = Math.floor(indent / 2);

    total++;
    if (isCompleted) completed++;

    const task: TaskItem = {
      id: `task-${i}`,
      text,
      completed: isCompleted,
      level,
      children: [],
    };

    // Find parent based on indentation level
    while (stack.length > 0 && stack[stack.length - 1].level >= level) {
      stack.pop();
    }

    if (stack.length === 0) {
      rootTasks.push(task);
    } else {
      stack[stack.length - 1].children.push(task);
    }

    stack.push(task);
  }

  const progressPct = total > 0 ? Math.round((completed * 100) / total) : 0;

  return { tasks: rootTasks, total, completed, progressPct };
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

export async function startSession(sessionId: string): Promise<Session> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/start`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to start session');
  }
  return response.json();
}

export async function sendMessage(sessionId: string, message: string, images: MessageImage[] = []): Promise<ChatResponse> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, images }),
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

export async function updateSessionProvider(sessionId: string, provider: string, model?: string): Promise<Session> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/provider`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ provider, model: model ?? null }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to update session provider');
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
  images: MessageImage[] = [],
  signal?: AbortSignal,
): AsyncGenerator<ChatStreamEvent, void, unknown> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/chat/stream`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    signal,
    body: JSON.stringify({ message, images }),
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

export async function getPendingQuestion(sessionId: string): Promise<PendingQuestion | null> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/question`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to get pending question');
  }
  const data = await response.json() as { question?: PendingQuestion };
  return data.question || null;
}

export async function answerQuestion(sessionId: string, answer: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/sessions/${sessionId}/answer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ answer }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to answer question');
  }
}

const AGENT_NAME_SETTING_KEY = 'AAGENT_NAME';
const DEFAULT_APP_TITLE_FALLBACK = '🤖 A2';

export async function healthCheck(): Promise<boolean> {
  try {
    const response = await fetch(`${getApiBaseUrl()}/health`);
    return response.ok;
  } catch {
    return false;
  }
}

export async function fetchAgentName(): Promise<string> {
  const activeBaseUrl = getApiBaseUrl();
  const cached = getStoredAgentNameForApiBaseUrl(activeBaseUrl);
  try {
    const response = await fetch(`${activeBaseUrl}/health`);
    if (!response.ok) {
      return cached || DEFAULT_APP_TITLE_FALLBACK;
    }
    const data = await response.json() as { agent_name?: string };
    const name = data.agent_name?.trim() || '';
    if (name !== '') {
      setApiBaseUrlAgentName(activeBaseUrl, name);
      return name;
    }
    return cached || DEFAULT_APP_TITLE_FALLBACK;
  } catch {
    return cached || DEFAULT_APP_TITLE_FALLBACK;
  }
}

export async function saveAgentName(name: string): Promise<void> {
  const trimmed = name.trim();
  const settings = await getSettings();
  const updated = { ...settings, [AGENT_NAME_SETTING_KEY]: trimmed };
  await updateSettings(updated);
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
  const data = await getSettingsPayload();
  return data.settings || {};
}

export async function getSettingsPayload(): Promise<SettingsPayload> {
  const response = await fetch(`${getApiBaseUrl()}/settings`);
  if (!response.ok) {
    throw new Error(`Failed to get settings: ${response.statusText}`);
  }
  const data: SettingsResponse = await response.json();
  return {
    settings: data.settings || {},
    defaultSystemPrompt: data.defaultSystemPrompt,
    defaultSystemPromptWithoutBuiltInTools: data.defaultSystemPromptWithoutBuiltInTools,
  };
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

// --- Browser Chrome API ---

export interface BrowserChromeProfileStatus {
  exists: boolean;
  path: string;
  lastUsed?: string;
}

export async function getBrowserChromeProfileStatus(): Promise<BrowserChromeProfileStatus> {
  const response = await fetch(`${getApiBaseUrl()}/browser-chrome/profile-status`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to get browser chrome profile status');
  }
  return response.json();
}

export interface BrowserChromeCreateProfileResponse {
  success: boolean;
  message: string;
  path: string;
  filesCopied: number;
  failedFiles: string[];
}

export async function createBrowserChromeProfile(): Promise<BrowserChromeCreateProfileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/browser-chrome/create-profile`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create browser chrome profile');
  }
  return response.json();
}

export interface BrowserChromeLaunchResponse {
  success: boolean;
  message: string;
  pid: number;
  profile: string;
}

export async function launchBrowserChrome(): Promise<BrowserChromeLaunchResponse> {
  const response = await fetch(`${getApiBaseUrl()}/browser-chrome/launch`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to launch browser chrome');
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

export async function searchRegistrySkills(
  query: string, 
  page = 1, 
  limit = 20,
  sort?: 'installsCurrent' | 'stars'
): Promise<SkillSearchResponse> {
  const params = new URLSearchParams({
    limit: limit.toString(),
  });
  
  if (query) {
    params.set('q', query);
  }
  
  if (page > 1) {
    params.set('page', page.toString());
  }
  
  if (sort) {
    params.set('sort', sort);
  }
  
  const response = await fetch(`${getApiBaseUrl()}/skills/registry/search?${params}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to search registry skills');
  }
  return response.json();
}

export async function deleteSkill(skillPath: string): Promise<{ success: boolean; message: string }> {
  const response = await fetch(`${getApiBaseUrl()}/skills/delete`, {
    method: 'DELETE',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ skill_path: skillPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to delete skill');
  }
  return response.json();
}

export async function installRegistrySkill(skillId: string): Promise<SkillInstallResponse> {
  const response = await fetch(`${getApiBaseUrl()}/skills/registry/install`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ skill_id: skillId } as SkillInstallRequest),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to install skill');
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

export interface MoveFileResponse {
  root_folder: string;
  from_path: string;
  to_path: string;
}

export async function moveMindFile(fromPath: string, toPath: string): Promise<MoveFileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/file/move`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to move file');
  }
  return response.json();
}

export interface CreateFolderResponse {
  root_folder: string;
  path: string;
}

export async function createMindFolder(path: string): Promise<CreateFolderResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/folder`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create folder');
  }
  return response.json();
}

export interface RenameEntryResponse {
  root_folder: string;
  old_path: string;
  new_path: string;
}

export async function renameMindEntry(oldPath: string, newName: string): Promise<RenameEntryResponse> {
  const response = await fetch(`${getApiBaseUrl()}/mind/rename`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ old_path: oldPath, new_name: newName }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to rename');
  }
  return response.json();
}

export async function listProjectTree(projectID: string, path = ''): Promise<MindTreeResponse> {
  const pathQuery = path.trim() === '' ? '' : `&path=${encodeURIComponent(path)}`;
  const response = await fetch(`${getApiBaseUrl()}/projects/tree?projectID=${encodeURIComponent(projectID)}${pathQuery}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list project tree');
  }
  return response.json();
}

export interface ProjectFileNameMatch {
  path: string;
  name: string;
}

export interface ProjectContentMatch {
  path: string;
  line: number;
  preview: string;
}

export interface ProjectSearchResponse {
  root_folder: string;
  query: string;
  filename_matches: ProjectFileNameMatch[];
  content_matches: ProjectContentMatch[];
}

export async function searchProject(projectID: string, query: string): Promise<ProjectSearchResponse> {
  const response = await fetch(
    `${getApiBaseUrl()}/projects/search?projectID=${encodeURIComponent(projectID)}&query=${encodeURIComponent(query)}`,
  );
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to search project');
  }
  return response.json();
}

export interface ProjectGitChangedFile {
  path: string;
  status: string;
  index_status: string;
  worktree_status: string;
  staged: boolean;
  untracked: boolean;
}

export interface ProjectGitStatusResponse {
  root_folder: string;
  has_git: boolean;
  files: ProjectGitChangedFile[];
}

export interface ProjectGitInitResponse {
  root_folder: string;
  has_git: boolean;
  remote_url?: string;
}

export interface ProjectGitCommitResponse {
  root_folder: string;
  commit: string;
  files_committed: number;
}

export interface ProjectGitFileDiffResponse {
  path: string;
  preview: string;
}

export async function getProjectGitStatus(projectID: string, repoPath = ''): Promise<ProjectGitStatusResponse> {
  const repoQuery = repoPath.trim() === '' ? '' : `&repoPath=${encodeURIComponent(repoPath)}`;
  const response = await fetch(`${getApiBaseUrl()}/projects/git/status?projectID=${encodeURIComponent(projectID)}${repoQuery}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load git status');
  }
  return response.json();
}

export async function initializeProjectGit(projectID: string, remoteUrl = '', repoPath = ''): Promise<ProjectGitInitResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/init?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ remote_url: remoteUrl, repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to initialize Git repository');
  }
  return response.json();
}

export async function commitProjectGit(projectID: string, message: string, repoPath = ''): Promise<ProjectGitCommitResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/commit?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ message, repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to commit changes');
  }
  return response.json();
}

export async function stageProjectGitFile(projectID: string, path: string, repoPath = ''): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/stage?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to stage file');
  }
}

export async function stageAllProjectGitFiles(projectID: string, repoPath = ''): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/stage-all?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to stage all files');
  }
}

export async function unstageProjectGitFile(projectID: string, path: string, repoPath = ''): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/unstage?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to unstage file');
  }
}

export async function discardProjectGitFile(projectID: string, path: string, repoPath = ''): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/discard?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to discard file changes');
  }
}

export async function getProjectGitFileDiff(projectID: string, path: string, repoPath = ''): Promise<ProjectGitFileDiffResponse> {
  const repoQuery = repoPath.trim() === '' ? '' : `&repoPath=${encodeURIComponent(repoPath)}`;
  const response = await fetch(
    `${getApiBaseUrl()}/projects/git/diff?projectID=${encodeURIComponent(projectID)}&path=${encodeURIComponent(path)}${repoQuery}`,
  );
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load file diff');
  }
  return response.json();
}

export async function generateProjectGitCommitMessage(projectID: string, repoPath = ''): Promise<string | null> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/commit-message?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repo_path: repoPath }),
  });

  if (response.status === 204) {
    return null;
  }
  if (!response.ok) {
    return null;
  }

  const data = await response.json() as { message?: string };
  const message = typeof data.message === 'string' ? data.message.trim() : '';
  return message !== '' ? message : null;
}

export async function pushProjectGit(projectID: string, repoPath = ''): Promise<string> {
  const response = await fetch(`${getApiBaseUrl()}/projects/git/push?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ repo_path: repoPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to push');
  }
  const data = await response.json() as { output?: string };
  return (data.output || '').trim();
}

export async function getProjectFile(projectID: string, path: string): Promise<MindFileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/file?projectID=${encodeURIComponent(projectID)}&path=${encodeURIComponent(path)}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load project file');
  }
  return response.json();
}

export async function saveProjectFile(projectID: string, path: string, content: string): Promise<MindFileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/file?projectID=${encodeURIComponent(projectID)}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path, content }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to save project file');
  }
  return response.json();
}

export async function deleteProjectFile(projectID: string, path: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/projects/file?projectID=${encodeURIComponent(projectID)}&path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to delete project file');
  }
}

export async function moveProjectFile(projectID: string, fromPath: string, toPath: string): Promise<MoveFileResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/file/move?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from_path: fromPath, to_path: toPath }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to move project file');
  }
  return response.json();
}

export async function createProjectFolder(projectID: string, path: string): Promise<CreateFolderResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/folder?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ path }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create folder');
  }
  return response.json();
}

export async function renameProjectEntry(projectID: string, oldPath: string, newName: string): Promise<RenameEntryResponse> {
  const response = await fetch(`${getApiBaseUrl()}/projects/rename?projectID=${encodeURIComponent(projectID)}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ old_path: oldPath, new_name: newName }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to rename');
  }
  return response.json();
}

export async function listSpeechVoices(): Promise<ElevenLabsVoice[]> {
  const response = await fetch(`${getApiBaseUrl()}/speech/voices`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load speech voices');
  }
  return response.json();
}

export async function listPiperVoices(): Promise<PiperVoiceOption[]> {
  const response = await fetch(`${getApiBaseUrl()}/speech/piper/voices`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load Piper voices');
  }
  return response.json();
}

export async function listCameraDevices(): Promise<CameraDeviceInfo[]> {
  const response = await fetch(`${getApiBaseUrl()}/devices/cameras`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load camera devices');
  }
  const data: CameraDevicesResponse = await response.json();
  return data.cameras || [];
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

export async function transcribeSpeech(audio: Blob, language?: string): Promise<SpeechTranscriptionResponse> {
  const formData = new FormData();
  formData.append('audio', audio, 'recording.wav');
  if ((language || '').trim() !== '') {
    formData.append('language', (language || '').trim());
  }

  const response = await fetch(`${getApiBaseUrl()}/speech/transcribe`, {
    method: 'POST',
    body: formData,
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to transcribe speech');
  }
  return response.json();
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

// Anthropic OAuth
export interface AnthropicOAuthStartResponse {
  auth_url: string;
  verifier: string;
}

export interface AnthropicOAuthStatusResponse {
  enabled: boolean;
  expires_at?: number;
}

export async function startAnthropicOAuth(): Promise<AnthropicOAuthStartResponse> {
  const response = await fetch(`${getApiBaseUrl()}/providers/anthropic/oauth/start`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to start OAuth');
  }
  return response.json();
}

export async function completeAnthropicOAuth(code: string, verifier: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/providers/anthropic/oauth/callback`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code, verifier }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to complete OAuth');
  }
}

export async function getAnthropicOAuthStatus(): Promise<AnthropicOAuthStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/providers/anthropic/oauth/status`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to get OAuth status');
  }
  return response.json();
}

export async function disconnectAnthropicOAuth(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/providers/anthropic/oauth`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to disconnect OAuth');
  }
}

export interface OpenAICodexOAuthImportResponse {
  success: boolean;
  imported: boolean;
  path: string;
  expires_at?: number;
}

export async function importOpenAICodexOAuth(path?: string): Promise<OpenAICodexOAuthImportResponse> {
  const response = await fetch(`${getApiBaseUrl()}/providers/openai_codex/oauth/import`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(path && path.trim() !== '' ? { path: path.trim() } : {}),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to import OpenAI Codex OAuth');
  }
  return response.json();
}

export async function getOpenAICodexOAuthStatus(): Promise<AnthropicOAuthStatusResponse> {
  const response = await fetch(`${getApiBaseUrl()}/providers/openai_codex/oauth/status`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to get OpenAI Codex OAuth status');
  }
  return response.json();
}

export async function disconnectOpenAICodexOAuth(): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/providers/openai_codex/oauth`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to disconnect OpenAI Codex OAuth');
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

export async function listOpenAICodexModels(baseURL?: string): Promise<string[]> {
  const url = new URL(`${getApiBaseUrl()}/providers/openai_codex/models`);
  const normalizedBaseURL = normalizeLMStudioBaseUrl(baseURL);
  if (normalizedBaseURL) {
    url.searchParams.set('base_url', normalizedBaseURL);
  }

  const response = await fetch(url.toString());
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to load OpenAI Codex models');
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models || [];
}

export async function listOpenRouterModels(baseURL?: string): Promise<string[]> {
  const params = new URLSearchParams();
  if (baseURL) {
    params.set('base_url', baseURL);
  }
  const queryString = params.toString();
  const url = `${getApiBaseUrl()}/providers/openrouter/models${queryString ? `?${queryString}` : ''}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to list OpenRouter models: ${response.statusText}`);
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models;
}

export async function listAnthropicModels(): Promise<string[]> {
  const response = await fetch(`${getApiBaseUrl()}/providers/anthropic/models`);
  if (!response.ok) {
    throw new Error(`Failed to list Anthropic models: ${response.statusText}`);
  }
  const data: ProviderModelsResponse = await response.json();
  return data.models;
}

export async function listProviderModels(providerType: LLMProviderType): Promise<string[]> {
  const normalized = providerType.toLowerCase().trim();
  switch (normalized) {
    case 'lmstudio':
      return listLMStudioModels();
    case 'kimi':
      return listKimiModels();
    case 'google':
      return listGoogleModels();
    case 'openai':
      return listOpenAIModels();
    case 'openai_codex':
      return listOpenAICodexModels();
    case 'openrouter':
      return listOpenRouterModels();
    case 'anthropic':
      return listAnthropicModels();
    default:
      throw new Error(`Unsupported provider: ${providerType}`);
  }
}

export interface ProviderTestResponse {
  success: boolean;
  message: string;
}

export async function testProvider(providerType: LLMProviderType): Promise<ProviderTestResponse> {
  const response = await fetch(`${getApiBaseUrl()}/providers/${encodeURIComponent(providerType)}/test`, {
    method: 'POST',
  });
  const data: ProviderTestResponse = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || `Failed to test provider: ${response.statusText}`);
  }
  return data;
}

export interface ProviderTestResult {
  provider: string;
  success: boolean;
  message: string;
  duration_ms: number;
}

export interface TestAllProvidersResponse {
  results: ProviderTestResult[];
}

export async function testAllProviders(): Promise<TestAllProvidersResponse> {
  const response = await fetch(`${getApiBaseUrl()}/providers/test-all`, {
    method: 'POST',
  });
  if (!response.ok) {
    throw new Error(`Failed to test providers: ${response.statusText}`);
  }
  return response.json();
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

// --- Sub-Agents ---

export interface SubAgent {
  id: string;
  name: string;
  provider: string;
  model: string;
  enabled_tools: string[];
  instruction_blocks: string;
  created_at: string;
  updated_at: string;
}

export interface SubAgentRequest {
  name: string;
  provider: string;
  model?: string;
  enabled_tools?: string[];
  instruction_blocks?: string;
}

export interface ToolDefinitionInfo {
  name: string;
  description: string;
}

export async function listSubAgents(): Promise<SubAgent[]> {
  const response = await fetch(`${getApiBaseUrl()}/sub-agents/`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list sub-agents');
  }
  return response.json();
}

export async function getSubAgent(id: string): Promise<SubAgent> {
  const response = await fetch(`${getApiBaseUrl()}/sub-agents/${id}`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to get sub-agent');
  }
  return response.json();
}

export async function createSubAgent(request: SubAgentRequest): Promise<SubAgent> {
  const response = await fetch(`${getApiBaseUrl()}/sub-agents/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to create sub-agent');
  }
  return response.json();
}

export async function updateSubAgent(id: string, request: SubAgentRequest): Promise<SubAgent> {
  const response = await fetch(`${getApiBaseUrl()}/sub-agents/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to update sub-agent');
  }
  return response.json();
}

export async function deleteSubAgent(id: string): Promise<void> {
  const response = await fetch(`${getApiBaseUrl()}/sub-agents/${id}`, {
    method: 'DELETE',
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to delete sub-agent');
  }
}

export async function estimateSubAgentInstructionPrompt(
  subAgentId: string | null,
  instructionBlocks: string,
  name: string,
  enabledTools: string[],
): Promise<InstructionEstimateResponse> {
  const url = subAgentId
    ? `${getApiBaseUrl()}/sub-agents/${subAgentId}/instruction-estimate`
    : `${getApiBaseUrl()}/sub-agents/instruction-estimate`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      instruction_blocks: instructionBlocks,
      name,
      enabled_tools: enabledTools,
    }),
  });
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to estimate sub-agent instructions');
  }
  return response.json();
}

export async function listToolDefinitions(): Promise<ToolDefinitionInfo[]> {
  const response = await fetch(`${getApiBaseUrl()}/tools/definitions`);
  if (!response.ok) {
    throw await buildApiError(response, 'Failed to list tool definitions');
  }
  return response.json();
}
