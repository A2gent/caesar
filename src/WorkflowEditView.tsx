import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { listLocalDockerAgents, listSubAgents, type LocalDockerAgent, type SubAgent } from './api';
import { parse as parseYAML, stringify as stringifyYAML } from 'yaml';
import {
  createWorkflowTemplate,
  duplicateWorkflow,
  getWorkflowFilePath,
  getWorkflowById,
  saveWorkflow,
  SYSTEM_SOUL_PROJECT_ID,
  type WorkflowDefinition,
  type WorkflowEdge,
  type WorkflowNode,
  type WorkflowNodeKind,
  type WorkflowStopCondition,
} from './workflows';
import {
  computeWorkflowGraphLayout,
  WORKFLOW_CANVAS_HEIGHT,
  WORKFLOW_CANVAS_WIDTH,
} from './workflowGraph';
import WorkflowGraphCanvas from './WorkflowGraphCanvas';
import { withAgentEmoji } from './agentVisuals';
import { getStoredFavoriteA2AAgents, type FavoriteA2AAgent } from './a2aIdentity';

const WORKFLOW_EDIT_CANVAS_WIDTH = 980;
const WORKFLOW_EDIT_CANVAS_HEIGHT = 760;

type ParsedGraph = {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  entryNodeId?: string;
  policy?: Partial<WorkflowDefinition['policy']>;
  errors: string[];
  warnings: string[];
};

type NodeSeed = {
  key: string;
  label: string;
  kind: WorkflowNodeKind;
  ref: string;
  isAgentIdRef?: boolean;
};

function stableNodeIdFromKey(key: string): string {
  const normalized = key.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '');
  return `node-${normalized || 'x'}`;
}

function cloneWorkflow(workflow: WorkflowDefinition): WorkflowDefinition {
  return {
    ...workflow,
    nodes: workflow.nodes.map((node) => ({ ...node })),
    edges: workflow.edges.map((edge) => ({ ...edge })),
    policy: { ...workflow.policy },
  };
}

function kindLabel(kind: WorkflowNodeKind): string {
  switch (kind) {
    case 'user':
      return 'User';
    case 'main':
      return 'Main agent';
    case 'subagent':
      return 'Sub-agent';
    case 'local':
      return 'Local agent';
    case 'external':
      return 'External agent';
    default:
      return kind;
  }
}

function parseMode(raw: string): 'sequential' | 'parallel' | null {
  const normalized = raw.trim().toLowerCase();
  if (normalized === '' || normalized === 'sequential' || normalized === 'seq') {
    return 'sequential';
  }
  if (normalized === 'parallel' || normalized === 'par') {
    return 'parallel';
  }
  return null;
}

function parseNodeToken(token: string): { label: string; kind: WorkflowNodeKind; ref: string; isAgentIdRef?: boolean } | null {
  const trimmed = token.trim();
  if (trimmed === '') return null;
  const idRefMatch = /^@([A-Za-z0-9._:-]+)$/.exec(trimmed);
  if (idRefMatch) {
    const ref = (idRefMatch[1] || '').trim();
    const lowered = ref.toLowerCase();
    if (lowered === 'user') {
      return { label: 'User', kind: 'user', ref: '' };
    }
    if (lowered === 'main') {
      return { label: 'Main agent', kind: 'main', ref: '' };
    }
    return { label: ref, kind: 'subagent', ref, isAgentIdRef: true };
  }
  const match = /^(.+?)(?:@([a-z_]+)(?:@([A-Za-z0-9._:-]+))?)?(?:\(([^)]+)\))?$/.exec(trimmed);
  if (!match) return null;

  const label = (match[1] || '').trim();
  const kindRaw = (match[2] || '').trim().toLowerCase();
  const refFromAt = (match[3] || '').trim();
  const refFromParens = (match[4] || '').trim();
  const ref = refFromParens !== '' ? refFromParens : refFromAt;
  if (label === '') return null;

  let kind: WorkflowNodeKind = 'main';
  if (kindRaw === '') {
    const lower = label.toLowerCase();
    if (lower === 'user' || lower === 'you') {
      kind = 'user';
    }
  } else if (kindRaw === 'user' || kindRaw === 'main' || kindRaw === 'subagent' || kindRaw === 'local' || kindRaw === 'external') {
    kind = kindRaw;
  } else {
    return null;
  }

  return { label, kind, ref };
}

function workflowToGraphYaml(workflow: WorkflowDefinition): string {
  return stringifyYAML({
    nodes: workflow.nodes.map((node) => ({
      id: node.id,
      label: node.label,
      kind: node.kind,
      x: Math.round(node.x),
      y: Math.round(node.y),
      ref: node.kind === 'subagent'
        ? node.subAgentId
        : node.kind === 'local'
          ? node.localAgentId
          : node.kind === 'external'
            ? node.externalAgentId
            : undefined,
    })),
    edges: workflow.edges.map((edge) => ({
      from: edge.from,
      to: edge.to,
    })),
    entryNodeId: workflow.entryNodeId,
    policy: {
      stopCondition: workflow.policy.stopCondition,
      judgeNodeId: workflow.policy.judgeNodeId,
      maxTurns: workflow.policy.maxTurns,
      timeboxMinutes: workflow.policy.timeboxMinutes,
    },
  });
}

type YamlNodeSeed = {
  id: string;
  label: string;
  kind: WorkflowNodeKind | null;
  ref: string;
  x?: number;
  y?: number;
};

type YamlEdgeSeed = {
  from: string;
  to: string;
  mode: 'sequential' | 'parallel' | null;
};

function parseYamlStopCondition(raw: unknown): WorkflowStopCondition | null {
  if (typeof raw !== 'string') {
    return null;
  }
  const normalized = raw.trim();
  if (normalized === 'manual' || normalized === 'max_turns' || normalized === 'consensus' || normalized === 'judge' || normalized === 'timebox') {
    return normalized;
  }
  return null;
}

function workflowCycleWarning(nodes: WorkflowNode[], edges: WorkflowEdge[]): string | null {
  if (nodes.length === 0) {
    return null;
  }
  const nodeIds = new Set(nodes.map((node) => node.id));
  const inDegree = new Map<string, number>();
  const outgoing = new Map<string, string[]>();
  nodeIds.forEach((nodeID) => {
    inDegree.set(nodeID, 0);
    outgoing.set(nodeID, []);
  });

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return;
    }
    inDegree.set(edge.to, (inDegree.get(edge.to) || 0) + 1);
    outgoing.get(edge.from)?.push(edge.to);
  });

  const queue: string[] = [];
  inDegree.forEach((deg, nodeID) => {
    if (deg === 0) {
      queue.push(nodeID);
    }
  });

  let visited = 0;
  while (queue.length > 0) {
    const nodeID = queue.shift();
    if (!nodeID) continue;
    visited += 1;
    (outgoing.get(nodeID) || []).forEach((nextID) => {
      const nextDegree = (inDegree.get(nextID) || 0) - 1;
      inDegree.set(nextID, nextDegree);
      if (nextDegree === 0) {
        queue.push(nextID);
      }
    });
  }

  if (visited === nodeIds.size) {
    return null;
  }
  const blocked = Array.from(inDegree.entries())
    .filter(([, deg]) => deg > 0)
    .map(([nodeID]) => nodeID)
    .sort();
  return `Workflow graph contains a loop. Nodes in loop: ${blocked.join(', ')}. Use policy.maxTurns/timeboxMinutes and, for judge workflows, make the judge output VERDICT: APPROVED to end early.`;
}

function withTopologyValidation(graph: ParsedGraph): ParsedGraph {
  if (graph.errors.length > 0) {
    return graph;
  }
  const cycleWarning = workflowCycleWarning(graph.nodes, graph.edges);
  if (!cycleWarning) {
    return graph;
  }
  return {
    ...graph,
    warnings: [...graph.warnings, cycleWarning],
  };
}

function parseYamlGraph(
  source: string,
  subAgents: SubAgent[],
  localAgents: LocalDockerAgent[],
  favoriteExternalAgents: FavoriteA2AAgent[],
): ParsedGraph {
  const raw = parseYAML(source) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { nodes: [], edges: [], errors: ['YAML root must be an object with nodes and edges.'], warnings: [] };
  }
  const obj = raw as Record<string, unknown>;
  const rawNodes = Array.isArray(obj.nodes) ? obj.nodes : [];
  const rawEdges = Array.isArray(obj.edges) ? obj.edges : [];
  if (rawNodes.length === 0) {
    return { nodes: [], edges: [], errors: ['YAML must include at least one node in nodes[].'], warnings: [] };
  }

  const yamlNodes: YamlNodeSeed[] = [];
  const yamlEdges: YamlEdgeSeed[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  const usedNodeIds = new Set<string>();

  rawNodes.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`nodes[${index}] must be an object.`);
      return;
    }
    const nodeObj = entry as Record<string, unknown>;
    const id = typeof nodeObj.id === 'string' ? nodeObj.id.trim() : '';
    const label = typeof nodeObj.label === 'string' ? nodeObj.label.trim() : '';
    const kindRaw = typeof nodeObj.kind === 'string' ? nodeObj.kind.trim().toLowerCase() : '';
    const ref = typeof nodeObj.ref === 'string' ? nodeObj.ref.trim() : '';
    const x = typeof nodeObj.x === 'number' && Number.isFinite(nodeObj.x) ? nodeObj.x : undefined;
    const y = typeof nodeObj.y === 'number' && Number.isFinite(nodeObj.y) ? nodeObj.y : undefined;
    const kind = kindRaw === ''
      ? null
      : (kindRaw === 'user' || kindRaw === 'main' || kindRaw === 'subagent' || kindRaw === 'local' || kindRaw === 'external')
        ? kindRaw as WorkflowNodeKind
        : null;
    if (id === '') {
      errors.push(`nodes[${index}].id is required.`);
      return;
    }
    if (usedNodeIds.has(id)) {
      errors.push(`nodes[${index}].id "${id}" is duplicated.`);
      return;
    }
    usedNodeIds.add(id);
    if (kindRaw !== '' && !kind) {
      errors.push(`nodes[${index}].kind must be one of user|main|subagent|local|external.`);
      return;
    }
    const resolvedLabel = label !== '' ? label : (ref !== '' ? ref : id);
    yamlNodes.push({ id, label: resolvedLabel, kind, ref, x, y });
  });

  rawEdges.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      errors.push(`edges[${index}] must be an object.`);
      return;
    }
    const edgeObj = entry as Record<string, unknown>;
    const from = typeof edgeObj.from === 'string' ? edgeObj.from.trim() : '';
    const to = typeof edgeObj.to === 'string' ? edgeObj.to.trim() : '';
    const modeRaw = typeof edgeObj.mode === 'string' ? edgeObj.mode.trim().toLowerCase() : '';
    let mode: 'sequential' | 'parallel' | null = null;
    if (modeRaw !== '') {
      if (modeRaw === 'sequential' || modeRaw === 'seq') {
        mode = 'sequential';
      } else if (modeRaw === 'parallel' || modeRaw === 'par') {
        mode = 'parallel';
      } else {
        errors.push(`edges[${index}].mode must be sequential|parallel when provided.`);
        return;
      }
    }
    if (from === '' || to === '') {
      errors.push(`edges[${index}] requires from and to.`);
      return;
    }
    yamlEdges.push({ from, to, mode });
  });

  if (errors.length > 0) {
    return { nodes: [], edges: [], errors, warnings: [] };
  }

  const nodeIds = new Set(yamlNodes.map((node) => node.id));
  const outgoingCounts = new Map<string, number>();
  yamlEdges.forEach((edge) => outgoingCounts.set(edge.from, (outgoingCounts.get(edge.from) || 0) + 1));

  yamlEdges.forEach((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      errors.push(`Edge "${edge.from} -> ${edge.to}" references unknown node id.`);
    }
  });

  if (errors.length > 0) {
    return { nodes: [], edges: [], errors, warnings: [] };
  }

  const positioned = assignNodeLayout(
    yamlNodes.map((node) => ({
      key: node.id,
      label: node.label,
      kind: node.kind || (node.ref !== '' ? 'subagent' : 'main'),
      ref: node.ref,
    })),
    yamlEdges.map((edge) => ({ from: edge.from, to: edge.to })),
  );
  const positionById = new Map(positioned.map((item) => [item.key, item]));

  const nodes: WorkflowNode[] = yamlNodes.map((node) => {
    const inferredKind: WorkflowNodeKind = node.kind || (() => {
      const lower = node.label.trim().toLowerCase();
      if (lower === 'user' || lower === 'you') return 'user';
      if (lower === 'main' || lower === 'main agent') return 'main';
      if (node.ref !== '') return 'subagent';
      return 'main';
    })();
    const pos = {
      x: typeof node.x === 'number' ? node.x : (positionById.get(node.id)?.x || 70),
      y: typeof node.y === 'number' ? node.y : (positionById.get(node.id)?.y || 60),
    };
    const result: WorkflowNode = {
      id: node.id,
      label: node.label,
      kind: inferredKind,
      x: pos.x,
      y: pos.y,
    };

    if (inferredKind === 'subagent') {
      const search = (node.ref || node.label).toLowerCase();
      const byId = subAgents.find((agent) => agent.id.toLowerCase() === search);
      const byName = subAgents.find((agent) => agent.name.toLowerCase() === search);
      const byLocalId = localAgents.find((agent) => agent.id.toLowerCase() === search);
      const byExternalId = favoriteExternalAgents.find((agent) => agent.id.toLowerCase() === search);
      const match = byId || byName;
      if (match) {
        result.subAgentId = match.id;
        result.label = match.name || node.label;
      } else if (byLocalId) {
        result.kind = 'local';
        result.localAgentId = byLocalId.id;
        result.localAgentName = byLocalId.name;
        result.localAgentBaseUrl = byLocalId.api_url || undefined;
        result.label = byLocalId.name || node.label;
      } else if (byExternalId) {
        result.kind = 'external';
        result.externalAgentId = byExternalId.id;
        result.externalAgentName = byExternalId.name;
        result.label = byExternalId.name || node.label;
      } else {
        errors.push(`Sub-agent "${node.label}" was not matched to an existing sub-agent.`);
      }
    }

    if (inferredKind === 'local') {
      const search = (node.ref || node.label).toLowerCase();
      const match = localAgents.find((agent) => agent.id.toLowerCase() === search)
        || localAgents.find((agent) => agent.name.toLowerCase() === search)
        || localAgents.find((agent) => (agent.api_url || '').toLowerCase() === search);
      if (match) {
        result.localAgentId = match.id;
        result.localAgentName = match.name;
        result.localAgentBaseUrl = match.api_url || undefined;
        result.label = match.name || node.label;
      } else {
        errors.push(`Local agent "${node.label}" was not matched to an existing local agent.`);
      }
    }

    if (inferredKind === 'external') {
      if (node.ref === '') {
        errors.push(`External node "${node.label}" has no external agent id in ref.`);
      } else {
        const favorite = favoriteExternalAgents.find((agent) => agent.id === node.ref);
        if (!favorite) {
          errors.push(`External agent id "${node.ref}" is not in favorites. Add it in A2 Registry first.`);
        } else {
          result.externalAgentId = favorite.id;
          result.externalAgentName = favorite.name;
          result.label = favorite.name || node.label;
        }
      }
    }

    return result;
  });

  if (errors.length > 0) {
    return { nodes: [], edges: [], errors, warnings: [] };
  }

  const edges: WorkflowEdge[] = yamlEdges.map((edge, index) => ({
    id: `edge-${index + 1}`,
    from: edge.from,
    to: edge.to,
    mode: edge.mode || ((outgoingCounts.get(edge.from) || 0) > 1 ? 'parallel' : 'sequential'),
  }));

  const entryNodeIdRaw = typeof obj.entryNodeId === 'string' ? obj.entryNodeId.trim() : '';
  const entryNodeId = nodeIds.has(entryNodeIdRaw) ? entryNodeIdRaw : (nodes[0]?.id || '');

  const policyPatch: Partial<WorkflowDefinition['policy']> = {};
  const policyRaw = obj.policy;
  if (policyRaw && typeof policyRaw === 'object' && !Array.isArray(policyRaw)) {
    const policyObj = policyRaw as Record<string, unknown>;
    const stopCondition = parseYamlStopCondition(policyObj.stopCondition);
    if (policyObj.stopCondition !== undefined && !stopCondition) {
      errors.push('policy.stopCondition must be one of manual|max_turns|consensus|judge|timebox.');
    } else if (stopCondition) {
      policyPatch.stopCondition = stopCondition;
    }
    if (typeof policyObj.judgeNodeId === 'string') {
      const judgeNodeId = policyObj.judgeNodeId.trim();
      if (judgeNodeId !== '') {
        policyPatch.judgeNodeId = judgeNodeId;
      }
    }
    if (typeof policyObj.maxTurns === 'number' && Number.isFinite(policyObj.maxTurns)) {
      policyPatch.maxTurns = Math.max(1, Math.floor(policyObj.maxTurns));
    }
    if (typeof policyObj.timeboxMinutes === 'number' && Number.isFinite(policyObj.timeboxMinutes)) {
      policyPatch.timeboxMinutes = Math.max(1, Math.floor(policyObj.timeboxMinutes));
    }
  }

  const stopCondition = policyPatch.stopCondition;
  if (stopCondition === 'judge') {
    if (!policyPatch.judgeNodeId) {
      errors.push('policy.judgeNodeId is required when policy.stopCondition is "judge".');
    } else if (!nodeIds.has(policyPatch.judgeNodeId)) {
      errors.push(`policy.judgeNodeId "${policyPatch.judgeNodeId}" does not match any node id.`);
    }
  } else if (policyPatch.judgeNodeId && !nodeIds.has(policyPatch.judgeNodeId)) {
    errors.push(`policy.judgeNodeId "${policyPatch.judgeNodeId}" does not match any node id.`);
  }

  if (errors.length > 0) {
    return { nodes: [], edges: [], errors, warnings: [] };
  }

  if (edges.length === 0) {
    warnings.push('No connections found yet.');
  }

  return {
    nodes,
    edges,
    entryNodeId,
    policy: policyPatch,
    errors: [],
    warnings,
  };
}

function parseGraphDefinition(
  source: string,
  subAgents: SubAgent[],
  localAgents: LocalDockerAgent[],
  favoriteExternalAgents: FavoriteA2AAgent[],
): ParsedGraph {
  const trimmed = source.trim();
  const yamlIntent = trimmed === ''
    || trimmed.startsWith('#')
    || /\bnodes\s*:/.test(source)
    || /\bedges\s*:/.test(source)
    || /\bentryNodeId\s*:/.test(source);

  try {
    const yamlParsed = parseYamlGraph(source, subAgents, localAgents, favoriteExternalAgents);
    if (yamlParsed.errors.length === 0 || yamlIntent) {
      return withTopologyValidation(yamlParsed);
    }
  } catch {
    if (yamlIntent) {
      return { nodes: [], edges: [], errors: ['Invalid YAML format.'], warnings: [] };
    }
  }
  const legacy = parseGraphDsl(source, subAgents, localAgents, favoriteExternalAgents);
  if (legacy.errors.length === 0) {
    return withTopologyValidation({
      ...legacy,
      warnings: [...legacy.warnings, 'Parsed as legacy line DSL. Prefer YAML nodes/edges format.'],
    });
  }
  return legacy;
}

function assignNodeLayout(nodes: NodeSeed[], edges: Array<{ from: string; to: string }>): Array<{ key: string; x: number; y: number }> {
  const virtualNodes: WorkflowNode[] = nodes.map((node, index) => ({
    id: node.key,
    label: node.label,
    kind: node.kind,
    x: 40 + (index % 4) * 170,
    y: 40 + Math.floor(index / 4) * 90,
  }));
  const virtualEdges: WorkflowEdge[] = edges.map((edge, index) => ({
    id: `seed-edge-${index + 1}`,
    from: edge.from,
    to: edge.to,
    mode: 'sequential',
  }));
  const positions = computeWorkflowGraphLayout(
    virtualNodes,
    virtualEdges,
    WORKFLOW_CANVAS_WIDTH,
    WORKFLOW_CANVAS_HEIGHT,
  );
  return nodes.map((node) => {
    const pos = positions.get(node.key) || { x: 60, y: 60 };
    return { key: node.key, x: pos.x, y: pos.y };
  });
}

function parseGraphDsl(
  dsl: string,
  subAgents: SubAgent[],
  localAgents: LocalDockerAgent[],
  favoriteExternalAgents: FavoriteA2AAgent[],
): ParsedGraph {
  const errors: string[] = [];
  const warnings: string[] = [];
  const nodeMap = new Map<string, NodeSeed>();
  const edgeSeeds: Array<{ fromKey: string; toKey: string; mode: 'sequential' | 'parallel' }> = [];
  let edgeCounter = 0;

  const lines = dsl.replace(/\r\n/g, '\n').split('\n');
  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) return;

    const edgeMatch = /^(.+?)\s*-->\s*(?:\|([^|]+)\|)?\s*(.+)$/.exec(trimmed);
    if (!edgeMatch) {
      errors.push(`Line ${index + 1}: invalid legacy syntax. Use "source --> target".`);
      return;
    }

    const leftRaw = edgeMatch[1] || '';
    const modeRaw = edgeMatch[2] || 'sequential';
    const rightRaw = edgeMatch[3] || '';

    const left = parseNodeToken(leftRaw);
    const right = parseNodeToken(rightRaw);
    const mode = parseMode(modeRaw);

    if (!left) {
      errors.push(`Line ${index + 1}: invalid source node "${leftRaw.trim()}".`);
      return;
    }
    if (!right) {
      errors.push(`Line ${index + 1}: invalid target node "${rightRaw.trim()}".`);
      return;
    }
    if (!mode) {
      errors.push(`Line ${index + 1}: unsupported mode "${modeRaw.trim()}". Use sequential|parallel.`);
      return;
    }

    const ensureNode = (parsed: { label: string; kind: WorkflowNodeKind; ref: string; isAgentIdRef?: boolean }) => {
      const key = parsed.label.toLowerCase();
      const existing = nodeMap.get(key);
      if (!existing) {
        nodeMap.set(key, { key, ...parsed });
        return key;
      }
      if (existing.kind !== parsed.kind) {
        errors.push(`Line ${index + 1}: node "${parsed.label}" has conflicting kinds (${existing.kind} vs ${parsed.kind}).`);
      }
      if (parsed.ref !== '' && existing.ref !== '' && parsed.ref !== existing.ref) {
        errors.push(`Line ${index + 1}: node "${parsed.label}" has conflicting refs (${existing.ref} vs ${parsed.ref}).`);
      }
      if (existing.ref === '' && parsed.ref !== '') {
        existing.ref = parsed.ref;
      }
      if (!existing.isAgentIdRef && parsed.isAgentIdRef) {
        existing.isAgentIdRef = true;
      }
      return key;
    };

    const fromKey = ensureNode(left);
    const toKey = ensureNode(right);
    edgeSeeds.push({ fromKey, toKey, mode });
    edgeCounter += 1;
  });

  const nodeSeeds = Array.from(nodeMap.values());
  const positioned = assignNodeLayout(
    nodeSeeds,
    edgeSeeds.map((edge) => ({ from: edge.fromKey, to: edge.toKey })),
  );
  const posByKey = new Map(positioned.map((item) => [item.key, item]));

  const keyToId = new Map<string, string>();
  const usedNodeIDs = new Set<string>();
  const nodes: WorkflowNode[] = nodeSeeds.map((seed) => {
    const baseNodeId = stableNodeIdFromKey(seed.key);
    let nodeId = baseNodeId;
    let suffix = 2;
    while (usedNodeIDs.has(nodeId)) {
      nodeId = `${baseNodeId}-${suffix}`;
      suffix += 1;
    }
    usedNodeIDs.add(nodeId);
    keyToId.set(seed.key, nodeId);
    const pos = posByKey.get(seed.key) || { x: 70, y: 60 };

    const node: WorkflowNode = {
      id: nodeId,
      label: seed.label,
      kind: seed.kind,
      x: pos.x,
      y: pos.y,
    };

    if (seed.kind === 'subagent') {
      const byId = subAgents.find((agent) => agent.id === seed.ref);
      const byName = subAgents.find((agent) => agent.name.toLowerCase() === (seed.ref || seed.label).toLowerCase());
      const localById = localAgents.find((agent) => agent.id === seed.ref);
      const externalById = favoriteExternalAgents.find((agent) => agent.id === seed.ref);
      const match = byId || byName;
      if (match && localById && seed.isAgentIdRef) {
        warnings.push(`Agent id "${seed.ref}" matches both sub-agent and local agent. Preferring sub-agent.`);
      }
      if (match) {
        node.subAgentId = match.id;
        node.label = match.name || seed.label;
      } else if (localById && seed.isAgentIdRef) {
        node.kind = 'local';
        node.localAgentId = localById.id;
        node.localAgentName = localById.name;
        node.localAgentBaseUrl = localById.api_url || undefined;
        node.label = localById.name || seed.label;
      } else if (externalById && seed.isAgentIdRef) {
        node.kind = 'external';
        node.externalAgentId = externalById.id;
        node.label = externalById.name || seed.label;
      } else {
        errors.push(seed.isAgentIdRef
          ? `Agent id "${seed.ref}" is unknown. It must match a sub-agent, local agent, or favorited external agent.`
          : `Sub-agent "${seed.label}" was not matched to an existing sub-agent.`);
      }
    }

    if (seed.kind === 'local') {
      const search = (seed.ref || seed.label).toLowerCase();
      const match = localAgents.find((agent) => agent.id.toLowerCase() === search)
        || localAgents.find((agent) => agent.name.toLowerCase() === search)
        || localAgents.find((agent) => (agent.api_url || '').toLowerCase() === search);
      if (match) {
        node.localAgentId = match.id;
        node.localAgentName = match.name;
        node.localAgentBaseUrl = match.api_url || undefined;
        node.label = match.name || seed.label;
      } else {
        errors.push(`Local agent "${seed.label}" was not matched to an existing local agent.`);
      }
    }

    if (seed.kind === 'external') {
      if (seed.ref === '') {
        errors.push(`External node "${seed.label}" has no external agent id. Use Name@external@agent-id.`);
      } else {
        const favorite = favoriteExternalAgents.find((agent) => agent.id === seed.ref);
        if (!favorite) {
          errors.push(`External agent id "${seed.ref}" is not in favorites. Add it in A2 Registry first.`);
        } else {
          node.externalAgentId = favorite.id;
          node.label = favorite.name || seed.label;
        }
      }
    }

    return node;
  });

  const edges: WorkflowEdge[] = edgeSeeds.map((seed) => ({
    id: `edge-${edgeSeeds.indexOf(seed) + 1}`,
    from: keyToId.get(seed.fromKey) || '',
    to: keyToId.get(seed.toKey) || '',
    mode: seed.mode,
  })).filter((edge) => edge.from !== '' && edge.to !== '');

  if (edgeCounter === 0) {
    warnings.push('No connections found yet.');
  }

  return { nodes, edges, errors, warnings };
}

function uniqueWorkflowNodeId(nodes: WorkflowNode[], preferred: string): string {
  const base = preferred.trim().toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+/, '').replace(/-+$/, '') || 'node';
  const used = new Set(nodes.map((node) => node.id));
  let candidate = base;
  let index = 2;
  while (used.has(candidate)) {
    candidate = `${base}-${index}`;
    index += 1;
  }
  return candidate;
}

function workflowNodeRef(node: WorkflowNode): string {
  if (node.kind === 'subagent') return node.subAgentId || '';
  if (node.kind === 'local') return node.localAgentId || '';
  if (node.kind === 'external') return node.externalAgentId || '';
  return '';
}

function edgeDisplayLabel(edge: WorkflowEdge, nodeMap: Map<string, WorkflowNode>): string {
  const from = nodeMap.get(edge.from)?.label || edge.from;
  const to = nodeMap.get(edge.to)?.label || edge.to;
  return `${from} -> ${to}`;
}

function WorkflowEditView() {
  const navigate = useNavigate();
  const { workflowId } = useParams<{ workflowId: string }>();
  const isNew = !workflowId;

  const [draft, setDraft] = useState<WorkflowDefinition | null>(null);
  const [graphDefinition, setGraphDefinition] = useState('');
  const [subAgents, setSubAgents] = useState<SubAgent[]>([]);
  const [localAgents, setLocalAgents] = useState<LocalDockerAgent[]>([]);
  const [favoriteExternalAgents, setFavoriteExternalAgents] = useState<FavoriteA2AAgent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [selectedSourceNodeId, setSelectedSourceNodeId] = useState<string | null>(null);
  const [activeNodeId, setActiveNodeId] = useState<string | null>(null);
  const [yamlExpanded, setYamlExpanded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const loadWorkflow = async () => {
      if (isNew) {
        const created = createWorkflowTemplate('Custom workflow');
        if (cancelled) return;
        setDraft(created);
        setGraphDefinition(workflowToGraphYaml(created));
        setError(null);
        return;
      }
      const decodedId = decodeURIComponent(workflowId || '').trim();
      try {
        const workflow = await getWorkflowById(decodedId);
        if (cancelled) return;
        if (!workflow) {
          setError('Workflow not found.');
          setDraft(null);
          return;
        }
        const next = workflow.builtIn
          ? { ...duplicateWorkflow(workflow), name: `${workflow.name} (custom)` }
          : cloneWorkflow(workflow);
        setDraft(next);
        setGraphDefinition(workflowToGraphYaml(next));
        setError(null);
        if (workflow.builtIn) {
          setSuccess('Built-in workflow was copied. You can edit and save this custom version.');
        }
      } catch (loadError) {
        if (cancelled) return;
        setError(loadError instanceof Error ? loadError.message : 'Failed to load workflow.');
        setDraft(null);
      }
    };

    void loadWorkflow();

    return () => {
      cancelled = true;
    };
  }, [isNew, workflowId]);

  useEffect(() => {
    void listSubAgents().then(setSubAgents).catch(() => setSubAgents([]));
    void listLocalDockerAgents()
      .then((response) => setLocalAgents(response.agents || []))
      .catch(() => setLocalAgents([]));
    setFavoriteExternalAgents(getStoredFavoriteA2AAgents());
  }, []);

  useEffect(() => {
    const refreshFavorites = () => setFavoriteExternalAgents(getStoredFavoriteA2AAgents());
    window.addEventListener('focus', refreshFavorites);
    window.addEventListener('storage', refreshFavorites);
    return () => {
      window.removeEventListener('focus', refreshFavorites);
      window.removeEventListener('storage', refreshFavorites);
    };
  }, []);

  const parsedGraph = useMemo(
    () => parseGraphDefinition(graphDefinition, subAgents, localAgents, favoriteExternalAgents),
    [graphDefinition, subAgents, localAgents, favoriteExternalAgents],
  );

  const effectiveStopCondition = (parsedGraph.policy?.stopCondition || draft?.policy.stopCondition || 'manual') as WorkflowStopCondition;
  const judgeNodeIdFromYaml = (parsedGraph.policy?.judgeNodeId || '').trim();
  const judgeValidationErrors = useMemo(() => {
    const next: string[] = [];
    if (!draft) {
      return next;
    }
    if (effectiveStopCondition === 'judge') {
      if (!judgeNodeIdFromYaml) {
        next.push('Choose a judge node when stop condition is "judge".');
      } else if (!parsedGraph.nodes.some((node) => node.id === judgeNodeIdFromYaml)) {
        next.push(`policy.judgeNodeId "${judgeNodeIdFromYaml}" does not match any node id.`);
      }
    }
    return next;
  }, [draft, effectiveStopCondition, judgeNodeIdFromYaml, parsedGraph.nodes]);

  const canEdit = !!draft;
  const canBuild = canEdit && parsedGraph.errors.length === 0;
  const canSave = canEdit && parsedGraph.errors.length === 0 && judgeValidationErrors.length === 0;

  const currentGraphWorkflow = (): WorkflowDefinition | null => {
    if (!draft || parsedGraph.errors.length > 0) {
      return null;
    }
    const entryNode = parsedGraph.nodes.find((node) => node.id === (parsedGraph.entryNodeId || draft.entryNodeId))
      || parsedGraph.nodes.find((node) => node.kind === 'user')
      || parsedGraph.nodes[0];
    return {
      ...draft,
      builtIn: false,
      nodes: parsedGraph.nodes.map((node) => ({ ...node })),
      edges: parsedGraph.edges.map((edge) => ({ ...edge })),
      entryNodeId: entryNode?.id || '',
      policy: {
        ...draft.policy,
        ...parsedGraph.policy,
        stopCondition: effectiveStopCondition,
        judgeNodeId: judgeNodeIdFromYaml || undefined,
      },
    };
  };

  const commitGraphWorkflow = (workflow: WorkflowDefinition, message?: string) => {
    setDraft((current) => (current ? { ...current, policy: { ...workflow.policy }, entryNodeId: workflow.entryNodeId } : current));
    setGraphDefinition(workflowToGraphYaml(workflow));
    if (message) {
      setSuccess(message);
    }
    setError(null);
  };

  const handleVisualNodeClick = (node: WorkflowNode) => {
    const base = currentGraphWorkflow();
    if (!base) {
      return;
    }
    if (!selectedSourceNodeId) {
      setSelectedSourceNodeId(node.id);
      setActiveNodeId(node.id);
      setSuccess(`Source selected: ${node.label}. Click another node to connect.`);
      setError(null);
      return;
    }
    if (selectedSourceNodeId === node.id) {
      setSelectedSourceNodeId(null);
      return;
    }

    const duplicate = parsedGraph.edges.some((edge) => edge.from === selectedSourceNodeId && edge.to === node.id);
    if (duplicate) {
      setSelectedSourceNodeId(null);
      setError('That connection already exists.');
      return;
    }

    const nextEdges: WorkflowEdge[] = [
      ...base.edges.map((edge) => ({ ...edge })),
      {
        id: `edge-${base.edges.length + 1}`,
        from: selectedSourceNodeId,
        to: node.id,
        mode: 'sequential',
      },
    ];

    const outgoingCount = nextEdges.filter((edge) => edge.from === selectedSourceNodeId).length;
    if (outgoingCount > 1) {
      for (let i = 0; i < nextEdges.length; i += 1) {
        if (nextEdges[i].from === selectedSourceNodeId) {
          nextEdges[i] = { ...nextEdges[i], mode: 'parallel' };
        }
      }
    }

    commitGraphWorkflow({ ...base, edges: nextEdges }, 'Connection added from visual map.');
    setSelectedSourceNodeId(null);
  };

  const visualNodes = useMemo(() => {
    return parsedGraph.nodes.map((node) => ({
      ...node,
      x: node.x,
      y: node.y,
    }));
  }, [parsedGraph.nodes]);

  const visualNodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    visualNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [visualNodes]);

  const activeNode = useMemo(
    () => visualNodes.find((node) => node.id === activeNodeId) || visualNodes[0] || null,
    [activeNodeId, visualNodes],
  );

  const addNode = (kind: WorkflowNodeKind, label: string, ref = '') => {
    const base = currentGraphWorkflow();
    if (!base) return;
    const nodeId = uniqueWorkflowNodeId(base.nodes, stableNodeIdFromKey(label).replace(/^node-/, '') || kind);
    const index = base.nodes.length;
    const node: WorkflowNode = {
      id: nodeId,
      label,
      kind,
      x: 80 + (index % 4) * 180,
      y: 80 + Math.floor(index / 4) * 120,
    };
    if (kind === 'subagent') {
      node.subAgentId = ref;
      const match = subAgents.find((agent) => agent.id === ref);
      if (match) node.label = match.name;
    }
    if (kind === 'local') {
      node.localAgentId = ref;
      const match = localAgents.find((agent) => agent.id === ref);
      if (match) {
        node.label = match.name;
        node.localAgentName = match.name;
        node.localAgentBaseUrl = match.api_url || undefined;
      }
    }
    if (kind === 'external') {
      node.externalAgentId = ref;
      const match = favoriteExternalAgents.find((agent) => agent.id === ref);
      if (match) {
        node.label = match.name || label;
        node.externalAgentName = match.name;
      }
    }
    setActiveNodeId(node.id);
    commitGraphWorkflow({ ...base, nodes: [...base.nodes, node] }, 'Node added.');
  };

  const updateNode = (nodeId: string, patch: Partial<WorkflowNode>) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    commitGraphWorkflow({
      ...base,
      nodes: base.nodes.map((node) => (node.id === nodeId ? { ...node, ...patch } : node)),
    });
  };

  const changeNodeKind = (nodeId: string, kind: WorkflowNodeKind) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    commitGraphWorkflow({
      ...base,
      nodes: base.nodes.map((node) => {
        if (node.id !== nodeId) return node;
        return {
          id: node.id,
          label: node.label,
          kind,
          x: node.x,
          y: node.y,
        };
      }),
    });
  };

  const deleteNode = (nodeId: string) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    const nextNodes = base.nodes.filter((node) => node.id !== nodeId);
    const nextEdges = base.edges.filter((edge) => edge.from !== nodeId && edge.to !== nodeId);
    const nextEntryNodeId = base.entryNodeId === nodeId ? (nextNodes[0]?.id || '') : base.entryNodeId;
    const nextPolicy = base.policy.judgeNodeId === nodeId ? { ...base.policy, judgeNodeId: undefined } : base.policy;
    setActiveNodeId(nextNodes[0]?.id || null);
    setSelectedSourceNodeId((current) => (current === nodeId ? null : current));
    commitGraphWorkflow({ ...base, nodes: nextNodes, edges: nextEdges, entryNodeId: nextEntryNodeId, policy: nextPolicy }, 'Node removed.');
  };

  const updatePolicy = (patch: Partial<WorkflowDefinition['policy']>) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    commitGraphWorkflow({ ...base, policy: { ...base.policy, ...patch } });
  };

  const updateEdge = (edgeId: string, patch: Partial<WorkflowEdge>) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    commitGraphWorkflow({
      ...base,
      edges: base.edges.map((edge) => (edge.id === edgeId ? { ...edge, ...patch } : edge)),
    });
  };

  const deleteEdge = (edgeId: string) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    commitGraphWorkflow({ ...base, edges: base.edges.filter((edge) => edge.id !== edgeId) }, 'Connection removed.');
  };

  const handleNodeMove = (nodeId: string, x: number, y: number) => {
    const base = currentGraphWorkflow();
    if (!base) return;
    setGraphDefinition(workflowToGraphYaml({
      ...base,
      nodes: base.nodes.map((node) => (node.id === nodeId ? { ...node, x, y } : node)),
    }));
  };

  const handleSave = async () => {
    if (!draft) return;
    if (draft.name.trim() === '') {
      setError('Workflow name is required.');
      return;
    }
    if (parsedGraph.errors.length > 0 || judgeValidationErrors.length > 0) {
      setError('Fix graph syntax errors before saving.');
      return;
    }
    if (parsedGraph.nodes.length === 0) {
      setError('Add at least one node to the workflow.');
      return;
    }

    const entryNode = parsedGraph.nodes.find((node) => node.kind === 'user') || parsedGraph.nodes[0];
    const mergedPolicy = {
      ...draft.policy,
      ...parsedGraph.policy,
      stopCondition: effectiveStopCondition,
      judgeNodeId: judgeNodeIdFromYaml || undefined,
    };

    try {
      await saveWorkflow({
        ...draft,
        builtIn: false,
        nodes: parsedGraph.nodes,
        edges: parsedGraph.edges,
        entryNodeId: parsedGraph.entryNodeId || entryNode?.id || '',
        policy: mergedPolicy,
      });

      setSuccess('Workflow saved.');
      setError(null);
      window.setTimeout(() => navigate('/workflows'), 250);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Failed to save workflow.');
      setSuccess(null);
    }
  };

  const handleCreateEditableCopy = () => {
    if (!draft) return;
    const copy = duplicateWorkflow(draft);
    setDraft(copy);
    setSuccess('Editable copy created.');
    setError(null);
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>{isNew ? 'New Workflow' : 'Edit Workflow'}</h1>
      </div>

      <div className="page-content settings-sections">
        {error ? (
          <div className="error-banner">
            {error}
            <button type="button" className="error-dismiss" onClick={() => setError(null)}>×</button>
          </div>
        ) : null}

        {success ? (
          <div className="success-banner">
            {success}
            <button type="button" className="success-dismiss" onClick={() => setSuccess(null)}>×</button>
          </div>
        ) : null}

        <div className="settings-panel workflows-editor-panel">
          <div className="settings-panel-title-row">
            <h2>{draft?.name || 'Workflow'}</h2>
            <div className="workflows-actions">
              <button type="button" className="settings-remove-btn" onClick={() => navigate('/workflows')}>Back</button>
              {draft?.builtIn ? (
                <button type="button" className="settings-add-btn" onClick={handleCreateEditableCopy}>Create Copy</button>
              ) : null}
              <button type="button" className="settings-save-btn" onClick={() => void handleSave()} disabled={!canSave}>Save</button>
            </div>
          </div>

          {draft ? (
            <>
              {draft.builtIn ? <p className="settings-help">Built-in workflow opened in editable copy mode.</p> : null}

              <div className="workflows-form-grid">
                <label className="settings-field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={draft.name}
                    onChange={(event) => setDraft((current) => (current ? { ...current, name: event.target.value } : current))}
                    disabled={!canEdit}
                  />
                </label>
                <label className="settings-field workflows-description-field">
                  <span>Description</span>
                  <textarea
                    value={draft.description}
                    onChange={(event) => setDraft((current) => (current ? { ...current, description: event.target.value } : current))}
                    disabled={!canEdit}
                    rows={2}
                  />
                </label>
              </div>

              <section className="workflows-block">
                <div className="workflows-block-header">
                  <h3>Visual Builder</h3>
                </div>
                <div className="workflows-graph-split">
                  <div className="workflows-graph-pane workflows-builder-sidebar">
                    <div className="workflows-toolbox">
                      <button type="button" className="settings-add-btn" onClick={() => addNode('user', 'User')} disabled={!canBuild}>User</button>
                      <button type="button" className="settings-add-btn" onClick={() => addNode('main', 'Main agent')} disabled={!canBuild}>Main Agent</button>
                    </div>

                    <label className="settings-field">
                      <span>Add sub-agent</span>
                      <select
                        value=""
                        onChange={(event) => {
                          const id = event.target.value;
                          if (!id) return;
                          const agent = subAgents.find((item) => item.id === id);
                          addNode('subagent', agent?.name || 'Sub-agent', id);
                        }}
                        disabled={!canBuild || subAgents.length === 0}
                      >
                        <option value="">Choose sub-agent...</option>
                        {subAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="settings-field">
                      <span>Add local agent</span>
                      <select
                        value=""
                        onChange={(event) => {
                          const id = event.target.value;
                          if (!id) return;
                          const agent = localAgents.find((item) => item.id === id);
                          addNode('local', agent?.name || 'Local agent', id);
                        }}
                        disabled={!canBuild || localAgents.length === 0}
                      >
                        <option value="">Choose local agent...</option>
                        {localAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name}</option>
                        ))}
                      </select>
                    </label>

                    <label className="settings-field">
                      <span>Add external agent</span>
                      <select
                        value=""
                        onChange={(event) => {
                          const id = event.target.value;
                          if (!id) return;
                          const agent = favoriteExternalAgents.find((item) => item.id === id);
                          addNode('external', agent?.name || 'External agent', id);
                        }}
                        disabled={!canBuild || favoriteExternalAgents.length === 0}
                      >
                        <option value="">Choose favorite...</option>
                        {favoriteExternalAgents.map((agent) => (
                          <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                        ))}
                      </select>
                    </label>

                    <div className="workflows-config-panel">
                      <h4>Workflow Settings</h4>
                      <label className="settings-field">
                        <span>Stop condition</span>
                        <select
                          value={effectiveStopCondition}
                          onChange={(event) => updatePolicy({ stopCondition: event.target.value as WorkflowStopCondition })}
                          disabled={!canBuild}
                        >
                          <option value="manual">Manual stop</option>
                          <option value="max_turns">Max turns</option>
                          <option value="consensus">Consensus reached</option>
                          <option value="judge">Judge decides</option>
                          <option value="timebox">Timebox</option>
                        </select>
                      </label>
                      <label className="settings-field">
                        <span>Max turns</span>
                        <input
                          type="number"
                          min={1}
                          max={200}
                          value={parsedGraph.policy?.maxTurns || draft.policy.maxTurns}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            updatePolicy({ maxTurns: Number.isFinite(parsed) && parsed > 0 ? parsed : 1 });
                          }}
                          disabled={!canBuild}
                        />
                      </label>
                      <label className="settings-field">
                        <span>Timebox minutes</span>
                        <input
                          type="number"
                          min={1}
                          max={720}
                          value={parsedGraph.policy?.timeboxMinutes || draft.policy.timeboxMinutes || 20}
                          onChange={(event) => {
                            const parsed = Number.parseInt(event.target.value, 10);
                            updatePolicy({ timeboxMinutes: Number.isFinite(parsed) && parsed > 0 ? parsed : 20 });
                          }}
                          disabled={!canBuild}
                        />
                      </label>
                      <label className="settings-field">
                        <span>Judge node</span>
                        <select
                          value={judgeNodeIdFromYaml}
                          onChange={(event) => updatePolicy({ judgeNodeId: event.target.value || undefined })}
                          disabled={!canBuild}
                        >
                          <option value="">No judge</option>
                          {visualNodes.map((node) => (
                            <option key={node.id} value={node.id}>{node.label}</option>
                          ))}
                        </select>
                      </label>
                    </div>

                    <div className="workflows-config-panel">
                      <h4>Selected Node</h4>
                      <label className="settings-field">
                        <span>Node</span>
                        <select
                          value={activeNode?.id || ''}
                          onChange={(event) => setActiveNodeId(event.target.value || null)}
                          disabled={!canBuild || visualNodes.length === 0}
                        >
                          {visualNodes.map((node) => (
                            <option key={node.id} value={node.id}>{node.label}</option>
                          ))}
                        </select>
                      </label>
                      {activeNode ? (
                        <>
                          <label className="settings-field">
                            <span>Label</span>
                            <input
                              type="text"
                              value={activeNode.label}
                              onChange={(event) => updateNode(activeNode.id, { label: event.target.value })}
                              disabled={!canBuild}
                            />
                          </label>
                          <label className="settings-field">
                            <span>Type</span>
                            <select
                              value={activeNode.kind}
                              onChange={(event) => changeNodeKind(activeNode.id, event.target.value as WorkflowNodeKind)}
                              disabled={!canBuild}
                            >
                              <option value="user">User</option>
                              <option value="main">Main agent</option>
                              <option value="subagent">Sub-agent</option>
                              <option value="local">Local agent</option>
                              <option value="external">External agent</option>
                            </select>
                          </label>
                          {activeNode.kind === 'subagent' ? (
                            <label className="settings-field">
                              <span>Sub-agent</span>
                              <select
                                value={activeNode.subAgentId || ''}
                                onChange={(event) => {
                                  const agent = subAgents.find((item) => item.id === event.target.value);
                                  updateNode(activeNode.id, { subAgentId: event.target.value, label: agent?.name || activeNode.label });
                                }}
                                disabled={!canBuild}
                              >
                                <option value="">Choose sub-agent...</option>
                                {subAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {activeNode.kind === 'local' ? (
                            <label className="settings-field">
                              <span>Local agent</span>
                              <select
                                value={activeNode.localAgentId || ''}
                                onChange={(event) => {
                                  const agent = localAgents.find((item) => item.id === event.target.value);
                                  updateNode(activeNode.id, {
                                    localAgentId: event.target.value,
                                    localAgentName: agent?.name,
                                    localAgentBaseUrl: agent?.api_url || undefined,
                                    label: agent?.name || activeNode.label,
                                  });
                                }}
                                disabled={!canBuild}
                              >
                                <option value="">Choose local agent...</option>
                                {localAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>{agent.name}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          {activeNode.kind === 'external' ? (
                            <label className="settings-field">
                              <span>External agent</span>
                              <select
                                value={activeNode.externalAgentId || ''}
                                onChange={(event) => {
                                  const agent = favoriteExternalAgents.find((item) => item.id === event.target.value);
                                  updateNode(activeNode.id, {
                                    externalAgentId: event.target.value,
                                    externalAgentName: agent?.name,
                                    label: agent?.name || activeNode.label,
                                  });
                                }}
                                disabled={!canBuild}
                              >
                                <option value="">Choose favorite...</option>
                                {favoriteExternalAgents.map((agent) => (
                                  <option key={agent.id} value={agent.id}>{agent.name || agent.id}</option>
                                ))}
                              </select>
                            </label>
                          ) : null}
                          <label className="settings-field">
                            <span>Node ID</span>
                            <input type="text" value={activeNode.id} disabled />
                          </label>
                          <label className="settings-field">
                            <span>Reference</span>
                            <input type="text" value={workflowNodeRef(activeNode) || 'None'} disabled />
                          </label>
                          <div className="workflows-toolbox">
                            <button type="button" className="settings-remove-btn" onClick={() => deleteNode(activeNode.id)} disabled={!canBuild || visualNodes.length <= 1}>Delete Node</button>
                            <button type="button" className="settings-add-btn" onClick={() => commitGraphWorkflow({ ...(currentGraphWorkflow() || draft), entryNodeId: activeNode.id })} disabled={!canBuild}>Set Entry</button>
                            <button type="button" className="settings-add-btn" onClick={() => updatePolicy({ stopCondition: 'judge', judgeNodeId: activeNode.id })} disabled={!canBuild}>Set Judge</button>
                          </div>
                        </>
                      ) : (
                        <p className="settings-help">Select a node on the map.</p>
                      )}
                    </div>

                    <div className="workflows-config-panel">
                      <h4>Connections</h4>
                      <div className="workflows-edge-list compact">
                        {parsedGraph.edges.map((edge) => (
                          <div className="workflows-edge-row compact" key={edge.id}>
                            <span title={edgeDisplayLabel(edge, visualNodeMap)}>{edgeDisplayLabel(edge, visualNodeMap)}</span>
                            <select value={edge.mode} onChange={(event) => updateEdge(edge.id, { mode: event.target.value as WorkflowEdge['mode'] })} disabled={!canBuild}>
                              <option value="sequential">Sequential</option>
                              <option value="parallel">Parallel</option>
                            </select>
                            <button type="button" className="settings-remove-btn" onClick={() => deleteEdge(edge.id)} disabled={!canBuild}>Remove</button>
                          </div>
                        ))}
                        {parsedGraph.edges.length === 0 ? <p className="settings-help">Click a source node, then a target node to connect them.</p> : null}
                      </div>
                    </div>

                    {parsedGraph.errors.length > 0 ? (
                      <div className="error-banner" style={{ marginTop: 10 }}>
                        {parsedGraph.errors.join(' ')}
                      </div>
                    ) : null}
                    {judgeValidationErrors.length > 0 ? (
                      <div className="error-banner" style={{ marginTop: 10 }}>
                        {judgeValidationErrors.join(' ')}
                      </div>
                    ) : null}
                    {parsedGraph.warnings.length > 0 ? (
                      <div className="success-banner" style={{ marginTop: 10 }}>
                        {parsedGraph.warnings.join(' ')}
                      </div>
                    ) : null}
                  </div>
                  <div className="workflows-graph-pane workflows-map-pane">
                    <div className="workflows-block-header">
                      <h3>Visual Map</h3>
                      <button
                        type="button"
                        className="settings-remove-btn"
                        onClick={() => setSelectedSourceNodeId(null)}
                        disabled={!selectedSourceNodeId}
                      >
                        Clear Selection
                      </button>
                    </div>
                    <p className="settings-help">
                      Drag nodes to arrange the workflow. Click one node, then another node to connect them.
                    </p>
                    <WorkflowGraphCanvas
                      nodes={visualNodes}
                      edges={parsedGraph.edges.filter((edge) => visualNodeMap.has(edge.from) && visualNodeMap.has(edge.to))}
                      nodeKindLabel={kindLabel}
                      canvasWidth={WORKFLOW_EDIT_CANVAS_WIDTH}
                      canvasHeight={WORKFLOW_EDIT_CANVAS_HEIGHT}
                      onNodeClick={canEdit ? handleVisualNodeClick : undefined}
                      onNodeMove={canBuild ? handleNodeMove : undefined}
                      selectedNodeId={selectedSourceNodeId}
                      judgeNodeId={effectiveStopCondition === 'judge' ? judgeNodeIdFromYaml : null}
                      nodeDisplayLabel={(node) => {
                        if (node.kind === 'main') {
                          return withAgentEmoji(node.label, 'main');
                        }
                        if (node.kind === 'subagent') {
                          return withAgentEmoji(node.label, 'subagent', node.subAgentId);
                        }
                        if (node.kind === 'local') {
                          return withAgentEmoji(node.label, 'local', node.localAgentId);
                        }
                        return node.label;
                      }}
                    />
                  </div>
                </div>
              </section>

              <section className="workflows-block">
                <div className="workflows-block-header">
                  <h3>YAML</h3>
                  <button type="button" className="settings-remove-btn" onClick={() => setYamlExpanded((value) => !value)}>
                    {yamlExpanded ? 'Hide YAML' : 'Show YAML'}
                  </button>
                </div>
                <p className="settings-help">
                  The visual builder writes this workflow file: <a href={`/projects/${encodeURIComponent(SYSTEM_SOUL_PROJECT_ID)}?openFile=${encodeURIComponent(getWorkflowFilePath(draft.id))}`}>{getWorkflowFilePath(draft.id)}</a>. You can copy this YAML to share the workflow.
                </p>
                {yamlExpanded ? (
                  <>
                    <p className="settings-help">
                      <a
                        href="https://github.com/A2gent/brute/blob/main/README.md#workflow-definition-yaml-standard"
                        target="_blank"
                        rel="noreferrer"
                      >
                        Workflow YAML format reference
                      </a>
                    </p>
                    <textarea
                      className="mind-session-textarea"
                      rows={16}
                      value={graphDefinition}
                      onChange={(event) => setGraphDefinition(event.target.value)}
                      disabled={!canEdit}
                      spellCheck={false}
                    />
                  </>
                ) : null}
              </section>
            </>
          ) : (
            <p className="settings-help">Workflow not found.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkflowEditView;
