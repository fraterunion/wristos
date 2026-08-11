export const CONTEXT_ENTITY_TYPES = [
  'WATCH',
  'CLIENT',
  'ACCOUNT_ENTRY',
  'INVESTOR',
  'OPERATING_EXPENSE',
  'TREASURY_TRANSFER',
] as const;
export type ContextEntityType = (typeof CONTEXT_ENTITY_TYPES)[number];
