import { getSettings, updateSettings } from './api';

const A2A_LOCAL_AGENT_ID_KEY = 'a2gent.a2a_local_agent_id';
const A2A_REGISTRY_URL_KEY = 'a2gent.a2a_registry_url';
const A2A_REGISTRY_OWNER_EMAIL_KEY = 'a2gent.a2a_registry_owner_email';
const A2A_FAVORITE_AGENTS_KEY = 'a2gent.a2a_favorite_agents';
const DEFAULT_REGISTRY_URL = 'http://localhost:5174';
const A2A_REGISTRY_URL_SETTING_KEY = 'A2A_REGISTRY_URL';
const A2A_FAVORITE_AGENTS_SETTING_KEY = 'A2A_FAVORITE_AGENTS_JSON';

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

export interface FavoriteA2AAgent {
  id: string;
  name?: string;
  description?: string;
  registry_url?: string;
  saved_at: string;
}

export function getStoredA2ARegistryURL(): string {
  const stored = localStorage.getItem(A2A_REGISTRY_URL_KEY);
  return stored && stored.trim() !== '' ? stored.trim() : DEFAULT_REGISTRY_URL;
}

export function storeA2ARegistryURL(url: string): void {
  const normalized = url.trim().replace(/\/$/, '');
  if (!normalized) {
    localStorage.removeItem(A2A_REGISTRY_URL_KEY);
    void syncA2ASettingsToBackend();
    return;
  }
  localStorage.setItem(A2A_REGISTRY_URL_KEY, normalized);
  void syncA2ASettingsToBackend();
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

export function getStoredFavoriteA2AAgents(): FavoriteA2AAgent[] {
  try {
    const raw = localStorage.getItem(A2A_FAVORITE_AGENTS_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) {
      return [];
    }
    return parsed
      .filter((item): item is FavoriteA2AAgent => !!item && typeof item === 'object' && typeof (item as FavoriteA2AAgent).id === 'string')
      .map((item) => ({
        id: item.id.trim(),
        name: item.name?.trim() || '',
        description: item.description?.trim() || '',
        registry_url: item.registry_url?.trim() || '',
        saved_at: item.saved_at || new Date().toISOString(),
      }))
      .filter((item) => item.id !== '');
  } catch {
    return [];
  }
}

export function isFavoriteA2AAgent(agentID: string): boolean {
  const normalized = agentID.trim();
  if (!normalized) {
    return false;
  }
  return getStoredFavoriteA2AAgents().some((item) => item.id === normalized);
}

export function storeFavoriteA2AAgent(agent: Omit<FavoriteA2AAgent, 'saved_at'>): void {
  const normalizedID = agent.id.trim();
  if (!normalizedID) {
    return;
  }
  const all = getStoredFavoriteA2AAgents().filter((item) => item.id !== normalizedID);
  all.unshift({
    id: normalizedID,
    name: agent.name?.trim() || '',
    description: agent.description?.trim() || '',
    registry_url: agent.registry_url?.trim() || '',
    saved_at: new Date().toISOString(),
  });
  localStorage.setItem(A2A_FAVORITE_AGENTS_KEY, JSON.stringify(all.slice(0, 200)));
  void syncA2ASettingsToBackend();
}

export function removeFavoriteA2AAgent(agentID: string): void {
  const normalizedID = agentID.trim();
  if (!normalizedID) {
    return;
  }
  const remaining = getStoredFavoriteA2AAgents().filter((item) => item.id !== normalizedID);
  localStorage.setItem(A2A_FAVORITE_AGENTS_KEY, JSON.stringify(remaining));
  void syncA2ASettingsToBackend();
}

export async function syncA2ASettingsToBackend(): Promise<void> {
  try {
    const settings = await getSettings();
    const nextSettings = {
      ...settings,
      [A2A_REGISTRY_URL_SETTING_KEY]: getStoredA2ARegistryURL(),
      [A2A_FAVORITE_AGENTS_SETTING_KEY]: JSON.stringify(getStoredFavoriteA2AAgents()),
    };
    await updateSettings(nextSettings);
  } catch {
    // non-fatal; local state still applies for UI
  }
}
