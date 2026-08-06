import { z } from 'zod';
import { JsonValue } from '../../domain/canonical-json';
import { BusinessActionDefinition, WarningRule } from './business-action-definition';
import { BusinessActionId, BusinessCapability, BusinessWarning, ConfirmationTier, StructuredEntities } from '../planner.types';

const present = (value: JsonValue | undefined) => value !== undefined && value !== null && value !== '';
const valueFor = (entities: StructuredEntities, key: string): JsonValue => entities[key] ?? null;
const fields = (entities: StructuredEntities, keys: readonly string[]) => keys.filter((key) => present(entities[key])).map((key) => ({ label: key, value: valueFor(entities, key) }));
const args = (entities: StructuredEntities): Record<string, JsonValue> => Object.fromEntries(Object.entries(entities).filter((entry): entry is [string, JsonValue] => entry[1] !== undefined));

const warning = (code: string, message: string, predicate: (entities: StructuredEntities) => boolean): WarningRule => ({ code, evaluate: (entities) => predicate(entities) ? { code, message } : null });

const questions: Record<string, string> = {
  watchId: 'Which watch should be used?', customerId: 'Who is the customer?', price: 'What is the price?', currency: 'What currency applies?',
  date: 'What date applies?', accountId: 'Which account should be used?', amount: 'What amount should be applied?', destination: 'Where should the payment be received?',
  watch: 'Which watch is being purchased?', cost: 'What is the purchase cost?', concept: 'What is the expense for?', sourceAccountId: 'Which account is funding the settlement?',
  destinationAccountId: 'Which account receives the settlement?', asset: 'Which crypto asset?', quantity: 'What quantity applies?', unitPrice: 'What is the crypto unit price?',
  year: 'Which year?', month: 'Which month?', query: 'What should be searched?', clientId: 'Which client?',
};

interface ActionOptions {
  id: BusinessActionId; name: string; category: string; tier: ConfirmationTier; required?: string[]; optional?: string[]; capabilities?: BusinessCapability[];
  effects?: Array<{ area: string; description: string }>; warnings?: WarningRule[]; reversibility?: 'FULL' | 'PARTIAL' | 'NONE';
}

const define = (options: ActionOptions): BusinessActionDefinition => {
  const required = options.required ?? [];
  const optional = options.optional ?? [];
  const capabilities = options.capabilities ?? [options.id];
  const effects = options.effects ?? [];
  return {
    id: options.id,
    name: options.name,
    description: `Deterministic plan for ${options.name.toLowerCase()}.`,
    category: options.category,
    confirmationTier: options.tier,
    requiredEntities: required,
    optionalEntities: optional,
    clarificationQuestions: Object.fromEntries(required.map((key) => [key, questions[key] ?? `Provide ${key}.`])),
    warningRules: options.warnings ?? [],
    previewBuilder: (entities: StructuredEntities, warnings: BusinessWarning[]) => ({ title: options.name, category: options.category, fields: fields(entities, [...required, ...optional]), warnings, confirmationTier: options.tier, estimatedEffects: effects }),
    planningStrategy: (entities: StructuredEntities) => capabilities.map((capability, index) => ({ stepId: `${capability.toLowerCase().replaceAll('_', '-')}-${index + 1}`, capability, arguments: args(entities), dependsOn: index === 0 ? [] : [`${capabilities[index - 1]!.toLowerCase().replaceAll('_', '-')}-${index}`], estimatedEffects: effects, reversibility: options.reversibility ?? (options.tier === 'NONE' ? 'FULL' : 'PARTIAL') })),
    capabilities,
    resultSchema: z.unknown(),
  };
};

export const BUSINESS_ACTIONS: readonly BusinessActionDefinition[] = [
  define({ id: 'GET_LIQUIDITY', name: 'Get Liquidity', category: 'FINANCE', tier: 'NONE' }),
  define({ id: 'GET_MONTHLY_PROFIT', name: 'Get Monthly Profit', category: 'ANALYTICS', tier: 'NONE', required: ['year', 'month'] }),
  define({ id: 'SEARCH_INVENTORY', name: 'Search Inventory', category: 'INVENTORY', tier: 'NONE', required: ['query'], optional: ['status', 'limit'] }),
  define({ id: 'SEARCH_CLIENT', name: 'Search Client', category: 'CRM', tier: 'NONE', required: ['query'], optional: ['limit'] }),
  define({ id: 'GET_CLIENT_ACCOUNTS', name: 'Get Client Accounts', category: 'ACCOUNTS', tier: 'NONE', required: ['clientId'], optional: ['type', 'status'] }),
  define({ id: 'REGISTER_SALE', name: 'Register Sale', category: 'SALES', tier: 'HIGH', required: ['watchId', 'customerId', 'price', 'currency'], optional: ['date', 'watchLabel', 'customerName', 'watchStatus'], effects: [{ area: 'Inventory', description: 'Selected watch becomes SOLD.' }, { area: 'Treasury', description: 'Sale proceeds are recorded in the selected currency.' }, { area: 'Capital', description: 'Profit is recalculated.' }], warnings: [warning('WATCH_RESERVED', 'The selected watch is reserved.', (e) => e.watchStatus === 'RESERVED')] }),
  define({ id: 'REGISTER_RECEIVABLE_PAYMENT', name: 'Register Receivable Payment', category: 'ACCOUNTS', tier: 'HIGH', required: ['accountId', 'amount', 'destination'], optional: ['currency', 'date', 'outstandingAmount'], effects: [{ area: 'Accounts', description: 'Outstanding receivable is reduced.' }, { area: 'Treasury', description: 'Destination balance increases.' }], warnings: [warning('AMOUNT_EXCEEDS_OUTSTANDING', 'Payment amount exceeds the outstanding balance.', (e) => typeof e.amount === 'number' && typeof e.outstandingAmount === 'number' && e.amount > e.outstandingAmount)] }),
  define({ id: 'REGISTER_PURCHASE', name: 'Register Purchase', category: 'INVENTORY', tier: 'HIGH', required: ['watch', 'cost', 'currency'], optional: ['date', 'serial', 'duplicateSerial'], effects: [{ area: 'Inventory', description: 'A purchased watch is added to inventory.' }, { area: 'Treasury', description: 'Purchase funding is recorded.' }], warnings: [warning('DUPLICATE_SERIAL', 'The supplied serial already exists.', (e) => e.duplicateSerial === true)] }),
  define({ id: 'REGISTER_EXPENSE', name: 'Register Expense', category: 'EXPENSES', tier: 'MEDIUM', required: ['concept', 'amount', 'currency'], optional: ['date', 'sourceAccountId'], effects: [{ area: 'Expenses', description: 'Operating expense is recorded.' }, { area: 'Treasury', description: 'Source balance is reduced.' }] }),
  define({ id: 'REGISTER_SETTLEMENT', name: 'Register Settlement', category: 'ACCOUNTS', tier: 'HIGH', required: ['sourceAccountId', 'destinationAccountId', 'amount', 'currency'], optional: ['date'], effects: [{ area: 'Accounts', description: 'The selected accounts are settled by the confirmed amount.' }] }),
  define({ id: 'REGISTER_CRYPTO_POSITION', name: 'Register Crypto Position', category: 'TREASURY', tier: 'HIGH', required: ['asset', 'quantity', 'cost', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed position is recorded.' }] }),
  define({ id: 'REGISTER_CRYPTO_PRICE', name: 'Register Crypto Price', category: 'TREASURY', tier: 'MEDIUM', required: ['asset', 'unitPrice', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed price snapshot is recorded.' }] }),
];
