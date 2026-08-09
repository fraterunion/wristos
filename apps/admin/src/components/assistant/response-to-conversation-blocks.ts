import type {
  AssistantWarning,
  BusinessActionId,
  JsonValue,
  StructuredAssistantResponse,
  WritePreviewAction,
} from '@/lib/assistant-types';

// Pure adapter: turns one already-validated StructuredAssistantResponse into an
// ordered list of small, deterministic conversation blocks. It never talks to
// the network, never mutates anything, and never runs on a response that
// validateAssistantResponse has not already accepted — callers must only pass
// `validation.response` from a `{ kind: 'VALID' }` result.
//
// Field names below (cashMxn, preview.fields, entries[].balance, ...) mirror
// the real backend payload shapes in apps/api's read tools and planner types.
// Every read is defensive (optional chaining, safe fallbacks) because this
// adapter has no schema authority over the payload — it only presents it.

export type ConversationBlock =
  | { kind: 'text'; id: string; text: string }
  | { kind: 'summary'; id: string; value: string }
  | { kind: 'breakdown'; id: string; items: Array<{ label: string; value: string }> }
  | { kind: 'question'; id: string; text: string; fields: Array<{ key: string; question: string }> }
  | { kind: 'choices'; id: string; options: Array<{ id: string; label: string; context?: string }>; allowOther: boolean }
  | {
      kind: 'preview';
      id: string;
      intro: string;
      title?: string;
      fields: Array<{ label: string; value: string }>;
      effects: string[];
      ctaLabel: string;
      ctaKind: PreviewCtaKind;
      ctaHref?: string;
      planFingerprint?: string;
      actionRunId?: string;
    }
  | {
      kind: 'receipt';
      id: string;
      message: string;
      lines: string[];
      dealHref?: string;
      correctHref?: string;
    }
  | { kind: 'list'; id: string; intro?: string; items: Array<{ label: string; value: string; meta?: string }> }
  | { kind: 'note'; id: string; text: string }
  | { kind: 'warning'; id: string; text: string }
  | { kind: 'error'; id: string; text: string };

const MANUAL_CTA_LABEL: Partial<Record<WritePreviewAction, string>> = {
  REGISTER_SALE: 'Abrir Ventas',
  REGISTER_RECEIVABLE_PAYMENT: 'Continuar en Cuentas',
  REGISTER_PAYABLE_PAYMENT: 'Continuar en Cuentas',
  REGISTER_TREASURY_TRANSFER: 'Abrir Tesorería',
  REGISTER_CAPITAL_CONTRIBUTION: 'Ver Capital',
  REGISTER_CAPITAL_DISTRIBUTION: 'Ver Capital',
  REGISTER_PURCHASE: 'Abrir Inventario',
  REGISTER_EXPENSE: 'Completar en Gastos',
  CREATE_CLIENT: 'Abrir CRM',
  UPDATE_CLIENT: 'Abrir CRM',
  REGISTER_SETTLEMENT: 'Continuar en Cuentas',
  REGISTER_CRYPTO_POSITION: 'Abrir Crypto',
  REGISTER_CRYPTO_PRICE: 'Abrir Crypto',
};

export function manualCtaLabel(intent: BusinessActionId): string {
  return MANUAL_CTA_LABEL[intent as WritePreviewAction] ?? 'Continuar en el módulo';
}

export type PreviewCtaKind =
  | 'CONFIRM_SALE'
  | 'CONFIRM_PAYMENT'
  | 'CONFIRM_TRANSFER'
  | 'CONFIRM_CONTRIBUTION'
  | 'CONFIRM_EXPENSE'
  | 'CONFIRM_CLIENT'
  | 'CONFIRM_CLIENT_UPDATE'
  | 'CONFIRM_PURCHASE'
  | 'MANUAL_MODULE';


function isRecord(value: JsonValue | undefined | null): value is Record<string, JsonValue> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function asString(value: JsonValue | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value : null;
}

function asArray(value: JsonValue | undefined): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function formatMoney(raw: JsonValue | undefined, currency = 'MXN'): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const value = Number(raw);
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  return `${rounded < 0 ? '-' : ''}$${Math.abs(rounded).toLocaleString('es-MX')} ${currency}`;
}

// Same as formatMoney, but omits amounts that round to zero — a "$0 USD"
// tacked onto a pending-balance chip is noise, not information.
function formatNonZeroMoney(raw: JsonValue | undefined, currency = 'MXN'): string | null {
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  if (Math.round(Number(raw)) === 0) return null;
  return formatMoney(raw, currency);
}

function plural(count: number, singular: string, pluralForm: string): string {
  return count === 1 ? singular : pluralForm;
}

// Placeholder — real, stable ids are assigned once at the end of
// responseToConversationBlocks based on final array position, so the same
// response always produces the same ids on every call.
function blockId(_response: StructuredAssistantResponse, tag: string): string {
  return tag;
}

function warningBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  return response.warnings.map((warning: AssistantWarning) => ({
    kind: 'warning' as const,
    id: `${response.requestId}:warning:${warning.code}`,
    text: warning.message,
  }));
}

function noteBlock(response: StructuredAssistantResponse): ConversationBlock | null {
  const unchanged = asString(response.payload.unchanged);
  return unchanged ? { kind: 'note', id: blockId(response, 'note'), text: unchanged } : null;
}

function liquidityBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const total = formatMoney(data.totalLiquidityMxn);
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: 'Tu liquidez total es:' },
  ];
  if (total) blocks.push({ kind: 'summary', id: blockId(response, 'summary'), value: total });
  const rows: Array<{ label: string; value: string }> = [];
  const cash = formatMoney(data.cashMxn);
  const bank = formatMoney(data.bankMxn);
  const crypto = formatMoney(data.cryptoMxn);
  const cesar = formatMoney(data.cesarMxn);
  if (cash) rows.push({ label: 'Efectivo', value: cash });
  if (bank) rows.push({ label: 'Bancos', value: bank });
  if (crypto) rows.push({ label: 'Crypto', value: crypto });
  if (cesar) rows.push({ label: 'Cuenta César', value: cesar });
  if (rows.length) blocks.push({ kind: 'breakdown', id: blockId(response, 'breakdown'), items: rows });
  return blocks;
}

function monthlyProfitBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const period = asString(data.period);
  const net = formatMoney(data.netProfitMxn);
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: period ? `La utilidad de ${period} es:` : 'La utilidad del periodo es:' },
  ];
  if (net) blocks.push({ kind: 'summary', id: blockId(response, 'summary'), value: net });
  const rows: Array<{ label: string; value: string }> = [];
  const sales = formatMoney(data.salesMxn);
  const cogs = formatMoney(data.cogsMxn);
  const commissions = formatMoney(data.bankCommissionsMxn);
  const opex = formatMoney(data.operatingExpensesMxn);
  if (sales) rows.push({ label: 'Ventas', value: sales });
  if (cogs) rows.push({ label: 'Costo de ventas', value: cogs });
  if (commissions) rows.push({ label: 'Comisiones bancarias', value: commissions });
  if (opex) rows.push({ label: 'Gastos operativos', value: opex });
  if (typeof data.saleCount === 'number') rows.push({ label: 'Ventas registradas', value: String(data.saleCount) });
  if (rows.length) blocks.push({ kind: 'breakdown', id: blockId(response, 'breakdown'), items: rows });
  return blocks;
}

function genericBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : null;
  if (!data) return [{ kind: 'text', id: blockId(response, 'text'), text: 'Estas son las cifras actuales.' }];
  const rows = Object.entries(data)
    .filter(([, value]) => typeof value === 'string' || typeof value === 'number')
    .map(([key, value]) => ({ label: key, value: String(value) }));
  const blocks: ConversationBlock[] = [{ kind: 'text', id: blockId(response, 'text'), text: 'Estas son las cifras actuales.' }];
  if (rows.length) blocks.push({ kind: 'breakdown', id: blockId(response, 'breakdown'), items: rows });
  return blocks;
}

function clientChoices(response: StructuredAssistantResponse, items: JsonValue[]): ConversationBlock[] {
  const options = items.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const id = asString(item.id);
    if (!id) return [];
    const label = asString(item.name) ?? asString(item.label) ?? `Cliente ${index + 1}`;
    const receivable = isRecord(item.openReceivableTotalByCurrency) ? item.openReceivableTotalByCurrency : null;
    const count = typeof item.openReceivableCount === 'number' ? item.openReceivableCount : 0;
    const mxn = receivable ? formatNonZeroMoney(receivable.MXN) : null;
    const usd = receivable ? formatNonZeroMoney(receivable.USD, 'USD') : null;
    const amounts = [mxn, usd].filter((value): value is string => !!value);
    const context = count > 0 && amounts.length ? `${amounts.join(' + ')} pendiente` : undefined;
    return [{ id, label, context }];
  });
  const count = options.length;
  const intro = count
    ? `Encontré ${count} ${plural(count, 'cliente', 'clientes')}.`
    : 'No encontré clientes con ese nombre.';
  const blocks: ConversationBlock[] = [{ kind: 'text', id: blockId(response, 'text'), text: intro }];
  if (options.length) {
    blocks.push({ kind: 'choices', id: blockId(response, 'choices'), options, allowOther: true });
  }
  return blocks;
}

function inventoryList(response: StructuredAssistantResponse, items: JsonValue[]): ConversationBlock[] {
  const count = items.length;
  const intro = count
    ? `Encontré ${count} ${plural(count, 'reloj', 'relojes')}.`
    : 'No encontré relojes con esa búsqueda.';
  const blocks: ConversationBlock[] = [{ kind: 'text', id: blockId(response, 'text'), text: intro }];
  const rows = items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = [asString(item.brand), asString(item.model)].filter(Boolean).join(' ') || asString(item.reference) || 'Reloj';
    const ref = asString(item.reference);
    const cost = formatMoney(item.cost);
    const status = asString(item.status);
    return [{ label: ref ? `${label} (${ref})` : label, value: status ?? '—', meta: cost ?? undefined }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  return blocks;
}

function accountEntriesList(response: StructuredAssistantResponse, entries: JsonValue[]): ConversationBlock[] {
  const count = entries.length;
  const intro = count
    ? `Estas son las cuentas abiertas (${count}).`
    : 'No hay cuentas abiertas para este cliente.';
  const blocks: ConversationBlock[] = [{ kind: 'text', id: blockId(response, 'text'), text: intro }];
  const rows = entries.flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const concept = asString(entry.concept) ?? asString(entry.counterpartyName) ?? 'Cuenta';
    const balance = formatMoney(entry.balance, asString(entry.currency) ?? 'MXN');
    const status = asString(entry.status);
    return [{ label: concept, value: balance ?? '—', meta: status ?? undefined }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  return blocks;
}

function receivableSummaryBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const currencies = isRecord(data.currencies) ? data.currencies : {};
  const mxn = isRecord(currencies.MXN) ? currencies.MXN : {};
  const outstanding = formatMoney(mxn.outstanding);
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: 'Esto es lo que tienes atorado en cuentas por cobrar:' },
  ];
  if (outstanding) blocks.push({ kind: 'summary', id: blockId(response, 'summary'), value: outstanding });
  const rows: Array<{ label: string; value: string }> = [];
  const paid = formatMoney(mxn.paidTotal);
  const original = formatMoney(mxn.originalTotal);
  if (original) rows.push({ label: 'Original MXN', value: original });
  if (paid) rows.push({ label: 'Cobrado MXN', value: paid });
  if (typeof mxn.activeAccountCount === 'number') {
    rows.push({ label: 'Cuentas activas MXN', value: String(mxn.activeAccountCount) });
  }
  const usd = isRecord(currencies.USD) ? currencies.USD : {};
  const usdOut = formatNonZeroMoney(usd.outstanding, 'USD');
  if (usdOut) rows.push({ label: 'Pendiente USD', value: usdOut });
  if (rows.length) blocks.push({ kind: 'breakdown', id: blockId(response, 'breakdown'), items: rows });
  return blocks;
}

function salesMarginBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const period = asString(data.period);
  const gross = formatMoney(data.grossProfit);
  const blocks: ConversationBlock[] = [
    {
      kind: 'text',
      id: blockId(response, 'text'),
      text: period ? `El margen bruto de ${period} es:` : 'El margen bruto del periodo es:',
    },
  ];
  if (gross) blocks.push({ kind: 'summary', id: blockId(response, 'summary'), value: gross });
  const rows: Array<{ label: string; value: string }> = [];
  const revenue = formatMoney(data.revenue);
  const cogs = formatMoney(data.cogs);
  if (revenue) rows.push({ label: 'Ingresos', value: revenue });
  if (cogs) rows.push({ label: 'Costo (COGS)', value: cogs });
  if (typeof data.grossMarginPercent === 'string' || typeof data.grossMarginPercent === 'number') {
    rows.push({ label: 'Margen %', value: `${data.grossMarginPercent}%` });
  }
  if (typeof data.unitsSold === 'number') rows.push({ label: 'Unidades', value: String(data.unitsSold) });
  rows.push({ label: 'Nota', value: 'Margen bruto ≠ utilidad neta' });
  if (rows.length) blocks.push({ kind: 'breakdown', id: blockId(response, 'breakdown'), items: rows });
  return blocks;
}

function attentionBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const items = asArray(data.items);
  const count = items.length;
  const blocks: ConversationBlock[] = [
    {
      kind: 'text',
      id: blockId(response, 'text'),
      text: count
        ? `Veo ${count} ${plural(count, 'cosa', 'cosas')} que vale la pena revisar.`
        : 'No veo alertas operativas relevantes ahora.',
    },
  ];
  const rows = items.flatMap((item, index) => {
    if (!isRecord(item)) return [];
    const title = asString(item.title) ?? `Punto ${index + 1}`;
    const explanation = asString(item.explanation) ?? '—';
    const severity = asString(item.severity);
    return [{ label: `${index + 1}. ${title}${severity ? ` (${severity})` : ''}`, value: explanation }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows.map((r) => ({ label: r.label, value: r.value })) });
  return blocks;
}

function businessSummaryBreakdown(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const liquidity = isRecord(data.liquidity) ? data.liquidity : {};
  const inventory = isRecord(data.inventory) ? data.inventory : {};
  const receivables = isRecord(data.receivables) ? data.receivables : {};
  const monthly = isRecord(data.monthlyPerformance) ? data.monthlyPerformance : {};
  const attention = asArray(data.attentionItems);
  const period = asString(monthly.period) ?? 'este mes';
  const blocks: ConversationBlock[] = [
    {
      kind: 'text',
      id: blockId(response, 'text'),
      text: `Así va Wrist Caviar (${period}):`,
    },
    {
      kind: 'breakdown',
      id: blockId(response, 'breakdown'),
      items: [
        { label: 'Liquidez', value: formatMoney(liquidity.totalLiquidityMxn) ?? '—' },
        {
          label: 'Inventario',
          value:
            typeof inventory.activeItemCount === 'number'
              ? `${inventory.activeItemCount} piezas · ${formatMoney(inventory.activeCapital) ?? '—'} de capital`
              : formatMoney(inventory.activeCapital) ?? '—',
        },
        { label: 'CXC MXN', value: formatMoney(receivables.MXN) ?? '—' },
        { label: 'CXC USD', value: formatMoney(receivables.USD) ?? '—' },
        { label: 'Utilidad del mes', value: formatMoney(monthly.netProfit) ?? '—' },
      ],
    },
  ];
  if (attention.length) {
    blocks.push({
      kind: 'text',
      id: blockId(response, 'attention-intro'),
      text: `Veo ${attention.length} ${plural(attention.length, 'cosa', 'cosas')} que vale la pena revisar.`,
    });
    const rows = attention.slice(0, 5).flatMap((item, index) => {
      if (!isRecord(item)) return [];
      const title = asString(item.title) ?? `Punto ${index + 1}`;
      const explanation = asString(item.explanation) ?? '—';
      return [{ label: `${index + 1}. ${title}`, value: explanation }];
    });
    if (rows.length) {
      blocks.push({ kind: 'list', id: blockId(response, 'attention-list'), items: rows });
    }
  }
  return blocks;
}

function agingList(response: StructuredAssistantResponse, items: JsonValue[]): ConversationBlock[] {
  const count = items.length;
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const capital = formatMoney(data.totalCapitalAtRisk);
  const blocks: ConversationBlock[] = [
    {
      kind: 'text',
      id: blockId(response, 'text'),
      text: count
        ? 'Inventario más antiguo por días registrados en WristOS:'
        : 'No hay inventario activo que coincida con ese filtro de antigüedad.',
    },
  ];
  const rows = items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label =
      asString(item.label) ||
      [asString(item.brand), asString(item.reference)].filter(Boolean).join(' ') ||
      'Reloj';
    const age =
      typeof item.ageDays === 'number' ? `${item.ageDays} días en WristOS` : '—';
    const cost = formatMoney(item.cost);
    return [{ label, value: age, meta: cost ?? undefined }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  if (capital) {
    blocks.push({
      kind: 'note',
      id: blockId(response, 'note-capital'),
      text: `Capital en este filtro: ${capital}. Edad = días desde el registro en WristOS (no fecha de compra física garantizada).`,
    });
  }
  return blocks;
}

function capitalList(response: StructuredAssistantResponse, items: JsonValue[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: 'Donde tienes más capital en inventario activo:' },
  ];
  const rows = items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asString(item.label) ?? 'Reloj';
    const cost = formatMoney(item.cost) ?? '—';
    const pctRaw =
      item.percentOfActiveInventoryCapital ?? item.percentOfInventoryCapital;
    const pct =
      typeof pctRaw === 'string' || typeof pctRaw === 'number'
        ? `${pctRaw}% del capital activo en inventario`
        : undefined;
    return [{ label, value: cost, meta: pct }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  return blocks;
}

function debtorsList(response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : {};
  const currencies = isRecord(data.currencies) ? data.currencies : {};
  const mxn = asArray(currencies.MXN);
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: 'En MXN, los mayores saldos pendientes:' },
  ];
  const rows = mxn.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asString(item.clientLabel) ?? 'Cliente';
    const outstanding = formatMoney(item.outstanding) ?? '—';
    const accounts =
      typeof item.openAccountCount === 'number' ? `${item.openAccountCount} cuentas` : undefined;
    return [{ label, value: outstanding, meta: accounts }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  else blocks.push({ kind: 'note', id: blockId(response, 'empty'), text: 'No hay saldos CXC pendientes en MXN.' });
  return blocks;
}

function brandProfitList(response: StructuredAssistantResponse, items: JsonValue[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: 'Utilidad bruta por marca:' },
  ];
  const rows = items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const brand = asString(item.brand) ?? 'Sin marca';
    const profit = formatMoney(item.grossProfit) ?? '—';
    const margin =
      typeof item.grossMarginPercent === 'string' || typeof item.grossMarginPercent === 'number'
        ? `${item.grossMarginPercent}% · ${item.unitsSold ?? 0} u.`
        : undefined;
    return [{ label: brand, value: profit, meta: margin }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  return blocks;
}

function topSalesList(response: StructuredAssistantResponse, items: JsonValue[]): ConversationBlock[] {
  const blocks: ConversationBlock[] = [
    { kind: 'text', id: blockId(response, 'text'), text: 'Mejores ventas (margen bruto):' },
  ];
  const rows = items.flatMap((item) => {
    if (!isRecord(item)) return [];
    const label = asString(item.watchLabel) ?? 'Venta';
    const profit = formatMoney(item.grossProfit) ?? '—';
    const metaParts = [
      formatMoney(item.saleAmount) ?? null,
      typeof item.grossMarginPercent === 'string' || typeof item.grossMarginPercent === 'number'
        ? `${item.grossMarginPercent}%`
        : null,
    ].filter(Boolean);
    return [{ label, value: profit, meta: metaParts.join(' · ') || undefined }];
  });
  if (rows.length) blocks.push({ kind: 'list', id: blockId(response, 'list'), items: rows });
  return blocks;
}

function entityListBlocks(intent: BusinessActionId, response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : null;
  const items = asArray(data?.items);
  const entries = asArray(data?.entries);
  if (entries.length) return accountEntriesList(response, entries);
  if (intent === 'SEARCH_INVENTORY') return inventoryList(response, items);
  if (intent === 'SEARCH_CLIENT' || intent === 'GET_CLIENT_ACCOUNTS') return clientChoices(response, items);
  // Write disambiguation / controlled composition dependency CTAs.
  if (
    response.payload.entityType === 'CLIENT' ||
    intent === 'REGISTER_PURCHASE' ||
    intent === 'REGISTER_SALE' ||
    intent === 'CREATE_CLIENT' ||
    intent === 'UPDATE_CLIENT' ||
    intent === 'REGISTER_RECEIVABLE_PAYMENT'
  ) {
    if (items.length) return clientChoices(response, items);
  }
  if (intent === 'GET_INVENTORY_AGING') return agingList(response, items);
  if (intent === 'GET_TOP_INVENTORY_CAPITAL') return capitalList(response, items);
  if (intent === 'GET_TOP_DEBTORS') return debtorsList(response);
  if (intent === 'GET_PROFIT_BY_BRAND') return brandProfitList(response, items);
  if (intent === 'GET_TOP_SALES') return topSalesList(response, items);
  if (items.length) return inventoryList(response, items);
  return [{ kind: 'text', id: blockId(response, 'text'), text: 'No encontré resultados.' }];
}

function missingFieldsBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const groups = asArray(response.payload.groups);
  const fields = groups.flatMap((group) => {
    if (!isRecord(group) || !Array.isArray(group.fields)) return [];
    return group.fields.flatMap((field) => {
      if (!isRecord(field) || typeof field.key !== 'string') return [];
      return [{ key: field.key, question: asString(field.question) ?? field.key }];
    });
  });
  const message =
    asString(response.payload.message) ??
    'Necesito algunos datos para continuar.';
  if (!fields.length) {
    return [{ kind: 'text', id: blockId(response, 'text'), text: message }];
  }
  return [
    {
      kind: 'question',
      id: blockId(response, 'question'),
      text: message,
      fields,
    },
  ];
}

function previewBlocks(intent: BusinessActionId, response: StructuredAssistantResponse): ConversationBlock[] {
  const preview = isRecord(response.payload.preview) ? response.payload.preview : null;
  const title = preview ? asString(preview.title) ?? undefined : undefined;
  const fields = preview && Array.isArray(preview.fields)
    ? preview.fields.flatMap((field) => {
        if (!isRecord(field)) return [];
        const label = asString(field.label);
        if (!label) return [];
        const value = typeof field.value === 'string' || typeof field.value === 'number' ? String(field.value) : JSON.stringify(field.value);
        return [{ label, value }];
      })
    : [];
  const effects = preview && Array.isArray(preview.estimatedEffects)
    ? preview.estimatedEffects.flatMap((effect) => {
        if (!isRecord(effect)) return [];
        const description = asString(effect.description);
        return description ? [description] : [];
      })
    : [];
  const executableSale =
    intent === 'REGISTER_SALE' && response.payload.executable === true;
  const executablePayment =
    (intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
      intent === 'REGISTER_PAYABLE_PAYMENT') &&
    response.payload.executable === true;
  const executableTransfer =
    intent === 'REGISTER_TREASURY_TRANSFER' && response.payload.executable === true;
  const executableContribution =
    intent === 'REGISTER_CAPITAL_CONTRIBUTION' && response.payload.executable === true;
  const executableExpense =
    intent === 'REGISTER_EXPENSE' && response.payload.executable === true;
  const executablePurchase =
    intent === 'REGISTER_PURCHASE' && response.payload.executable === true;
  const executableCreateClient =
    intent === 'CREATE_CLIENT' && response.payload.executable === true;
  const executableUpdateClient =
    intent === 'UPDATE_CLIENT' && response.payload.executable === true;
  const planFingerprint = asString(response.payload.planFingerprint) ?? undefined;
  const intro = executableUpdateClient
    ? 'Voy a actualizar este cliente:'
    : executableCreateClient
      ? 'Voy a crear este cliente:'
      : executablePurchase
        ? 'Voy a registrar esta compra:'
        : executableExpense
          ? 'Voy a registrar este gasto:'
          : executableContribution
            ? 'Voy a registrar esta aportación:'
            : executableTransfer
              ? 'Voy a registrar esta transferencia:'
              : executablePayment
                ? (fields.some((f) => f.label === 'Liquidez' && f.value === 'Sin cambio')
                    ? 'Voy a aplicar este pago directamente a una cuenta por pagar:'
                    : 'Voy a registrar este pago:')
                : executableSale
                  ? 'Perfecto. Esto es lo que voy a registrar:'
                  : 'Perfecto. Esto es lo que voy a preparar:';
  return [
    {
      kind: 'preview',
      id: blockId(response, 'preview'),
      intro,
      title,
      fields,
      effects,
      ctaLabel: executableUpdateClient
        ? 'Guardar cambios'
        : executableCreateClient
          ? 'Crear cliente'
          : executablePurchase
            ? 'Confirmar compra'
            : executableExpense
              ? 'Confirmar gasto'
              : executableContribution
                ? 'Confirmar aportación'
                : executableTransfer
                  ? 'Confirmar transferencia'
                  : executablePayment
                    ? 'Confirmar pago'
                    : executableSale
                      ? 'Confirmar venta'
                      : manualCtaLabel(intent),
      ctaKind: executableUpdateClient
        ? 'CONFIRM_CLIENT_UPDATE'
        : executableCreateClient
          ? 'CONFIRM_CLIENT'
          : executablePurchase
            ? 'CONFIRM_PURCHASE'
            : executableExpense
              ? 'CONFIRM_EXPENSE'
              : executableContribution
                ? 'CONFIRM_CONTRIBUTION'
                : executableTransfer
                  ? 'CONFIRM_TRANSFER'
                  : executablePayment
                    ? 'CONFIRM_PAYMENT'
                    : executableSale
                      ? 'CONFIRM_SALE'
                      : 'MANUAL_MODULE',
      planFingerprint,
      actionRunId: response.actionRunId,
    },
  ];
}

function saleReceiptBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. La venta quedó registrada.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const watch = asString(receipt.watchLabel);
    const amount = formatMoney(receipt.amount, asString(receipt.currency) ?? 'MXN');
    if (watch || amount) {
      lines.push([watch, amount].filter(Boolean).join(' · '));
    }
    const customer = asString(receipt.customerName);
    if (customer) lines.push(`Cliente: ${customer}`);
    const destRaw = asString(receipt.destination);
    const destLabel =
      destRaw === 'CASH' ? 'Efectivo' : destRaw === 'BANCOS' ? 'Bancos' : destRaw === 'CESAR' ? 'César' : destRaw;
    const mode = asString(receipt.paymentMode);
    if (mode === 'CREDIT') lines.push('Pago: Crédito');
    else if (destLabel) lines.push(`Pago: ${destLabel}`);
    const remaining = formatNonZeroMoney(
      receipt.remainingReceivable,
      asString(receipt.currency) ?? 'MXN',
    );
    if (remaining) lines.push(`Cuenta por cobrar: ${remaining}`);
  }
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: receipt && typeof receipt.dealId === 'string' ? `/ventas?deal=${receipt.dealId}` : '/ventas',
      correctHref: '/ventas',
    },
  ];
}

function expenseReceiptBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. El gasto quedó registrado.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const currency = asString(receipt.currency) ?? 'MXN';
    const concept = asString(receipt.concept);
    const amount = formatMoney(receipt.amount, currency);
    if (concept) lines.push(concept);
    if (amount) lines.push(amount);
    if (asString(receipt.category) === 'OTHER') {
      lines.push('Categoría: Otro');
    }
    const source =
      asString(receipt.sourceLabel) ||
      (() => {
        const raw = asString(receipt.sourceAccount);
        if (raw === 'CASH') return 'Efectivo';
        if (raw === 'BANK') return 'Bancos';
        if (raw === 'CESAR') return 'Cuenta César';
        return raw;
      })();
    if (source) lines.push(`Pagado desde: ${source}`);
    const date = asString(receipt.expenseDate);
    if (date) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(date);
      const months = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
      lines.push(
        m
          ? `Fecha: ${Number(m[3])} ${months[Number(m[2]) - 1]} ${m[1]}`
          : `Fecha: ${date}`,
      );
    }
  }
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: '/expenses',
      correctHref: '/expenses',
    },
  ];
}

function purchaseReceiptBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. La compra quedó registrada.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const watch = asString(receipt.watchLabel);
    if (watch) lines.push(watch);
    const cost = formatMoney(receipt.costMxn, asString(receipt.currency) ?? 'MXN');
    if (cost) lines.push(`Costo ${cost}`);
    const mode = asString(receipt.paymentMode);
    const source =
      asString(receipt.sourceLabel) ||
      (() => {
        const raw = asString(receipt.sourceAccount);
        if (raw === 'CASH') return 'Efectivo';
        if (raw === 'BANK') return 'Bancos';
        if (raw === 'CESAR') return 'Cuenta César';
        return raw;
      })();
    if (mode === 'PAID') {
      lines.push(source ? `Pagado desde ${source}` : 'Pagado');
      lines.push('Pendiente: Sin saldo');
    } else if (mode === 'CREDIT') {
      const seller = asString(receipt.seller);
      const outstanding = formatMoney(
        receipt.outstandingPayable ?? receipt.costMxn,
        asString(receipt.currency) ?? 'MXN',
      );
      if (seller) lines.push(`Vendedor: ${seller}`);
      lines.push('Pago: A crédito');
      if (outstanding) lines.push(`Cuenta por pagar: ${outstanding}`);
    } else if (mode === 'PARTIAL') {
      const paid = formatMoney(
        receipt.initialPaymentAmount,
        asString(receipt.currency) ?? 'MXN',
      );
      const outstanding = formatMoney(
        receipt.outstandingPayable,
        asString(receipt.currency) ?? 'MXN',
      );
      if (paid) lines.push(source ? `Pagado ${paid} desde ${source}` : `Pagado ${paid}`);
      if (outstanding) lines.push(`Pendiente ${outstanding}`);
    }
    const status = asString(receipt.statusLabel) ?? asString(receipt.status);
    if (status) lines.push(`Estado: ${status}`);
  }
  const watchId = receipt && typeof receipt.watchId === 'string' ? receipt.watchId : null;
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: watchId ? `/inventory?watch=${watchId}` : '/inventory',
      correctHref: '/inventory',
    },
  ];
}

function createClientReceiptBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. El cliente quedó creado.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const name = asString(receipt.name);
    if (name) lines.push(name);
    const phoneMasked = asString(receipt.phoneMasked);
    if (phoneMasked) lines.push(`Teléfono ${phoneMasked}`);
    const emailMasked = asString(receipt.emailMasked);
    if (emailMasked) lines.push(`Correo ${emailMasked}`);
  }
  const clientId = receipt && typeof receipt.clientId === 'string' ? receipt.clientId : null;
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: clientId ? `/crm/${clientId}` : '/crm',
      correctHref: '/crm',
    },
  ];
}

function updateClientReceiptBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. El cliente quedó actualizado.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const name = asString(receipt.name);
    if (name) lines.push(name);
    const changed = Array.isArray(receipt.changedFields)
      ? receipt.changedFields.map((f) => String(f)).join(', ')
      : null;
    if (changed) lines.push(`Cambios: ${changed}`);
    const phoneMasked = asString(receipt.phoneMasked);
    if (phoneMasked) lines.push(`Teléfono ${phoneMasked}`);
    const emailMasked = asString(receipt.emailMasked);
    if (emailMasked) lines.push(`Correo ${emailMasked}`);
  }
  const clientId = receipt && typeof receipt.clientId === 'string' ? receipt.clientId : null;
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: clientId ? `/crm/${clientId}` : '/crm',
      correctHref: '/crm',
    },
  ];
}

function treasuryTransferReceiptBlocks(
  response: StructuredAssistantResponse,
): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. La transferencia quedó registrada.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const currency = asString(receipt.currency) ?? 'MXN';
    const amount = formatMoney(receipt.amount, currency);
    const src =
      asString(receipt.sourceAccountLabel) ||
      (() => {
        const raw = asString(receipt.sourceAccount);
        if (raw === 'CASH') return 'Efectivo';
        if (raw === 'BANK') return 'Bancos';
        if (raw === 'CESAR') return 'Cuenta César';
        return raw;
      })();
    const dest =
      asString(receipt.destinationAccountLabel) ||
      (() => {
        const raw = asString(receipt.destinationAccount);
        if (raw === 'CASH') return 'Efectivo';
        if (raw === 'BANK') return 'Bancos';
        if (raw === 'CESAR') return 'Cuenta César';
        return raw;
      })();
    if (src && amount) lines.push(`${src}: -${amount}`);
    if (dest && amount) lines.push(`${dest}: +${amount}`);
    lines.push('Liquidez total: Sin cambio');
  }
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: '/treasury',
      correctHref: '/treasury',
    },
  ];
}

function capitalContributionReceiptBlocks(
  response: StructuredAssistantResponse,
): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. La aportación quedó registrada.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const currency = asString(receipt.currency) ?? 'MXN';
    const amount = formatMoney(receipt.amount, currency);
    const investor = asString(receipt.investorLabel);
    if (investor) lines.push(investor);
    if (amount) lines.push(`Aportación · ${amount}`);
    const account =
      asString(receipt.accountLabel) ||
      (() => {
        const raw = asString(receipt.account);
        if (raw === 'CASH') return 'Efectivo';
        if (raw === 'BANK') return 'Bancos';
        if (raw === 'CESAR_ACCOUNT') return 'Cuenta César';
        return raw;
      })();
    if (account) lines.push(`Cuenta de referencia · ${account}`);
    if (amount) lines.push(`Capital aportado · +${amount}`);
    lines.push('Tesorería · Sin cambio');
    lines.push('Ownership · Sin cambio');
  }
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: '/capital',
      correctHref: '/capital',
    },
  ];
}

function paymentReceiptBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message =
    asString(response.payload.message) ?? 'Listo. El pago quedó registrado.';
  const receipt = isRecord(response.payload.receipt) ? response.payload.receipt : null;
  const lines: string[] = [];
  if (receipt) {
    const kind = asString(receipt.kind);
    const currency = asString(receipt.currency) ?? 'MXN';
    if (kind === 'SETTLEMENT') {
      const cxc = asString(receipt.customerName);
      const remainingCxc = formatMoney(receipt.remainingReceivable, currency);
      if (cxc || remainingCxc) lines.push(`CxC ${[cxc, remainingCxc].filter(Boolean).join(' · ')}`);
      const cxp = asString(receipt.payableLabel);
      const remainingCxp = formatMoney(receipt.remainingPayable, currency);
      if (cxp || remainingCxp) lines.push(`CxP ${[cxp, remainingCxp].filter(Boolean).join(' · ')}`);
      lines.push('Liquidez: Sin cambio');
    } else if (kind === 'PAYABLE_CASH_PAYMENT') {
      const party = asString(receipt.counterpartyLabel) ?? asString(receipt.customerName);
      const amount = formatMoney(receipt.amount, currency);
      if (party || amount) lines.push([party, amount].filter(Boolean).join(' · '));
      const src =
        asString(receipt.sourceAccountLabel) ||
        (() => {
          const raw = asString(receipt.sourceAccount);
          if (raw === 'CASH') return 'Efectivo';
          if (raw === 'BANK') return 'Bancos';
          if (raw === 'CESAR') return 'Cuenta César';
          return raw;
        })();
      if (src) lines.push(`Desde: ${src}`);
      const remaining = formatMoney(receipt.remainingOutstanding, currency);
      const status = asString(receipt.status);
      if (status === 'PAID' || remaining === '$0.00' || remaining === '0.00') {
        lines.push('Cuenta liquidada.');
      } else if (remaining) {
        lines.push(`Saldo pendiente: ${remaining}`);
      }
    } else {
      const customer = asString(receipt.customerName);
      const amount = formatMoney(receipt.amount, currency);
      if (customer || amount) lines.push([customer, amount].filter(Boolean).join(' · '));
      const dest =
        asString(receipt.destinationLabel) ||
        (() => {
          const destRaw = asString(receipt.destination);
          if (destRaw === 'CASH') return 'Efectivo';
          if (destRaw === 'BANK') return 'Bancos';
          if (destRaw === 'CESAR') return 'Cuenta César';
          return destRaw;
        })();
      if (dest) lines.push(`Destino: ${dest}`);
      const remaining = formatMoney(receipt.remainingReceivable, currency);
      if (remaining) lines.push(`CxC pendiente: ${remaining}`);
    }
  }
  const entryId =
    receipt && typeof receipt.payableEntryId === 'string'
      ? receipt.payableEntryId
      : receipt && typeof receipt.receivableEntryId === 'string'
        ? receipt.receivableEntryId
        : null;
  return [
    {
      kind: 'receipt',
      id: blockId(response, 'receipt'),
      message,
      lines,
      dealHref: entryId ? `/cuentas?entry=${entryId}` : '/cuentas',
      correctHref: '/cuentas',
    },
  ];
}

function errorBlocks(response: StructuredAssistantResponse): ConversationBlock[] {
  const message = asString(response.payload.message) ?? 'No pude completar la consulta. No se realizó ningún cambio.';
  return [{ kind: 'error', id: blockId(response, 'error'), text: message }];
}

/**
 * Maps one validated response to ordered conversation blocks. `response` must
 * already be the `.response` of a `{ kind: 'VALID' }` result from
 * validateAssistantResponse — this function performs no safety checks of its
 * own and must never be called on a FAIL_CLOSED candidate.
 */
export function responseToConversationBlocks(
  intent: BusinessActionId,
  response: StructuredAssistantResponse,
): ConversationBlock[] {
  let main: ConversationBlock[];
  const isError = response.responseType === 'ERROR_RECOVERY_CARD';
  switch (response.responseType) {
    case 'ERROR_RECOVERY_CARD':
      main = errorBlocks(response);
      break;
    case 'ACTION_PREVIEW_CARD':
      main = previewBlocks(intent, response);
      break;
    case 'MISSING_FIELDS_CARD':
      main = missingFieldsBlocks(response);
      break;
    case 'METRIC_BREAKDOWN':
      main =
        intent === 'GET_LIQUIDITY'
          ? liquidityBreakdown(response)
          : intent === 'GET_MONTHLY_PROFIT'
            ? monthlyProfitBreakdown(response)
            : intent === 'GET_RECEIVABLE_SUMMARY'
              ? receivableSummaryBreakdown(response)
              : intent === 'GET_SALES_MARGIN_SUMMARY'
                ? salesMarginBreakdown(response)
                : intent === 'GET_ATTENTION_ITEMS'
                  ? attentionBreakdown(response)
                  : intent === 'GET_BUSINESS_SUMMARY'
                    ? businessSummaryBreakdown(response)
                  : genericBreakdown(response);
      break;
    case 'ENTITY_LIST':
    case 'ENTITY_PICKER':
      main = entityListBlocks(intent, response);
      break;
    case 'METRIC_CARD':
    case 'SUCCESS_RECEIPT': {
      if (intent === 'REGISTER_SALE') {
        main = saleReceiptBlocks(response);
        break;
      }
      if (
        intent === 'REGISTER_RECEIVABLE_PAYMENT' ||
        intent === 'REGISTER_PAYABLE_PAYMENT'
      ) {
        main = paymentReceiptBlocks(response);
        break;
      }
      if (intent === 'REGISTER_TREASURY_TRANSFER') {
        main = treasuryTransferReceiptBlocks(response);
        break;
      }
      if (intent === 'REGISTER_CAPITAL_CONTRIBUTION') {
        main = capitalContributionReceiptBlocks(response);
        break;
      }
      if (intent === 'REGISTER_EXPENSE') {
        main = expenseReceiptBlocks(response);
        break;
      }
      if (intent === 'REGISTER_PURCHASE') {
        main = purchaseReceiptBlocks(response);
        break;
      }
      if (intent === 'CREATE_CLIENT') {
        main = createClientReceiptBlocks(response);
        break;
      }
      if (intent === 'UPDATE_CLIENT') {
        main = updateClientReceiptBlocks(response);
        break;
      }
      const summary = asString(response.payload.message) ?? asString(response.payload.summary);
      main = summary ? [{ kind: 'text', id: blockId(response, 'text'), text: summary }] : genericBreakdown(response);
      break;
    }
    case 'TEXT_ANSWER':
    default: {
      const text = asString(response.payload.message) ?? asString(response.payload.summary) ?? 'Esto es lo que encontré.';
      main = [{ kind: 'text', id: blockId(response, 'text'), text }];
    }
  }
  // Errors already carry their own "what changed" framing inline; avoid
  // stacking a second generic warning/note block underneath them.
  const trailing: ConversationBlock[] = isError ? [] : [...warningBlocks(response)];
  const note = isError ? null : noteBlock(response);
  if (note) trailing.push(note);
  return [...main, ...trailing].map((block, index) => ({ ...block, id: `${response.requestId}:${index}` }));
}
