import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  listKimiModels,
  listLMStudioModels,
  listProviders,
  setActiveProvider,
  updateProvider,
  type LLMProviderType,
  type ProviderConfig,
} from './api';

function ProviderEditView() {
  const { providerType } = useParams<{ providerType: LLMProviderType }>();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [apiKey, setApiKey] = useState('');
  const [baseURL, setBaseURL] = useState('');
  const [model, setModel] = useState('');
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [isLoadingModels, setIsLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [fallbackChain, setFallbackChain] = useState<LLMProviderType[]>([]);
  const [candidateNode, setCandidateNode] = useState<LLMProviderType>('kimi');

  const selected = useMemo(
    () => providers.find((provider) => provider.type === providerType),
    [providers, providerType],
  );
  const isLMStudio = selected?.type === 'lmstudio';
  const isKimi = selected?.type === 'kimi';
  const isFallback = selected?.type === 'fallback_chain';
  const nonAggregateProviders = useMemo(
    () => providers.filter((provider) => provider.type !== 'fallback_chain'),
    [providers],
  );

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
    loadProviders();
  }, []);

  useEffect(() => {
    if (!selected) return;
    if (selected.type === 'fallback_chain') {
      const initialChain = (selected.fallback_chain || []).filter((node) => node !== 'fallback_chain');
      setFallbackChain(initialChain);
      const firstCandidate = nonAggregateProviders.find((provider) => provider.configured)?.type || nonAggregateProviders[0]?.type || 'kimi';
      setCandidateNode(firstCandidate);
      setApiKey('');
      setBaseURL('');
      setModel('');
      setAvailableModels([]);
      setModelsError(null);
      setIsLoadingModels(false);
      return;
    }

    setApiKey('');
    const initialBaseURL = selected.base_url || selected.default_url || '';
    setBaseURL(initialBaseURL);
    setModel(selected.model || selected.default_model || '');
    setAvailableModels([]);
    setModelsError(null);

    if (selected.type !== 'lmstudio' && selected.type !== 'kimi') return;

    let canceled = false;
    setIsLoadingModels(true);
    const modelLoader = selected.type === 'lmstudio' ? listLMStudioModels : listKimiModels;
    modelLoader(initialBaseURL)
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
  }, [selected, nonAggregateProviders]);

  const handleQueryModels = async () => {
    if (!selected || (selected.type !== 'lmstudio' && selected.type !== 'kimi')) {
      return;
    }
    const modelLoader = selected.type === 'lmstudio' ? listLMStudioModels : listKimiModels;
    try {
      setIsLoadingModels(true);
      setModelsError(null);
      const models = await modelLoader(baseURL);
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
            fallback_chain: fallbackChain,
          }
        : {
            api_key: apiKey.trim() === '' ? undefined : apiKey.trim(),
            base_url: baseURL.trim(),
            model: model.trim(),
          };
      const updated = await updateProvider(providerType, payload);
      setProviders(updated);
      setApiKey('');
      setSuccess(isFallback ? 'Fallback chain updated.' : 'Provider updated.');
    } catch (err) {
      console.error('Failed to update provider:', err);
      setError(err instanceof Error ? err.message : 'Failed to update provider');
    } finally {
      setIsSaving(false);
    }
  };

  const handleAddFallbackNode = () => {
    if (candidateNode === 'fallback_chain') {
      return;
    }
    const candidate = nonAggregateProviders.find((provider) => provider.type === candidateNode);
    if (!candidate?.configured) {
      return;
    }
    if (fallbackChain.includes(candidateNode)) {
      return;
    }
    setFallbackChain((prev) => [...prev, candidateNode]);
  };

  const handleRemoveFallbackNode = (index: number) => {
    setFallbackChain((prev) => prev.filter((_, idx) => idx !== index));
  };

  const handleMoveFallbackNode = (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= fallbackChain.length) {
      return;
    }
    setFallbackChain((prev) => {
      const next = [...prev];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
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

  if (isLoading) {
    return <div className="sessions-loading">Loading provider...</div>;
  }

  if (!selected) {
    return (
      <div className="page-shell">
        <div className="page-content page-content-narrow">
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

      <div className="page-content page-content-narrow">
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

          {!isLMStudio && !isFallback ? (
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
            </label>
          ) : null}

          {!isFallback ? (
            <label className="settings-field">
              <span>Base URL</span>
              <input type="text" value={baseURL} onChange={(e) => setBaseURL(e.target.value)} autoComplete="off" />
            </label>
          ) : null}

          {(isLMStudio || isKimi) && !isFallback ? (
            <div className="settings-field">
              <span>Default model</span>
              <div className="provider-model-query-row">
                <select value={model} onChange={(e) => setModel(e.target.value)} disabled={isLoadingModels}>
                  <option value="">{isLMStudio ? 'Select a loaded LM Studio model' : 'Select a loaded Kimi model'}</option>
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
          ) : !isFallback ? (
            <label className="settings-field">
              <span>Default model</span>
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} autoComplete="off" />
            </label>
          ) : null}

          {isLMStudio && !isFallback ? (
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

          {isFallback ? (
            <div className="settings-field">
              <span>Fallback nodes (in order)</span>
              <div className="provider-fallback-compose-row">
                <select value={candidateNode} onChange={(e) => setCandidateNode(e.target.value as LLMProviderType)}>
                  {nonAggregateProviders.map((provider) => (
                    <option key={provider.type} value={provider.type} disabled={!provider.configured || fallbackChain.includes(provider.type)}>
                      {provider.display_name} {provider.configured ? '' : '(not configured)'}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settings-add-btn"
                  onClick={handleAddFallbackNode}
                  disabled={
                    candidateNode === 'fallback_chain' ||
                    fallbackChain.includes(candidateNode) ||
                    !nonAggregateProviders.find((provider) => provider.type === candidateNode)?.configured
                  }
                >
                  Add node
                </button>
              </div>
              <div className="provider-fallback-chain-list">
                {fallbackChain.map((node, index) => {
                  const provider = nonAggregateProviders.find((item) => item.type === node);
                  return (
                    <div key={`${node}-${index}`} className="provider-fallback-chain-item">
                      <span className="provider-fallback-index">{index + 1}.</span>
                      <span className="provider-fallback-label">{provider?.display_name || node}</span>
                      <div className="provider-fallback-actions">
                        <button
                          type="button"
                          className="settings-add-btn"
                          onClick={() => handleMoveFallbackNode(index, -1)}
                          disabled={index === 0}
                        >
                          Up
                        </button>
                        <button
                          type="button"
                          className="settings-add-btn"
                          onClick={() => handleMoveFallbackNode(index, 1)}
                          disabled={index === fallbackChain.length - 1}
                        >
                          Down
                        </button>
                        <button type="button" className="settings-remove-btn" onClick={() => handleRemoveFallbackNode(index)}>
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
              disabled={isSaving || (isFallback && fallbackChain.length < 2)}
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
          </div>

          {success && <div className="settings-success">{success}</div>}
        </div>
      </div>
    </div>
  );
}

export default ProviderEditView;
