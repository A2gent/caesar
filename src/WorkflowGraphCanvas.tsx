import { useEffect, useMemo, useRef } from 'react';
import type { PointerEvent } from 'react';
import type { MouseEvent } from 'react';
import type { WorkflowEdge, WorkflowNode } from './workflows';
import {
  WORKFLOW_CANVAS_HEIGHT,
  WORKFLOW_CANVAS_WIDTH,
  buildWorkflowEdgeCurve,
  buildWorkflowEdgePath,
} from './workflowGraph';

interface WorkflowGraphCanvasProps {
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
  nodeKindLabel: (kind: WorkflowNode['kind']) => string;
  nodeDisplayLabel?: (node: WorkflowNode) => string;
  canvasWidth?: number;
  canvasHeight?: number;
  onNodeClick?: (node: WorkflowNode, modifiers?: { shiftKey: boolean }) => void;
  onNodeMove?: (nodeId: string, x: number, y: number) => void;
  onEdgeClick?: (edge: WorkflowEdge) => void;
  selectedNodeId?: string | null;
  selectedNodeIds?: string[];
  selectedEdgeId?: string | null;
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

function quadraticPoint(
  start: { x: number; y: number },
  control: { x: number; y: number },
  end: { x: number; y: number },
  t: number,
): { x: number; y: number } {
  const oneMinusT = 1 - t;
  return {
    x: oneMinusT * oneMinusT * start.x + 2 * oneMinusT * t * control.x + t * t * end.x,
    y: oneMinusT * oneMinusT * start.y + 2 * oneMinusT * t * control.y + t * t * end.y,
  };
}

export default function WorkflowGraphCanvas({
  nodes,
  edges,
  nodeKindLabel,
  nodeDisplayLabel,
  canvasWidth = WORKFLOW_CANVAS_WIDTH,
  canvasHeight = WORKFLOW_CANVAS_HEIGHT,
  onNodeClick,
  onNodeMove,
  onEdgeClick,
  selectedNodeId = null,
  selectedNodeIds = [],
  selectedEdgeId = null,
  judgeNodeId = null,
}: WorkflowGraphCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const dragRef = useRef<{
    nodeId: string;
    pointerId: number;
    startClientX: number;
    startClientY: number;
    startX: number;
    startY: number;
    moved: boolean;
    shiftKey: boolean;
  } | null>(null);

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    nodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [nodes]);

  const edgeLayouts = useMemo(() => {
    const pairCounts = new Map<string, number>();
    edges.forEach((edge) => {
      const key = [edge.from, edge.to].sort().join('<->');
      pairCounts.set(key, (pairCounts.get(key) || 0) + 1);
    });

    const seenPerPair = new Map<string, number>();
    return edges.map((edge) => {
      const sortedPair = [edge.from, edge.to].sort();
      const key = sortedPair.join('<->');
      const count = pairCounts.get(key) || 1;
      const seen = seenPerPair.get(key) || 0;
      seenPerPair.set(key, seen + 1);
      const directionSign = edge.from === sortedPair[0] ? 1 : -1;
      return {
        edge,
        siblingOffset: (seen - (count - 1) / 2) * directionSign,
      };
    });
  }, [edges]);

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

    edgeLayouts.forEach(({ edge, siblingOffset }) => {
      const from = nodeMap.get(edge.from);
      const to = nodeMap.get(edge.to);
      if (!from || !to) {
        return;
      }

      const curve = buildWorkflowEdgeCurve(from, to, siblingOffset);
      const isSelected = selectedEdgeId === edge.id;
      const color = isSelected ? '#f2cc60' : edge.mode === 'parallel' ? '#2ea043' : '#8b949e';

      ctx.beginPath();
      ctx.setLineDash(edge.mode === 'parallel' ? [6, 4] : []);
      ctx.moveTo(curve.start.x, curve.start.y);
      ctx.quadraticCurveTo(curve.control.x, curve.control.y, curve.end.x, curve.end.y);
      ctx.strokeStyle = color;
      ctx.lineWidth = isSelected ? 3.25 : edge.mode === 'parallel' ? 2.5 : 1.75;
      ctx.stroke();

      drawArrowHead(ctx, curve.end.x, curve.end.y, curve.control.x, curve.control.y, color);
    });
  }, [canvasHeight, canvasWidth, edgeLayouts, nodeMap, selectedEdgeId]);

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>, node: WorkflowNode) => {
    if (!onNodeMove) {
      return;
    }
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      nodeId: node.id,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      startX: node.x,
      startY: node.y,
      moved: false,
      shiftKey: event.shiftKey,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || !onNodeMove || drag.pointerId !== event.pointerId) {
      return;
    }
    const dx = event.clientX - drag.startClientX;
    const dy = event.clientY - drag.startClientY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      drag.moved = true;
    }
    const nextX = Math.max(8, Math.min(canvasWidth - 140, drag.startX + dx));
    const nextY = Math.max(8, Math.min(canvasHeight - 72, drag.startY + dy));
    onNodeMove(drag.nodeId, Math.round(nextX), Math.round(nextY));
  };

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>, node: WorkflowNode) => {
    const drag = dragRef.current;
    dragRef.current = null;
    if (drag?.pointerId === event.pointerId) {
      try {
        event.currentTarget.releasePointerCapture(event.pointerId);
      } catch {
        // Pointer capture may already be released by the browser.
      }
      if (drag.moved) {
        return;
      }
    }
    if (onNodeClick) {
      onNodeClick(node, { shiftKey: Boolean(drag?.shiftKey || event.shiftKey) });
    }
  };

  return (
    <div className="workflow-canvas" role="img" aria-label="Workflow map preview">
      <canvas
        ref={canvasRef}
        className="workflow-canvas-lines"
        style={{ width: `${canvasWidth}px`, height: `${canvasHeight}px` }}
      />
      <svg
        className="workflow-canvas-edge-actions"
        viewBox={`0 0 ${canvasWidth} ${canvasHeight}`}
        aria-hidden="true"
      >
        {edgeLayouts.map(({ edge, siblingOffset }) => {
          const from = nodeMap.get(edge.from);
          const to = nodeMap.get(edge.to);
          if (!from || !to) {
            return null;
          }
          const curve = buildWorkflowEdgeCurve(from, to, siblingOffset);
          const anchor = quadraticPoint(curve.start, curve.control, curve.end, 0.5);
          const isSelected = selectedEdgeId === edge.id;
          return (
            <g key={edge.id}>
              <path
                className="workflow-canvas-edge-hit"
                d={buildWorkflowEdgePath(from, to, siblingOffset)}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdgeClick?.(edge);
                }}
              />
              <circle
                className={`workflow-canvas-edge-anchor${isSelected ? ' selected' : ''}`}
                cx={anchor.x}
                cy={anchor.y}
                r={5}
                onClick={(event) => {
                  event.stopPropagation();
                  onEdgeClick?.(edge);
                }}
              />
            </g>
          );
        })}
      </svg>
      {nodes.map((node) => {
        const connectionSelectionIndex = selectedNodeIds.indexOf(node.id);
        const isConnectionSelected = connectionSelectionIndex >= 0;
        const isSelected = selectedNodeId === node.id || isConnectionSelected;
        const isReviewLoop = node.kind === 'review_loop';
        const workerLabel = node.workerLabel || node.workerSubAgentId || 'Worker';
        const criticLabel = node.reviewerLabel || node.reviewerSubAgentId || 'Critic';
        return (
        <div
          key={node.id}
          className={`workflow-canvas-node kind-${node.kind}${isSelected ? ' selected' : ''}${isConnectionSelected ? ' connection-selected' : ''}${connectionSelectionIndex === 0 ? ' connection-source' : ''}${connectionSelectionIndex === 1 ? ' connection-target' : ''}${onNodeClick ? ' clickable' : ''}${judgeNodeId === node.id ? ' judge' : ''}`}
          style={{ left: `${node.x}px`, top: `${node.y}px` }}
          onPointerDown={(event) => handlePointerDown(event, node)}
          onPointerMove={handlePointerMove}
          onPointerUp={(event) => handlePointerUp(event, node)}
          onClick={onNodeMove ? undefined : (onNodeClick ? (event: MouseEvent<HTMLDivElement>) => onNodeClick(node, { shiftKey: event.shiftKey }) : undefined)}
        >
          {isConnectionSelected ? (
            <em className="workflow-canvas-connection-badge">
              {connectionSelectionIndex === 0 ? 'From' : 'To'}
            </em>
          ) : null}
          <strong>{nodeDisplayLabel ? nodeDisplayLabel(node) : node.label}</strong>
          <small>{isReviewLoop ? 'Virtual review loop' : nodeKindLabel(node.kind)}</small>
          {isReviewLoop ? (
            <div className="workflow-canvas-loop-agents" aria-hidden="true">
              <span className="workflow-canvas-loop-agent" title={workerLabel}>
                <b>Worker</b>
                <em>{workerLabel}</em>
              </span>
              <span className="workflow-canvas-loop-bridge">↔</span>
              <span className="workflow-canvas-loop-agent" title={criticLabel}>
                <b>Critic</b>
                <em>{criticLabel}</em>
              </span>
            </div>
          ) : null}
          {judgeNodeId === node.id ? <em className="workflow-canvas-node-badge">Judge</em> : null}
        </div>
        );
      })}
    </div>
  );
}
