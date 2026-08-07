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
  REGISTER_PURCHASE: 'Abrir Inventario',
  REGISTER_EXPENSE: 'Completar en Gastos',
  REGISTER_SETTLEMENT: 'Continuar en Cuentas',
  REGISTER_CRYPTO_POSITION: 'Abrir Crypto',
  REGISTER_CRYPTO_PRICE: 'Abrir Crypto',
};

export function manualCtaLabel(intent: BusinessActionId): string {
  return MANUAL_CTA_LABEL[intent as WritePreviewAction] ?? 'Continuar en el módulo';
}

export type PreviewCtaKind = 'CONFIRM_SALE' | 'MANUAL_MODULE';


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

function entityListBlocks(intent: BusinessActionId, response: StructuredAssistantResponse): ConversationBlock[] {
  const data = isRecord(response.payload.data) ? response.payload.data : null;
  const items = asArray(data?.items);
  const entries = asArray(data?.entries);
  if (entries.length) return accountEntriesList(response, entries);
  if (intent === 'SEARCH_INVENTORY') return inventoryList(response, items);
  if (intent === 'SEARCH_CLIENT' || intent === 'GET_CLIENT_ACCOUNTS') return clientChoices(response, items);
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
  const planFingerprint = asString(response.payload.planFingerprint) ?? undefined;
  return [
    {
      kind: 'preview',
      id: blockId(response, 'preview'),
      intro: executableSale
        ? 'Perfecto. Esto es lo que voy a registrar:'
        : 'Perfecto. Esto es lo que voy a preparar:',
      title,
      fields,
      effects,
      ctaLabel: executableSale ? 'Confirmar venta' : manualCtaLabel(intent),
      ctaKind: executableSale ? 'CONFIRM_SALE' : 'MANUAL_MODULE',
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
      main = intent === 'GET_LIQUIDITY'
        ? liquidityBreakdown(response)
        : intent === 'GET_MONTHLY_PROFIT'
          ? monthlyProfitBreakdown(response)
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
