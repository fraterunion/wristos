export const queryKeys = {
  auth: {
    currentUser: ['auth', 'current-user'] as const,
  },
  analytics: {
    summary: ['analytics', 'summary'] as const,
    inventoryAging: ['analytics', 'inventory-aging'] as const,
    pipeline: ['analytics', 'pipeline'] as const,
  },
  inventory: {
    all: ['inventory'] as const,
    list: (filters?: Record<string, string | number | boolean | undefined>) =>
      ['inventory', 'list', filters ?? {}] as const,
    detail: (watchId: string) => ['inventory', 'detail', watchId] as const,
  },
  crm: {
    clients: ['crm', 'clients'] as const,
    list: (filters?: Record<string, string | number | boolean | undefined>) =>
      ['crm', 'clients', 'list', filters ?? {}] as const,
    clientDetail: (clientId: string) => ['crm', 'clients', clientId] as const,
    clientInteractions: (clientId: string) =>
      ['crm', 'clients', clientId, 'interactions'] as const,
    clientPreference: (clientId: string) =>
      ['crm', 'clients', clientId, 'preference'] as const,
  },
  deals: {
    all: ['deals'] as const,
    list: (filters?: Record<string, string | number | boolean | undefined>) =>
      ['deals', 'list', filters ?? {}] as const,
    detail: (dealId: string) => ['deals', 'detail', dealId] as const,
    paymentSummary: (dealId: string) => ['deals', 'payment-summary', dealId] as const,
    payments: (dealId: string) => ['deals', 'payments', dealId] as const,
  },
  matching: {
    watchSuggestions: (watchId: string) =>
      ['matching', 'watch', watchId, 'suggestions'] as const,
    clientSuggestions: (clientId: string) =>
      ['matching', 'client', clientId, 'suggestions'] as const,
  },
  automations: {
    rules: ['automations', 'rules'] as const,
  },
};
