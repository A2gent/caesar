import type { WorkflowEdge, WorkflowNode } from './workflows';

export const WORKFLOW_CANVAS_WIDTH = 860;
export const WORKFLOW_CANVAS_HEIGHT = 360;
export const WORKFLOW_NODE_WIDTH = 132;
export const WORKFLOW_NODE_HEIGHT = 56;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function computeNodeLevel(nodes: WorkflowNode[], edges: WorkflowEdge[]): Map<string, number> {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map<string, number>();
  const outgoing = new Map<string, string[]>();

  nodes.forEach((node) => {
    incoming.set(node.id, 0);
    outgoing.set(node.id, []);
  });

  edges.forEach((edge) => {
    if (!nodeIds.has(edge.from) || !nodeIds.has(edge.to)) {
      return;
    }
    incoming.set(edge.to, (incoming.get(edge.to) || 0) + 1);
    const next = outgoing.get(edge.from) || [];
    next.push(edge.to);
    outgoing.set(edge.from, next);
  });

  const queue = nodes.filter((node) => (incoming.get(node.id) || 0) === 0).map((node) => node.id);
  const level = new Map<string, number>();
  nodes.forEach((node) => level.set(node.id, 0));

  if (queue.length === 0) {
    nodes.forEach((node, index) => level.set(node.id, index));
    return level;
  }

  while (queue.length > 0) {
    const current = queue.shift() as string;
    const currentLevel = level.get(current) || 0;
    const children = outgoing.get(current) || [];
    children.forEach((child) => {
      level.set(child, Math.max(level.get(child) || 0, currentLevel + 1));
      incoming.set(child, (incoming.get(child) || 0) - 1);
      if ((incoming.get(child) || 0) === 0) {
        queue.push(child);
      }
    });
  }

  return level;
}

export function computeWorkflowGraphLayout(
  nodes: WorkflowNode[],
  edges: WorkflowEdge[],
  width = WORKFLOW_CANVAS_WIDTH,
  height = WORKFLOW_CANVAS_HEIGHT,
): Map<string, { x: number; y: number }> {
  const positions = new Map<string, { x: number; y: number }>();
  if (nodes.length === 0) {
    return positions;
  }

  const level = computeNodeLevel(nodes, edges);
  const maxLevel = nodes.reduce((max, node) => Math.max(max, level.get(node.id) || 0), 0);
  const minX = 14;
  const maxX = Math.max(minX, width - WORKFLOW_NODE_WIDTH - 14);
  const minY = 12;
  const maxY = Math.max(minY, height - WORKFLOW_NODE_HEIGHT - 12);

  const levelGroups = new Map<number, string[]>();
  nodes.forEach((node) => {
    const key = level.get(node.id) || 0;
    const list = levelGroups.get(key) || [];
    list.push(node.id);
    levelGroups.set(key, list);
  });

  const initialTargets = new Map<string, { x: number; y: number }>();
  nodes.forEach((node) => {
    const l = level.get(node.id) || 0;
    const col = maxLevel <= 0 ? 0.5 : l / maxLevel;
    const tx = minX + col * (maxX - minX);
    const group = levelGroups.get(l) || [node.id];
    const idx = Math.max(0, group.indexOf(node.id));
    const ty = group.length <= 1
      ? (minY + maxY) / 2
      : minY + (idx / (group.length - 1)) * (maxY - minY);
    initialTargets.set(node.id, { x: tx, y: ty });
  });

  const indexById = new Map(nodes.map((node, idx) => [node.id, idx]));
  const nodeIds = new Set(nodes.map((node) => node.id));
  const validEdges = edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to));

  const pos = nodes.map((node) => {
    const target = initialTargets.get(node.id) || { x: minX, y: minY };
    const seedX = Number.isFinite(node.x) ? node.x : target.x;
    const seedY = Number.isFinite(node.y) ? node.y : target.y;
    return {
      x: clamp(seedX * 0.35 + target.x * 0.65, minX, maxX),
      y: clamp(seedY * 0.35 + target.y * 0.65, minY, maxY),
    };
  });
  const vel = nodes.map(() => ({ x: 0, y: 0 }));

  const repulsion = 24000;
  const springK = 0.05;
  const xAnchorK = 0.03;
  const yAnchorK = 0.015;
  const damping = 0.84;

  for (let iter = 0; iter < 220; iter += 1) {
    const force = nodes.map(() => ({ x: 0, y: 0 }));

    for (let i = 0; i < nodes.length; i += 1) {
      for (let j = i + 1; j < nodes.length; j += 1) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const dist2 = Math.max(1, dx * dx + dy * dy);
        const dist = Math.sqrt(dist2);
        const scale = repulsion / dist2;
        const fx = (dx / dist) * scale;
        const fy = (dy / dist) * scale;
        force[i].x += fx;
        force[i].y += fy;
        force[j].x -= fx;
        force[j].y -= fy;
      }
    }

    validEdges.forEach((edge) => {
      const fromIndex = indexById.get(edge.from);
      const toIndex = indexById.get(edge.to);
      if (fromIndex == null || toIndex == null) {
        return;
      }
      const dx = pos[toIndex].x - pos[fromIndex].x;
      const dy = pos[toIndex].y - pos[fromIndex].y;
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy));
      const levelGap = Math.max(1, (level.get(edge.to) || 0) - (level.get(edge.from) || 0));
      const ideal = 120 + levelGap * 35;
      const stretch = (dist - ideal) * springK;
      const fx = (dx / dist) * stretch;
      const fy = (dy / dist) * stretch;
      force[fromIndex].x += fx;
      force[fromIndex].y += fy;
      force[toIndex].x -= fx;
      force[toIndex].y -= fy;

      const directionalBias = (dx - 96) * 0.015;
      force[fromIndex].x += directionalBias;
      force[toIndex].x -= directionalBias;
    });

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    nodes.forEach((node, idx) => {
      const target = initialTargets.get(node.id) || { x: centerX, y: centerY };
      force[idx].x += (target.x - pos[idx].x) * xAnchorK;
      force[idx].y += (target.y - pos[idx].y) * yAnchorK;
      force[idx].x += (centerX - pos[idx].x) * 0.002;
      force[idx].y += (centerY - pos[idx].y) * 0.002;

      vel[idx].x = (vel[idx].x + force[idx].x * 0.12) * damping;
      vel[idx].y = (vel[idx].y + force[idx].y * 0.12) * damping;
      pos[idx].x = clamp(pos[idx].x + vel[idx].x, minX, maxX);
      pos[idx].y = clamp(pos[idx].y + vel[idx].y, minY, maxY);
    });
  }

  nodes.forEach((node, idx) => {
    positions.set(node.id, {
      x: Math.round(pos[idx].x),
      y: Math.round(pos[idx].y),
    });
  });

  return positions;
}

function nodeBoundaryPoint(fromX: number, fromY: number, toX: number, toY: number): { x: number; y: number } {
  const centerX = fromX + WORKFLOW_NODE_WIDTH / 2;
  const centerY = fromY + WORKFLOW_NODE_HEIGHT / 2;
  const dx = toX - fromX;
  const dy = toY - fromY;
  const length = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const ux = dx / length;
  const uy = dy / length;
  const rx = WORKFLOW_NODE_WIDTH / 2;
  const ry = WORKFLOW_NODE_HEIGHT / 2;
  const scale = 1 / Math.max(Math.abs(ux) / rx, Math.abs(uy) / ry);
  return {
    x: centerX + ux * scale,
    y: centerY + uy * scale,
  };
}

export function buildWorkflowEdgePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
  siblingOffset = 0,
): string {
  const fromCenterX = from.x + WORKFLOW_NODE_WIDTH / 2;
  const fromCenterY = from.y + WORKFLOW_NODE_HEIGHT / 2;
  const toCenterX = to.x + WORKFLOW_NODE_WIDTH / 2;
  const toCenterY = to.y + WORKFLOW_NODE_HEIGHT / 2;

  const start = nodeBoundaryPoint(from.x, from.y, toCenterX, toCenterY);
  const end = nodeBoundaryPoint(to.x, to.y, fromCenterX, fromCenterY);

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const curve = siblingOffset * 22;
  const controlX = midX + normalX * curve;
  const controlY = midY + normalY * curve;

  return `M ${start.x} ${start.y} Q ${controlX} ${controlY} ${end.x} ${end.y}`;
}

export function buildWorkflowEdgeCurve(
  from: { x: number; y: number },
  to: { x: number; y: number },
  siblingOffset = 0,
): { start: { x: number; y: number }; control: { x: number; y: number }; end: { x: number; y: number } } {
  const fromCenterX = from.x + WORKFLOW_NODE_WIDTH / 2;
  const fromCenterY = from.y + WORKFLOW_NODE_HEIGHT / 2;
  const toCenterX = to.x + WORKFLOW_NODE_WIDTH / 2;
  const toCenterY = to.y + WORKFLOW_NODE_HEIGHT / 2;

  const start = nodeBoundaryPoint(from.x, from.y, toCenterX, toCenterY);
  const end = nodeBoundaryPoint(to.x, to.y, fromCenterX, fromCenterY);

  const midX = (start.x + end.x) / 2;
  const midY = (start.y + end.y) / 2;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const distance = Math.max(1, Math.sqrt(dx * dx + dy * dy));
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const curve = siblingOffset * 22;
  const control = {
    x: midX + normalX * curve,
    y: midY + normalY * curve,
  };

  return { start, control, end };
}
