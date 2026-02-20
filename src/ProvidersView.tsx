import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  deleteProvider,
  listProviders,
  setActiveProvider,
  testAllProviders,
  type LLMProviderType,
  type ProviderConfig,
  type ProviderTestResult,
} from './api';

function isFallbackProvider(type: LLMProviderType): boolean {
  return type === 'fallback_chain' || type.startsWith('fallback_chain:');
}

function formatProvider(type: LLMProviderType): string {
  switch (type) {
    case 'lmstudio':
      return 'LM Studio';
    case 'anthropic':
      return 'Anthropic';
    case 'openrouter':
      return 'OpenRouter';
    case 'kimi':
      return 'Kimi';
    case 'google':
      return 'Gemini';
    case 'openai':
      return 'OpenAI';
    case 'automatic_router':
      return 'Automatic Router';
    default:
      return type;
  }
}

function formatNodeLabel(provider: LLMProviderType, model?: string): string {
  const providerLabel = formatProvider(provider);
  const modelLabel = model?.trim();
  return modelLabel ? `${providerLabel} / ${modelLabel}` : providerLabel;
}

interface TestStatus {
  success: boolean | null;
  message: string;
  durationMs: number | null;
  isTesting: boolean;
}

function ProvidersView() {
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTestingAll, setIsTestingAll] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testStatuses, setTestStatuses] = useState<Record<string, TestStatus>>({});

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listProviders();
      setProviders(data);
    } catch (err) {
      console.error('Failed to load providers:', err);
      setError(err instanceof Error ? err.message : 'Failed to load providers');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadProviders();
  }, []);

  const handleSetActive = async (providerType: LLMProviderType) => {
    try {
      setIsSaving(true);
      setError(null);
      const updated = await setActiveProvider(providerType);
      setProviders(updated);
    } catch (err) {
      console.error('Failed to set active provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to set active provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAggregate = async (provider: ProviderConfig) => {
    if (!isFallbackProvider(provider.type)) {
      return;
    }
    if (!confirm(`Delete fallback aggregate "${provider.display_name}"?`)) {
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await deleteProvider(provider.type);
      await loadProviders();
    } catch (err) {
      console.error('Failed to delete provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestAll = async () => {
    try {
      setIsTestingAll(true);
      setError(null);
      // Initialize testing state for all providers
      const initialStatuses: Record<string, TestStatus> = {};
      providers.forEach((p) => {
        if (!isFallbackProvider(p.type) && p.type !== 'automatic_router') {
          initialStatuses[p.type] = {
            success: null,
            message: '',
            durationMs: null,
            isTesting: p.configured,
          };
        }
      });
      setTestStatuses(initialStatuses);

      const response = await testAllProviders();

      // Update statuses with results
      const newStatuses: Record<string, TestStatus> = {};
      response.results.forEach((result: ProviderTestResult) => {
        newStatuses[result.provider] = {
          success: result.success,
          message: result.message,
          durationMs: result.duration_ms,
          isTesting: false,
        };
      });

      // Mark non-tested providers (not configured)
      providers.forEach((p) => {
        if (!isFallbackProvider(p.type) && p.type !== 'automatic_router' && !newStatuses[p.type]) {
          newStatuses[p.type] = {
            success: null,
            message: 'Not configured',
            durationMs: null,
            isTesting: false,
          };
        }
      });

      setTestStatuses(newStatuses);
    } catch (err) {
      console.error('Failed to test providers:', err);
      setError(err instanceof Error ? err.message : 'Failed to test providers');
      // Clear testing state on error
      const clearedStatuses: Record<string, TestStatus> = {};
      providers.forEach((p) => {
        if (!isFallbackProvider(p.type) && p.type !== 'automatic_router') {
          clearedStatuses[p.type] = {
            success: null,
            message: '',
            durationMs: null,
            isTesting: false,
          };
        }
      });
      setTestStatuses(clearedStatuses);
    } finally {
      setIsTestingAll(false);
    }
  };

  const renderTestIndicator = (provider: ProviderConfig) => {
    if (isFallbackProvider(provider.type) || provider.type === 'automatic_router') {
      return null;
    }

    const status = testStatuses[provider.type];
    if (!status) {
      return <span className="provider-test-indicator pending" />;
    }

    if (status.isTesting) {
      return <span className="provider-test-indicator testing" title="Testing..." />;
    }

    if (status.success === null) {
      return <span className="provider-test-indicator pending" title="Not tested" />;
    }

    const durationText = status.durationMs !== null ? ` (${status.durationMs}ms)` : '';
    const title = `${status.success ? 'Success' : 'Failed'}${durationText}: ${status.message}`;

    return (
      <span
        className={`provider-test-indicator ${status.success ? 'success' : 'error'}`}
        title={title}
      />
    );
  };

  const renderTestDuration = (provider: ProviderConfig) => {
    if (isFallbackProvider(provider.type) || provider.type === 'automatic_router') {
      return null;
    }

    const status = testStatuses[provider.type];
    if (!status || status.durationMs === null) {
      return null;
    }

    return <span className="provider-test-duration">{status.durationMs}ms</span>;
  };

  if (isLoading) {
    return <div className="sessions-loading">Loading providers...</div>;
  }

  const automaticRouterProviders = providers.filter((provider) => provider.type === 'automatic_router');
  const chainProviders = providers.filter((provider) => isFallbackProvider(provider.type));
  const regularProviders = providers.filter((provider) => !isFallbackProvider(provider.type) && provider.type !== 'automatic_router');

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>LLM Providers</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow provider-list-view">
        <div className="settings-actions" style={{ marginBottom: '16px' }}>
          <button
            type="button"
            className="settings-add-btn"
            onClick={handleTestAll}
            disabled={isTestingAll}
          >
            {isTestingAll ? 'Testing all...' : 'Test all providers'}
          </button>
        </div>

        <h3>Automatic Router</h3>
        <p className="thinking-note">
          Automatic router is for intent-based model selection: a lightweight router model reads the prompt and your plain-text mapping rules,
          then chooses the best target model (or fallback chain) for the actual response.
        </p>
        {automaticRouterProviders.length === 0 ? (
          <div className="provider-chain-empty">Automatic router is not available.</div>
        ) : null}
        {automaticRouterProviders.map((provider) => {
          const routingRules = provider.router_rules || [];
          const treePaddingY = 12;
          const branchesPaddingY = 6;
          const branchHeight = 44;
          const branchGap = 10;
          const branchAreaHeight = routingRules.length > 0
            ? routingRules.length * branchHeight + (routingRules.length - 1) * branchGap
            : branchHeight;
          const svgHeight = treePaddingY * 2 + branchesPaddingY * 2 + branchAreaHeight;
          const branchCenterY = (index: number) =>
            treePaddingY + branchesPaddingY + (branchHeight / 2) + (index * (branchHeight + branchGap));
          const rootY = routingRules.length > 0
            ? (branchCenterY(0) + branchCenterY(routingRules.length - 1)) / 2
            : svgHeight / 2;

          return (
            <div key={provider.type} className={`provider-list-item ${provider.is_active ? 'active' : ''}`}>
              <div className="provider-list-main">
                <h3>{provider.display_name}</h3>
                <div className="provider-list-meta">
                  <span className={`status-badge ${provider.configured ? 'status-completed' : 'status-paused'}`}>
                    {provider.configured ? 'Configured' : 'Not configured'}
                  </span>
                  {provider.is_active ? <span className="status-badge status-running">Active</span> : null}
                </div>
                <div className="provider-router-tree" aria-label="Automatic routing tree">
                  {routingRules.length > 0 ? (
                    <svg className="provider-router-bezier" viewBox={`0 0 100 ${svgHeight}`} preserveAspectRatio="none" aria-hidden="true">
                      {routingRules.map((_, index) => {
                        const y = branchCenterY(index);
                        return (
                          <path
                            key={`path-${index}`}
                            d={`M 27 ${rootY} C 39 ${rootY}, 47 ${y}, 58 ${y}`}
                            className="provider-router-bezier-path"
                          />
                        );
                      })}
                    </svg>
                  ) : null}
                  <div className="provider-router-root-wrap">
                    <span className="provider-router-root-label">Request router</span>
                    <span className="provider-router-root-node">
                      {formatNodeLabel(provider.router_provider || 'automatic_router', provider.router_model)}
                    </span>
                  </div>
                  <div className="provider-router-branches">
                    {routingRules.length === 0 ? (
                      <div className="provider-chain-empty">No routing rules configured yet</div>
                    ) : (
                      routingRules.map((rule, index) => (
                        <div key={`${rule.match}-${rule.provider}-${rule.model || ''}-${index}`} className="provider-router-branch">
                          <span className="provider-router-rule">Rule: {rule.match}</span>
                          <span className="provider-router-connector" aria-hidden="true" />
                          <span className="provider-router-target">{formatNodeLabel(rule.provider, rule.model)}</span>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>

              <div className="provider-list-actions">
                <Link to={`/providers/${encodeURIComponent(provider.type)}`} className="settings-add-btn">
                  Edit
                </Link>
                <button
                  type="button"
                  className="settings-save-btn"
                  disabled={isSaving || provider.is_active}
                  onClick={() => handleSetActive(provider.type)}
                >
                  Set active
                </button>
              </div>
            </div>
          );
        })}

        <h3>Fallback Chains</h3>
        <div className="settings-actions">
          <Link to="/providers/fallback-aggregates/new" className="settings-add-btn">
          New chain
          </Link>
        </div>

        <p className="thinking-note">
          Fallback chains improve reliability and continuity: if one provider/model fails (rate limit, outage, auth, or transient errors),
          the run automatically continues on the next model in the chain without manual intervention.
        </p>
        {chainProviders.length === 0 ? (
          <div className="provider-chain-empty">No fallback chains yet.</div>
        ) : null}
        {chainProviders.map((provider) => (
          <div key={provider.type} className={`provider-list-item ${provider.is_active ? 'active' : ''}`}>
            <div className="provider-list-main">
              <h3>{provider.display_name}</h3>
              <div className="provider-list-meta">
                {provider.is_active ? <span className="status-badge status-running">Active</span> : null}
                {provider.model ? <span className="session-provider-chip">{provider.model}</span> : null}
              </div>
              {isFallbackProvider(provider.type) ? (
                <div className="provider-chain-visual" aria-label="Fallback chain nodes">
                  {(provider.fallback_chain || []).map((node, index) => (
                    <span key={`${node.provider}-${node.model}-${index}`} className="provider-chain-item-wrap">
                      <span className="provider-chain-node">{formatProvider(node.provider)} / {node.model}</span>
                      {index < (provider.fallback_chain || []).length - 1 ? <span className="provider-chain-arrow">→</span> : null}
                    </span>
                  ))}
                  {(provider.fallback_chain || []).length === 0 ? (
                    <span className="provider-chain-empty">No nodes configured yet</span>
                  ) : null}
                </div>
              ) : null}
            </div>

            <div className="provider-list-actions">
              <Link to={`/providers/${encodeURIComponent(provider.type)}`} className="settings-add-btn">
                Edit
              </Link>
              <button
                type="button"
                className="settings-save-btn"
                disabled={isSaving || provider.is_active}
                onClick={() => handleSetActive(provider.type)}
              >
                Set active
              </button>
              {isFallbackProvider(provider.type) ? (
                <button
                  type="button"
                  className="settings-remove-btn"
                  onClick={() => void handleDeleteAggregate(provider)}
                  disabled={isSaving || provider.is_active}
                >
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        ))}

        <h3>Regular Providers</h3>
        {regularProviders.map((provider) => (
          <div key={provider.type} className={`provider-list-item ${provider.is_active ? 'active' : ''}`}>
            <div className="provider-list-main">
              <div className="provider-list-header">
                {renderTestIndicator(provider)}
                <h3>{provider.display_name}</h3>
                {renderTestDuration(provider)}
              </div>
              <div className="provider-list-meta">
                <span className={`status-badge ${provider.configured ? 'status-completed' : 'status-paused'}`}>
                  {provider.configured ? 'Configured' : 'Not configured'}
                </span>
                {provider.is_active ? <span className="status-badge status-running">Active</span> : null}
                {provider.model ? <span className="session-provider-chip">{provider.model}</span> : null}
              </div>
            </div>

            <div className="provider-list-actions">
              <Link to={`/providers/${encodeURIComponent(provider.type)}`} className="settings-add-btn">
                Edit
              </Link>
              <button
                type="button"
                className="settings-save-btn"
                disabled={isSaving || provider.is_active}
                onClick={() => handleSetActive(provider.type)}
              >
                Set active
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default ProvidersView;
