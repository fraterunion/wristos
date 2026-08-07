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
  effects?: Array<{ area: string; description: string }>;
  effectsBuilder?: (entities: StructuredEntities) => Array<{ area: string; description: string }>;
  warnings?: WarningRule[]; reversibility?: 'FULL' | 'PARTIAL' | 'NONE';
  conditionalMissing?: (entities: StructuredEntities) => Array<{ entity: string; question: string }>;
  previewFields?: (entities: StructuredEntities) => Array<{ label: string; value: JsonValue }>;
}

const define = (options: ActionOptions): BusinessActionDefinition => {
  const required = options.required ?? [];
  const optional = options.optional ?? [];
  const capabilities = options.capabilities ?? [options.id];
  const effects = options.effects ?? [];
  const effectsFor = options.effectsBuilder ?? (() => effects);
  const fieldKeys = [...required, ...optional];
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
    conditionalMissing: options.conditionalMissing,
    previewBuilder: (entities: StructuredEntities, warnings: BusinessWarning[]) => ({
      title: options.name,
      category: options.category,
      fields: options.previewFields ? options.previewFields(entities) : fields(entities, fieldKeys),
      warnings,
      confirmationTier: options.tier,
      estimatedEffects: effectsFor(entities),
    }),
    planningStrategy: (entities: StructuredEntities) => capabilities.map((capability, index) => ({ stepId: `${capability.toLowerCase().replaceAll('_', '-')}-${index + 1}`, capability, arguments: args(entities), dependsOn: index === 0 ? [] : [`${capabilities[index - 1]!.toLowerCase().replaceAll('_', '-')}-${index}`], estimatedEffects: effectsFor(entities), reversibility: options.reversibility ?? (options.tier === 'NONE' ? 'FULL' : 'PARTIAL') })),
    capabilities,
    resultSchema: z.unknown(),
  };
};

const destinationLabel: Record<string, string> = { CASH: 'Efectivo', BANCOS: 'Bancos', CESAR: 'César' };

/** Preview effects must match the canonical sale registration command semantics. */
function registerSaleEffects(entities: StructuredEntities): Array<{ area: string; description: string }> {
  const mode = typeof entities.paymentMode === 'string' ? entities.paymentMode : null;
  const destination = typeof entities.destination === 'string' ? entities.destination : null;
  const destLabel = destination ? destinationLabel[destination] ?? destination : null;
  const inventory = { area: 'Inventory', description: 'Inventario: AVAILABLE → SOLD.' };
  const capital = { area: 'Capital', description: 'La utilidad se recalcula con la venta.' };
  const correction = { area: 'Correction', description: 'Después de registrarla, cualquier corrección se realiza desde Ventas.' };
  if (mode === 'CREDIT') {
    return [
      inventory,
      { area: 'Treasury', description: 'Sin movimiento de Treasury.' },
      { area: 'CxC', description: 'Cuenta por cobrar por el monto total de la venta.' },
      capital,
      correction,
    ];
  }
  if (mode === 'PARTIAL') {
    return [
      inventory,
      { area: 'Treasury', description: destLabel ? `Ingreso a ${destLabel} por el monto recibido.` : 'Ingreso a destino seleccionado por el monto recibido.' },
      { area: 'CxC', description: 'Cuenta por cobrar por el saldo restante.' },
      ...(destination === 'BANCOS'
        ? [{ area: 'Bank fee', description: 'Comisión bancaria según canal (JOSE/MAYTE) si aplica.' }]
        : []),
      capital,
      correction,
    ];
  }
  if (mode === 'PAID') {
    return [
      inventory,
      { area: 'Treasury', description: destLabel ? `Ingreso completo a ${destLabel}.` : 'Ingreso completo al destino seleccionado.' },
      { area: 'CxC', description: 'Sin cuenta por cobrar pendiente.' },
      ...(destination === 'BANCOS'
        ? [{ area: 'Bank fee', description: 'Comisión bancaria según canal (JOSE/MAYTE) si aplica.' }]
        : []),
      capital,
      correction,
    ];
  }
  return [
    inventory,
    { area: 'Treasury', description: 'Ingreso solo si hay pago recibido (Efectivo / Bancos / César).' },
    { area: 'CxC', description: 'La cuenta por cobrar refleja el saldo pendiente.' },
    capital,
    correction,
  ];
}

function registerSalePreviewFields(entities: StructuredEntities): Array<{ label: string; value: JsonValue }> {
  const rows: Array<{ label: string; value: JsonValue }> = [];
  if (present(entities.watchLabel) || present(entities.watchId)) {
    rows.push({ label: 'Reloj', value: entities.watchLabel ?? entities.watchId ?? null });
  }
  if (present(entities.customerName) || present(entities.customerId)) {
    rows.push({ label: 'Cliente', value: entities.customerName ?? entities.customerId ?? null });
  }
  if (present(entities.price)) rows.push({ label: 'Precio acordado', value: entities.price ?? null });
  if (present(entities.currency)) rows.push({ label: 'Moneda', value: entities.currency ?? null });
  if (present(entities.date)) rows.push({ label: 'Fecha', value: entities.date ?? null });
  if (present(entities.paymentMode)) rows.push({ label: 'Modo de pago', value: entities.paymentMode ?? null });
  if (present(entities.amountReceived)) rows.push({ label: 'Monto recibido', value: entities.amountReceived ?? null });
  if (present(entities.destination)) {
    const dest = String(entities.destination);
    rows.push({ label: 'Destino', value: destinationLabel[dest] ?? dest });
  }
  if (present(entities.bankChannel)) rows.push({ label: 'Canal bancario', value: entities.bankChannel ?? null });
  return rows;
}

function registerSaleConditionalMissing(entities: StructuredEntities): Array<{ entity: string; question: string }> {
  const missing: Array<{ entity: string; question: string }> = [];
  const mode = typeof entities.paymentMode === 'string' ? entities.paymentMode : null;
  if (!mode) {
    missing.push({ entity: 'paymentMode', question: '¿La venta es de contado (PAID), a crédito (CREDIT) o parcial (PARTIAL)?' });
    return missing;
  }
  if (mode === 'CREDIT') return missing;
  if (!present(entities.destination)) {
    missing.push({ entity: 'destination', question: '¿Dónde se recibió el pago? (CASH, BANCOS o CESAR)' });
  }
  if (mode === 'PARTIAL' && !present(entities.amountReceived)) {
    missing.push({ entity: 'amountReceived', question: '¿Cuánto se recibió como pago inicial?' });
  }
  if (entities.destination === 'BANCOS' && !present(entities.bankChannel)) {
    missing.push({ entity: 'bankChannel', question: '¿Qué canal bancario aplica? (JOSE o MAYTE)' });
  }
  return missing;
}

export const BUSINESS_ACTIONS: readonly BusinessActionDefinition[] = [
  define({ id: 'GET_LIQUIDITY', name: 'Get Liquidity', category: 'FINANCE', tier: 'NONE' }),
  define({ id: 'GET_MONTHLY_PROFIT', name: 'Get Monthly Profit', category: 'ANALYTICS', tier: 'NONE', required: ['year', 'month'] }),
  define({ id: 'SEARCH_INVENTORY', name: 'Search Inventory', category: 'INVENTORY', tier: 'NONE', required: ['query'], optional: ['status', 'limit'] }),
  define({ id: 'SEARCH_CLIENT', name: 'Search Client', category: 'CRM', tier: 'NONE', required: ['query'], optional: ['limit'] }),
  define({ id: 'GET_CLIENT_ACCOUNTS', name: 'Get Client Accounts', category: 'ACCOUNTS', tier: 'NONE', required: ['clientId'], optional: ['type', 'status'] }),
  define({
    id: 'REGISTER_SALE',
    name: 'Register Sale',
    category: 'SALES',
    tier: 'HIGH',
    required: ['watchId', 'customerId', 'price', 'currency'],
    optional: ['date', 'watchLabel', 'customerName', 'watchStatus', 'paymentMode', 'amountReceived', 'destination', 'bankChannel'],
    effectsBuilder: registerSaleEffects,
    previewFields: registerSalePreviewFields,
    conditionalMissing: registerSaleConditionalMissing,
    warnings: [warning('WATCH_RESERVED', 'The selected watch is reserved.', (e) => e.watchStatus === 'RESERVED')],
  }),
  define({ id: 'REGISTER_RECEIVABLE_PAYMENT', name: 'Register Receivable Payment', category: 'ACCOUNTS', tier: 'HIGH', required: ['accountId', 'amount', 'destination'], optional: ['currency', 'date', 'outstandingAmount'], effects: [{ area: 'Accounts', description: 'Outstanding receivable is reduced.' }, { area: 'Treasury', description: 'Destination balance increases.' }], warnings: [warning('AMOUNT_EXCEEDS_OUTSTANDING', 'Payment amount exceeds the outstanding balance.', (e) => typeof e.amount === 'number' && typeof e.outstandingAmount === 'number' && e.amount > e.outstandingAmount)] }),
  define({ id: 'REGISTER_PURCHASE', name: 'Register Purchase', category: 'INVENTORY', tier: 'HIGH', required: ['watch', 'cost', 'currency'], optional: ['date', 'serial', 'duplicateSerial'], effects: [{ area: 'Inventory', description: 'A purchased watch is added to inventory.' }, { area: 'Treasury', description: 'Purchase funding is recorded.' }], warnings: [warning('DUPLICATE_SERIAL', 'The supplied serial already exists.', (e) => e.duplicateSerial === true)] }),
  define({ id: 'REGISTER_EXPENSE', name: 'Register Expense', category: 'EXPENSES', tier: 'MEDIUM', required: ['concept', 'amount', 'currency'], optional: ['date', 'sourceAccountId'], effects: [{ area: 'Expenses', description: 'Operating expense is recorded.' }, { area: 'Treasury', description: 'Source balance is reduced.' }] }),
  define({ id: 'REGISTER_SETTLEMENT', name: 'Register Settlement', category: 'ACCOUNTS', tier: 'HIGH', required: ['sourceAccountId', 'destinationAccountId', 'amount', 'currency'], optional: ['date'], effects: [{ area: 'Accounts', description: 'The selected accounts are settled by the confirmed amount.' }] }),
  define({ id: 'REGISTER_CRYPTO_POSITION', name: 'Register Crypto Position', category: 'TREASURY', tier: 'HIGH', required: ['asset', 'quantity', 'cost', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed position is recorded.' }] }),
  define({ id: 'REGISTER_CRYPTO_PRICE', name: 'Register Crypto Price', category: 'TREASURY', tier: 'MEDIUM', required: ['asset', 'unitPrice', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed price snapshot is recorded.' }] }),
];
