import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  createFallbackAggregate,
  listGoogleModels,
  listKimiModels,
  listLMStudioModels,
  listOpenAIModels,
  listOpenRouterModels,
  listProviders,
  type FallbackChainNode,
  type LLMProviderType,
  type ProviderConfig,
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
    default:
      return type;
  }
}

function FallbackAggregateCreateView() {
  const navigate = useNavigate();
  const [providers, setProviders] = useState<ProviderConfig[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [aggregateName, setAggregateName] = useState('');
  const [aggregateChain, setAggregateChain] = useState<FallbackChainNode[]>([]);
  const [candidateProvider, setCandidateProvider] = useState<LLMProviderType>('openai');
  const [candidateModel, setCandidateModel] = useState('');
  const [candidateModels, setCandidateModels] = useState<string[]>([]);
  const [isLoadingCandidateModels, setIsLoadingCandidateModels] = useState(false);

  const directProviders = useMemo(
    () => providers.filter((provider) => !isFallbackProvider(provider.type) && provider.type !== 'automatic_router'),
    [providers],
  );

  const loadProviders = async () => {
    try {
      setIsLoading(true);
      setError(null);
      const data = await listProviders();
      setProviders(data);
      const firstConfigured = data.find((provider) => !isFallbackProvider(provider.type) && provider.configured);
      if (firstConfigured) {
        setCandidateProvider(firstConfigured.type);
      }
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

  const loadCandidateModels = async (providerType: LLMProviderType) => {
    const provider = directProviders.find((item) => item.type === providerType);
    if (!provider) {
      setCandidateModels([]);
      setCandidateModel('');
      return;
    }

    const baseOptions = [provider.model, provider.default_model]
      .map((value) => value.trim())
      .filter((value) => value !== '');
    const nextOptions = new Set(baseOptions);

    setIsLoadingCandidateModels(true);
    try {
      if (provider.type === 'lmstudio') {
        (await listLMStudioModels(provider.base_url)).forEach((modelName) => nextOptions.add(modelName));
      } else if (provider.type === 'kimi') {
        (await listKimiModels(provider.base_url)).forEach((modelName) => nextOptions.add(modelName));
      } else if (provider.type === 'google') {
        (await listGoogleModels(provider.base_url)).forEach((modelName) => nextOptions.add(modelName));
      } else if (provider.type === 'openai') {
        (await listOpenAIModels(provider.base_url)).forEach((modelName) => nextOptions.add(modelName));
      } else if (provider.type === 'openrouter') {
        (await listOpenRouterModels(provider.base_url)).forEach((modelName) => nextOptions.add(modelName));
      }
    } catch {
      // Keep defaults when querying models fails.
    } finally {
      setIsLoadingCandidateModels(false);
    }

    const options = Array.from(nextOptions).sort((a, b) => a.localeCompare(b));
    setCandidateModels(options);
    setCandidateModel((current) => (current.trim() !== '' && nextOptions.has(current.trim()) ? current.trim() : (options[0] || '')));
  };

  useEffect(() => {
    if (candidateProvider.trim() === '') {
      return;
    }
    void loadCandidateModels(candidateProvider);
  }, [candidateProvider, directProviders]);

  const handleAddNode = () => {
    const provider = directProviders.find((item) => item.type === candidateProvider);
    if (!provider || !provider.configured) {
      return;
    }
    const model = candidateModel.trim();
    if (model === '') {
      return;
    }
    const duplicate = aggregateChain.some((node) => node.provider === candidateProvider && node.model === model);
    if (duplicate) {
      return;
    }
    setAggregateChain((prev) => [...prev, { provider: candidateProvider, model }]);
  };

  const handleSave = async () => {
    const name = aggregateName.trim();
    if (name === '') {
      setError('Aggregate name is required.');
      return;
    }
    if (aggregateChain.length < 2) {
      setError('Fallback aggregate needs at least two model nodes.');
      return;
    }

    try {
      setIsSaving(true);
      setError(null);
      await createFallbackAggregate({
        name,
        fallback_chain: aggregateChain,
      });
      navigate('/providers');
    } catch (err) {
      console.error('Failed to create fallback aggregate:', err);
      setError(err instanceof Error ? err.message : 'Failed to create fallback aggregate');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoading) {
    return <div className="sessions-loading">Loading providers...</div>;
  }

  return (
    <div className="page-shell">
      <div className="page-header">
        <h1>Create Fallback Aggregate</h1>
      </div>

      {error && (
        <div className="error-banner">
          {error}
          <button onClick={() => setError(null)} className="error-dismiss">×</button>
        </div>
      )}

      <div className="page-content page-content-narrow">
        <div className="settings-panel provider-edit-panel">
          <label className="settings-field">
            <span>Name</span>
            <input
              type="text"
              value={aggregateName}
              onChange={(event) => setAggregateName(event.target.value)}
              placeholder="light-weight"
              disabled={isSaving}
            />
          </label>

          <div className="provider-fallback-compose-row">
            <select className="settings-field-select" value={candidateProvider} onChange={(event) => setCandidateProvider(event.target.value)}>
              {directProviders.map((provider) => (
                <option key={provider.type} value={provider.type} disabled={!provider.configured}>
                  {provider.display_name} {provider.configured ? '' : '(not configured)'}
                </option>
              ))}
            </select>
            <select className="settings-field-select" value={candidateModel} onChange={(event) => setCandidateModel(event.target.value)} disabled={isLoadingCandidateModels}>
              {candidateModels.map((modelName) => (
                <option key={modelName} value={modelName}>{modelName}</option>
              ))}
            </select>
            <button type="button" className="settings-add-btn" onClick={handleAddNode} disabled={isSaving}>
              Add node
            </button>
          </div>

          <div className="provider-fallback-chain-list">
            {aggregateChain.map((node, index) => (
              <div key={`${node.provider}-${node.model}-${index}`} className="provider-fallback-chain-item">
                <span className="provider-fallback-index">{index + 1}.</span>
                <span className="provider-fallback-label">{formatProvider(node.provider)} / {node.model}</span>
                <div className="provider-fallback-actions">
                  <button type="button" className="settings-remove-btn" onClick={() => setAggregateChain((prev) => prev.filter((_, idx) => idx !== index))}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
            {aggregateChain.length === 0 ? <div className="provider-fallback-empty">No model nodes selected.</div> : null}
          </div>

          <div className="settings-actions">
            <Link to="/providers" className="settings-add-btn">Cancel</Link>
            <button type="button" className="settings-save-btn" onClick={handleSave} disabled={isSaving || aggregateChain.length < 2}>
              {isSaving ? 'Saving...' : 'Create aggregate'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default FallbackAggregateCreateView;
