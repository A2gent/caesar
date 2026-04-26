import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  DEFAULT_WORKFLOW_ID,
  deleteWorkflow,
  listWorkflows,
  type WorkflowDefinition,
  type WorkflowNode,
} from './workflows';
import { withAgentEmoji } from './agentVisuals';
import {
  computeWorkflowGraphLayout,
  WORKFLOW_CANVAS_HEIGHT,
  WORKFLOW_CANVAS_WIDTH,
} from './workflowGraph';
import WorkflowGraphCanvas from './WorkflowGraphCanvas';

function kindLabel(kind: WorkflowNode['kind']): string {
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
    case 'review_loop':
      return 'Review loop';
    default:
      return kind;
  }
}

function WorkflowsView() {
  const navigate = useNavigate();
  const [workflows, setWorkflows] = useState<WorkflowDefinition[]>([]);
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string>(DEFAULT_WORKFLOW_ID);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const loadWorkflows = async () => {
    try {
      const items = await listWorkflows();
      setWorkflows(items);
      if (items.some((workflow) => workflow.id === selectedWorkflowId)) {
        return;
      }
      setSelectedWorkflowId(items[0]?.id || DEFAULT_WORKFLOW_ID);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Failed to load workflows');
    }
  };

  useEffect(() => {
    void loadWorkflows();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedWorkflow = useMemo(
    () => workflows.find((item) => item.id === selectedWorkflowId) || null,
    [workflows, selectedWorkflowId],
  );

  const visualNodes = useMemo(() => {
    if (!selectedWorkflow) {
      return [];
    }
    const layout = computeWorkflowGraphLayout(
      selectedWorkflow.nodes,
      selectedWorkflow.edges,
      WORKFLOW_CANVAS_WIDTH,
      WORKFLOW_CANVAS_HEIGHT,
    );
    return selectedWorkflow.nodes.map((node) => ({
      ...node,
      x: layout.get(node.id)?.x ?? node.x,
      y: layout.get(node.id)?.y ?? node.y,
    }));
  }, [selectedWorkflow]);

  const nodeMap = useMemo(() => {
    const map = new Map<string, WorkflowNode>();
    visualNodes.forEach((node) => map.set(node.id, node));
    return map;
  }, [visualNodes]);

  const handleDelete = async (workflow: WorkflowDefinition) => {
    if (workflow.builtIn) {
      return;
    }
    if (!confirm(`Delete workflow "${workflow.name}"?`)) {
      return;
    }
    try {
      await deleteWorkflow(workflow.id);
      setSuccess('Workflow deleted.');
      setError(null);
      await loadWorkflows();
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'Failed to delete workflow');
      setSuccess(null);
    }
  };

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Workflows</h1>
      </div>

      <div className="page-content settings-sections workflows-layout">
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

        <div className="settings-panel workflows-list-panel">
          <div className="settings-panel-title-row">
            <h2>Workflow List</h2>
            <button type="button" className="settings-add-btn" onClick={() => navigate('/workflows/new')}>New</button>
          </div>

          <div className="workflows-list">
            {workflows.map((workflow) => (
              <div
                key={workflow.id}
                className={`workflows-list-item ${selectedWorkflowId === workflow.id ? 'active' : ''}`}
              >
                <button
                  type="button"
                  className="workflows-list-item-main"
                  onClick={() => setSelectedWorkflowId(workflow.id)}
                >
                  <div className="workflows-list-title">{workflow.name}</div>
                  <div className="workflows-list-meta">
                    <span>{workflow.builtIn ? 'Built-in' : 'Custom'}</span>
                    <span>{workflow.nodes.length} node{workflow.nodes.length === 1 ? '' : 's'}</span>
                  </div>
                </button>
                <div className="workflows-row-actions">
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={() => navigate(`/workflows/${encodeURIComponent(workflow.id)}/edit`)}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="settings-remove-btn"
                    onClick={() => void handleDelete(workflow)}
                    disabled={workflow.builtIn}
                    title={workflow.builtIn ? 'Built-in workflows cannot be deleted' : 'Delete workflow'}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="settings-panel workflows-editor-panel">
          {selectedWorkflow ? (
            <>
              <div className="settings-panel-title-row">
                <h2>{selectedWorkflow.name}</h2>
              </div>
              <p className="settings-help">{selectedWorkflow.description || 'No description.'}</p>
              <p className="settings-help">
                Stop: <strong>{selectedWorkflow.policy.stopCondition}</strong> · Max turns: <strong>{selectedWorkflow.policy.maxTurns}</strong>
                {selectedWorkflow.policy.timeboxMinutes ? <> · Timebox: <strong>{selectedWorkflow.policy.timeboxMinutes} min</strong></> : null}
              </p>

              <section className="workflows-block">
                <div className="workflows-block-header">
                  <h3>Visual Map</h3>
                </div>
                <WorkflowGraphCanvas
                  nodes={visualNodes}
                  edges={selectedWorkflow.edges.filter((edge) => nodeMap.has(edge.from) && nodeMap.has(edge.to))}
                  nodeKindLabel={kindLabel}
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
                    if (node.kind === 'review_loop') {
                      return `↻ ${node.label}`;
                    }
                    return node.label;
                  }}
                />
              </section>
            </>
          ) : (
            <p className="settings-help">Select a workflow to preview it.</p>
          )}
        </div>
      </div>
    </div>
  );
}

export default WorkflowsView;
