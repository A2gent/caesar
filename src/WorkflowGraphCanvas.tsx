import { useEffect, useMemo, useRef } from 'react';
import type { WorkflowEdge, WorkflowNode } from './workflows';
import {
  WORKFLOW_CANVAS_HEIGHT,
  WORKFLOW_CANVAS_WIDTH,
  buildWorkflowEdgeCurve,
} from './workflowGraph';

interface WorkflowGraphCanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeKindLabel: (kind: WorkflowNode['kind']) => string;
  nodeDisplayLabel?: (node: WorkflowNode) => string;
  canvasWidth?: number;
  canvasHeight?: number;
  onNodeClick?: (node: WorkflowNode) => void;
  selectedNodeId?: string | null;
  judgeNodeId?: string | null;
}

function drawArrowHead(
  ctx: CanvasRenderingContext2D,
  tipX: number,
  tipY: number,
  fromX: number,
  fromY: number,
  color: string,
) {
  const dx = tipX - fromX;
  const dy = tipY - fromY;
  const angle = Math.atan2(dy, dx);
  const size = 8;
  const spread = Math.PI / 7;
  const x1 = tipX - Math.cos(angle - spread) * size;
  const y1 = tipY - Math.sin(angle - spread) * size;
  const x2 = tipX - Math.cos(angle + spread) * size;
  const y2 = tipY - Math.sin(angle + spread) * size;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}

export default function WorkflowGraphCanvas({
  nodes,
  edges,
  nodeKindLabel,
  nodeDisplayLabel,
  canvasWidth = WORKFLOW_CANVAS_WIDTH,
  canvasHeight = WORKFLOW_CANVAS_HEIGHT,
  onNodeClick,
  selectedNodeId = null,
  judgeNodeId = null,
}: WorkflowGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(canvasWidth * dpr);
    canvas.height = Math.round(canvasHeight * dpr);
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, canvasWidth, canvasHeight);

    const pairCounts = new Map<string, number>();
    edges.forEach((edge) => {
      const key = `${edge.from}->${edge.to}`;
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    });
    const seenPerPair = new Map<string, number>();

    edges.forEach((edge) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) {
        return;
      }
      const key = `${edge.from}->${edge.to}`;
      const count = pairCounts.get(key) || 1;
      const seen = seenPerPair.get(key) || 0;
      seenPerPair.set(key, seen + 1);
      const siblingOffset = seen - (count - 1) / 2;

      const curve = buildWorkflowEdgeCurve(from, to, siblingOffset);
      const color = edge.mode === 'parallel' ? '#2ea043' : '#8b949e';

      ctx.beginPath();
      ctx.setLineDash(edge.mode === 'parallel' ? [6, 4] : []);
      ctx.moveTo(curve.start.x, curve.start.y);
      ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = edge.mode === 'parallel' ? 2.5 : 1.75;
      ctx.stroke();

      drawArrowHead(ctx, curve.end.x, curve.end.y, curve.control.x, curve.control.y, color);
    });
  }, [canvasHeight, canvasWidth, edges, nodeMap]);

  return (
    <div className="workflow-canvas" role="img" aria-label="Workflow map preview">
      <canvas
        ref={canvasRef}
        className="workflow-canvas-lines"
        style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
      />
      {nodes.map((node) => (
        <div
          key={node.id}
          className={`workflow-canvas-node kind-${node.kind}${selectedNodeId === node.id ? ' selected' : ''}${onNodeClick ? ' clickable' : ''}${judgeNodeId === node.id ? ' judge' : ''}`}
          style={{ left: `${node.x}px`, top: `${node.y}px` }}
          onClick={onNodeClick ? () => onNodeClick(node) : undefined}
        >
          <strong>{nodeDisplayLabel ? nodeDisplayLabel(node) : node.label}</strong>
          <small>{nodeKindLabel(node.kind)}</small>
          {judgeNodeId === node.id ? <em className="workflow-canvas-node-badge">Judge</em> : null}
        </div>
      ))}
    </div>
  );
}
