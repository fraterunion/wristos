import { IntentAdapterProvider, IntentInterpretationInput, IntentInterpretationRawResult } from '../intent-adapter-provider';

/**
 * Deterministic, dependency-free provider for local development and the
 * default non-production fallback (mirrors data-onboarding's
 * FakeExtractionProvider). This is a fixed lookup table over known phrasing,
 * NOT a natural-language engine — it exists so the rest of the pipeline
 * (schema validation, normalization, confidence policy, the message
 * endpoint, idempotency) can be exercised end-to-end without a live
 * provider. Real language understanding is Claude's job in production.
 */

type FakeOutput = Record<string, unknown>;

function match(text: string, patterns: RegExp[]): boolean {
  return patterns.some((pattern) => pattern.test(text));
}

function classify(text: string, currentDate: string): FakeOutput {
  const t = text.trim().toLowerCase().replace(/[.?!¿¡]+$/g, '').trim();

  // --- Adversarial / injection attempts -> UNKNOWN, regardless of content ---
  if (
    match(t, [
      /ignore (your |all )?(previous |prior )?(instructions|rules)/,
      /system prompt/,
      /reveal (your|the) (instructions|prompt)/,
      /call register_sale/,
      /use prisma/,
      /delete all/,
      /admin_?override/,
      /execute this (json|code)/i,
    ])
  ) {
    return { intent: 'UNKNOWN', entities: {}, missingEntities: [], ambiguities: [], confidence: 'LOW', language: 'es' };
  }

  // --- Operational intelligence reads (before generic liquidity "cuánto tengo") ---
  if (/lleva m[aá]s tiempo parado|inventario viejo|m[aá]s de \d+ d[ií]as|tiempo sin venderse|reloj.*m[aá]s tiempo/.test(t)) {
    const days = t.match(/m[aá]s de (\d+)\s*d[ií]as/);
    return {
      intent: 'GET_INVENTORY_AGING',
      entities: days ? { minAgeDays: Number(days[1]) } : {},
      missingEntities: [],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }
  if (/m[aá]s (dinero )?parado|relojes m[aá]s caros|capital en inventario|inventario.*pesa|d[oó]nde tengo m[aá]s (dinero|capital)/.test(t)) {
    return { intent: 'GET_TOP_INVENTORY_CAPITAL', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/qui[eé]n me debe|clientes me deben|top deudores|deudores/.test(t)) {
    return { intent: 'GET_TOP_DEBTORS', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/cu[aá]nto.*(cxc|cuentas por cobrar|me deben)|atorado en (cxc|cuentas)|cu[aá]ntas cuentas.*(abiertas|tengo)/.test(t)) {
    return { intent: 'GET_RECEIVABLE_SUMMARY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/margen.*(julio|enero|febrero|marzo|abril|mayo|junio|agosto|septiembre|octubre|noviembre|diciembre|este mes)|qu[eé] margen|tan rentables fueron/.test(t)) {
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    const m = t.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
    const entities: Record<string, unknown> = {};
    if (m) {
      entities.month = months.indexOf(m[1]) + 1;
      entities.year = Number(currentDate.slice(0, 4));
      entities.period = 'CUSTOM';
    } else {
      entities.period = 'CURRENT_MONTH';
    }
    return { intent: 'GET_SALES_MARGIN_SUMMARY', entities, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/marca.*(utilidad|margen|deja m[aá]s)|rolex o ap|mejor margen|margen en ([a-z]+)/.test(t)) {
    const brandMatch = t.match(/margen en ([a-z0-9]+)|marca ([a-z0-9]+)/);
    const entities: Record<string, unknown> = { period: 'CURRENT_MONTH' };
    if (brandMatch) entities.brand = (brandMatch[1] ?? brandMatch[2] ?? '').toUpperCase();
    if (/rolex/.test(t) && !entities.brand) entities.brand = 'ROLEX';
    return { intent: 'GET_PROFIT_BY_BRAND', entities, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/venta m[aá]s rentable|mejores ventas|top ventas|m[aá]s rentable/.test(t)) {
    return {
      intent: 'GET_TOP_SALES',
      entities: { sortBy: 'GROSS_PROFIT', period: 'CURRENT_MONTH', limit: /m[aá]s rentable/.test(t) ? 1 : 10 },
      missingEntities: [],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }
  if (/deber[ií]a revisar|necesita mi atenci[oó]n|algo importante|qu[eé] ves raro|revisar hoy/.test(t)) {
    return { intent: 'GET_ATTENTION_ITEMS', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/^qu[eé] est[aá] mal|^qu[eé] hago|^c[oó]mo voy/.test(t)) {
    return {
      intent: 'UNKNOWN',
      entities: {},
      missingEntities: [],
      ambiguities: [{ field: 'intent', reason: 'ambiguous operational ask; prefer GET_ATTENTION_ITEMS or GET_MONTHLY_PROFIT', candidates: ['GET_ATTENTION_ITEMS', 'GET_MONTHLY_PROFIT', 'GET_LIQUIDITY'] }],
      confidence: 'LOW',
      language: 'es',
    };
  }

  // --- Reads ---
  if (/cu[aá]nto (dinero )?tengo(?! atorado)|dime mi liquidez|mi liquidez|liquidez total/.test(t)) {
    return { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/qu[eé] ap tengo|cuentas por pagar/.test(t)) {
    return { intent: 'GET_LIQUIDITY', entities: {}, missingEntities: [], ambiguities: [{ field: 'intent', reason: 'AP query not yet a distinct read action', candidates: ['GET_LIQUIDITY'] }], confidence: 'MEDIUM', language: 'es' };
  }
  const monthMatch = t.match(/(cu[aá]nto ganamos|utilidad).*(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/);
  if (monthMatch) {
    const months = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
    return {
      intent: 'GET_MONTHLY_PROFIT',
      entities: { month: months.indexOf(monthMatch[2]) + 1, year: Number(currentDate.slice(0, 4)) },
      missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es',
    };
  }
  const inventoryMatch = t.match(/busca ([a-z0-9 ]+?)(\s+en inventario)?$|mu[eé]strame ([a-z0-9 ]+?) disponibles/);
  if (inventoryMatch && /rolex|batman|submariner|daytona|ap\b|yacht|disponibles|inventario/.test(t)) {
    const rawQuery = (inventoryMatch[1] ?? inventoryMatch[3] ?? '').trim();
    return {
      intent: 'SEARCH_INVENTORY',
      entities: { query: rawQuery || 'reloj' },
      missingEntities: [], ambiguities: [], confidence: rawQuery ? 'HIGH' : 'MEDIUM', language: 'es',
    };
  }
  const clientMatch = t.match(/busca a ([a-záéíóúñ ]+)\.?$|qu[eé] cuentas tiene ([a-záéíóúñ ]+)\??$/);
  if (clientMatch) {
    const name = (clientMatch[1] ?? clientMatch[2] ?? '').trim();
    if (/cuentas tiene/.test(t)) {
      return { intent: 'GET_CLIENT_ACCOUNTS', entities: { clientQuery: name }, missingEntities: ['clientId'], ambiguities: [], confidence: 'HIGH', language: 'es' };
    }
    return { intent: 'SEARCH_CLIENT', entities: { query: name }, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }

  // --- Write detection only ---
  const saleMatch = t.match(/vend[ií] ([a-z0-9 ]+?) en ([\d.,]+ ?(mil|k)?)( d[oó]lares)?/);
  if (saleMatch) {
    const amount = parseFakeAmount(saleMatch[2]);
    return {
      intent: 'REGISTER_SALE',
      entities: { watchQuery: saleMatch[1].trim(), price: String(amount), currency: saleMatch[4] ? 'USD' : 'MXN' },
      missingEntities: ['watchId', 'customerId'], ambiguities: [], confidence: 'HIGH', language: 'es',
    };
  }
  if (/^vend[ií] ([a-z0-9 ]+)\.?$/.test(t)) {
    return { intent: 'REGISTER_SALE', entities: { watchQuery: t.replace(/^vend[ií] /, '').replace(/\.$/, '') }, missingEntities: ['watchId', 'customerId', 'price', 'currency'], ambiguities: [], confidence: 'MEDIUM', language: 'es' };
  }
  const paymentMatch = t.match(/([a-záéíóúñ]+) me pag[oó] ([\d.,]+ ?(mil|k)?)/);
  if (paymentMatch) {
    return {
      intent: 'REGISTER_RECEIVABLE_PAYMENT',
      entities: { customerQuery: paymentMatch[1], amount: String(parseFakeAmount(paymentMatch[2])) },
      missingEntities: ['accountId', 'destination'], ambiguities: [], confidence: 'HIGH', language: 'es',
    };
  }
  if (/^[a-záéíóúñ]+ me pag[oó]\.?$/.test(t)) {
    return { intent: 'REGISTER_RECEIVABLE_PAYMENT', entities: { customerQuery: t.split(' ')[0] }, missingEntities: ['accountId', 'amount', 'destination'], ambiguities: [], confidence: 'MEDIUM', language: 'es' };
  }
  const purchaseMatch = t.match(/compr[eé] ([a-z0-9 ]+?) en ([\d.,]+ ?(mil|k)?)( d[oó]lares)?/);
  if (purchaseMatch) {
    return {
      intent: 'REGISTER_PURCHASE',
      entities: { watchQuery: purchaseMatch[1].trim(), cost: String(parseFakeAmount(purchaseMatch[2])), currency: purchaseMatch[4] ? 'USD' : 'MXN' },
      missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es',
    };
  }
  if (/^compr[eé] ([a-z0-9 ]+)\.?$/.test(t)) {
    return { intent: 'REGISTER_PURCHASE', entities: { watchQuery: t.replace(/^compr[eé] /, '').replace(/\.$/, '') }, missingEntities: ['cost', 'currency'], ambiguities: [], confidence: 'MEDIUM', language: 'es' };
  }
  const expenseMatch = t.match(/gast[eé] ([\d.,]+) en ([a-z0-9 ]+)/);
  if (expenseMatch) {
    return { intent: 'REGISTER_EXPENSE', entities: { amount: String(parseFakeAmount(expenseMatch[1])), currency: 'MXN', concept: expenseMatch[2].trim() }, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/le pag[oó] .* a /.test(t)) {
    return { intent: 'REGISTER_RECEIVABLE_PAYMENT', entities: {}, missingEntities: ['accountId', 'amount', 'destination'], ambiguities: [{ field: 'destination', reason: 'multiple parties mentioned', candidates: [] }], confidence: 'MEDIUM', language: 'es' };
  }
  if (/agrega ([\d.,]+) usdt/.test(t)) {
    const m = t.match(/agrega ([\d.,]+) usdt/)!;
    return { intent: 'REGISTER_CRYPTO_POSITION', entities: { asset: 'USDT', quantity: m[1].replace(/,/g, '') }, missingEntities: ['cost', 'currency'], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
  if (/actualiza el precio de usdt/.test(t)) {
    return { intent: 'REGISTER_CRYPTO_PRICE', entities: { asset: 'USDT' }, missingEntities: ['unitPrice', 'currency'], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }

  // --- Ambiguous fragments ---
  if (/^el primero\.?$/.test(t) || /^35\.?$/.test(t) || /^haz lo mismo que ayer\.?$/.test(t)) {
    return { intent: 'UNKNOWN', entities: {}, missingEntities: [], ambiguities: [{ field: 'reference', reason: 'no prior context to resolve this reference against' }], confidence: 'LOW', language: 'es' };
  }

  return { intent: 'UNKNOWN', entities: {}, missingEntities: [], ambiguities: [], confidence: 'LOW', language: 'es' };
}

function parseFakeAmount(raw: string): number {
  const cleaned = raw.replace(/,/g, '').trim();
  const scaled = cleaned.match(/^([\d.]+)\s*mil$/);
  if (scaled) return Number(scaled[1]) * 1000;
  const kMatch = cleaned.match(/^([\d.]+)\s*k$/);
  if (kMatch) return Number(kMatch[1]) * 1000;
  return Number(cleaned) || 0;
}

export class FakeIntentProvider implements IntentAdapterProvider {
  readonly providerName = 'fake';

  async interpret(input: IntentInterpretationInput): Promise<IntentInterpretationRawResult> {
    const startedAt = Date.now();
    const output = classify(input.userText, input.currentDate);
    return {
      output,
      provider: this.providerName,
      model: 'fake-heuristic-v1',
      latencyMs: Date.now() - startedAt,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
