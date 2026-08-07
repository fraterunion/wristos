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

  // --- Reads ---
  if (/cu[aá]nto (dinero )?tengo|dime mi liquidez|mi liquidez|liquidez total/.test(t)) {
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
