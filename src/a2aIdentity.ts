const A2A_LOCAL_AGENT_ID_KEY = 'a2gent.a2a_local_agent_id';
const A2A_REGISTRY_URL_KEY = 'a2gent.a2a_registry_url';
const A2A_REGISTRY_OWNER_EMAIL_KEY = 'a2gent.a2a_registry_owner_email';
const DEFAULT_REGISTRY_URL = 'http://localhost:5174';

export interface RegistrySelfAgent {
  id: string;
  name: string;
  status: string;
  visibility: string;
  agent_type: string;
  discoverable: boolean;
  created_at: string;
  updated_at: string;
}

export function getStoredA2ARegistryURL(): string {
  const stored = localStorage.getItem(A2A_REGISTRY_URL_KEY);
  return stored && stored.trim() !== '' ? stored.trim() : DEFAULT_REGISTRY_URL;
}

export function storeA2ARegistryURL(url: string): void {
  const normalized = url.trim().replace(/\/$/, '');
  if (!normalized) {
    localStorage.removeItem(A2A_REGISTRY_URL_KEY);
    return;
  }
  localStorage.setItem(A2A_REGISTRY_URL_KEY, normalized);
}

export async function fetchRegistrySelfAgent(registryUrl: string, apiKey: string): Promise<RegistrySelfAgent> {
  const normalizedURL = registryUrl.trim().replace(/\/$/, '');
  const normalizedKey = apiKey.trim();
  if (!normalizedURL) {
    throw new Error('Registry URL is not set');
  }
  if (!normalizedKey) {
    throw new Error('API key is not set');
  }

  const response = await fetch(`${normalizedURL}/agents/me`, {
    headers: {
      Authorization: `Bearer ${normalizedKey}`,
    },
    signal: AbortSignal.timeout(6000),
  });
  if (!response.ok) {
    let detail = `${response.status} ${response.statusText}`;
    try {
      const body = await response.json() as { error?: string };
      if (body.error?.trim()) {
        detail = body.error.trim();
      }
    } catch {
      // best-effort error extraction
    }
    throw new Error(detail);
  }
  return response.json() as Promise<RegistrySelfAgent>;
}

export function getStoredLocalA2AAgentID(): string {
  return localStorage.getItem(A2A_LOCAL_AGENT_ID_KEY)?.trim() || '';
}

export function storeLocalA2AAgentID(agentID: string): void {
  const normalized = agentID.trim();
  if (!normalized) {
    localStorage.removeItem(A2A_LOCAL_AGENT_ID_KEY);
    return;
  }
  localStorage.setItem(A2A_LOCAL_AGENT_ID_KEY, normalized);
}

export function clearStoredLocalA2AAgentID(): void {
  localStorage.removeItem(A2A_LOCAL_AGENT_ID_KEY);
}

export function getStoredA2ARegistryOwnerEmail(): string {
  return localStorage.getItem(A2A_REGISTRY_OWNER_EMAIL_KEY)?.trim() || '';
}

export function storeA2ARegistryOwnerEmail(email: string): void {
  const normalized = email.trim();
  if (!normalized) {
    localStorage.removeItem(A2A_REGISTRY_OWNER_EMAIL_KEY);
    return;
  }
  localStorage.setItem(A2A_REGISTRY_OWNER_EMAIL_KEY, normalized);
}
