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
  payableAccountId: 'Which payable account should receive the settlement?',
  watch: 'Which watch is being purchased?', cost: 'What is the purchase cost?',
  concept: 'What is the expense for?',
  category: '¿Cuál es la categoría del gasto?',
  source: '¿Desde dónde lo pagaste?',
  sourceAccountId: 'Which account is funding the settlement?',
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

const destinationLabel: Record<string, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  BANCOS: 'Bancos',
  CESAR: 'Cuenta César',
  APPLY_TO_PAYABLE: 'Aplicar a cuenta por pagar',
};

function moneyNumber(value: JsonValue | undefined): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function formatMoneyPreview(amount: JsonValue | undefined, currency: JsonValue | undefined): string {
  const n = moneyNumber(amount);
  const cur = typeof currency === 'string' && currency ? currency : 'MXN';
  if (n === null) return String(amount ?? '');
  return `$${n.toLocaleString('es-MX', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${cur}`;
}

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

function registerReceivablePaymentEffects(entities: StructuredEntities): Array<{ area: string; description: string }> {
  const destination = typeof entities.destination === 'string' ? entities.destination : null;
  const destLabel =
    (typeof entities.destinationLabel === 'string' && entities.destinationLabel) ||
    (destination ? destinationLabel[destination] ?? destination : null);
  const before = entities.outstandingBefore ?? entities.outstandingAmount;
  const after = entities.outstandingAfter;
  const cxc =
    present(before) && present(after)
      ? `CxC ${formatMoneyPreview(before, entities.currency)} → ${formatMoneyPreview(after, entities.currency)}`
      : 'CxC: el saldo pendiente disminuye por el monto del pago.';
  if (destination === 'APPLY_TO_PAYABLE') {
    const pBefore = entities.payableOutstandingBefore ?? entities.payableOutstandingAmount;
    const pAfter = entities.payableOutstandingAfter;
    const cxp =
      present(pBefore) && present(pAfter)
        ? `CxP ${formatMoneyPreview(pBefore, entities.currency)} → ${formatMoneyPreview(pAfter, entities.currency)}`
        : 'CxP: el saldo pendiente disminuye por el mismo monto.';
    return [
      { area: 'CxC', description: cxc },
      { area: 'CxP', description: cxp },
      { area: 'Liquidity', description: 'Liquidez: Sin cambio' },
      { area: 'Correction', description: 'Después de registrarlo, cualquier corrección se realiza desde Cuentas.' },
    ];
  }
  return [
    { area: 'CxC', description: cxc },
    {
      area: 'Treasury',
      description: destLabel ? `${destLabel}: +${formatMoneyPreview(entities.amount, entities.currency)}` : 'Destino de liquidez aumenta por el monto.',
    },
    { area: 'Correction', description: 'Después de registrarlo, cualquier corrección se realiza desde Cuentas.' },
  ];
}

function registerReceivablePaymentPreviewFields(entities: StructuredEntities): Array<{ label: string; value: JsonValue }> {
  const destination = typeof entities.destination === 'string' ? entities.destination : null;
  const rows: Array<{ label: string; value: JsonValue }> = [];
  if (destination === 'APPLY_TO_PAYABLE') {
    if (present(entities.customerName) || present(entities.receivableLabel)) {
      rows.push({
        label: 'CxC',
        value: [entities.customerName, entities.receivableLabel].filter(present).join(' · ') || null,
      });
    }
    if (present(entities.outstandingBefore) || present(entities.outstandingAmount)) {
      const before = entities.outstandingBefore ?? entities.outstandingAmount;
      rows.push({
        label: 'CxC saldo',
        value: present(entities.outstandingAfter)
          ? `${formatMoneyPreview(before, entities.currency)} → ${formatMoneyPreview(entities.outstandingAfter, entities.currency)}`
          : formatMoneyPreview(before, entities.currency),
      });
    }
    if (present(entities.payableLabel)) {
      rows.push({ label: 'CxP', value: entities.payableLabel ?? null });
    }
    if (present(entities.payableOutstandingBefore) || present(entities.payableOutstandingAmount)) {
      const before = entities.payableOutstandingBefore ?? entities.payableOutstandingAmount;
      rows.push({
        label: 'CxP saldo',
        value: present(entities.payableOutstandingAfter)
          ? `${formatMoneyPreview(before, entities.currency)} → ${formatMoneyPreview(entities.payableOutstandingAfter, entities.currency)}`
          : formatMoneyPreview(before, entities.currency),
      });
    }
    if (present(entities.amount)) {
      rows.push({ label: 'Pago', value: formatMoneyPreview(entities.amount, entities.currency) });
    }
    rows.push({ label: 'Liquidez', value: 'Sin cambio' });
    return rows;
  }

  if (present(entities.customerName)) rows.push({ label: 'Cliente', value: entities.customerName ?? null });
  if (present(entities.receivableLabel) || present(entities.accountLabel)) {
    rows.push({ label: 'Cuenta por cobrar', value: entities.receivableLabel ?? entities.accountLabel ?? null });
  }
  if (present(entities.amount)) {
    rows.push({ label: 'Pago', value: formatMoneyPreview(entities.amount, entities.currency) });
  }
  if (destination) {
    rows.push({
      label: 'Destino',
      value: (typeof entities.destinationLabel === 'string' && entities.destinationLabel) || destinationLabel[destination] || destination,
    });
  }
  if (present(entities.outstandingBefore) || present(entities.outstandingAmount)) {
    const before = entities.outstandingBefore ?? entities.outstandingAmount;
    rows.push({
      label: 'CxC',
      value: present(entities.outstandingAfter)
        ? `${formatMoneyPreview(before, entities.currency)} → ${formatMoneyPreview(entities.outstandingAfter, entities.currency)}`
        : formatMoneyPreview(before, entities.currency),
    });
  }
  if (present(entities.date)) rows.push({ label: 'Fecha', value: entities.date ?? null });
  return rows;
}

function registerReceivablePaymentConditionalMissing(
  entities: StructuredEntities,
): Array<{ entity: string; question: string }> {
  const missing: Array<{ entity: string; question: string }> = [];
  const amount = moneyNumber(entities.amount);
  if (amount !== null && amount <= 0) {
    missing.push({ entity: 'amount', question: 'El monto del pago debe ser mayor que cero.' });
  }
  const outstanding = moneyNumber(entities.outstandingAmount ?? entities.outstandingBefore);
  if (amount !== null && outstanding !== null && amount > outstanding) {
    missing.push({
      entity: 'amount',
      question: `El monto supera el saldo pendiente (${formatMoneyPreview(outstanding, entities.currency)}). Indica un monto válido — no se ajusta automáticamente.`,
    });
  }
  if (entities.destination === 'CRYPTO') {
    missing.push({
      entity: 'destination',
      question: 'CRYPTO/USDT no es un destino de cobro soportado. Usa Efectivo, Bancos, César, o aplicar a una cuenta por pagar.',
    });
  }
  if (entities.destination === 'APPLY_TO_PAYABLE') {
    if (!present(entities.payableAccountId) && !present(entities.payableEntryId)) {
      missing.push({
        entity: 'payableAccountId',
        question: '¿A qué cuenta por pagar se aplica este pago?',
      });
    }
    const payableOutstanding = moneyNumber(
      entities.payableOutstandingAmount ?? entities.payableOutstandingBefore,
    );
    if (amount !== null && payableOutstanding !== null && amount > payableOutstanding) {
      missing.push({
        entity: 'amount',
        question: `El monto supera el saldo de la cuenta por pagar (${formatMoneyPreview(payableOutstanding, entities.currency)}). Indica un monto válido.`,
      });
    }
  }
  return missing;
}

const expenseSourceLabel: Record<string, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR: 'Cuenta César',
};

const expenseCategoryLabel: Record<string, string> = {
  GASOLINE: 'Gasolina',
  TOLLS: 'Casetas',
  WATCHMAKER: 'Relojero',
  PARKING: 'Estacionamiento',
  MEALS: 'Comidas',
  FLIGHTS: 'Vuelos',
  TRAVEL: 'Viáticos',
  MARKETING: 'Marketing',
  COMMISSIONS: 'Comisiones',
  OTHER: 'Otro',
};

function formatExpenseDatePreview(value: JsonValue | undefined): string | null {
  if (typeof value !== 'string' || !value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return value;
  const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
  return `${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`;
}

function registerExpenseEffects(entities: StructuredEntities): Array<{ area: string; description: string }> {
  const amountLabel = formatMoneyPreview(entities.amount, entities.currency ?? 'MXN');
  const source = typeof entities.source === 'string' ? entities.source : null;
  const sourceLabel =
    (typeof entities.sourceLabel === 'string' && entities.sourceLabel) ||
    (source ? expenseSourceLabel[source] ?? source : null);
  return [
    { area: 'Gastos', description: `Gastos del mes: +${amountLabel}` },
    {
      area: 'Treasury',
      description: sourceLabel
        ? `${sourceLabel}: -${amountLabel}`
        : `Fuente de liquidez: -${amountLabel}`,
    },
    { area: 'Utilidad neta', description: `Utilidad neta del mes: disminuye ${amountLabel}` },
    {
      area: 'Capital',
      description: 'Capital: Sin cambio bajo la metodología histórica actual (utilidad bruta de trading).',
    },
    { area: 'Correction', description: 'Después de registrarlo, cualquier corrección se realiza desde Gastos.' },
  ];
}

function registerExpensePreviewFields(entities: StructuredEntities): Array<{ label: string; value: JsonValue }> {
  const rows: Array<{ label: string; value: JsonValue }> = [];
  const category = typeof entities.category === 'string' ? entities.category : null;
  const categoryLabel =
    (typeof entities.categoryLabel === 'string' && entities.categoryLabel) ||
    (category ? expenseCategoryLabel[category] ?? category : null);
  const concept = entities.concept ?? entities.notes;
  if (present(concept)) rows.push({ label: 'Concepto', value: concept ?? null });
  if (categoryLabel) rows.push({ label: 'Categoría', value: categoryLabel });
  if (present(entities.amount)) {
    rows.push({ label: 'Monto', value: formatMoneyPreview(entities.amount, entities.currency ?? 'MXN') });
  }
  const source = typeof entities.source === 'string' ? entities.source : null;
  const sourceLabel =
    (typeof entities.sourceLabel === 'string' && entities.sourceLabel) ||
    (source ? expenseSourceLabel[source] ?? source : null);
  if (sourceLabel) rows.push({ label: 'Pagado desde', value: sourceLabel });
  const dateRaw = entities.dateLabel ?? entities.date ?? entities.expenseDate ?? entities.effectiveDate;
  const dateLabel =
    (typeof entities.dateLabel === 'string' && entities.dateLabel) ||
    formatExpenseDatePreview(dateRaw as JsonValue);
  if (dateLabel) rows.push({ label: 'Fecha', value: dateLabel });
  return rows;
}

function registerExpenseConditionalMissing(
  entities: StructuredEntities,
): Array<{ entity: string; question: string }> {
  const missing: Array<{ entity: string; question: string }> = [];
  if (present(entities.expenseUnsupportedReason)) {
    missing.push({
      entity: 'category',
      question: String(entities.expenseUnsupportedReason),
    });
    return missing;
  }
  const currency = typeof entities.currency === 'string' ? entities.currency.toUpperCase() : null;
  if (currency && currency !== 'MXN') {
    missing.push({
      entity: 'currency',
      question:
        'V1 solo registra gastos en MXN. No convierto dólares ni crypto — indica el monto en pesos o regístralo manualmente.',
    });
  }
  if (entities.sourceUnsupported === 'CRYPTO') {
    missing.push({
      entity: 'source',
      question:
        'No registro gastos pagados con crypto en V1. Usa Efectivo, Bancos o Cuenta César.',
    });
  }
  if (!present(entities.source)) {
    missing.push({
      entity: 'source',
      question: '¿Desde dónde lo pagaste? (Efectivo, Bancos o Cuenta César)',
    });
  }
  if (!present(entities.category)) {
    missing.push({
      entity: 'category',
      question:
        (typeof entities.categoryClarifyReason === 'string' && entities.categoryClarifyReason) ||
        '¿Cuál es la categoría del gasto? (Gasolina, Casetas, Marketing, Otro, …)',
    });
  }
  const amount = moneyNumber(entities.amount);
  if (amount !== null && amount <= 0) {
    missing.push({ entity: 'amount', question: 'El monto del gasto debe ser mayor que cero.' });
  }
  return missing;
}

export const BUSINESS_ACTIONS: readonly BusinessActionDefinition[] = [
  define({ id: 'GET_LIQUIDITY', name: 'Get Liquidity', category: 'FINANCE', tier: 'NONE' }),
  define({ id: 'GET_MONTHLY_PROFIT', name: 'Get Monthly Profit', category: 'ANALYTICS', tier: 'NONE', required: ['year', 'month'] }),
  define({ id: 'SEARCH_INVENTORY', name: 'Search Inventory', category: 'INVENTORY', tier: 'NONE', required: ['query'], optional: ['status', 'limit'] }),
  define({ id: 'SEARCH_CLIENT', name: 'Search Client', category: 'CRM', tier: 'NONE', required: ['query'], optional: ['limit'] }),
  define({ id: 'GET_CLIENT_ACCOUNTS', name: 'Get Client Accounts', category: 'ACCOUNTS', tier: 'NONE', required: ['clientId'], optional: ['type', 'status'] }),
  define({ id: 'GET_INVENTORY_AGING', name: 'Get Inventory Aging', category: 'INVENTORY', tier: 'NONE', optional: ['minAgeDays', 'limit'] }),
  define({ id: 'GET_TOP_INVENTORY_CAPITAL', name: 'Get Top Inventory Capital', category: 'INVENTORY', tier: 'NONE', optional: ['limit'] }),
  define({ id: 'GET_TOP_DEBTORS', name: 'Get Top Debtors', category: 'ACCOUNTS', tier: 'NONE', optional: ['limit'] }),
  define({ id: 'GET_RECEIVABLE_SUMMARY', name: 'Get Receivable Summary', category: 'ACCOUNTS', tier: 'NONE' }),
  define({ id: 'GET_SALES_MARGIN_SUMMARY', name: 'Get Sales Margin Summary', category: 'ANALYTICS', tier: 'NONE', optional: ['period', 'year', 'month', 'brand'] }),
  define({ id: 'GET_PROFIT_BY_BRAND', name: 'Get Profit By Brand', category: 'ANALYTICS', tier: 'NONE', optional: ['period', 'year', 'month', 'brand', 'limit'] }),
  define({ id: 'GET_TOP_SALES', name: 'Get Top Sales', category: 'SALES', tier: 'NONE', optional: ['period', 'year', 'month', 'sortBy', 'limit', 'includeCustomerLabel'] }),
  define({ id: 'GET_ATTENTION_ITEMS', name: 'Get Attention Items', category: 'ANALYTICS', tier: 'NONE', optional: ['limit'] }),
  define({ id: 'GET_BUSINESS_SUMMARY', name: 'Get Business Summary', category: 'ANALYTICS', tier: 'NONE' }),
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
  define({
    id: 'REGISTER_RECEIVABLE_PAYMENT',
    name: 'Register Receivable Payment',
    category: 'ACCOUNTS',
    tier: 'HIGH',
    required: ['accountId', 'amount', 'destination'],
    optional: [
      'currency',
      'date',
      'notes',
      'outstandingAmount',
      'outstandingBefore',
      'outstandingAfter',
      'payableAccountId',
      'payableEntryId',
      'payableOutstandingAmount',
      'payableOutstandingBefore',
      'payableOutstandingAfter',
      'customerId',
      'customerName',
      'receivableLabel',
      'accountLabel',
      'payableLabel',
      'destinationLabel',
      'uniqueReceivableSelected',
      'uniquePayableSelected',
    ],
    effectsBuilder: registerReceivablePaymentEffects,
    previewFields: registerReceivablePaymentPreviewFields,
    conditionalMissing: registerReceivablePaymentConditionalMissing,
    warnings: [
      warning(
        'UNSUPPORTED_DESTINATION',
        'CRYPTO is not a receivable-payment destination.',
        (e) => e.destination === 'CRYPTO',
      ),
      warning(
        'UNIQUE_RECEIVABLE_SELECTED',
        'Se usó la única cuenta por cobrar abierta de este cliente.',
        (e) => e.uniqueReceivableSelected === true || e.uniqueReceivableSelected === 'true',
      ),
    ],
  }),
  define({ id: 'REGISTER_PURCHASE', name: 'Register Purchase', category: 'INVENTORY', tier: 'HIGH', required: ['watch', 'cost', 'currency'], optional: ['date', 'serial', 'duplicateSerial'], effects: [{ area: 'Inventory', description: 'A purchased watch is added to inventory.' }, { area: 'Treasury', description: 'Purchase funding is recorded.' }], warnings: [warning('DUPLICATE_SERIAL', 'The supplied serial already exists.', (e) => e.duplicateSerial === true)] }),
  define({
    id: 'REGISTER_EXPENSE',
    name: 'Register Expense',
    category: 'EXPENSES',
    tier: 'MEDIUM',
    required: ['amount', 'currency', 'category', 'source'],
    optional: [
      'concept',
      'notes',
      'date',
      'expenseDate',
      'dateLabel',
      'categoryLabel',
      'sourceLabel',
      'effectiveDate',
      'sourceAccount',
      'sourceAccountId',
      'expenseUnsupportedReason',
      'categoryClarifyReason',
      'sourceUnsupported',
    ],
    effectsBuilder: registerExpenseEffects,
    previewFields: registerExpensePreviewFields,
    conditionalMissing: registerExpenseConditionalMissing,
    reversibility: 'NONE',
  }),
  define({ id: 'REGISTER_SETTLEMENT', name: 'Register Settlement', category: 'ACCOUNTS', tier: 'HIGH', required: ['sourceAccountId', 'destinationAccountId', 'amount', 'currency'], optional: ['date'], effects: [{ area: 'Accounts', description: 'The selected accounts are settled by the confirmed amount.' }] }),
  define({ id: 'REGISTER_CRYPTO_POSITION', name: 'Register Crypto Position', category: 'TREASURY', tier: 'HIGH', required: ['asset', 'quantity', 'cost', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed position is recorded.' }] }),
  define({ id: 'REGISTER_CRYPTO_PRICE', name: 'Register Crypto Price', category: 'TREASURY', tier: 'MEDIUM', required: ['asset', 'unitPrice', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed price snapshot is recorded.' }] }),
];
