import type { IntegrationProvider } from './api';

const INTEGRATION_PROVIDER_LABELS: Record<IntegrationProvider, string> = {
  telegram: 'Telegram',
  slack: 'Slack',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  webhook: 'Webhook',
  google_calendar: 'Google Calendar',
  elevenlabs: 'ElevenLabs',
  perplexity: 'Perplexity',
  brave_search: 'Brave Search',
};

const TOOL_PROVIDER_BY_NAME: Partial<Record<string, IntegrationProvider>> = {
  google_calendar_query: 'google_calendar',
  brave_search_query: 'brave_search',
  elevenlabs_tts: 'elevenlabs',
  telegram_send_message: 'telegram',
};

function asIntegrationProvider(provider: string): IntegrationProvider | null {
  const normalized = provider.trim() as IntegrationProvider;
  if (normalized in INTEGRATION_PROVIDER_LABELS) {
    return normalized;
  }
  return null;
}

export function integrationProviderLabel(provider: string): string {
  const known = asIntegrationProvider(provider);
  if (!known) {
    return provider;
  }
  return INTEGRATION_PROVIDER_LABELS[known];
}

export function integrationProviderForToolName(toolName: string): IntegrationProvider | null {
  return TOOL_PROVIDER_BY_NAME[toolName.trim()] || null;
}

export function IntegrationProviderIcon({ provider, label }: { provider: string; label?: string }) {
  const knownProvider = asIntegrationProvider(provider);
  const title = label || integrationProviderLabel(provider);
  const commonProps = { className: 'integration-provider-icon-svg', viewBox: '0 0 24 24', 'aria-hidden': true as const };

  switch (knownProvider) {
    case 'telegram':
      return (
        <span className="integration-provider-icon integration-provider-icon-telegram" title={title}>
          <svg {...commonProps}>
            <path d="M20.5 4.2 3.9 10.6c-1 .4-1 1.8.1 2.1l4.2 1.4 1.6 5.1c.3 1 1.6 1.1 2.1.2l2.4-3.5 3.9 2.9c.7.5 1.7.1 1.9-.8L22 5.6c.2-1.1-.7-2-1.8-1.4Z" />
          </svg>
        </span>
      );
    case 'slack':
      return (
        <span className="integration-provider-icon integration-provider-icon-slack" title={title}>
          <svg {...commonProps}>
            <rect x="3" y="9" width="7" height="4" rx="2" />
            <rect x="7" y="3" width="4" height="7" rx="2" />
            <rect x="14" y="3" width="4" height="7" rx="2" />
            <rect x="14" y="11" width="7" height="4" rx="2" />
            <rect x="13" y="14" width="4" height="7" rx="2" />
            <rect x="6" y="14" width="4" height="7" rx="2" />
          </svg>
        </span>
      );
    case 'discord':
      return (
        <span className="integration-provider-icon integration-provider-icon-discord" title={title}>
          <svg {...commonProps}>
            <path d="M7.2 6.7a15.7 15.7 0 0 1 3-1l.4.8a14 14 0 0 1 2.8 0l.4-.8a15.6 15.6 0 0 1 3 1c1.8 2.6 2.3 5.1 2.1 7.6a12 12 0 0 1-3.7 1.9l-.8-1.3c.5-.2 1-.5 1.4-.8l-.3-.2c-2.7 1.3-5.6 1.3-8.3 0l-.3.2c.4.3.9.6 1.4.8l-.8 1.3a12 12 0 0 1-3.7-1.9c-.2-2.5.3-5 2.1-7.6Z" />
            <circle cx="9.7" cy="11.7" r="1.1" fill="currentColor" />
            <circle cx="14.3" cy="11.7" r="1.1" fill="currentColor" />
          </svg>
        </span>
      );
    case 'whatsapp':
      return (
        <span className="integration-provider-icon integration-provider-icon-whatsapp" title={title}>
          <svg {...commonProps}>
            <path d="M12 3.5a8.5 8.5 0 0 0-7.4 12.6L3 20.5l4.6-1.4A8.5 8.5 0 1 0 12 3.5Z" />
            <path
              d="M9.2 8.8c.2-.5.5-.5.8-.5h.7c.2 0 .4.1.5.3l.7 1.7c.1.2 0 .4-.1.6l-.4.6c-.1.1-.1.3 0 .4.3.6.8 1.2 1.4 1.6.1.1.3.1.4 0l.7-.4c.2-.1.4-.1.6 0l1.6.8c.2.1.3.3.3.5v.7c0 .3 0 .6-.5.8-.4.2-1.3.4-2.3 0-1.1-.4-2.2-1.2-3-2.2-.9-.9-1.4-2-1.8-2.9-.4-1.1-.2-1.9 0-2.4Z"
              fill="#1f1f1f"
            />
          </svg>
        </span>
      );
    case 'webhook':
      return (
        <span className="integration-provider-icon integration-provider-icon-webhook" title={title}>
          <svg {...commonProps}>
            <circle cx="6" cy="12" r="2.3" />
            <circle cx="18" cy="7" r="2.3" />
            <circle cx="18" cy="17" r="2.3" />
            <path d="M8.2 11.2 15.7 7.8M8.2 12.8l7.5 3.4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" fill="none" />
          </svg>
        </span>
      );
    case 'google_calendar':
      return (
        <span className="integration-provider-icon integration-provider-icon-google-calendar" title={title}>
          <svg {...commonProps}>
            <path d="M7 3.5v3m10-3v3M4.5 8.5h15m-14 0h13a1 1 0 0 1 1 1v9a2 2 0 0 1-2 2h-11a2 2 0 0 1-2-2v-9a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            <circle cx="9" cy="13" r="1.2" />
            <circle cx="13" cy="13" r="1.2" />
            <circle cx="17" cy="13" r="1.2" />
            <circle cx="9" cy="17" r="1.2" />
            <circle cx="13" cy="17" r="1.2" />
          </svg>
        </span>
      );
    case 'elevenlabs':
      return (
        <span className="integration-provider-icon integration-provider-icon-elevenlabs" title={title}>
          <svg {...commonProps}>
            <path d="M8 4.5a3.5 3.5 0 0 1 3.5 3.5v2h-2V8a1.5 1.5 0 0 0-3 0v8a1.5 1.5 0 0 0 3 0v-2h2v2a3.5 3.5 0 0 1-7 0V8A3.5 3.5 0 0 1 8 4.5Zm8 0a3.5 3.5 0 0 1 3.5 3.5v8a3.5 3.5 0 1 1-7 0v-2h2v2a1.5 1.5 0 1 0 3 0V8a1.5 1.5 0 0 0-3 0v2h-2V8A3.5 3.5 0 0 1 16 4.5Z" />
          </svg>
        </span>
      );
    case 'perplexity':
      return (
        <span className="integration-provider-icon integration-provider-icon-perplexity" title={title}>
          <svg {...commonProps}>
            <path d="M6.5 5.5a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v3.2l2 2V18a2 2 0 0 1-2 2h-1v-5h-3v5h-3v-5h-3v5h-1a2 2 0 0 1-2-2v-7.3l2-2V5.5Zm2 0v2h7v-2h-7Zm1 6h5l2-2h-9l2 2Z" />
          </svg>
        </span>
      );
    case 'brave_search':
      return (
        <span className="integration-provider-icon integration-provider-icon-brave-search" title={title}>
          <svg {...commonProps}>
            <path d="M12 3.3 8 4.6 5.5 8v4.6L8 19.4l4 1.3 4-1.3 2.5-6.8V8L16 4.6 12 3.3Zm-3.1 7.9c.5-.9 1.5-1.6 3.1-1.6s2.6.7 3.1 1.6c.4.8.3 1.8-.2 2.6-.6 1-1.6 1.5-2.9 1.5s-2.3-.5-2.9-1.5c-.5-.8-.6-1.8-.2-2.6Zm3.1.2c-.8 0-1.3.3-1.6.8-.2.3-.2.8.1 1.2.3.6.8.8 1.5.8s1.2-.2 1.5-.8c.3-.4.3-.9.1-1.2-.3-.5-.8-.8-1.6-.8Z" />
          </svg>
        </span>
      );
    default:
      return null;
  }
}
