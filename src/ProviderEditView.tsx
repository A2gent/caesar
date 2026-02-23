import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  deleteProvider,
  listGoogleModels,
  listKimiModels,
  listLMStudioModels,
  listOpenAIModels,
  listOpenAICodexModels,
  listOpenRouterModels,
  listAnthropicModels,
  listProviders,
  setActiveProvider,
  updateProvider,
  startAnthropicOAuth,
  completeAnthropicOAuth,
  getAnthropicOAuthStatus,
  disconnectAnthropicOAuth,
  importOpenAICodexOAuth,
  getOpenAICodexOAuthStatus,
  disconnectOpenAICodexOAuth,
  testProvider,
  type FallbackChainNode,
  type LLMProviderType,
  type ProviderConfig,
  type RouterRule,
} from './api';

function isFallbackProvider(type?: string): boolean {
  if (!type) {
    return false;
  }
  return type === 'fallback_chain' || type.startsWith('fallback_chain:');
}

function isModelQueryableProvider(type: LLMProviderType): boolean {
  return type === 'lmstudio' || type === 'kimi' || type === 'google' || type === 'openai' || type === 'openai_codex' || type === 'openrouter' || type === 'anthropic';
}

function ProviderEditView() {
  const { providerType: providerTypeParam } = useParams<{ providerType: LLMProviderType }>();
  const providerType = providerTypeParam ? decodeURIComponent(providerTypeParam) : undefined;
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);

  const [fallbackChain, setFallbackChain] = useState<FallbackChainNode[]>([]);
  const [fallbackName, setFallbackName] = useState('');
  const [candidateNode, setCandidateNode] = useState<LLMProviderType>('openai');
  const [candidateNodeModel, setCandidateNodeModel] = useState('');
  const [candidateNodeModels, setCandidateNodeModels] = useState<string[]>([]);
  const [isLoadingCandidateNodeModels, setIsLoadingCandidateNodeModels] = useState(false);

  const [routerProvider, setRouterProvider] = useState<LLMProviderType>('');
  const [routerModel, setRouterModel] = useState('');
  const [routerProviderModels, setRouterProviderModels] = useState<string[]>([]);
  const [isLoadingRouterModels, setIsLoadingRouterModels] = useState(false);
  const [routingRules, setRoutingRules] = useState<RouterRule[]>([]);
  const [routingMatch, setRoutingMatch] = useState('');
  const [routingTargetProvider, setRoutingTargetProvider] = useState<LLMProviderType>('');
  const [routingTargetModel, setRoutingTargetModel] = useState('');
  const [routingTargetModels, setRoutingTargetModels] = useState<string[]>([]);
  const [isLoadingRoutingTargetModels, setIsLoadingRoutingTargetModels] = useState(false);

  // Anthropic OAuth state
  const [oauthEnabled, setOAuthEnabled] = useState(false);
  const [oauthExpiresAt, setOAuthExpiresAt] = useState<number | null>(null);
  const [oauthAuthCode, setOAuthAuthCode] = useState('');
  const [oauthVerifier, setOAuthVerifier] = useState('');
  const [isOAuthFlow, setIsOAuthFlow] = useState(false);
  const [codexOAuthEnabled, setCodexOAuthEnabled] = useState(false);
  const [codexOAuthExpiresAt, setCodexOAuthExpiresAt] = useState<number | null>(null);

  const selected = useMemo(
    () => providers.find((provider) => provider.type === providerType),
    [providers, providerType],
  );

  const isAutomaticRouter = selected?.type === 'automatic_router';
  const isLMStudio = selected?.type === 'lmstudio';
  const isKimi = selected?.type === 'kimi';
  const isGoogle = selected?.type === 'google';
  const isOpenAI = selected?.type === 'openai';
  const isOpenAICodex = selected?.type === 'openai_codex';
  const isOpenRouter = selected?.type === 'openrouter';
  const isAnthropic = selected?.type === 'anthropic';
  const isFallback = isFallbackProvider(selected?.type);
  const isNamedFallbackAggregate = selected?.type ? selected.type.startsWith('fallback_chain:') : false;

  const nonAggregateProviders = useMemo(
    () => providers.filter((provider) => !isFallbackProvider(provider.type) && provider.type !== 'automatic_router'),
    [providers],
  );

  const eligibleTargetProviders = useMemo(
    () => providers.filter((provider) => provider.type !== 'automatic_router'),
    [providers],
  );

  const loadProviderModels = async (provider: ProviderConfig | undefined): Promise<string[]> => {
    if (!provider) {
      return [];
    }
    const options = new Set<string>();
    [provider.model, provider.default_model]
      .map((value) => value.trim())
      .filter((value) => value !== '')
      .forEach((value) => options.add(value));

    try {
      if (provider.type === 'lmstudio') {
        (await listLMStudioModels(provider.base_url)).forEach((name) => options.add(name));
      } else if (provider.type === 'kimi') {
        (await listKimiModels(provider.base_url)).forEach((name) => options.add(name));
      } else if (provider.type === 'google') {
        (await listGoogleModels(provider.base_url)).forEach((name) => options.add(name));
      } else if (provider.type === 'openai') {
        (await listOpenAIModels(provider.base_url)).forEach((name) => options.add(name));
      } else if (provider.type === 'openai_codex') {
        (await listOpenAICodexModels(provider.base_url)).forEach((name) => options.add(name));
      } else if (provider.type === 'openrouter') {
        (await listOpenRouterModels(provider.base_url)).forEach((name) => options.add(name));
      } else if (provider.type === 'anthropic') {
        (await listAnthropicModels()).forEach((name) => options.add(name));
      }
    } catch {
      // Keep saved/default options when model querying fails.
    }

    return Array.from(options).sort((a, b) => a.localeCompare(b));
  };

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

  // Load OAuth status for OAuth-capable providers
  useEffect(() => {
    if (selected?.type !== 'anthropic' && selected?.type !== 'openai_codex') return;

    let canceled = false;
    if (selected.type === 'anthropic') {
      void getAnthropicOAuthStatus()
        .then((status) => {
          if (canceled) return;
          setOAuthEnabled(status.enabled);
          setOAuthExpiresAt(status.expires_at || null);
        })
        .catch((err) => {
          console.error('Failed to load OAuth status:', err);
        });
    } else {
      void getOpenAICodexOAuthStatus()
        .then((status) => {
          if (canceled) return;
          setCodexOAuthEnabled(status.enabled);
          setCodexOAuthExpiresAt(status.expires_at || null);
        })
        .catch((err) => {
          console.error('Failed to load Codex OAuth status:', err);
        });
    }

    return () => {
      canceled = true;
    };
  }, [selected]);

  useEffect(() => {
    if (!selected) return;

    if (isFallbackProvider(selected.type)) {
      const initialChain = (selected.fallback_chain || []).filter((node) => node.provider !== 'fallback_chain');
      setFallbackChain(initialChain);
      setFallbackName(selected.display_name || '');
      const firstCandidate = nonAggregateProviders.find((provider) => provider.configured)?.type || nonAggregateProviders[0]?.type || 'openai';
      setCandidateNode(firstCandidate);
      const provider = nonAggregateProviders.find((item) => item.type === firstCandidate);
      setCandidateNodeModel(provider?.model || provider?.default_model || '');
      setApiKey('');
      setBaseURL('');
      setModel('');
      setAvailableModels([]);
      setModelsError(null);
      setIsLoadingModels(false);
      return;
    }

    if (selected.type === 'automatic_router') {
      const firstRouterProvider = eligibleTargetProviders.find((provider) => provider.configured)?.type || eligibleTargetProviders[0]?.type || '';
      const configuredRouterProvider = selected.router_provider && selected.router_provider.trim() !== '' ? selected.router_provider : firstRouterProvider;
      setRouterProvider(configuredRouterProvider);
      setRouterModel(selected.router_model || '');
      setRoutingRules(selected.router_rules || []);
      const firstTarget = eligibleTargetProviders.find((provider) => provider.configured)?.type || eligibleTargetProviders[0]?.type || '';
      setRoutingTargetProvider(firstTarget);
      setRoutingTargetModel('');
      setRoutingMatch('');
      setApiKey('');
      setBaseURL('');
      setModel('');
      setAvailableModels([]);
      setModelsError(null);
      return;
    }

    setApiKey('');
    let initialBaseURL = selected.base_url || selected.default_url || '';
    if (selected.type === 'openai_codex' && initialBaseURL.toLowerCase().includes('api.openai.com')) {
      initialBaseURL = selected.default_url || initialBaseURL;
    }
    setBaseURL(initialBaseURL);
    setModel(selected.model || selected.default_model || '');
    setAvailableModels([]);
    setModelsError(null);

    if (!isModelQueryableProvider(selected.type)) return;

    let canceled = false;
    setIsLoadingModels(true);
    void loadProviderModels(selected)
      .then((models) => {
        if (canceled) return;
        setAvailableModels(models);
      })
      .catch((err) => {
        if (canceled) return;
        console.error(`Failed to load ${selected.type} models:`, err);
        setModelsError(err instanceof Error ? err.message : 'Failed to load models');
      })
      .finally(() => {
        if (canceled) return;
        setIsLoadingModels(false);
      });

    return () => {
      canceled = true;
    };
  }, [selected, nonAggregateProviders, eligibleTargetProviders]);

  const loadCandidateNodeModels = async (providerTypeValue: LLMProviderType) => {
    const provider = nonAggregateProviders.find((item) => item.type === providerTypeValue);
    if (!provider) {
      setCandidateNodeModels([]);
      setCandidateNodeModel('');
      return;
    }

    setIsLoadingCandidateNodeModels(true);
    const options = await loadProviderModels(provider);
    setIsLoadingCandidateNodeModels(false);
    setCandidateNodeModels(options);
    setCandidateNodeModel((current) => (current.trim() !== '' && options.includes(current.trim()) ? current.trim() : (options[0] || '')));
  };

  useEffect(() => {
    if (!isFallback || candidateNode.trim() === '') {
      return;
    }
    void loadCandidateNodeModels(candidateNode);
  }, [isFallback, candidateNode, nonAggregateProviders]);

  useEffect(() => {
    if (!isAutomaticRouter || routerProvider.trim() === '') {
      return;
    }
    const provider = eligibleTargetProviders.find((item) => item.type === routerProvider);
    if (!provider || isFallbackProvider(provider.type)) {
      setRouterProviderModels([]);
      setRouterModel('');
      return;
    }

    let canceled = false;
    setIsLoadingRouterModels(true);
    void loadProviderModels(provider)
      .then((options) => {
        if (canceled) return;
        setRouterProviderModels(options);
        setRouterModel((current) => (current.trim() !== '' ? current.trim() : (options[0] || provider.model || provider.default_model || '')));
      })
      .finally(() => {
        if (canceled) return;
        setIsLoadingRouterModels(false);
      });

    return () => {
      canceled = true;
    };
  }, [isAutomaticRouter, routerProvider, eligibleTargetProviders]);

  useEffect(() => {
    if (!isAutomaticRouter || routingTargetProvider.trim() === '') {
      return;
    }
    const provider = eligibleTargetProviders.find((item) => item.type === routingTargetProvider);
    if (!provider || isFallbackProvider(provider.type)) {
      setRoutingTargetModels([]);
      setRoutingTargetModel('');
      return;
    }

    let canceled = false;
    setIsLoadingRoutingTargetModels(true);
    void loadProviderModels(provider)
      .then((options) => {
        if (canceled) return;
        setRoutingTargetModels(options);
        setRoutingTargetModel((current) => (current.trim() !== '' ? current.trim() : (options[0] || provider.model || provider.default_model || '')));
      })
      .finally(() => {
        if (canceled) return;
        setIsLoadingRoutingTargetModels(false);
      });

    return () => {
      canceled = true;
    };
  }, [isAutomaticRouter, routingTargetProvider, eligibleTargetProviders]);

  const handleQueryModels = async () => {
    if (!selected || !isModelQueryableProvider(selected.type)) {
      return;
    }
    const providerForQuery: ProviderConfig = {
      ...selected,
      base_url: baseURL,
    };
    try {
      setIsLoadingModels(true);
      setModelsError(null);
      const models = await loadProviderModels(providerForQuery);
      setAvailableModels(models);
    } catch (err) {
      console.error(`Failed to load ${selected.type} models:`, err);
      setModelsError(err instanceof Error ? err.message : 'Failed to load models');
    } finally {
      setIsLoadingModels(false);
    }
  };

  const handleSave = async () => {
    if (!providerType) return;

    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);

      const payload = isFallback
        ? {
            name: isNamedFallbackAggregate ? fallbackName.trim() : undefined,
            fallback_chain: fallbackChain,
          }
        : isAutomaticRouter
          ? {
              router_provider: routerProvider,
              router_model: isFallbackProvider(routerProvider) ? '' : routerModel.trim(),
              router_rules: routingRules.map((rule) => ({
                match: rule.match.trim(),
                provider: rule.provider,
                model: isFallbackProvider(rule.provider) ? '' : (rule.model || '').trim(),
              })),
            }
          : {
              api_key: apiKey.trim() === '' ? undefined : apiKey.trim(),
              base_url: baseURL.trim(),
              model: model.trim(),
            };

      const updated = await updateProvider(providerType, payload);
      setProviders(updated);
      setApiKey('');
      setSuccess(isFallback ? 'Fallback chain updated.' : isAutomaticRouter ? 'Automatic router updated.' : 'Provider updated.');
    } catch (err) {
      console.error('Failed to update provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFallbackNode = () => {
    const candidate = nonAggregateProviders.find((provider) => provider.type === candidateNode);
    if (!candidate?.configured) {
      return;
    }
    const modelForNode = candidateNodeModel.trim();
    if (modelForNode === '') {
      return;
    }
    if (fallbackChain.some((node) => node.provider === candidateNode && node.model === modelForNode)) {
      return;
    }
    setFallbackChain((prev) => [...prev, { provider: candidateNode, model: modelForNode }]);
  };

  const handleAddRoutingRule = () => {
    const match = routingMatch.trim();
    if (match === '' || routingTargetProvider.trim() === '') {
      return;
    }
    const targetIsFallback = isFallbackProvider(routingTargetProvider);
    const nextModel = targetIsFallback ? '' : routingTargetModel.trim();
    if (!targetIsFallback && nextModel === '') {
      return;
    }
    setRoutingRules((prev) => [
      ...prev,
      {
        match,
        provider: routingTargetProvider,
        model: nextModel,
      },
    ]);
    setRoutingMatch('');
  };

  const handleSetActive = async () => {
    if (!providerType) return;
    try {
      setIsSaving(true);
      setError(null);
      setSuccess(null);
      const updated = await setActiveProvider(providerType);
      setProviders(updated);
      setSuccess('Provider is now active.');
    } catch (err) {
      console.error('Failed to set active provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to set active provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteAggregate = async () => {
    if (!selected || !isFallbackProvider(selected.type)) {
      return;
    }
    if (!confirm(`Delete fallback aggregate "${selected.display_name}"?`)) {
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await deleteProvider(selected.type);
      window.location.href = '/providers';
    } catch (err) {
      console.error('Failed to delete provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to delete provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleStartOAuth = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const result = await startAnthropicOAuth();
      setOAuthVerifier(result.verifier);
      setIsOAuthFlow(true);
      // Open OAuth URL in new window
      window.open(result.auth_url, '_blank');
      setSuccess('Authorization page opened. After approving, paste the code below.');
    } catch (err) {
      console.error('Failed to start OAuth:', err);
      setError(err instanceof Error ? err.message : 'Failed to start OAuth');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCompleteOAuth = async () => {
    if (!oauthAuthCode.trim()) {
      setError('Please paste the authorization code');
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await completeAnthropicOAuth(oauthAuthCode.trim(), oauthVerifier);
      setSuccess('OAuth connected successfully! Free API access enabled.');
      setIsOAuthFlow(false);
      setOAuthAuthCode('');
      setOAuthVerifier('');
      // Reload OAuth status
      const status = await getAnthropicOAuthStatus();
      setOAuthEnabled(status.enabled);
      setOAuthExpiresAt(status.expires_at || null);
    } catch (err) {
      console.error('Failed to complete OAuth:', err);
      setError(err instanceof Error ? err.message : 'Failed to complete OAuth');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnectOAuth = async () => {
    if (!confirm('Disconnect OAuth? You will need to use API key instead.')) {
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await disconnectAnthropicOAuth();
      setOAuthEnabled(false);
      setOAuthExpiresAt(null);
      setSuccess('OAuth disconnected. Use API key for authentication.');
    } catch (err) {
      console.error('Failed to disconnect OAuth:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect OAuth');
    } finally {
      setIsSaving(false);
    }
  };

  const handleImportCodexOAuth = async () => {
    try {
      setIsSaving(true);
      setError(null);
      const result = await importOpenAICodexOAuth();
      setCodexOAuthEnabled(true);
      setCodexOAuthExpiresAt(result.expires_at || null);
      setSuccess(`Codex OAuth imported from ${result.path}`);
    } catch (err) {
      console.error('Failed to import Codex OAuth:', err);
      setError(err instanceof Error ? err.message : 'Failed to import Codex OAuth');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDisconnectCodexOAuth = async () => {
    if (!confirm('Disconnect Codex OAuth? You will need to use API key instead.')) {
      return;
    }
    try {
      setIsSaving(true);
      setError(null);
      await disconnectOpenAICodexOAuth();
      setCodexOAuthEnabled(false);
      setCodexOAuthExpiresAt(null);
      setSuccess('Codex OAuth disconnected. Use API key for authentication.');
    } catch (err) {
      console.error('Failed to disconnect Codex OAuth:', err);
      setError(err instanceof Error ? err.message : 'Failed to disconnect Codex OAuth');
    } finally {
      setIsSaving(false);
    }
  };

  const handleTest = async () => {
    if (!providerType) return;
    try {
      setIsTesting(true);
      setError(null);
      setSuccess(null);
      const result = await testProvider(providerType);
      setSuccess(result.message);
    } catch (err) {
      console.error('Failed to test provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to test provider');
    } finally {
      setIsTesting(false);
    }
  };

  if (isLoading) {
    return <div className="sessions-loading">Loading provider...</div>;
  }

  if (!selected) {
    return (
      <div className="page-shell">
        <div className="page-content page-content-narrow settings-sections">
          <div className="job-detail-error">
            Provider not found.
            <div className="settings-actions">
              <Link to="/providers" className="settings-add-btn">Back to providers</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>{selected.display_name}</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow settings-sections">
        <div className="settings-panel provider-edit-panel">
          <div className="provider-edit-top">
            <Link to="/providers" className="settings-add-btn">Back</Link>
            <div className="provider-list-meta">
              <span className={`status-badge ${selected.configured ? 'status-completed' : 'status-paused'}`}>
                {selected.configured ? 'Configured' : 'Not configured'}
              </span>
              {selected.is_active ? <span className="status-badge status-running">Active</span> : null}
            </div>
          </div>

          {/* Anthropic: OAuth or API key */}
          {isAnthropic && !isFallback && !isAutomaticRouter ? (
            <div className="settings-field">
              <span>Authentication method</span>
              {oauthEnabled ? (
                <div className="provider-oauth-status">
                  <div className="provider-oauth-status-row">
                    <span className="status-badge status-completed">✓ OAuth Connected (Free API)</span>
                    <button
                      type="button"
                      className="settings-remove-btn"
                      onClick={handleDisconnectOAuth}
                      disabled={isSaving}
                    >
                      Disconnect
                    </button>
                  </div>
                  {oauthExpiresAt ? (() => {
                    const isExpired = Date.now() / 1000 > oauthExpiresAt;
                    return (
                      <span className="thinking-note" style={{ margin: 0, color: isExpired ? '#ef4444' : undefined }}>
                        {isExpired
                          ? `⚠ Token expired: ${new Date(oauthExpiresAt * 1000).toLocaleString()} — will auto-refresh on next request, or reconnect below`
                          : `Token expires: ${new Date(oauthExpiresAt * 1000).toLocaleString()}`}
                      </span>
                    );
                  })() : null}
                </div>
              ) : isOAuthFlow ? (
                <div className="provider-oauth-flow">
                  <span className="thinking-note">
                    After approving in the browser, paste the authorization code here:
                  </span>
                  <input
                    type="text"
                    value={oauthAuthCode}
                    onChange={(e) => setOAuthAuthCode(e.target.value)}
                    placeholder="Paste authorization code (e.g., abc123#state456)"
                    autoComplete="off"
                  />
                  <div className="settings-actions">
                    <button
                      type="button"
                      className="settings-save-btn"
                      onClick={handleCompleteOAuth}
                      disabled={isSaving || !oauthAuthCode.trim()}
                    >
                      {isSaving ? 'Connecting...' : 'Complete OAuth'}
                    </button>
                    <button
                      type="button"
                      className="settings-add-btn"
                      onClick={() => {
                        setIsOAuthFlow(false);
                        setOAuthAuthCode('');
                      }}
                      disabled={isSaving}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div className="provider-oauth-choice">
                  {/* OAuth Section */}
                  <div className="provider-oauth-section recommended">
                    <div className="provider-oauth-section-header">
                      <div className="provider-oauth-section-title">
                        Claude Pro/Max Subscription
                        <span className="provider-oauth-badge recommended">Recommended</span>
                      </div>
                      <span className="provider-oauth-badge free">Free API</span>
                    </div>
                    <div className="provider-oauth-section-description">
                      Connect your Claude Pro or Max subscription to get free API access
                    </div>
                    <div className="provider-oauth-benefits">
                      <div className="provider-oauth-benefit">Zero cost - covered by subscription</div>
                      <div className="provider-oauth-benefit">Higher rate limits</div>
                      <div className="provider-oauth-benefit">Auto-refresh tokens</div>
                    </div>
                    <button
                      type="button"
                      className="settings-save-btn"
                      onClick={handleStartOAuth}
                      disabled={isSaving}
                      style={{ width: '100%' }}
                    >
                      {isSaving ? 'Starting...' : 'Connect with OAuth'}
                    </button>
                  </div>

                  <div className="provider-oauth-divider" />

                  {/* API Key Section */}
                  <div className="provider-oauth-section">
                    <div className="provider-oauth-section-header">
                      <div className="provider-oauth-section-title">
                        API Key
                      </div>
                      <span className="provider-oauth-badge paid">Pay per use</span>
                    </div>
                    <div className="provider-oauth-section-description">
                      Use an API key for pay-as-you-go access. Free tier available with rate limits.
                    </div>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={selected.has_api_key ? 'Stored (enter to replace)' : 'Enter API key'}
                      autoComplete="off"
                      style={{ marginBottom: '8px' }}
                    />
                    <span className="thinking-note" style={{ margin: 0 }}>
                      Get an API key from{' '}
                      <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer noopener">
                        console.anthropic.com/settings/keys
                      </a>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* OpenAI Codex: OAuth import or API key */}
          {isOpenAICodex && !isFallback && !isAutomaticRouter ? (
            <div className="settings-field">
              <span>Authentication method</span>
              {codexOAuthEnabled ? (
                <div className="provider-oauth-status">
                  <div className="provider-oauth-status-row">
                    <span className="status-badge status-completed">✓ OAuth Connected (Codex/ChatGPT)</span>
                    <button
                      type="button"
                      className="settings-remove-btn"
                      onClick={handleDisconnectCodexOAuth}
                      disabled={isSaving}
                    >
                      Disconnect
                    </button>
                  </div>
                  {codexOAuthExpiresAt ? (() => {
                    const isExpired = Date.now() / 1000 > codexOAuthExpiresAt;
                    return (
                      <span className="thinking-note" style={{ margin: 0, color: isExpired ? '#ef4444' : undefined }}>
                        {isExpired
                          ? `⚠ Token expired: ${new Date(codexOAuthExpiresAt * 1000).toLocaleString()} — run codex login, then import again`
                          : `Token expires: ${new Date(codexOAuthExpiresAt * 1000).toLocaleString()}`}
                      </span>
                    );
                  })() : null}
                </div>
              ) : (
                <div className="provider-oauth-choice">
                  <div className="provider-oauth-section recommended">
                    <div className="provider-oauth-section-header">
                      <div className="provider-oauth-section-title">
                        Codex / ChatGPT OAuth
                        <span className="provider-oauth-badge recommended">Recommended</span>
                      </div>
                      <span className="provider-oauth-badge free">OAuth</span>
                    </div>
                    <div className="provider-oauth-section-description">
                      Sign in with Codex locally, then import OAuth credentials from your Codex auth cache.
                    </div>
                    <div className="provider-oauth-benefits">
                      <div className="provider-oauth-benefit">Separate from API key management</div>
                      <div className="provider-oauth-benefit">Uses your existing Codex login session</div>
                      <div className="provider-oauth-benefit">One-click re-import after refresh/login</div>
                    </div>
                    <span className="thinking-note" style={{ margin: '0 0 8px 0' }}>
                      Run <code>codex login</code> in terminal first. Import reads <code>~/.codex/auth.json</code>.
                    </span>
                    <button
                      type="button"
                      className="settings-save-btn"
                      onClick={handleImportCodexOAuth}
                      disabled={isSaving}
                      style={{ width: '100%' }}
                    >
                      {isSaving ? 'Importing...' : 'Import OAuth from Codex'}
                    </button>
                  </div>

                  <div className="provider-oauth-divider" />

                  <div className="provider-oauth-section">
                    <div className="provider-oauth-section-header">
                      <div className="provider-oauth-section-title">API Key</div>
                      <span className="provider-oauth-badge paid">Pay per use</span>
                    </div>
                    <div className="provider-oauth-section-description">
                      Use standard OpenAI API keys instead of OAuth.
                    </div>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder={selected.has_api_key ? 'Stored (enter to replace)' : 'Enter API key'}
                      autoComplete="off"
                      style={{ marginBottom: '8px' }}
                    />
                    <span className="thinking-note" style={{ margin: 0 }}>
                      Get an API key from{' '}
                      <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer noopener">
                        platform.openai.com/api-keys
                      </a>
                    </span>
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {/* Other providers: API key only */}
          {!isLMStudio && !isFallback && !isAutomaticRouter && !isAnthropic && !isOpenAICodex ? (
            <label className="settings-field">
              <span>API key</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={selected.has_api_key ? 'Stored (enter to replace)' : 'Enter API key'}
                autoComplete="off"
                disabled={!selected.requires_key}
              />
              {isOpenAI ? (
                <span className="thinking-note">
                  Get an API key from{' '}
                  <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer noopener">
                    platform.openai.com/api-keys
                  </a>
                  . OpenAI API authentication is API-key based; OAuth sign-in is not currently supported for this provider.
                  ChatGPT Plus/Pro subscriptions are billed separately from API usage.
                </span>
              ) : isOpenRouter ? (
                <span className="thinking-note">
                  Get an API key from{' '}
                  <a href="https://openrouter.ai/settings/keys" target="_blank" rel="noreferrer noopener">
                    openrouter.ai/settings/keys
                  </a>
                  .
                </span>
              ) : null}
            </label>
          ) : null}

          {!isFallback && !isAutomaticRouter && !isAnthropic ? (
            <label className="settings-field">
              <span>Base URL</span>
              <input type="text" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} autoComplete="off" />
            </label>
          ) : null}

          {(isLMStudio || isKimi || isGoogle || isOpenAI || isOpenAICodex || isOpenRouter || isAnthropic) && !isFallback && !isAutomaticRouter ? (
            <div className="settings-field">
              <span>Default model</span>
              <div className="provider-model-query-row">
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={isLoadingModels}>
                  <option value="">
                    {isLMStudio
                      ? 'Select a loaded LM Studio model'
                      : isGoogle
                        ? 'Select a loaded Gemini model'
                        : isOpenAI
                          ? 'Select an OpenAI model'
                          : isOpenAICodex
                            ? 'Select an OpenAI model'
                          : isOpenRouter
                            ? 'Select an OpenRouter model'
                            : isAnthropic
                              ? 'Select a Claude model'
                              : 'Select a loaded Kimi model'}
                  </option>
                  {model.trim() !== '' && !availableModels.includes(model) ? (
                    <option value={model}>{model}</option>
                  ) : null}
                  {availableModels.map((modelName) => (
                    <option key={modelName} value={modelName}>
                      {modelName}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settings-add-btn"
                  onClick={handleQueryModels}
                  disabled={isLoadingModels}
                >
                  {isLoadingModels ? 'Querying...' : 'Query models'}
                </button>
              </div>
              {modelsError ? <span className="settings-inline-error">{modelsError}</span> : null}
            </div>
          ) : !isFallback && !isAutomaticRouter ? (
            <label className="settings-field">
              <span>Default model</span>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
            </label>
          ) : null}

          {isLMStudio && !isFallback && !isAutomaticRouter ? (
            <label className="settings-field">
              <span>API key (optional)</span>
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder={selected.has_api_key ? 'Stored (enter to replace)' : 'Optional API key'}
                autoComplete="off"
              />
            </label>
          ) : null}

          {isAutomaticRouter ? (
            <>
              <div className="settings-field">
                <span>Router model provider</span>
                <select value={routerProvider} onChange={(event) => setRouterProvider(event.target.value)}>
                  {eligibleTargetProviders.map((provider) => (
                    <option key={provider.type} value={provider.type} disabled={!provider.configured}>
                      {provider.display_name} {provider.configured ? '' : '(not configured)'}
                    </option>
                  ))}
                </select>
              </div>

              {!isFallbackProvider(routerProvider) ? (
                <div className="settings-field">
                  <span>Router model</span>
                  <div className="provider-model-query-row">
                    <select value={routerModel} onChange={(event) => setRouterModel(event.target.value)} disabled={isLoadingRouterModels}>
                      <option value="">Select model</option>
                      {routerProviderModels.map((modelName) => (
                        <option key={modelName} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : null}

              <div className="settings-field">
                <span>Routing rules</span>
                <div className="provider-fallback-compose-row">
                  <input
                    type="text"
                    value={routingMatch}
                    onChange={(event) => setRoutingMatch(event.target.value)}
                    placeholder="Task context (e.g. coding, marketing)"
                  />
                  <select value={routingTargetProvider} onChange={(event) => setRoutingTargetProvider(event.target.value)}>
                    {eligibleTargetProviders.map((provider) => (
                      <option key={provider.type} value={provider.type} disabled={!provider.configured}>
                        {provider.display_name} {provider.configured ? '' : '(not configured)'}
                      </option>
                    ))}
                  </select>
                  {!isFallbackProvider(routingTargetProvider) ? (
                    <select
                      value={routingTargetModel}
                      onChange={(event) => setRoutingTargetModel(event.target.value)}
                      disabled={isLoadingRoutingTargetModels}
                    >
                      <option value="">Select model</option>
                      {routingTargetModels.map((modelName) => (
                        <option key={modelName} value={modelName}>{modelName}</option>
                      ))}
                    </select>
                  ) : null}
                  <button
                    type="button"
                    className="settings-add-btn"
                    onClick={handleAddRoutingRule}
                    disabled={routingMatch.trim() === '' || routingTargetProvider.trim() === '' || (!isFallbackProvider(routingTargetProvider) && routingTargetModel.trim() === '')}
                  >
                    Add rule
                  </button>
                </div>

                <div className="provider-fallback-chain-list">
                  {routingRules.map((rule, index) => {
                    const provider = eligibleTargetProviders.find((item) => item.type === rule.provider);
                    return (
                      <div key={`${rule.match}-${rule.provider}-${rule.model || ''}-${index}`} className="provider-fallback-chain-item">
                        <span className="provider-fallback-index">{index + 1}.</span>
                        <span className="provider-fallback-label">
                          "{rule.match}" → {provider?.display_name || rule.provider}{rule.model ? ` / ${rule.model}` : ''}
                        </span>
                        <div className="provider-fallback-actions">
                          <button
                            type="button"
                            className="settings-remove-btn"
                            onClick={() => setRoutingRules((prev) => prev.filter((_, idx) => idx !== index))}
                          >
                            Remove
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  {routingRules.length === 0 ? <div className="provider-fallback-empty">No routing rules configured yet.</div> : null}
                </div>
              </div>
            </>
          ) : null}

          {isFallback ? (
            <div className="settings-field">
              {isNamedFallbackAggregate ? (
                <label className="settings-field">
                  <span>Name</span>
                  <input
                    type="text"
                    value={fallbackName}
                    onChange={(event) => setFallbackName(event.target.value)}
                    placeholder="Fallback chain name"
                    disabled={isSaving}
                  />
                </label>
              ) : null}
              <span>Fallback nodes (in order)</span>
              <div className="provider-fallback-compose-row">
                <select value={candidateNode} onChange={(e) => {
                  const nextProvider = e.target.value as LLMProviderType;
                  setCandidateNode(nextProvider);
                  const provider = nonAggregateProviders.find((item) => item.type === nextProvider);
                  setCandidateNodeModel(provider?.model || provider?.default_model || '');
                }}>
                  {nonAggregateProviders.map((provider) => (
                    <option key={provider.type} value={provider.type} disabled={!provider.configured}>
                      {provider.display_name} {provider.configured ? '' : '(not configured)'}
                    </option>
                  ))}
                </select>
                <select value={candidateNodeModel} onChange={(e) => setCandidateNodeModel(e.target.value)} disabled={isLoadingCandidateNodeModels}>
                  {candidateNodeModels.map((modelName) => (
                    <option key={modelName} value={modelName}>{modelName}</option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settings-add-btn"
                  onClick={handleAddFallbackNode}
                  disabled={
                    candidateNodeModel.trim() === '' ||
                    fallbackChain.some((node) => node.provider === candidateNode && node.model === candidateNodeModel.trim()) ||
                    !nonAggregateProviders.find((provider) => provider.type === candidateNode)?.configured
                  }
                >
                  Add node
                </button>
              </div>
              <div className="provider-fallback-chain-list">
                {fallbackChain.map((node, index) => {
                  const provider = nonAggregateProviders.find((item) => item.type === node.provider);
                  return (
                    <div key={`${node.provider}-${node.model}-${index}`} className="provider-fallback-chain-item">
                      <span className="provider-fallback-index">{index + 1}.</span>
                      <span className="provider-fallback-label">{provider?.display_name || node.provider} / {node.model}</span>
                      <div className="provider-fallback-actions">
                        <button
                          type="button"
                          className="settings-add-btn"
                          onClick={() => {
                            const nextIndex = index - 1;
                            if (nextIndex < 0) return;
                            setFallbackChain((prev) => {
                              const next = [...prev];
                              const [item] = next.splice(index, 1);
                              next.splice(nextIndex, 0, item);
                              return next;
                            });
                          }}
                          disabled={index === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="settings-add-btn"
                          onClick={() => {
                            const nextIndex = index + 1;
                            if (nextIndex >= fallbackChain.length) return;
                            setFallbackChain((prev) => {
                              const next = [...prev];
                              const [item] = next.splice(index, 1);
                              next.splice(nextIndex, 0, item);
                              return next;
                            });
                          }}
                          disabled={index === fallbackChain.length - 1}
                        >
                          Down
                        </button>
                        <button type="button" className="settings-remove-btn" onClick={() => setFallbackChain((prev) => prev.filter((_, idx) => idx !== index))}>
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
                {fallbackChain.length === 0 ? <div className="provider-fallback-empty">No nodes selected yet.</div> : null}
              </div>
              {fallbackChain.length > 0 && fallbackChain.length < 2 ? (
                <span className="settings-inline-error">Fallback chain needs at least two nodes.</span>
              ) : null}
            </div>
          ) : null}

          <div className="settings-actions">
            <button
              type="button"
              className="settings-save-btn"
              onClick={handleSave}
              disabled={
                isSaving ||
                (isNamedFallbackAggregate && fallbackName.trim() === '') ||
                (isFallback && fallbackChain.length < 2) ||
                (isAutomaticRouter && (routerProvider.trim() === '' || routingRules.length === 0 || (!isFallbackProvider(routerProvider) && routerModel.trim() === '')))
              }
            >
              {isSaving ? 'Saving...' : 'Save'}
            </button>
            <button
              type="button"
              className="settings-add-btn"
              onClick={handleSetActive}
              disabled={isSaving || selected.is_active}
            >
              Set active
            </button>
            {!isFallback && !isAutomaticRouter ? (
              <button
                type="button"
                className="settings-add-btn"
                onClick={handleTest}
                disabled={isTesting || !selected.configured}
              >
                {isTesting ? 'Testing...' : 'Test'}
              </button>
            ) : null}
            {isFallback ? (
              <button
                type="button"
                className="settings-remove-btn"
                onClick={handleDeleteAggregate}
                disabled={isSaving}
              >
                Delete aggregate
              </button>
            ) : null}
          </div>

          {success && <div className="settings-success">{success}</div>}
        </div>
      </div>
    </div>
  );
}

export default ProviderEditView;
