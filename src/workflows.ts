import {
  createProjectFolder,
  deleteProjectFile,
  getProjectFile,
  listProjectTree,
  listProjects,
  saveProjectFile,
} from './api';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';

export type WorkflowNodeKind = 'user' | 'main' | 'subagent' | 'local' | 'external' | 'review_loop';
export type WorkflowEdgeMode = 'sequential' | 'parallel';
export type WorkflowStopCondition = 'manual' | 'max_turns' | 'consensus' | 'judge' | 'timebox';

export interface WorkflowNode {
  id: string;
  label: string;
  kind: WorkflowNodeKind;
  x: number;
  y: number;
  subAgentId?: string;
  localAgentId?: string;
  localAgentName?: string;
  localAgentBaseUrl?: string;
  externalAgentId?: string;
  externalAgentName?: string;
  workerSubAgentId?: string;
  workerLabel?: string;
  reviewerSubAgentId?: string;
  reviewerLabel?: string;
  loopMaxTurns?: number;
}

export interface WorkflowEdge {
  id: string;
  from: string;
  to: string;
  mode: WorkflowEdgeMode;
}

export interface WorkflowPolicy {
  maxTurns: number;
  stopCondition: WorkflowStopCondition;
  timeboxMinutes?: number;
  judgeNodeId?: string;
}

export interface WorkflowDefinition {
  id: string;
  name: string;
  description: string;
  builtIn?: boolean;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId: string;
  policy: WorkflowPolicy;
  createdAt: string;
  updatedAt: string;
}

export type WorkflowLaunchTarget =
  | { kind: 'main'; node: WorkflowNode }
  | { kind: 'subagent'; node: WorkflowNode; subAgentId: string }
  | { kind: 'external'; node: WorkflowNode; externalAgentId: string; externalAgentName?: string }
  | { kind: 'local'; node: WorkflowNode; localAgentId?: string; localAgentName?: string; localAgentBaseUrl?: string }
  | { kind: 'none' };

const WORKFLOWS_STORAGE_KEY = 'a2gent.workflows.v1';
const WORKFLOWS_FOLDER = 'workflows';
export const SYSTEM_SOUL_PROJECT_ID = 'system-soul';
export const DEFAULT_WORKFLOW_ID = 'builtin:user-main';

const sourcePathByWorkflowId = new Map<string, string>();
let workflowProjectIdPromise: Promise<string | null> | null = null;
let legacyMigrationPromise: Promise<void> | null = null;

function nowISO(): string {
  return new Date().toISOString();
}

function randomId(prefix: string): string {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function basePolicy(): WorkflowPolicy {
  return {
    maxTurns: 12,
    stopCondition: 'manual',
    timeboxMinutes: 20,
  };
}

function builtInWorkflows(): WorkflowDefinition[] {
  const createdAt = '2026-03-07T00:00:00.000Z';
  const updatedAt = createdAt;
  return [
    {
      id: 'builtin:user-main',
      name: 'User <-> Agent',
      description: 'Default chat between you and one agent.',
      builtIn: true,
      nodes: [
        { id: 'n-user', label: 'User', kind: 'user', x: 80, y: 140 },
        { id: 'n-main', label: 'Main agent', kind: 'main', x: 340, y: 140 },
      ],
      edges: [
        { id: 'e-user-main', from: 'n-user', to: 'n-main', mode: 'sequential' },
      ],
      entryNodeId: 'n-user',
      policy: { ...basePolicy(), stopCondition: 'manual' },
      createdAt,
      updatedAt,
    },
  ];
}

function sortWorkflows(items: WorkflowDefinition[]): WorkflowDefinition[] {
  const builtInOrder: Record<string, number> = {
    'builtin:user-main': 0,
  };

  return [...items].sort((a, b) => {
    const aBuiltInRank = builtInOrder[a.id];
    const bBuiltInRank = builtInOrder[b.id];
    const aHasBuiltInRank = Number.isFinite(aBuiltInRank);
    const bHasBuiltInRank = Number.isFinite(bBuiltInRank);
    if (aHasBuiltInRank || bHasBuiltInRank) {
      if (aHasBuiltInRank && bHasBuiltInRank) {
        return aBuiltInRank - bBuiltInRank;
      }
      return aHasBuiltInRank ? -1 : 1;
    }
    if (!!a.builtIn !== !!b.builtIn) {
      return a.builtIn ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function asObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return raw as Record<string, unknown>;
}

function asString(raw: unknown): string {
  return typeof raw === 'string' ? raw : '';
}

function asNumber(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : fallback;
}

function parseStopCondition(raw: unknown): WorkflowStopCondition {
  const value = asString(raw).trim();
  if (value === 'max_turns' || value === 'consensus' || value === 'judge' || value === 'timebox') {
    return value;
  }
  return 'manual';
}

function parseEdgeMode(raw: unknown): WorkflowEdgeMode {
  return asString(raw).trim() === 'parallel' ? 'parallel' : 'sequential';
}

function parseNodeKind(raw: unknown): WorkflowNodeKind {
  const value = asString(raw).trim();
  if (value === 'user' || value === 'main' || value === 'subagent' || value === 'local' || value === 'external' || value === 'review_loop') {
    return value;
  }
  return 'main';
}

function normalizeWorkflow(raw: unknown): WorkflowDefinition | null {
  const obj = asObject(raw);
  if (!obj) {
    return null;
  }

  const id = asString(obj.id).trim();
  if (id === '') {
    return null;
  }

  const nodesRaw = Array.isArray(obj.nodes) ? obj.nodes : [];
  const edgesRaw = Array.isArray(obj.edges) ? obj.edges : [];

  const nodes: WorkflowNode[] = nodesRaw
    .map((entry, index): WorkflowNode | null => {
      const node = asObject(entry);
      if (!node) return null;
      const nodeId = asString(node.id).trim() || `node-${index + 1}`;
      const next: WorkflowNode = {
        id: nodeId,
        label: asString(node.label).trim() || nodeId,
        kind: parseNodeKind(node.kind),
        x: asNumber(node.x, 60 + (index % 4) * 140),
        y: asNumber(node.y, 80 + Math.floor(index / 4) * 100),
      };
      const subAgentId = asString(node.subAgentId).trim();
      const localAgentId = asString(node.localAgentId).trim();
      const localAgentName = asString(node.localAgentName).trim();
      const localAgentBaseUrl = asString(node.localAgentBaseUrl).trim();
      const externalAgentId = asString(node.externalAgentId).trim();
      const externalAgentName = asString(node.externalAgentName).trim();
      const loopObj = asObject(node.loop) || {};
      const workerSubAgentId = asString(node.workerSubAgentId).trim() || asString(loopObj.workerSubAgentId).trim();
      const workerLabel = asString(node.workerLabel).trim() || asString(loopObj.workerLabel).trim();
      const reviewerSubAgentId = asString(node.reviewerSubAgentId).trim() || asString(loopObj.reviewerSubAgentId).trim();
      const reviewerLabel = asString(node.reviewerLabel).trim() || asString(loopObj.reviewerLabel).trim();
      const loopMaxTurns = asNumber(node.loopMaxTurns, asNumber(loopObj.maxTurns, 0));
      if (subAgentId !== '') next.subAgentId = subAgentId;
      if (localAgentId !== '') next.localAgentId = localAgentId;
      if (localAgentName !== '') next.localAgentName = localAgentName;
      if (localAgentBaseUrl !== '') next.localAgentBaseUrl = localAgentBaseUrl;
      if (externalAgentId !== '') next.externalAgentId = externalAgentId;
      if (externalAgentName !== '') next.externalAgentName = externalAgentName;
      if (workerSubAgentId !== '') next.workerSubAgentId = workerSubAgentId;
      if (workerLabel !== '') next.workerLabel = workerLabel;
      if (reviewerSubAgentId !== '') next.reviewerSubAgentId = reviewerSubAgentId;
      if (reviewerLabel !== '') next.reviewerLabel = reviewerLabel;
      if (loopMaxTurns > 0) next.loopMaxTurns = Math.floor(loopMaxTurns);
      return next;
    })
    .filter((node): node is WorkflowNode => !!node);

  if (nodes.length === 0) {
    return null;
  }

  const nodeIds = new Set(nodes.map((node) => node.id));

  const edges: WorkflowEdge[] = edgesRaw
    .map((entry, index) => {
      const edge = asObject(entry);
      if (!edge) return null;
      const from = asString(edge.from).trim();
      const to = asString(edge.to).trim();
      if (!nodeIds.has(from) || !nodeIds.has(to)) {
        return null;
      }
      return {
        id: asString(edge.id).trim() || `edge-${index + 1}`,
        from,
        to,
        mode: parseEdgeMode(edge.mode),
      };
    })
    .filter((edge): edge is WorkflowEdge => !!edge);

  const policyRaw = asObject(obj.policy) || {};
  const policy: WorkflowPolicy = {
    maxTurns: Math.max(1, Math.floor(asNumber(policyRaw.maxTurns, 12))),
    stopCondition: parseStopCondition(policyRaw.stopCondition),
    timeboxMinutes: Math.max(1, Math.floor(asNumber(policyRaw.timeboxMinutes, 20))),
    judgeNodeId: asString(policyRaw.judgeNodeId).trim() || undefined,
  };

  const entryNodeIdRaw = asString(obj.entryNodeId).trim();
  const entryNodeId = nodeIds.has(entryNodeIdRaw) ? entryNodeIdRaw : nodes[0].id;

  return {
    id,
    name: asString(obj.name).trim() || id,
    description: asString(obj.description),
    builtIn: false,
    nodes,
    edges,
    entryNodeId,
    policy,
    createdAt: asString(obj.createdAt).trim() || nowISO(),
    updatedAt: asString(obj.updatedAt).trim() || nowISO(),
  };
}

function workflowToStorageObject(workflow: WorkflowDefinition): Record<string, unknown> {
  return {
    version: 1,
    id: workflow.id,
    name: workflow.name,
    description: workflow.description,
    entryNodeId: workflow.entryNodeId,
    policy: {
      maxTurns: workflow.policy.maxTurns,
      stopCondition: workflow.policy.stopCondition,
      timeboxMinutes: workflow.policy.timeboxMinutes,
      judgeNodeId: workflow.policy.judgeNodeId,
    },
    nodes: workflow.nodes,
    edges: workflow.edges,
    createdAt: workflow.createdAt,
    updatedAt: workflow.updatedAt,
  };
}

function workflowFileName(workflowId: string): string {
  const normalized = workflowId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  return `${normalized || 'workflow'}.yaml`;
}

function workflowFilePath(workflowId: string): string {
  return `${WORKFLOWS_FOLDER}/${workflowFileName(workflowId)}`;
}

function workflowMarkdownFallbackPath(path: string): string {
  const trimmed = path.trim();
  if (trimmed.toLowerCase().endsWith('.yaml')) {
    return `${trimmed.slice(0, -5)}.md`;
  }
  if (trimmed.toLowerCase().endsWith('.yml')) {
    return `${trimmed.slice(0, -4)}.md`;
  }
  return `${trimmed}.md`;
}

function isMarkdownOnlyWorkflowSaveError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error || '');
  return message.includes('Only markdown files can be created or edited');
}

async function saveWorkflowFileWithFallback(projectID: string, path: string, content: string): Promise<string> {
  try {
    await saveProjectFile(projectID, path, content);
    return path;
  } catch (error) {
    if (!isMarkdownOnlyWorkflowSaveError(error)) {
      throw error;
    }
    const fallbackPath = workflowMarkdownFallbackPath(path);
    await saveProjectFile(projectID, fallbackPath, content);
    return fallbackPath;
  }
}

export function getWorkflowFilePath(workflowId: string): string {
  if (!workflowId) {
    return `${WORKFLOWS_FOLDER}/workflow.yaml`;
  }
  return sourcePathByWorkflowId.get(workflowId) || workflowFilePath(workflowId);
}

async function resolveWorkflowProjectID(): Promise<string | null> {
  if (!workflowProjectIdPromise) {
    workflowProjectIdPromise = (async () => {
      try {
        const projects = await listProjects();
        const exact = projects.find((project) => project.id === SYSTEM_SOUL_PROJECT_ID && !!project.folder);
        if (exact) {
          return exact.id;
        }
        const byName = projects.find((project) => project.is_system && project.name.trim().toLowerCase() === 'soul' && !!project.folder);
        return byName?.id || null;
      } catch {
        return null;
      }
    })();
  }
  return workflowProjectIdPromise;
}

async function migrateLegacyLocalStorage(projectID: string): Promise<void> {
  if (legacyMigrationPromise || typeof window === 'undefined') {
    return legacyMigrationPromise || Promise.resolve();
  }

  legacyMigrationPromise = (async () => {
    let parsed: unknown;
    try {
      const raw = window.localStorage.getItem(WORKFLOWS_STORAGE_KEY);
      if (!raw) {
        return;
      }
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    if (!Array.isArray(parsed)) {
      return;
    }

    try {
      await createProjectFolder(projectID, WORKFLOWS_FOLDER);
    } catch {
      // Folder can already exist.
    }

    let allSaved = true;

    for (const item of parsed) {
      const normalized = normalizeWorkflow(item);
      if (!normalized || normalized.builtIn) {
        continue;
      }
      const path = workflowFilePath(normalized.id);
      const content = stringifyYAML(workflowToStorageObject(normalized));
      try {
        const savedPath = await saveWorkflowFileWithFallback(projectID, path, content);
        sourcePathByWorkflowId.set(normalized.id, savedPath);
      } catch {
        allSaved = false;
      }
    }

    if (allSaved) {
      window.localStorage.removeItem(WORKFLOWS_STORAGE_KEY);
    }
  })();

  return legacyMigrationPromise;
}

async function loadCustomWorkflowsFromFiles(): Promise<WorkflowDefinition[]> {
  const projectID = await resolveWorkflowProjectID();
  if (!projectID) {
    return [];
  }

  await migrateLegacyLocalStorage(projectID);

  let entries: Array<{ path: string; type: string }> = [];
  try {
    const tree = await listProjectTree(projectID, WORKFLOWS_FOLDER);
    entries = tree.entries || [];
  } catch {
    return [];
  }

  const workflowFiles = entries
    .filter((entry) => entry.type === 'file')
    .map((entry) => entry.path)
    .filter((path) => {
      const lower = path.toLowerCase();
      return lower.endsWith('.yaml') || lower.endsWith('.yml') || lower.endsWith('.md') || lower.endsWith('.markdown');
    });

  const loaded = await Promise.all(
    workflowFiles.map(async (path) => {
      try {
        const file = await getProjectFile(projectID, path);
        const parsed = parseYAML(file.content);
        const normalized = normalizeWorkflow(parsed);
        if (!normalized) {
          return null;
        }
        sourcePathByWorkflowId.set(normalized.id, path);
        return normalized;
      } catch {
        return null;
      }
    }),
  );

  const deduped = new Map<string, WorkflowDefinition>();
  for (const workflow of loaded) {
    if (!workflow || workflow.id.startsWith('builtin:')) {
      continue;
    }
    deduped.set(workflow.id, { ...workflow, builtIn: false });
  }

  return Array.from(deduped.values());
}

export async function listWorkflows(): Promise<WorkflowDefinition[]> {
  const builtIns = builtInWorkflows();
  const builtInIDs = new Set(builtIns.map((item) => item.id));
  const custom = (await loadCustomWorkflowsFromFiles()).filter((item) => !builtInIDs.has(item.id));
  return sortWorkflows([...builtIns, ...custom]);
}

export async function getWorkflowById(workflowId: string): Promise<WorkflowDefinition | null> {
  if (!workflowId) {
    return null;
  }
  const all = await listWorkflows();
  return all.find((workflow) => workflow.id === workflowId) || null;
}

export function createWorkflowTemplate(name = 'New workflow'): WorkflowDefinition {
  const id = randomId('wf');
  const timestamp = nowISO();
  const userNodeId = randomId('node');
  const mainNodeId = randomId('node');
  return {
    id,
    name,
    description: '',
    builtIn: false,
    nodes: [
      { id: userNodeId, label: 'User', kind: 'user', x: 80, y: 140 },
      { id: mainNodeId, label: 'Main agent', kind: 'main', x: 340, y: 140 },
    ],
    edges: [],
    entryNodeId: userNodeId,
    policy: basePolicy(),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export async function saveWorkflow(workflow: WorkflowDefinition): Promise<void> {
  if (workflow.builtIn) {
    return;
  }

  const projectID = await resolveWorkflowProjectID();
  if (!projectID) {
    throw new Error('Soul project is unavailable; cannot save workflow file.');
  }

  try {
    await createProjectFolder(projectID, WORKFLOWS_FOLDER);
  } catch {
    // Folder can already exist.
  }

  const next: WorkflowDefinition = {
    ...workflow,
    builtIn: false,
    updatedAt: nowISO(),
    createdAt: workflow.createdAt || nowISO(),
    entryNodeId: workflow.entryNodeId || workflow.nodes[0]?.id || '',
  };

  const sourcePath = sourcePathByWorkflowId.get(next.id) || workflowFilePath(next.id);
  const content = stringifyYAML(workflowToStorageObject(next));
  const savedPath = await saveWorkflowFileWithFallback(projectID, sourcePath, content);
  if (savedPath !== sourcePath) {
    try {
      await deleteProjectFile(projectID, sourcePath);
    } catch {
      // Ignore if source path does not exist.
    }
  }
  sourcePathByWorkflowId.set(next.id, savedPath);
}

export async function deleteWorkflow(workflowId: string): Promise<void> {
  if (!workflowId || workflowId.startsWith('builtin:')) {
    return;
  }

  const projectID = await resolveWorkflowProjectID();
  if (!projectID) {
    throw new Error('Soul project is unavailable; cannot delete workflow file.');
  }

  const sourcePath = sourcePathByWorkflowId.get(workflowId) || workflowFilePath(workflowId);
  await deleteProjectFile(projectID, sourcePath);
  sourcePathByWorkflowId.delete(workflowId);
}

export function duplicateWorkflow(source: WorkflowDefinition): WorkflowDefinition {
  const timestamp = nowISO();
  const id = randomId('wf');
  return {
    ...source,
    id,
    name: `${source.name} (copy)`,
    builtIn: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function resolveWorkflowLaunchTarget(workflow: WorkflowDefinition): WorkflowLaunchTarget {
  const nodeMap = new Map(workflow.nodes.map((node) => [node.id, node]));

  const toLaunch = (node: WorkflowNode | undefined): WorkflowLaunchTarget => {
    if (!node) {
      return { kind: 'none' };
    }
    if (node.kind === 'main') {
      return { kind: 'main', node };
    }
    if (node.kind === 'subagent' && node.subAgentId) {
      return { kind: 'subagent', node, subAgentId: node.subAgentId };
    }
    if (node.kind === 'external' && node.externalAgentId) {
      return { kind: 'external', node, externalAgentId: node.externalAgentId, externalAgentName: node.externalAgentName };
    }
    if (node.kind === 'local') {
      return {
        kind: 'local',
        node,
        localAgentId: node.localAgentId,
        localAgentName: node.localAgentName,
        localAgentBaseUrl: node.localAgentBaseUrl,
      };
    }
    return { kind: 'none' };
  };

  const entry = nodeMap.get(workflow.entryNodeId) || workflow.nodes[0];
  if (!entry) {
    return { kind: 'none' };
  }

  if (entry.kind !== 'user') {
    return toLaunch(entry);
  }

  const outgoing = workflow.edges
    .filter((edge) => edge.from === entry.id)
    .map((edge) => nodeMap.get(edge.to))
    .filter((node): node is WorkflowNode => !!node);

  for (const node of outgoing) {
    const target = toLaunch(node);
    if (target.kind !== 'none') {
      return target;
    }
  }

  for (const node of workflow.nodes) {
    const target = toLaunch(node);
    if (target.kind !== 'none') {
      return target;
    }
  }

  return { kind: 'none' };
}
export const SELECTED_WORKFLOW_STORAGE_KEY_PREFIX = 'a2gent.project.selectedWorkflow.';

export function buildWorkflowSessionMetadata(workflow: WorkflowDefinition): Record<string, unknown> {
  return {
    workflow_id: workflow.id,
    workflow_name: workflow.name,
    workflow_definition: {
      id: workflow.id,
      name: workflow.name,
      description: workflow.description,
      entryNodeId: workflow.entryNodeId,
      policy: workflow.policy,
      nodes: workflow.nodes.map((node) => ({
        id: node.id,
        label: node.label,
        kind: node.kind,
        ref: node.kind === 'subagent'
          ? (node.subAgentId || '')
          : node.kind === 'local'
            ? (node.localAgentId || '')
            : node.kind === 'external'
              ? (node.externalAgentId || '')
              : '',
        subAgentId: node.subAgentId,
        localAgentId: node.localAgentId,
        externalAgentId: node.externalAgentId,
        workerSubAgentId: node.workerSubAgentId,
        workerLabel: node.workerLabel,
        reviewerSubAgentId: node.reviewerSubAgentId,
        reviewerLabel: node.reviewerLabel,
        loopMaxTurns: node.loopMaxTurns,
      })),
      edges: workflow.edges.map((edge) => ({
        from: edge.from,
        to: edge.to,
        mode: edge.mode,
      })),
    },
  };
}
