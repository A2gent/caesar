import React, { useEffect, useMemo, useState } from 'react';

interface SettingsPanelProps {
  settings: Record<string, string>;
  isSaving: boolean;
  onSave: (settings: Record<string, string>) => Promise<void>;
}

interface CustomRow {
  id: string;
  key: string;
  value: string;
}

const PRESET_KEYS = [
  'ELEVENLABS_API_KEY',
  'SAG_VOICE_ID',
  'KIMI_API_KEY',
  'ANTHROPIC_API_KEY',
  'AAGENT_SPEECH_ENABLED',
  'AAGENT_SAY_VOICE',
] as const;

const labels: Record<string, string> = {
  ELEVENLABS_API_KEY: '11 Labs API key',
  SAG_VOICE_ID: 'SAG voice id',
  KIMI_API_KEY: 'Kimi API key',
  ANTHROPIC_API_KEY: 'Anthropic API key',
  AAGENT_SPEECH_ENABLED: 'Speak completion aloud',
  AAGENT_SAY_VOICE: 'macOS say voice',
};

function isSecretKey(key: string): boolean {
  const upper = key.toUpperCase();
  return upper.includes('KEY') || upper.includes('TOKEN') || upper.includes('SECRET') || upper.includes('PASSWORD');
}

function isTruthySetting(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

const SettingsPanel: React.FC<SettingsPanelProps> = ({ settings, isSaving, onSave }) => {
  const [presetValues, setPresetValues] = useState<Record<string, string>>(() => {
    const values: Record<string, string> = {};
    for (const key of PRESET_KEYS) {
      values[key] = settings[key] || '';
    }
    return values;
  });

  const [customRows, setCustomRows] = useState<CustomRow[]>(() => {
    const rows: CustomRow[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (!PRESET_KEYS.includes(key as (typeof PRESET_KEYS)[number])) {
        rows.push({ id: crypto.randomUUID(), key, value });
      }
    }
    return rows;
  });

  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState<string | null>(null);

  useEffect(() => {
    const values: Record<string, string> = {};
    for (const key of PRESET_KEYS) {
      values[key] = settings[key] || '';
    }
    setPresetValues(values);

    const rows: CustomRow[] = [];
    for (const [key, value] of Object.entries(settings)) {
      if (!PRESET_KEYS.includes(key as (typeof PRESET_KEYS)[number])) {
        rows.push({ id: crypto.randomUUID(), key, value });
      }
    }
    setCustomRows(rows);
  }, [settings]);

  const canSave = useMemo(() => {
    return !isSaving;
  }, [isSaving]);

  const addRow = () => {
    setCustomRows((prev) => [...prev, { id: crypto.randomUUID(), key: '', value: '' }]);
  };

  const updateRow = (id: string, field: 'key' | 'value', next: string) => {
    setCustomRows((prev) => prev.map((row) => (row.id === id ? { ...row, [field]: next } : row)));
  };

  const removeRow = (id: string) => {
    setCustomRows((prev) => prev.filter((row) => row.id !== id));
  };

  const handleSave = async () => {
    setSaveError(null);
    setSaveSuccess(null);

    const payload: Record<string, string> = {};

    for (const key of PRESET_KEYS) {
      if (key === 'AAGENT_SPEECH_ENABLED') {
        payload[key] = isTruthySetting(presetValues[key] || '') ? 'true' : 'false';
        continue;
      }

      const value = (presetValues[key] || '').trim();
      if (value !== '') {
        payload[key] = value;
      }
    }

    for (const row of customRows) {
      const key = row.key.trim();
      if (!key) {
        continue;
      }
      payload[key] = row.value.trim();
    }

    try {
      await onSave(payload);
      setSaveSuccess('Settings saved and synced to backend.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Failed to save settings');
    }
  };

  return (
    <div className="settings-panel">
      <h2>Agent environment</h2>
      <p className="settings-help">
        Secrets are stored in backend SQLite and synced into backend environment variables for agent/tool commands.
      </p>

      <div className="settings-group">
        {PRESET_KEYS.map((key) => (
          <label key={key} className="settings-field">
            <span>{labels[key]}</span>
            {key === 'AAGENT_SPEECH_ENABLED' ? (
              <input
                type="checkbox"
                checked={isTruthySetting(presetValues[key] || '')}
                onChange={(e) => setPresetValues((prev) => ({ ...prev, [key]: e.target.checked ? 'true' : 'false' }))}
              />
            ) : (
              <input
                type={isSecretKey(key) ? 'password' : 'text'}
                value={presetValues[key] || ''}
                onChange={(e) => setPresetValues((prev) => ({ ...prev, [key]: e.target.value }))}
                placeholder={key}
                autoComplete="off"
              />
            )}
          </label>
        ))}
      </div>

      <div className="settings-custom-header">
        <h3>Custom secrets/tokens</h3>
        <button type="button" onClick={addRow} className="settings-add-btn">Add</button>
      </div>

      <div className="settings-custom-list">
        {customRows.map((row) => (
          <div key={row.id} className="settings-custom-row">
            <input
              type="text"
              value={row.key}
              onChange={(e) => updateRow(row.id, 'key', e.target.value)}
              placeholder="ENV_VAR_NAME"
              autoComplete="off"
            />
            <input
              type={isSecretKey(row.key) ? 'password' : 'text'}
              value={row.value}
              onChange={(e) => updateRow(row.id, 'value', e.target.value)}
              placeholder="value"
              autoComplete="off"
            />
            <button type="button" onClick={() => removeRow(row.id)} className="settings-remove-btn">Remove</button>
          </div>
        ))}
      </div>

      {saveError && <div className="settings-error">{saveError}</div>}
      {saveSuccess && <div className="settings-success">{saveSuccess}</div>}

      <button type="button" onClick={handleSave} className="settings-save-btn" disabled={!canSave}>
        {isSaving ? 'Saving...' : 'Save settings'}
      </button>
    </div>
  );
};

export default SettingsPanel;
