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
  exchangeRateUsed: '¿Cuál tipo de cambio MXN aplica para este pago en USD?',
  watch: '¿Qué reloj compraste? (marca y modelo)',
  brand: '¿Qué marca?',
  model: '¿Qué modelo?',
  cost: '¿Cuánto costó la compra?',
  paymentMode: '¿Cómo lo pagaste? (pagado / a crédito / parcial)',
  acquiredAt: '¿Qué fecha de compra?',
  sourceAccount: '¿Desde dónde lo pagaste? (Efectivo, Bancos o Cuenta César)',
  destinationAccount: '¿Hacia qué cuenta? (Efectivo, Bancos o Cuenta César)',
  initialPaymentAmount: '¿Cuánto pagaste ahora?',
  seller: '¿A quién le compraste?',
  concept: 'What is the expense for?',
  category: '¿Cuál es la categoría del gasto?',
  source: '¿Desde dónde lo pagaste?',
  sourceAccountId: 'Which account is funding the settlement?',
  destinationAccountId: 'Which account receives the settlement?', asset: 'Which crypto asset?', quantity: 'What quantity applies?', unitPrice: 'What is the crypto unit price?',
  year: 'Which year?', month: 'Which month?', query: 'What should be searched?', clientId: 'Which client?',
  name: '¿Cómo se llama el cliente?',
  email: '¿Cuál es el correo?',
  phone: '¿Cuál es el teléfono?',
  allowProbableDuplicate: 'Encontré clientes con nombre parecido. ¿Creo uno nuevo de todos modos?',
  investorId: '¿De qué socio es la aportación?',
  account: '¿Cuál es la cuenta de referencia? (Efectivo, Bancos o Cuenta César)',
  contributedAt: '¿Qué fecha tiene la aportación?',
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
  CESAR_ACCOUNT: 'Cuenta César',
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

function registerTreasuryTransferEffects(entities: StructuredEntities): Array<{ area: string; description: string }> {
  const source =
    typeof entities.sourceAccount === 'string'
      ? entities.sourceAccount
      : typeof entities.source === 'string'
        ? entities.source
        : null;
  const dest =
    typeof entities.destinationAccount === 'string'
      ? entities.destinationAccount
      : typeof entities.destination === 'string'
        ? entities.destination
        : null;
  const srcLabel =
    (typeof entities.sourceAccountLabel === 'string' && entities.sourceAccountLabel) ||
    (source ? destinationLabel[source] ?? source : 'Origen');
  const destLabel =
    (typeof entities.destinationAccountLabel === 'string' && entities.destinationAccountLabel) ||
    (dest ? destinationLabel[dest] ?? dest : 'Destino');
  return [
    {
      area: 'Treasury',
      description: `${srcLabel}: −${formatMoneyPreview(entities.amount, entities.currency ?? 'MXN')}`,
    },
    {
      area: 'Treasury',
      description: `${destLabel}: +${formatMoneyPreview(entities.amount, entities.currency ?? 'MXN')}`,
    },
    { area: 'Liquidity', description: 'Liquidez total: Sin cambio' },
    { area: 'P&L', description: 'Utilidad: Sin cambio' },
    { area: 'Capital', description: 'Capital: Sin cambio' },
    {
      area: 'Correction',
      description: 'Después de registrarla, cualquier corrección se realiza desde Tesorería.',
    },
  ];
}

function registerTreasuryTransferPreviewFields(
  entities: StructuredEntities,
): Array<{ label: string; value: JsonValue }> {
  const rows: Array<{ label: string; value: JsonValue }> = [];
  const source =
    typeof entities.sourceAccount === 'string'
      ? entities.sourceAccount
      : typeof entities.source === 'string'
        ? entities.source
        : null;
  const dest =
    typeof entities.destinationAccount === 'string'
      ? entities.destinationAccount
      : typeof entities.destination === 'string'
        ? entities.destination
        : null;
  if (source) {
    rows.push({
      label: 'Desde',
      value:
        (typeof entities.sourceAccountLabel === 'string' && entities.sourceAccountLabel) ||
        destinationLabel[source] ||
        source,
    });
  }
  if (dest) {
    rows.push({
      label: 'Hacia',
      value:
        (typeof entities.destinationAccountLabel === 'string' && entities.destinationAccountLabel) ||
        destinationLabel[dest] ||
        dest,
    });
  }
  if (present(entities.amount)) {
    rows.push({
      label: 'Monto',
      value: formatMoneyPreview(entities.amount, entities.currency ?? 'MXN'),
    });
  }
  if (present(entities.date) || present(entities.transferDate)) {
    rows.push({
      label: 'Fecha',
      value: entities.date ?? entities.transferDate ?? null,
    });
  }
  return rows;
}

function registerCapitalContributionEffects(
  entities: StructuredEntities,
): Array<{ area: string; description: string }> {
  const amount = formatMoneyPreview(entities.amount, entities.currency ?? 'MXN');
  return [
    { area: 'Capital', description: `Capital aportado: +${amount}` },
    { area: 'Capital', description: `Capital neto: +${amount}` },
    { area: 'Ownership', description: 'Ownership: Sin cambio' },
    { area: 'P&L', description: 'Utilidad del negocio: Sin cambio' },
    { area: 'Treasury', description: 'Tesorería: Sin cambio' },
    {
      area: 'Correction',
      description:
        'Después de registrarla, cualquier corrección se realiza desde Capital (revierte y crea de nuevo).',
    },
  ];
}

function registerCapitalContributionPreviewFields(
  entities: StructuredEntities,
): Array<{ label: string; value: JsonValue }> {
  const rows: Array<{ label: string; value: JsonValue }> = [];
  const investorLabel =
    (typeof entities.investorLabel === 'string' && entities.investorLabel) ||
    (typeof entities.investorName === 'string' && entities.investorName) ||
    null;
  if (investorLabel) rows.push({ label: 'Socio', value: investorLabel });
  if (present(entities.amount)) {
    rows.push({
      label: 'Monto',
      value: formatMoneyPreview(entities.amount, entities.currency ?? 'MXN'),
    });
  }
  const account =
    typeof entities.account === 'string'
      ? entities.account
      : typeof entities.capitalAccount === 'string'
        ? entities.capitalAccount
        : null;
  if (account || typeof entities.accountLabel === 'string') {
    rows.push({
      label: 'Cuenta de referencia',
      value:
        (typeof entities.accountLabel === 'string' && entities.accountLabel) ||
        (account ? destinationLabel[account] ?? account : null),
    });
  }
  if (present(entities.contributedAt) || present(entities.date)) {
    rows.push({
      label: 'Fecha',
      value: entities.contributedAt ?? entities.date ?? null,
    });
  }
  return rows;
}

function registerCapitalContributionConditionalMissing(
  entities: StructuredEntities,
): Array<{ entity: string; question: string }> {
  const missing: Array<{ entity: string; question: string }> = [];
  const amount = moneyNumber(entities.amount);
  if (present(entities.amount) && (amount === null || amount <= 0)) {
    missing.push({
      entity: 'amount',
      question: 'El monto de la aportación debe ser mayor que cero.',
    });
  }
  if (
    entities.currency === 'USD' ||
    entities.currency === 'USDT' ||
    entities.currency === 'CRYPTO' ||
    entities.account === 'CRYPTO'
  ) {
    missing.push({
      entity: 'currency',
      question:
        'Las aportaciones de capital V1 son solo en MXN. ¿Confirmas el monto en pesos mexicanos?',
    });
  }
  return missing;
}

function registerTreasuryTransferConditionalMissing(
  entities: StructuredEntities,
): Array<{ entity: string; question: string }> {
  const missing: Array<{ entity: string; question: string }> = [];
  const source =
    typeof entities.sourceAccount === 'string'
      ? entities.sourceAccount
      : typeof entities.source === 'string'
        ? entities.source
        : null;
  const dest =
    typeof entities.destinationAccount === 'string'
      ? entities.destinationAccount
      : typeof entities.destination === 'string'
        ? entities.destination
        : null;
  // amount is required (syntactically present) for READY, but 0 / negative /
  // non-numeric values must never become an executable transfer preview.
  // Negative ACCOUNT BALANCE remains allowed at domain execution; negative
  // TRANSFER AMOUNT is invalid input (not reverse direction).
  const amount = moneyNumber(entities.amount);
  if (present(entities.amount) && (amount === null || amount <= 0)) {
    missing.push({
      entity: 'amount',
      question: 'El monto de la transferencia debe ser mayor que cero.',
    });
  }
  if (source && dest && source === dest) {
    missing.push({
      entity: 'destinationAccount',
      question:
        'No puedo registrar una transferencia entre la misma cuenta. ¿Cuál es la cuenta destino distinta?',
    });
  }
  if (
    entities.currency === 'USD' ||
    entities.currency === 'USDT' ||
    entities.sourceAccount === 'CRYPTO' ||
    entities.destinationAccount === 'CRYPTO' ||
    entities.source === 'CRYPTO' ||
    entities.destination === 'CRYPTO'
  ) {
    missing.push({
      entity: 'currency',
      question:
        'Las transferencias de tesorería V1 son solo en MXN entre Efectivo, Bancos y Cuenta César. ¿Confirmas monto y cuentas en MXN?',
    });
  }
  return missing;
}

function registerPayablePaymentEffects(entities: StructuredEntities): Array<{ area: string; description: string }> {
  const source =
    typeof entities.sourceAccount === 'string'
      ? entities.sourceAccount
      : typeof entities.source === 'string'
        ? entities.source
        : null;
  const srcLabel =
    (typeof entities.sourceAccountLabel === 'string' && entities.sourceAccountLabel) ||
    (source ? destinationLabel[source] ?? source : null);
  const before = entities.outstandingBefore ?? entities.outstandingAmount;
  const after = entities.outstandingAfter;
  const cxp =
    present(before) && present(after)
      ? `CxP ${formatMoneyPreview(before, entities.currency)} → ${formatMoneyPreview(after, entities.currency)}`
      : 'CxP: el saldo pendiente disminuye por el monto del pago.';
  return [
    { area: 'CxP', description: cxp },
    {
      area: 'Treasury',
      description: srcLabel
        ? `${srcLabel}: −${formatMoneyPreview(entities.amount, entities.currency)}`
        : 'Fuente de liquidez disminuye por el monto.',
    },
    { area: 'P&L', description: 'Utilidad: Sin cambio' },
    { area: 'Correction', description: 'Después de registrarlo, cualquier corrección se realiza desde Cuentas.' },
  ];
}

function registerPayablePaymentPreviewFields(entities: StructuredEntities): Array<{ label: string; value: JsonValue }> {
  const rows: Array<{ label: string; value: JsonValue }> = [];
  if (present(entities.counterpartyLabel) || present(entities.customerName)) {
    rows.push({
      label: 'A favor de',
      value: entities.counterpartyLabel ?? entities.customerName ?? null,
    });
  }
  if (present(entities.payableLabel) || present(entities.accountLabel)) {
    rows.push({
      label: 'Cuenta por pagar',
      value: entities.payableLabel ?? entities.accountLabel ?? null,
    });
  }
  if (present(entities.outstandingBefore) || present(entities.outstandingAmount)) {
    const before = entities.outstandingBefore ?? entities.outstandingAmount;
    rows.push({ label: 'Saldo actual', value: formatMoneyPreview(before, entities.currency) });
  }
  if (present(entities.amount)) {
    rows.push({
      label: entities.paymentCompletes === true || entities.paymentCompletes === 'true' ? 'Liquidación' : 'Pago',
      value: formatMoneyPreview(entities.amount, entities.currency),
    });
  }
  const source =
    typeof entities.sourceAccount === 'string'
      ? entities.sourceAccount
      : typeof entities.source === 'string'
        ? entities.source
        : null;
  if (source) {
    rows.push({
      label: 'Desde',
      value:
        (typeof entities.sourceAccountLabel === 'string' && entities.sourceAccountLabel) ||
        destinationLabel[source] ||
        source,
    });
  }
  if (present(entities.outstandingAfter)) {
    rows.push({
      label: 'Saldo después',
      value:
        moneyNumber(entities.outstandingAfter) === 0
          ? 'Liquidada'
          : formatMoneyPreview(entities.outstandingAfter, entities.currency),
    });
  }
  if (present(entities.date)) rows.push({ label: 'Fecha', value: entities.date ?? null });
  rows.push({ label: 'Utilidad', value: 'Sin cambio' });
  return rows;
}

function registerPayablePaymentConditionalMissing(
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
      question: `El saldo pendiente es de ${formatMoneyPreview(outstanding, entities.currency)}. ¿Quieres liquidarlo por ese monto? No se ajusta automáticamente a un sobrepago.`,
    });
  }
  if (entities.sourceAccount === 'CRYPTO' || entities.source === 'CRYPTO') {
    missing.push({
      entity: 'sourceAccount',
      question: 'CRYPTO no es una fuente válida para pagar cuentas por pagar. Usa Efectivo, Bancos o Cuenta César.',
    });
  }
  const currency = typeof entities.currency === 'string' ? entities.currency.toUpperCase() : null;
  if (currency === 'USD' && !present(entities.exchangeRateUsed)) {
    missing.push({
      entity: 'exchangeRateUsed',
      question: 'Esta cuenta está en USD. ¿Cuál tipo de cambio MXN usamos para el pago?',
    });
  }
  return missing;
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

const purchaseSourceLabel: Record<string, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR: 'Cuenta César',
};

const purchasePaymentModeLabel: Record<string, string> = {
  PAID: 'Pagado',
  CREDIT: 'A crédito',
  PARTIAL: 'Pago parcial',
};

const purchaseStatusLabel: Record<string, string> = {
  AVAILABLE: 'Disponible',
  IN_TRANSIT: 'En tránsito',
};

function registerPurchaseEffects(entities: StructuredEntities): Array<{ area: string; description: string }> {
  const costLabel = formatMoneyPreview(
    entities.cost ?? entities.purchaseAmount,
    entities.currency ?? 'MXN',
  );
  const mode = typeof entities.paymentMode === 'string' ? entities.paymentMode : null;
  const source = typeof entities.sourceAccount === 'string'
    ? entities.sourceAccount
    : typeof entities.source === 'string'
      ? entities.source
      : null;
  const sourceLabel =
    (typeof entities.sourceLabel === 'string' && entities.sourceLabel) ||
    (source ? purchaseSourceLabel[source] ?? source : null);
  const seller =
    (typeof entities.sellerLabel === 'string' && entities.sellerLabel) ||
    (typeof entities.sellerCounterpartyName === 'string' && entities.sellerCounterpartyName) ||
    null;
  const initial = formatMoneyPreview(entities.initialPaymentAmount, entities.currency ?? 'MXN');
  const outstanding = formatMoneyPreview(entities.outstandingAmount, entities.currency ?? 'MXN');

  const inventory = {
    area: 'Inventario',
    description: `+1 reloj · +${costLabel} de costo`,
  };
  const pnl = {
    area: 'Utilidad',
    description: 'Sin cambio hasta que el reloj se venda',
  };
  const correction = {
    area: 'Corrección',
    description: 'Después de registrarla, cualquier corrección se realiza desde Inventario.',
  };

  if (mode === 'CREDIT') {
    return [
      inventory,
      { area: 'Tesorería', description: 'Sin cambio' },
      {
        area: 'Cuentas por pagar',
        description: seller ? `${seller}: +${costLabel}` : `+${costLabel}`,
      },
      pnl,
      correction,
    ];
  }
  if (mode === 'PARTIAL') {
    return [
      inventory,
      {
        area: sourceLabel ?? 'Tesorería',
        description: `-${initial}`,
      },
      {
        area: 'Cuentas por pagar',
        description: seller ? `${seller}: +${outstanding}` : `+${outstanding}`,
      },
      pnl,
      correction,
    ];
  }
  // PAID (or unknown — planner should clarify before preview)
  return [
    inventory,
    {
      area: sourceLabel ?? 'Tesorería',
      description: `-${costLabel}`,
    },
    { area: 'Cuentas por pagar', description: 'Sin saldo' },
    pnl,
    correction,
  ];
}

function registerPurchasePreviewFields(
  entities: StructuredEntities,
): Array<{ label: string; value: JsonValue }> {
  const rows: Array<{ label: string; value: JsonValue }> = [];
  const watchLabel =
    (typeof entities.watchLabel === 'string' && entities.watchLabel) ||
    [entities.brand, entities.model].filter((v) => typeof v === 'string' && v).join(' ') ||
    null;
  if (watchLabel) rows.push({ label: 'Reloj', value: watchLabel });
  if (present(entities.cost) || present(entities.purchaseAmount)) {
    rows.push({
      label: 'Costo',
      value: formatMoneyPreview(
        entities.cost ?? entities.purchaseAmount,
        entities.currency ?? 'MXN',
      ),
    });
  }
  const status = typeof entities.status === 'string' ? entities.status : null;
  const statusLabel =
    (typeof entities.statusLabel === 'string' && entities.statusLabel) ||
    (status ? purchaseStatusLabel[status] ?? status : null);
  if (statusLabel) rows.push({ label: 'Estado', value: statusLabel });
  const dateLabel =
    (typeof entities.dateLabel === 'string' && entities.dateLabel) ||
    (typeof entities.acquiredAt === 'string' ? entities.acquiredAt : null) ||
    (typeof entities.acquisitionDate === 'string' ? entities.acquisitionDate : null);
  if (dateLabel) rows.push({ label: 'Fecha de compra', value: dateLabel });

  const seller =
    (typeof entities.sellerLabel === 'string' && entities.sellerLabel) ||
    (typeof entities.sellerCounterpartyName === 'string' && entities.sellerCounterpartyName) ||
    null;
  if (seller) rows.push({ label: 'Vendedor', value: seller });

  const mode = typeof entities.paymentMode === 'string' ? entities.paymentMode : null;
  const modeLabel =
    (typeof entities.paymentModeLabel === 'string' && entities.paymentModeLabel) ||
    (mode ? purchasePaymentModeLabel[mode] ?? mode : null);
  if (modeLabel) rows.push({ label: 'Pago', value: modeLabel });

  if (mode === 'PARTIAL' && present(entities.initialPaymentAmount)) {
    rows.push({
      label: 'Pagado ahora',
      value: formatMoneyPreview(entities.initialPaymentAmount, entities.currency ?? 'MXN'),
    });
  }
  const source = typeof entities.sourceAccount === 'string'
    ? entities.sourceAccount
    : typeof entities.source === 'string'
      ? entities.source
      : null;
  const sourceLabel =
    (typeof entities.sourceLabel === 'string' && entities.sourceLabel) ||
    (source ? purchaseSourceLabel[source] ?? source : null);
  if (sourceLabel && mode !== 'CREDIT') {
    rows.push({ label: 'Desde', value: sourceLabel });
  }
  if (mode === 'PARTIAL' && present(entities.outstandingAmount)) {
    rows.push({
      label: 'Pendiente',
      value: formatMoneyPreview(entities.outstandingAmount, entities.currency ?? 'MXN'),
    });
  }
  if (typeof entities.serialNumber === 'string' || typeof entities.serial === 'string') {
    rows.push({
      label: 'Serie',
      value: (entities.serialNumber ?? entities.serial) as JsonValue,
    });
  }
  return rows;
}

function registerPurchaseConditionalMissing(
  entities: StructuredEntities,
): Array<{ entity: string; question: string }> {
  const missing: Array<{ entity: string; question: string }> = [];

  if (entities.duplicateSerial === true || entities.duplicateSerial === 'true') {
    missing.push({
      entity: 'serial',
      question:
        'Ya existe un reloj activo con ese número de serie. Corrige la serie o revisa el inventario — no se sobrescribe un reloj existente.',
    });
    return missing;
  }

  if (entities.watchIdentityAmbiguous === true || entities.watchIdentityAmbiguous === 'true') {
    missing.push({
      entity: 'watch',
      question:
        '¿Qué marca y modelo exactamente? (ej. Rolex GMT-Master II Batman). No invento referencia ni serie.',
    });
  } else if (!present(entities.brand) || !present(entities.model)) {
    missing.push({
      entity: 'watch',
      question: '¿Qué reloj compraste? Indica marca y modelo.',
    });
  }

  if (!present(entities.cost) && !present(entities.purchaseAmount)) {
    missing.push({
      entity: 'cost',
      question: '¿Cuánto costó la compra?',
    });
  }

  const currency =
    typeof entities.currency === 'string' ? entities.currency.toUpperCase() : null;
  if (currency && currency !== 'MXN' && currency !== 'USD') {
    missing.push({
      entity: 'currency',
      question: 'Solo registro compras en MXN o USD. Indica la moneda correcta.',
    });
  }
  if (currency === 'USD' && !present(entities.fxRate) && !present(entities.exchangeRate)) {
    // Canonical domain fetches FX at execution; preview can proceed with USD cost.
  }

  if (entities.sourceUnsupported === 'CRYPTO') {
    missing.push({
      entity: 'sourceAccount',
      question:
        'No registro compras de inventario pagadas con crypto. Usa Efectivo, Bancos o Cuenta César.',
    });
  }

  const mode = typeof entities.paymentMode === 'string' ? entities.paymentMode : null;
  if (!mode) {
    missing.push({
      entity: 'paymentMode',
      question:
        '¿Cómo lo pagaste? (pagado completo / a crédito / pago parcial con monto inicial)',
    });
  }

  if (mode === 'PAID' || mode === 'PARTIAL') {
    const source =
      entities.sourceAccount ?? entities.source;
    if (!present(source)) {
      missing.push({
        entity: 'sourceAccount',
        question: '¿Desde dónde lo pagaste? (Efectivo, Bancos o Cuenta César)',
      });
    }
  }

  if (mode === 'PARTIAL') {
    const cost = moneyNumber(entities.cost ?? entities.purchaseAmount);
    const initial = moneyNumber(entities.initialPaymentAmount);
    if (initial == null || initial <= 0) {
      missing.push({
        entity: 'initialPaymentAmount',
        question: '¿Cuánto pagaste ahora? (debe ser mayor que 0 y menor que el costo)',
      });
    } else if (cost != null && initial >= cost) {
      missing.push({
        entity: 'paymentMode',
        question:
          'El pago inicial es igual o mayor al costo. Si lo pagaste completo, confirma “pagado”; si no, indica un monto menor.',
      });
    }
  }

  if (mode === 'CREDIT' || mode === 'PARTIAL') {
    if (!present(entities.sellerClientId) && !present(entities.sellerCounterpartyName)) {
      missing.push({
        entity: 'seller',
        question:
          '¿A quién le compraste? Necesito el vendedor para la cuenta por pagar (cliente existente o nombre).',
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
  define({
    id: 'REGISTER_PAYABLE_PAYMENT',
    name: 'Register Payable Payment',
    category: 'ACCOUNTS',
    tier: 'HIGH',
    required: ['accountId', 'amount', 'sourceAccount'],
    optional: [
      'currency',
      'date',
      'notes',
      'outstandingAmount',
      'outstandingBefore',
      'outstandingAfter',
      'payableEntryId',
      'payableAccountId',
      'customerId',
      'customerName',
      'counterpartyLabel',
      'payableLabel',
      'accountLabel',
      'sourceAccountLabel',
      'exchangeRateUsed',
      'payFullOutstanding',
      'paymentCompletes',
      'uniquePayableSelected',
      'payableSource',
    ],
    effectsBuilder: registerPayablePaymentEffects,
    previewFields: registerPayablePaymentPreviewFields,
    conditionalMissing: registerPayablePaymentConditionalMissing,
    warnings: [
      warning(
        'UNSUPPORTED_SOURCE',
        'CRYPTO is not a payable-payment funding source.',
        (e) => e.sourceAccount === 'CRYPTO' || e.source === 'CRYPTO',
      ),
      warning(
        'UNIQUE_PAYABLE_SELECTED',
        'Se usó la única cuenta por pagar abierta de este contacto.',
        (e) => e.uniquePayableSelected === true || e.uniquePayableSelected === 'true',
      ),
    ],
  }),
  define({
    id: 'REGISTER_TREASURY_TRANSFER',
    name: 'Register Treasury Transfer',
    category: 'TREASURY',
    tier: 'HIGH',
    required: ['sourceAccount', 'destinationAccount', 'amount'],
    optional: [
      'currency',
      'date',
      'transferDate',
      'notes',
      'sourceAccountLabel',
      'destinationAccountLabel',
      'source',
      'destination',
    ],
    effectsBuilder: registerTreasuryTransferEffects,
    previewFields: registerTreasuryTransferPreviewFields,
    conditionalMissing: registerTreasuryTransferConditionalMissing,
    reversibility: 'NONE',
    warnings: [
      warning(
        'UNSUPPORTED_ACCOUNT',
        'CRYPTO and arbitrary accounts are not valid treasury transfer accounts.',
        (e) =>
          e.sourceAccount === 'CRYPTO' ||
          e.destinationAccount === 'CRYPTO' ||
          e.source === 'CRYPTO' ||
          e.destination === 'CRYPTO',
      ),
      warning(
        'UNSUPPORTED_CURRENCY',
        'Treasury transfers are MXN only.',
        (e) =>
          typeof e.currency === 'string' &&
          e.currency !== 'MXN' &&
          e.currency !== '' &&
          e.currency !== null,
      ),
    ],
  }),
  define({
    id: 'REGISTER_CAPITAL_CONTRIBUTION',
    name: 'Register Capital Contribution',
    category: 'CAPITAL',
    tier: 'HIGH',
    required: ['investorId', 'amount', 'account', 'contributedAt'],
    optional: [
      'currency',
      'date',
      'notes',
      'investorLabel',
      'investorName',
      'accountLabel',
      'selectedInvestorId',
      'investorQuery',
      'capitalAccount',
    ],
    effectsBuilder: registerCapitalContributionEffects,
    previewFields: registerCapitalContributionPreviewFields,
    conditionalMissing: registerCapitalContributionConditionalMissing,
    reversibility: 'NONE',
    warnings: [
      warning(
        'UNSUPPORTED_CURRENCY',
        'Capital contributions are MXN only.',
        (e) =>
          typeof e.currency === 'string' &&
          e.currency !== 'MXN' &&
          e.currency !== '' &&
          e.currency !== null,
      ),
      warning(
        'LEDGER_ONLY',
        'Esta aportación es solo en el libro de Capital: la Tesorería no se mueve.',
        () => true,
      ),
    ],
  }),
  define({
    id: 'REGISTER_CAPITAL_DISTRIBUTION',
    name: 'Register Capital Distribution',
    category: 'CAPITAL',
    tier: 'HIGH',
    required: ['investorId', 'amount', 'account', 'paidAt'],
    optional: ['currency', 'date', 'notes', 'investorLabel'],
    reversibility: 'NONE',
  }),
  define({
    id: 'REGISTER_PURCHASE',
    name: 'Register Purchase',
    category: 'INVENTORY',
    tier: 'HIGH',
    required: ['brand', 'model', 'cost', 'currency', 'paymentMode', 'acquiredAt'],
    optional: [
      'watch',
      'watchQuery',
      'watchLabel',
      'purchaseAmount',
      'reference',
      'serial',
      'serialNumber',
      'condition',
      'conditionDefaulted',
      'status',
      'statusLabel',
      'date',
      'acquisitionDate',
      'dateLabel',
      'effectiveDate',
      'paymentModeLabel',
      'source',
      'sourceAccount',
      'sourceLabel',
      'initialPaymentAmount',
      'outstandingAmount',
      'sellerClientId',
      'sellerCounterpartyName',
      'sellerLabel',
      'sellerUnlinked',
      'sellerFallbackNote',
      'supplierQuery',
      'sellerQuery',
      'duplicateSerial',
      'sourceUnsupported',
      'watchIdentityAmbiguous',
      'priceMin',
      'priceMax',
    ],
    effectsBuilder: registerPurchaseEffects,
    previewFields: registerPurchasePreviewFields,
    conditionalMissing: registerPurchaseConditionalMissing,
    reversibility: 'NONE',
    warnings: [
      warning(
        'DUPLICATE_SERIAL',
        'Ya existe un reloj activo con ese número de serie. No se puede registrar esta compra.',
        (e) => e.duplicateSerial === true || e.duplicateSerial === 'true',
      ),
      warning(
        'SELLER_UNLINKED',
        'El vendedor se registrará como texto libre (sin cliente vinculado).',
        (e) => e.sellerUnlinked === true || e.sellerUnlinked === 'true',
      ),
    ],
  }),
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
  define({
    id: 'CREATE_CLIENT',
    name: 'Create Client',
    category: 'CRM',
    tier: 'MEDIUM',
    required: ['name'],
    optional: [
      'email',
      'phone',
      'notes',
      'tags',
      'budgetRange',
      'allowProbableDuplicate',
      'hasEmail',
      'hasPhone',
      'clientName',
      'customerName',
      'correo',
      'telefono',
    ],
    effects: [
      { area: 'CRM', description: '+1 cliente' },
      { area: 'Finanzas', description: 'Sin movimientos financieros' },
    ],
    previewFields: (entities) => [
      { label: 'Nombre', value: entities.name ?? '—' },
      { label: 'Correo', value: entities.email ?? '—' },
      { label: 'Teléfono', value: entities.phone ?? '—' },
    ],
    reversibility: 'NONE',
  }),
  define({
    id: 'UPDATE_CLIENT',
    name: 'Update Client',
    category: 'CRM',
    tier: 'MEDIUM',
    required: ['clientId', 'expectedUpdatedAt'],
    optional: [
      'clientLabel',
      'selectedClientId',
      'operations',
      'changedFields',
      'changePreview',
      'preStateHashes',
      'patchName',
      'patchEmail',
      'patchPhone',
      'patchNotes',
      'patchTags',
      'patchBudgetRange',
      'hasEmail',
      'hasPhone',
      'clientQuery',
      'clientName',
      'setName',
      'setEmail',
      'setPhone',
      'setNotes',
      'appendNotes',
      'addTags',
      'removeTags',
      'replaceTags',
      'budgetRange',
      'email',
      'phone',
      'notes',
      'tags',
    ],
    effects: [
      { area: 'CRM', description: 'Actualización de contacto' },
      { area: 'Finanzas', description: 'Sin cambios' },
    ],
    previewFields: (entities) => {
      const rows: Array<{ label: string; value: JsonValue }> = [
        { label: 'Cliente', value: entities.clientLabel ?? entities.clientName ?? '—' },
      ];
      const preview = entities.changePreview;
      if (Array.isArray(preview)) {
        for (const item of preview) {
          if (!item || typeof item !== 'object') continue;
          const row = item as Record<string, JsonValue>;
          const field = String(row.field ?? '');
          const label =
            field === 'name'
              ? 'Nombre'
              : field === 'email'
                ? 'Correo'
                : field === 'phone'
                  ? 'Teléfono'
                  : field === 'notes'
                    ? 'Notas'
                    : field === 'tags'
                      ? 'Etiquetas'
                      : field === 'budgetRange'
                        ? 'Presupuesto'
                        : field || 'Campo';
          rows.push({
            label,
            value: `${String(row.before ?? '—')} → ${String(row.after ?? '—')}`,
          });
        }
      }
      return rows;
    },
    reversibility: 'NONE',
  }),
  define({ id: 'REGISTER_SETTLEMENT', name: 'Register Settlement', category: 'ACCOUNTS', tier: 'HIGH', required: ['sourceAccountId', 'destinationAccountId', 'amount', 'currency'], optional: ['date'], effects: [{ area: 'Accounts', description: 'The selected accounts are settled by the confirmed amount.' }] }),
  define({ id: 'REGISTER_CRYPTO_POSITION', name: 'Register Crypto Position', category: 'TREASURY', tier: 'HIGH', required: ['asset', 'quantity', 'cost', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed position is recorded.' }] }),
  define({ id: 'REGISTER_CRYPTO_PRICE', name: 'Register Crypto Price', category: 'TREASURY', tier: 'MEDIUM', required: ['asset', 'unitPrice', 'currency'], optional: ['date'], effects: [{ area: 'Crypto', description: 'The confirmed price snapshot is recorded.' }] }),
];
