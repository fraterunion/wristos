import { IntentAdapterProvider, IntentInterpretationInput, IntentInterpretationRawResult } from '../intent-adapter-provider';
import { detectExpenseCorrectionLanguage } from '../../reversals/expense-correction-language';

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

function fakeTreasuryAccount(fragment: string): 'CASH' | 'BANK' | 'CESAR' | null {
  const t = fragment.trim().toLowerCase();
  if (/efectivo|caja|\bcash\b/.test(t)) return 'CASH';
  if (/banco|bancos|cuenta bancaria/.test(t)) return 'BANK';
  if (/c[eé]sar|cuenta de c[eé]sar|cuenta c[eé]sar/.test(t)) return 'CESAR';
  return null;
}

function fakeCapitalAccount(fragment: string): 'CASH' | 'BANK' | 'CESAR_ACCOUNT' | null {
  const s = fragment.trim().toLowerCase();
  if (/efectivo|caja|\bcash\b/.test(s)) return 'CASH';
  if (/banco|bancos|cuenta bancaria/.test(s)) return 'BANK';
  if (/c[eé]sar|cuenta de c[eé]sar|cuenta c[eé]sar/.test(s)) return 'CESAR_ACCOUNT';
  return null;
}

function classifyCapitalDistribution(t: string): FakeOutput | null {
  // Payable / receivable debt language is not a capital distribution.
  if (/\b(?:que le debemos|cuenta por pagar|cuenta por cobrar|cxp|cxc|nos debe)\b/.test(t)) {
    return null;
  }
  // Treasury transfer phrasing.
  if (/\b(?:pasa|pasar|mueve|mover|transfiere|transferir)\b/.test(t)) return null;
  if (
    !/(?:utilidad|distribuci[oó]n|retiro del socio|retir[aeé].*(?:utilidad|para)|p[aá]gale?\s+(?:[\d.,]+\s*(?:mil|k|millones)?\s+)?(?:de\s+)?utilidad|dale\s+.*utilidad|registra.*distribuci)/.test(
      t,
    )
  ) {
    return null;
  }
  // Keep purchase/expense language out.
  if (/\b(?:compr[eé]|gast[eé]|renta|gasolina|marketing|publicidad|vuelo)\b/.test(t)) {
    return null;
  }

  const amountMatch = t.match(/([\d.,]+ ?(mil|k|millones)?)/);
  let amount: string | undefined;
  if (amountMatch) {
    const raw = amountMatch[1];
    if (/millones/.test(raw)) {
      const n = Number(raw.replace(/millones|,/g, '').trim());
      amount = String(Math.round(n * 1_000_000));
    } else {
      amount = String(parseFakeAmount(raw));
    }
  }
  const nameMatch = t.match(
    /(?:para|a)\s+([a-záéíóúñü][a-záéíóúñü\s]{1,40}?)(?:\s+(?:en|de)\b|\s*$)/i,
  );
  let account: 'CASH' | 'BANK' | 'CESAR_ACCOUNT' | null = null;
  const enAccount = t.match(/\b(?:en|como)\s+(.+?)(?:\s*$)/i);
  if (enAccount) account = fakeCapitalAccount(enAccount[1]);
  if (!account) {
    if (/\bbancos?\b|\bbanco\b/.test(t)) account = 'BANK';
    else if (/\befectivo\b|\bcaja\b/.test(t)) account = 'CASH';
    else if (/cuenta\s+c[eé]sar/.test(t)) account = 'CESAR_ACCOUNT';
  }

  if (/crypto|usdt|bitcoin|btc|d[oó]lares|\busd\b/.test(t)) {
    return {
      intent: 'REGISTER_CAPITAL_DISTRIBUTION',
      entities: {},
      missingEntities: ['amount', 'investorQuery', 'account'],
      ambiguities: [
        {
          field: 'currency',
          reason: 'Capital distributions are MXN only',
          candidates: [],
        },
      ],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }

  const entities: Record<string, string> = { currency: 'MXN' };
  if (amount) entities.amount = amount;
  if (nameMatch?.[1]) {
    const name = nameMatch[1].trim().replace(/\s+(en|de)$/i, '');
    if (!/^(efectivo|bancos|banco|caja|utilidad|sus)$/i.test(name)) {
      entities.investorQuery = name;
    }
  }
  if (account) entities.account = account;
  const missing: string[] = [];
  if (!amount) missing.push('amount');
  if (!entities.investorQuery) missing.push('investorQuery');
  if (!account) missing.push('account');
  return {
    intent: 'REGISTER_CAPITAL_DISTRIBUTION',
    entities,
    missingEntities: missing,
    ambiguities: [],
    confidence: missing.length ? 'MEDIUM' : 'HIGH',
    language: 'es',
  };
}

function classifyCapitalContribution(t: string): FakeOutput | null {
  // Distribution / payout language is not a contribution.
  if (
    /utilidad|retiro del socio|retir[eé].*(?:utilidad|para)|p[aá]gale?\s+.*utilidad/.test(t)
  ) {
    return null;
  }
  // Purchase / OpEx / transfer boundaries.
  if (
    /\b(?:compr[eé]|compramos|gast[eé]|pasa|pasar|mueve|mover|transfiere|transferir)\b/.test(t)
  ) {
    return null;
  }
  // Ambiguous "puso X para marketing" — do not auto-classify as contribution.
  if (/\bpuso\b.*\b(?:para|de)\b.*\b(?:marketing|publicidad|renta|gasolina)\b/.test(t)) {
    return null;
  }
  if (
    !/(?:aport[oó]|aportaci[oó]n|meti[oó]|met[ií]|puso\b|registra.*aport)/.test(t)
  ) {
    return null;
  }

  const amountMatch = t.match(/([\d.,]+ ?(mil|k|millones)?)/);
  let amount: string | undefined;
  if (amountMatch) {
    const raw = amountMatch[1];
    if (/millones/.test(raw)) {
      const n = Number(raw.replace(/millones|,/g, '').trim());
      amount = String(Math.round(n * 1_000_000));
    } else {
      amount = String(parseFakeAmount(raw));
    }
  }

  let investorQuery: string | undefined;
  // Avoid \\b after accented verbs (ó is non-word in JS).
  const nameFirst = t.match(
    /^([a-záéíóúñü][a-záéíóúñü]+)\s+(?:aport[oó]|meti[oó]|puso)(?:\s|$)/i,
  );
  if (nameFirst?.[1]) investorQuery = nameFirst[1];
  if (!investorQuery) {
    const para = t.match(
      /(?:para|de)\s+([a-záéíóúñü][a-záéíóúñü]+)(?:\s+(?:en|al|a)\b|\s*$)/i,
    );
    if (para?.[1] && !/^(efectivo|bancos|banco|caja|negocio|capital)$/i.test(para[1])) {
      investorQuery = para[1];
    }
  }

  let account: 'CASH' | 'BANK' | 'CESAR_ACCOUNT' | null = null;
  const enAccount = t.match(
    /\b(?:en|como|m[aá]rcalos?\s+como|cuenta)\s+(.+?)(?:\s*$)/i,
  );
  if (enAccount) account = fakeCapitalAccount(enAccount[1]);
  if (!account) {
    if (/\bbancos?\b|\bbanco\b/.test(t)) account = 'BANK';
    else if (/\befectivo\b|\bcaja\b/.test(t)) account = 'CASH';
    else if (/cuenta\s+c[eé]sar|c[eé]sar/.test(t) && /m[aá]rca|cuenta|como/.test(t)) {
      account = 'CESAR_ACCOUNT';
    }
  }

  if (/crypto|usdt|bitcoin|btc|d[oó]lares|\busd\b/.test(t)) {
    return {
      intent: 'REGISTER_CAPITAL_CONTRIBUTION',
      entities: {},
      missingEntities: ['amount', 'investorQuery', 'account'],
      ambiguities: [
        {
          field: 'currency',
          reason: 'Capital contributions are MXN only',
          candidates: [],
        },
      ],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }

  const entities: Record<string, string> = { currency: 'MXN' };
  if (amount) entities.amount = amount;
  if (investorQuery) entities.investorQuery = investorQuery;
  if (account) entities.account = account;

  const missing: string[] = [];
  if (!amount) missing.push('amount');
  if (!investorQuery) missing.push('investorQuery');
  if (!account) missing.push('account');

  return {
    intent: 'REGISTER_CAPITAL_CONTRIBUTION',
    entities,
    missingEntities: missing,
    ambiguities: [],
    confidence: missing.length ? 'MEDIUM' : 'HIGH',
    language: 'es',
  };
}

function classifyCreateReceivable(t: string): FakeOutput | null {
  // Settlement netting must stay REGISTER_SETTLEMENT (unbound) — not create CxC.
  if (/\bcompensa|\bcompensa(?:r|ción)?\b|aplica.*(?:saldo a favor|cuenta a favor)/.test(t)) {
    return null;
  }
  // Payment / collection language is REGISTER_RECEIVABLE_PAYMENT, not create.
  if (
    /\b(?:pag[oó]|me pag[oó]|cobr[eé]|recib[ií]|deposit[oó]|vendimos|vend[ií])\b/.test(t)
  ) {
    return null;
  }
  if (
    !/(?:nos debe|cuenta por cobrar|\bcxc\b|registra(?:r)?\s+una\s+cuenta\s+por\s+cobrar)/.test(
      t,
    )
  ) {
    return null;
  }

  const amountMatch = t.match(/([\d.,]+ ?(mil|k|millones)?)/);
  let amount: string | undefined;
  if (amountMatch) {
    amount = String(parseFakeAmount(amountMatch[1]!));
  }

  let counterpartyName: string | undefined;
  const subjectBefore = t.match(
    /^([a-záéíóúñü][a-záéíóúñü\s.'-]{1,40}?)\s+nos debe/i,
  );
  if (subjectBefore?.[1]) {
    counterpartyName = subjectBefore[1].trim().replace(/\s+/g, ' ');
  }
  if (!counterpartyName) {
    const aPara = t.match(
      /(?:a|para)\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,40}?)(?:\s+(?:nos debe|de|,|\.|$))/i,
    );
    if (aPara?.[1]) counterpartyName = aPara[1].trim().replace(/\s+/g, ' ');
  }
  if (!counterpartyName) {
    const de = t.match(
      /cuenta por cobrar\s+(?:de|a)\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,40}?)(?:\s|$)/i,
    );
    if (de?.[1]) counterpartyName = de[1].trim().replace(/\s+/g, ' ');
  }

  const entities: Record<string, string> = { currency: 'MXN' };
  if (amount) entities.amount = amount;
  if (counterpartyName) {
    entities.counterpartyName = counterpartyName;
    entities.clientQuery = counterpartyName;
  }
  if (/d[oó]lares|\busd\b/.test(t)) entities.currency = 'USD';

  const missing: string[] = [];
  if (!amount) missing.push('amount');
  if (!counterpartyName) missing.push('counterpartyName');

  return {
    intent: 'CREATE_RECEIVABLE',
    entities,
    missingEntities: missing,
    ambiguities: [],
    confidence: missing.length ? 'MEDIUM' : 'HIGH',
    language: 'es',
  };
}

function classifyCreatePayable(t: string): FakeOutput | null {
  // Settlement netting must stay REGISTER_SETTLEMENT (unbound) — not create CxP.
  if (/\bcompensa|\bcompensa(?:r|ción)?\b|aplica.*(?:saldo a favor|cuenta a favor)/.test(t)) {
    return null;
  }
  // Cash payment language is REGISTER_PAYABLE_PAYMENT, not create.
  if (
    /\b(?:p[aá]gale|paga\s|transfer|compramos\s+a\s+cr[eé]dito|compr[eé])\b/.test(t)
  ) {
    return null;
  }
  if (
    !/(?:le debemos|debemos|cuenta por pagar|\bcxp\b|registra(?:r)?\s+una\s+cuenta\s+por\s+pagar)/.test(
      t,
    )
  ) {
    return null;
  }
  // Avoid bare "debemos" matching capital / utility language.
  if (/utilidad|socio|aportaci[oó]n|distribuci[oó]n/.test(t)) return null;

  const amountMatch = t.match(/([\d.,]+ ?(mil|k|millones)?)/);
  let amount: string | undefined;
  if (amountMatch) {
    amount = String(parseFakeAmount(amountMatch[1]!));
  }

  let counterpartyName: string | undefined;
  const aPara = t.match(
    /(?:a|para)\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,40}?)(?:\s+(?:le debemos|debemos|,|\.|$))/i,
  );
  if (aPara?.[1]) counterpartyName = aPara[1].trim().replace(/\s+/g, ' ');
  if (!counterpartyName) {
    const debemosA = t.match(
      /(?:le\s+)?debemos\s+(?:[\d.,]+ ?(?:mil|k)?\s+)?a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,40}?)(?:\s|$)/i,
    );
    if (debemosA?.[1]) counterpartyName = debemosA[1].trim().replace(/\s+/g, ' ');
  }
  if (!counterpartyName) {
    const de = t.match(
      /cuenta por pagar\s+(?:de|a)\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,40}?)(?:\s|$)/i,
    );
    if (de?.[1]) counterpartyName = de[1].trim().replace(/\s+/g, ' ');
  }

  const entities: Record<string, string> = { currency: 'MXN' };
  if (amount) entities.amount = amount;
  if (counterpartyName) {
    entities.counterpartyName = counterpartyName;
    entities.clientQuery = counterpartyName;
  }
  if (/d[oó]lares|\busd\b/.test(t)) entities.currency = 'USD';

  const missing: string[] = [];
  if (!amount) missing.push('amount');
  if (!counterpartyName) missing.push('counterpartyName');

  return {
    intent: 'CREATE_PAYABLE',
    entities,
    missingEntities: missing,
    ambiguities: [],
    confidence: missing.length ? 'MEDIUM' : 'HIGH',
    language: 'es',
  };
}

function classifyTreasuryTransfer(t: string): FakeOutput | null {
  // Capital / ownership language must NOT become a treasury transfer.
  if (
    /utilidad|socio|aport[oó]|aportaci[oó]n|retir[eé].*utilidad|p[aá]gale? la utilidad|retiro del socio|meti[oó].*negocio/.test(
      t,
    )
  ) {
    return null;
  }
  // Avoid \\b around accented verbs like "transferí" (í is non-word in JS).
  if (
    !/(?:^|\s)(?:pasa|pasar|mueve|mover|transfiere|transferir|transfer[ií]|manda|mandar)(?:\s|$)/.test(
      t,
    )
  ) {
    return null;
  }
  if (!/(?:efectivo|caja|banco|bancos|c[eé]sar|cash|cuenta bancaria)/.test(t)) {
    return null;
  }

  let source: 'CASH' | 'BANK' | 'CESAR' | null = null;
  let destination: 'CASH' | 'BANK' | 'CESAR' | null = null;

  // "de X a Y" / "desde X a Y" — capture full account phrases (e.g. "cuenta césar")
  const deA = t.match(/(?:de|desde)\s+(.+?)\s+a\s+(.+)$/);
  if (deA) {
    source = fakeTreasuryAccount(deA[1]);
    destination = fakeTreasuryAccount(deA[2]);
  }

  // "a Y desde X"
  if (!source || !destination) {
    const aDesde = t.match(/a\s+(.+?)\s+desde\s+(.+)$/);
    if (aDesde) {
      destination = fakeTreasuryAccount(aDesde[1]);
      source = fakeTreasuryAccount(aDesde[2]);
    }
  }

  // "De X manda/pasa … a Y"
  if (!source || !destination) {
    const deManda = t.match(
      /^de\s+(.+?)\s+(?:manda|pasa|mueve|transfiere)\s+.+?\s+a\s+(.+)$/,
    );
    if (deManda) {
      source = fakeTreasuryAccount(deManda[1]);
      destination = fakeTreasuryAccount(deManda[2]);
    }
  }

  // "Transferí / Mueve efectivo a bancos" (no explicit "de")
  if (!source || !destination) {
    const bare = t.match(
      /(?:pasa|pasar|mueve|mover|transfiere|transferir|transfer[ií]|manda|mandar)\s+(?:[\d.,]+\s*(?:mil|k|millones)?\s+(?:de\s+)?)?(.+?)\s+a\s+(.+)$/,
    );
    if (bare) {
      source = fakeTreasuryAccount(bare[1]);
      destination = fakeTreasuryAccount(bare[2]);
    }
  }

  if (/crypto|usdt|bitcoin|btc|d[oó]lares|\busd\b/.test(t)) {
    return {
      intent: 'REGISTER_TREASURY_TRANSFER',
      entities: {},
      missingEntities: ['sourceAccount', 'destinationAccount', 'amount'],
      ambiguities: [
        {
          field: 'currency',
          reason: 'Treasury transfers are MXN only between CASH|BANK|CESAR',
          candidates: [],
        },
      ],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }

  const amountMatch = t.match(/([\d.,]+ ?(mil|k|millones)?)/);
  let amount: string | undefined;
  if (amountMatch) {
    const raw = amountMatch[1];
    if (/millones/.test(raw)) {
      const n = Number(raw.replace(/millones|,/g, '').trim());
      amount = String(Math.round(n * 1_000_000));
    } else {
      amount = String(parseFakeAmount(raw));
    }
  }

  const entities: Record<string, string> = {};
  if (source) entities.sourceAccount = source;
  if (destination) entities.destinationAccount = destination;
  if (amount) entities.amount = amount;
  entities.currency = 'MXN';

  const missing: string[] = [];
  if (!source) missing.push('sourceAccount');
  if (!destination) missing.push('destinationAccount');
  if (!amount) missing.push('amount');
  if (source && destination && source === destination) {
    return {
      intent: 'REGISTER_TREASURY_TRANSFER',
      entities: { ...entities, destinationAccount: destination },
      missingEntities: ['destinationAccount'],
      ambiguities: [],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }

  return {
    intent: 'REGISTER_TREASURY_TRANSFER',
    entities,
    missingEntities: missing,
    ambiguities: [],
    confidence: missing.length ? 'MEDIUM' : 'HIGH',
    language: 'es',
  };
}

function classifyReverseExpense(t: string): FakeOutput | null {
  const detected = detectExpenseCorrectionLanguage(t);
  if (!detected) return null;
  if (detected.kind === 'BLOCKED_NON_EXPENSE_REVERSAL') {
    return {
      intent: 'UNKNOWN',
      entities: {},
      missingEntities: [],
      ambiguities: [
        {
          field: 'intent',
          reason: detected.reason,
        },
      ],
      confidence: 'LOW',
      language: 'es',
    };
  }
  return {
    intent: 'REVERSE_EXPENSE',
    entities: detected.entities,
    missingEntities: [],
    ambiguities: [],
    confidence: detected.kind === 'LAST_ACTION_DEIXIS' ? 'MEDIUM' : 'HIGH',
    language: 'es',
  };
}

function classify(
  text: string,
  currentDate: string,
  context?: { lastIntent?: string },
): FakeOutput {
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
  if (/c[oó]mo va( el negocio)?|c[oó]mo vamos( hoy| este mes)?|dame (un )?resumen|resumen del negocio/.test(t)) {
    return { intent: 'GET_BUSINESS_SUMMARY', entities: {}, missingEntities: [], ambiguities: [], confidence: 'HIGH', language: 'es' };
  }
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
  if (/^qu[eé] est[aá] mal|^qu[eé] hago$/.test(t)) {
    return {
      intent: 'UNKNOWN',
      entities: {},
      missingEntities: [],
      ambiguities: [{ field: 'intent', reason: 'ambiguous operational ask; prefer GET_ATTENTION_ITEMS, GET_BUSINESS_SUMMARY or GET_MONTHLY_PROFIT', candidates: ['GET_ATTENTION_ITEMS', 'GET_BUSINESS_SUMMARY', 'GET_MONTHLY_PROFIT', 'GET_LIQUIDITY'] }],
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

  // UPDATE_CLIENT — before CREATE_CLIENT / SEARCH to avoid "agrega nota" → create.
  {
    const updatePhone = t.match(
      /(?:c[aá]mbiale|cambia|ponle|actual[ií]za)\s+(?:el\s+)?tel[eé]fono(?:\s+a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,60}))?\s*(?:al?|a|:)?\s*(\+?\d[\d\s()-]{6,18}\d)/i,
    );
    const updateEmail = t.match(
      /(?:c[aá]mbiale|cambia|ponle|actual[ií]za)\s+(?:el\s+)?(?:correo|email|mail)(?:\s+a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,60}))?\s*(?:a|:)?\s*([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i,
    );
    const updateName = t.match(
      /(?:c[aá]mbiale|cambia)\s+(?:el\s+)?nombre(?:\s+a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,60}))?\s*(?:a|por|:)\s*([a-záéíóúñü][a-záéíóúñü\s.'-]{1,80})/i,
    );
    const appendNote = t.match(
      /(?:agr[eé]gale|agrega|a[nñ]ade)\s+(?:una\s+)?nota(?:\s+a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,60}))?\s*(?:que|:)?\s*(.+)$/i,
    );
    const removeTag = t.match(
      /(?:qu[ií]tale|quita|elimina)\s+(?:el\s+)?tag\s+([a-z0-9_-]{1,40})(?:\s+a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,60}))?/i,
    );
    const addTag = t.match(
      /(?:agr[eé]gale|agrega|ponle)\s+(?:el\s+)?tag\s+([a-z0-9_-]{1,40})(?:\s+a\s+([a-záéíóúñü][a-záéíóúñü\s.'-]{1,60}))?/i,
    );
    const clearPhone = /(?:qu[ií]tale|quita)\s+(?:el\s+)?tel[eé]fono/.test(t);
    const clearEmail = /(?:qu[ií]tale|quita|d[eé]jalo sin)\s+(?:el\s+)?(?:correo|email)/.test(t);
    const deicticUpdate =
      /^(?:c[aá]mbiale|ponle|agr[eé]gale|qu[ií]tale)\b/.test(t) &&
      !/(?:crea|crear|busca|pag[oó]|vend[ií]|compr[eé])/.test(t);

    if (updatePhone || updateEmail || updateName || appendNote || removeTag || addTag || clearPhone || clearEmail || deicticUpdate) {
      const entities: Record<string, string | boolean> = {};
      const clientFrom =
        updatePhone?.[1] ||
        updateEmail?.[1] ||
        updateName?.[1] ||
        appendNote?.[1] ||
        removeTag?.[2] ||
        addTag?.[2];
      if (clientFrom) entities.clientQuery = clientFrom.trim().replace(/\s+/g, ' ');
      if (updatePhone?.[2]) entities.setPhone = updatePhone[2].replace(/\s+/g, ' ').trim();
      if (updateEmail?.[2]) entities.setEmail = updateEmail[2].trim();
      if (updateName?.[2]) entities.setName = updateName[2].trim().replace(/\s+/g, ' ');
      if (appendNote?.[2]) entities.appendNotes = appendNote[2].trim().replace(/[.,;:]+$/, '');
      if (addTag?.[1]) entities.addTag = addTag[1].trim();
      if (removeTag?.[1]) entities.removeTag = removeTag[1].trim();
      if (clearPhone) entities.clearPhone = true;
      if (clearEmail) entities.clearEmail = true;
      // Deictic phone/email without explicit verbs above
      if (!entities.setPhone && !entities.clearPhone) {
        const phoneOnly = t.match(/tel[eé]fono.*(\+?\d[\d\s()-]{6,18}\d)/i);
        if (phoneOnly) entities.setPhone = phoneOnly[1]!.replace(/\s+/g, ' ').trim();
      }
      if (!entities.setEmail && !entities.clearEmail) {
        const emailOnly = t.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
        if (emailOnly && /correo|email|mail|ponle/.test(t)) entities.setEmail = emailOnly[1]!;
      }
      return {
        intent: 'UPDATE_CLIENT',
        entities,
        missingEntities: entities.clientQuery ? [] : ['clientQuery'],
        ambiguities: [],
        confidence: 'HIGH',
        language: 'es',
      };
    }
  }

  // Capital distribution / contribution before CREATE_CLIENT — "registra una distribución/aportación…"
  // would otherwise match CREATE_CLIENT name capture.
  {
    const distribution = classifyCapitalDistribution(t);
    if (distribution) return distribution;
  }
  {
    const contribution = classifyCapitalContribution(t);
    if (contribution) return contribution;
  }

  // Settlement before CREATE_RECEIVABLE/CREATE_PAYABLE — "compensa lo que nos debe…"
  // contains "nos debe" / "debemos" and must not become manual CxC/CxP.
  if (/compensa|aplica.*(saldo a favor|cuenta a favor)|compensa.*(debe|debemos)/.test(t)) {
    return {
      intent: 'REGISTER_SETTLEMENT',
      entities: {},
      missingEntities: ['sourceAccountId', 'destinationAccountId', 'amount', 'currency'],
      ambiguities: [],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }

  {
    const receivable = classifyCreateReceivable(t);
    if (receivable) return receivable;
  }
  {
    const payable = classifyCreatePayable(t);
    if (payable) return payable;
  }

  // CREATE_CLIENT — before SEARCH_CLIENT / payment / purchase to avoid collisions.
  if (
    context?.lastIntent === 'CREATE_CLIENT' &&
    /^(crear (cliente )?nuevo|crear de todos modos|crea uno nuevo|sí,? crea(r)?)\.?$/.test(t)
  ) {
    return {
      intent: 'CREATE_CLIENT',
      entities: { allowProbableDuplicate: true },
      missingEntities: [],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }
  const createClientMatch = t.match(
    /(?:crea|crear|registra|registrar|agrega|agregar|alta de)\s+(?:a\s+|este\s+cliente:?\s*)?([a-záéíóúñü][a-záéíóúñü\s.'-]{1,80})/i,
  );
  if (
    createClientMatch &&
    !/busca|pag[oó]|vend[ií]|compr[eé]|gast[eé]|transfer|utilidad|distribuci[oó]n|aportaci[oó]n|cuenta por cobrar|cuenta por pagar|\bcxc\b|\bcxp\b|nos debe|debemos|reloj|cat[aá]logo|usdt|bitcoin|inventario/.test(
      t,
    )
  ) {
    const name = createClientMatch[1]!.trim().replace(/\s+/g, ' ').replace(/[.,;:]+$/, '');
    const emailMatch = t.match(/([a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})/i);
    const phoneMatch = t.match(
      /(?:tel[eé]fono|cel(?:ular)?|whats?app)?\s*(?:es|:)?\s*(\+?\d[\d\s()-]{6,18}\d)/i,
    );
    const entities: Record<string, string | boolean> = { name };
    if (emailMatch) entities.email = emailMatch[1]!;
    if (phoneMatch) entities.phone = phoneMatch[1]!.replace(/\s+/g, ' ').trim();
    return {
      intent: 'CREATE_CLIENT',
      entities,
      missingEntities: [],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }

  // --- Write detection only ---

  // REVERSE_EXPENSE before REGISTER_EXPENSE / sale — financial "delete" means reverse.
  const reverseExpense = classifyReverseExpense(t);
  if (reverseExpense) return reverseExpense;

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

  // Internal treasury transfers (before payable/expense) — not capital withdrawals.
  // Capital contribution/distribution already classified above (before CREATE_CLIENT).
  {
    const transfer = classifyTreasuryTransfer(t);
    if (transfer) return transfer;
  }

  // Settlement language must stay REGISTER_SETTLEMENT (unbound) — not cash payable payment.
  if (/compensa|aplica.*(saldo a favor|cuenta a favor)|compensa.*(debe|debemos)/.test(t)) {
    return {
      intent: 'REGISTER_SETTLEMENT',
      entities: {},
      missingEntities: ['sourceAccountId', 'destinationAccountId', 'amount', 'currency'],
      ambiguities: [],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }

  // Payable cash payment — before "X le pagó a Y" settlement-style receivable path.
  // Expense "paga renta" etc. handled later; exclude common OpEx nouns here.
  if (
    !/\b(renta|gasolina|estacionamiento|comida|publicidad|n[oó]mina|salario|utilidad|socio)\b/.test(
      t,
    ) &&
    (/\bp[aá]gale?\b/.test(t) ||
      /\babona\b/.test(t) ||
      /\bliquida(?:lo|la|)\b/.test(t) ||
      /\bpaga\b.*\b(cuenta|cxp|pendiente)\b/.test(t))
  ) {
    let sourceAccount: string | undefined;
    if (/efectivo|cash/i.test(t)) sourceAccount = 'CASH';
    else if (/banco|bancos|transfer/i.test(t)) sourceAccount = 'BANK';
    else if (/c[eé]sar|cuenta de c[eé]sar/i.test(t)) sourceAccount = 'CESAR';
    if (/crypto|usdt|bitcoin|btc/i.test(t)) {
      return {
        intent: 'REGISTER_PAYABLE_PAYMENT',
        entities: {},
        missingEntities: ['accountId', 'amount', 'sourceAccount'],
        ambiguities: [
          {
            field: 'sourceAccount',
            reason: 'CRYPTO is unsupported for payable payments',
            candidates: [],
          },
        ],
        confidence: 'MEDIUM',
        language: 'es',
      };
    }
    const payFull =
      /\bliquida(?:lo|la|)\b/.test(t) ||
      /\bpaga(?:r)?\s+todo\b/.test(t) ||
      /\bcuenta completa\b/.test(t) ||
      /\blo pendiente\b/.test(t);
    const amountMatch = t.match(/([\d.,]+ ?(mil|k)?)/);
    const whoMatch =
      t.match(/p[aá]gale?\s+(?:[\d.,]+ ?(?:mil|k)?\s+)?a\s+([a-záéíóúñ ]+?)(?:\s+desde|\s+de|\s+en|\s*$)/) ||
      t.match(/(?:cuenta|cxp|pendiente)\s+(?:de|del|de la)\s+([a-záéíóúñ ]+)/) ||
      t.match(/a\s+([a-záéíóúñ]+)\s+(?:desde|de|en)\s+/);
    const counterpartyQuery = whoMatch?.[1]?.trim().replace(/\s+/g, ' ');
    const entities: Record<string, string | boolean> = {};
    if (counterpartyQuery) entities.customerQuery = counterpartyQuery;
    if (sourceAccount) entities.sourceAccount = sourceAccount;
    if (payFull) entities.payFullOutstanding = true;
    else if (amountMatch) entities.amount = String(parseFakeAmount(amountMatch[1]));
    if (/d[oó]lares|usd/i.test(t)) entities.currency = 'USD';
    const missing: string[] = [];
    if (!entities.customerQuery && !payFull) missing.push('accountId');
    else missing.push('accountId');
    if (!payFull && !entities.amount) missing.push('amount');
    if (!sourceAccount) missing.push('sourceAccount');
    return {
      intent: 'REGISTER_PAYABLE_PAYMENT',
      entities,
      missingEntities: missing,
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }

  const settlementMatch = t.match(/([a-záéíóúñ]+) le pag[oó] ([\d.,]+ ?(mil|k)?) a ([a-záéíóúñ]+)/);
  if (settlementMatch) {
    return {
      intent: 'REGISTER_RECEIVABLE_PAYMENT',
      entities: {
        customerQuery: settlementMatch[1],
        amount: String(parseFakeAmount(settlementMatch[2])),
        destination: 'APPLY_TO_PAYABLE',
        payableQuery: settlementMatch[4],
      },
      missingEntities: ['accountId', 'payableAccountId'],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }
  const paymentMatch = t.match(
    /([a-záéíóúñ]+) me (?:pag[oó]|deposit[oó]) ([\d.,]+ ?(mil|k)?)(.*)/,
  );
  if (paymentMatch) {
    const rest = paymentMatch[4] ?? '';
    let destination: string | undefined;
    if (/crypto|usdt|bitcoin|btc/i.test(rest)) {
      return {
        intent: 'REGISTER_RECEIVABLE_PAYMENT',
        entities: { customerQuery: paymentMatch[1], amount: String(parseFakeAmount(paymentMatch[2])) },
        missingEntities: ['accountId', 'destination'],
        ambiguities: [{ field: 'destination', reason: 'CRYPTO is unsupported for receivable payments', candidates: [] }],
        confidence: 'MEDIUM',
        language: 'es',
      };
    }
    if (/efectivo|cash/i.test(rest)) destination = 'CASH';
    else if (/banco|transfer|deposit/i.test(rest)) destination = 'BANK';
    else if (/c[eé]sar/i.test(rest)) destination = 'CESAR';
    return {
      intent: 'REGISTER_RECEIVABLE_PAYMENT',
      entities: {
        customerQuery: paymentMatch[1],
        amount: String(parseFakeAmount(paymentMatch[2])),
        ...(destination ? { destination } : {}),
      },
      missingEntities: destination ? ['accountId'] : ['accountId', 'destination'],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }
  if (/^[a-záéíóúñ]+ me pag[oó]\.?$/.test(t)) {
    return { intent: 'REGISTER_RECEIVABLE_PAYMENT', entities: { customerQuery: t.split(' ')[0] }, missingEntities: ['accountId', 'amount', 'destination'], ambiguities: [], confidence: 'MEDIUM', language: 'es' };
  }
  const purchaseMatch = t.match(
    /compr[eé] (?:un |una )?(?:reloj )?([a-z0-9áéíóúñ .\-]+?) (?:a |de )?([a-záéíóúñ ]+ )?por ([\d.,]+ ?(mil|k)?)( d[oó]lares)?/,
  );
  const purchaseMatchAlt = t.match(
    /compr[eé] (?:un |una )?([a-z0-9áéíóúñ .\-]+?) (?:por |en )([\d.,]+ ?(mil|k)?)( d[oó]lares)?/,
  );
  // Non-inventory "compré …" (gasolina, etc.) is EXPENSE — not REGISTER_PURCHASE.
  if (
    /compr[eé]\s+(gasolina|estacionamiento|comida|almuerzo|cena|vuelo|boleto|renta|publicidad|peaje|toll)/.test(
      t,
    )
  ) {
    const concept =
      t.match(
        /compr[eé]\s+(gasolina|estacionamiento|comida|almuerzo|cena|vuelo|boleto|renta|publicidad|peaje)/,
      )?.[1] ?? 'gasto';
    return {
      intent: 'REGISTER_EXPENSE',
      entities: { concept, currency: 'MXN' },
      missingEntities: ['amount', 'category', 'source'],
      ambiguities: [],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }
  if (/agrega (este |el )?reloj|al cat[aá]logo|solo (al )?inventario/.test(t)) {
    return {
      intent: 'UNKNOWN',
      entities: {},
      missingEntities: [],
      ambiguities: [
        {
          field: 'intent',
          reason: 'inventory-only catalog add is not REGISTER_PURCHASE',
        },
      ],
      confidence: 'LOW',
      language: 'es',
    };
  }
  if (
    purchaseMatch ||
    purchaseMatchAlt ||
    /compr[eé] (un |una )?(rolex|ap|patek|batman|daytona|yacht|submariner|watch|reloj|nautilus|royal oak)/.test(
      t,
    )
  ) {
    // Crypto inventory language stays crypto — not inventory purchase
    if (/\b(usdt|crypto|bitcoin|btc)\b/.test(t)) {
      // fall through to crypto matcher below
    } else {
      const m = purchaseMatch ?? purchaseMatchAlt;
      const entities: Record<string, string> = {};
      if (m) {
        entities.watchQuery = (m[1] ?? '').trim();
        if (purchaseMatch && purchaseMatch[2]) {
          entities.sellerQuery = purchaseMatch[2].trim().replace(/^a |^de /i, '');
          entities.sellerCounterpartyName = entities.sellerQuery;
        }
        const amountGroup = purchaseMatch ? purchaseMatch[3] : purchaseMatchAlt?.[2];
        const usdGroup = purchaseMatch ? purchaseMatch[5] : purchaseMatchAlt?.[4];
        if (amountGroup) entities.cost = String(parseFakeAmount(amountGroup));
        entities.currency = usdGroup ? 'USD' : 'MXN';
      } else {
        entities.watchQuery = t.replace(/^compr[eé]\s+/, '').replace(/\.$/, '');
      }

      if (/a cr[eé]dito|qued[oó] pendiente|no (le )?pagu[eé]/.test(t)) {
        entities.paymentMode = 'CREDIT';
      } else if (/pagad[oa]|contado|completo|lo pagu[eé]|ya qued[oó] pagad/.test(t)) {
        entities.paymentMode = 'PAID';
      } else if (/le di |pagu[eé] .* y |quedaron|parcial/.test(t)) {
        entities.paymentMode = 'PARTIAL';
        const paidM = t.match(/(?:le di |pagu[eé] )([\d.,]+ ?(mil|k)?)/);
        if (paidM) entities.initialPaymentAmount = String(parseFakeAmount(paidM[1]));
      }

      if (/efectivo|cash/.test(t)) entities.sourceAccount = 'CASH';
      else if (/banco|transfer/.test(t)) entities.sourceAccount = 'BANK';
      else if (/c[eé]sar/.test(t)) entities.sourceAccount = 'CESAR';

      if (/todav[ií]a no|no (me )?llega|en camino|en tr[aá]nsito/.test(t)) {
        entities.status = 'IN_TRANSIT';
      } else if (/ya (lo )?tengo|ya lleg[oó]/.test(t)) {
        entities.status = 'AVAILABLE';
      }

      const missing: string[] = [];
      if (!entities.cost) missing.push('cost');
      if (!entities.paymentMode) missing.push('paymentMode');
      if (
        (entities.paymentMode === 'PAID' || entities.paymentMode === 'PARTIAL') &&
        !entities.sourceAccount
      ) {
        missing.push('sourceAccount');
      }
      if (
        (entities.paymentMode === 'CREDIT' || entities.paymentMode === 'PARTIAL') &&
        !entities.sellerQuery &&
        !entities.sellerCounterpartyName
      ) {
        missing.push('seller');
      }

      return {
        intent: 'REGISTER_PURCHASE',
        entities,
        missingEntities: missing,
        ambiguities: [],
        confidence: entities.cost ? 'HIGH' : 'MEDIUM',
        language: 'es',
      };
    }
  }
  if (
    /^compr[eé] ([a-z0-9 ]+)\.?$/.test(t) &&
    !/\b(usdt|crypto|bitcoin|gasolina|renta|estacionamiento)\b/.test(t)
  ) {
    return {
      intent: 'REGISTER_PURCHASE',
      entities: { watchQuery: t.replace(/^compr[eé] /, '').replace(/\.$/, '') },
      missingEntities: ['cost', 'paymentMode'],
      ambiguities: [],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }
  if (
    /compr[eéa].*\b(usdt|crypto|bitcoin)\b|\bagrega ([\d.,]+) usdt|\bcompra\s+([\d.,]+ ?(mil|k)?)\s+de\s+usdt/.test(
      t,
    )
  ) {
    const m =
      t.match(/([\d.,]+)\s*usdt/) ??
      t.match(/agrega ([\d.,]+) usdt/) ??
      t.match(/compra\s+([\d.,]+ ?(mil|k)?)\s+de\s+usdt/);
    const quantity = m
      ? String(/mil|k/.test(m[1]) ? parseFakeAmount(m[1]) : m[1].replace(/,/g, ''))
      : undefined;
    return {
      intent: 'REGISTER_CRYPTO_POSITION',
      entities: { asset: 'USDT', ...(quantity ? { quantity } : {}) },
      missingEntities: quantity ? ['cost', 'currency'] : ['quantity', 'cost', 'currency'],
      ambiguities: [],
      confidence: 'HIGH',
      language: 'es',
    };
  }
  if (/me depositaron|me pagaron|recib[ií]\b/.test(t) && !/gast[eé]|pagu[eé]/.test(t)) {
    return {
      intent: 'UNKNOWN',
      entities: {},
      missingEntities: [],
      ambiguities: [{ field: 'intent', reason: 'inflow language is not an operating expense' }],
      confidence: 'LOW',
      language: 'es',
    };
  }
  if (/comisi[oó]n(es)? bancaria|cargo bancario|me cobraron.*banco/.test(t)) {
    const amountMatch = t.match(/([\d.,]+(?:\s*(?:mil|k))?)/);
    return {
      intent: 'REGISTER_EXPENSE',
      entities: {
        concept: 'comisión bancaria',
        currency: 'MXN',
        ...(amountMatch ? { amount: String(parseFakeAmount(amountMatch[1])) } : {}),
      },
      missingEntities: amountMatch ? ['category', 'source'] : ['amount', 'category', 'source'],
      ambiguities: [{ field: 'category', reason: 'bank fee is unsupported as operating expense' }],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }
  if (/^efectivo\.?$|^bancos\.?$|^banco\.?$|^cuenta c[eé]sar\.?$|^c[eé]sar\.?$/.test(t)) {
    const source = /efectivo/.test(t) ? 'CASH' : /c[eé]sar/.test(t) ? 'CESAR' : 'BANK';
    return {
      intent: 'REGISTER_EXPENSE',
      entities: { source },
      missingEntities: ['amount', 'currency', 'category'],
      ambiguities: [],
      confidence: 'MEDIUM',
      language: 'es',
    };
  }
  const expensePaidMatch = t.match(
    /(?:gast[eé]|pagu[eé])\s+([\d.,]+(?:\s*(?:mil|k))?)\s*(?:pesos|mxn)?\s*(?:de|en)\s+(.+?)(?:\s+(?:desde|de|en|con)\s+(.+))?$/,
  );
  const expenseAlt = t.match(
    /(?:gast[eé]|pagu[eé])\s+([\d.,]+(?:\s*(?:mil|k))?)\s+(?:de|en)\s+(.+)$/,
  );
  if (expensePaidMatch || expenseAlt) {
    const m = expensePaidMatch ?? expenseAlt!;
    const amountRaw = m[1];
    let rest = (m[2] ?? '').trim();
    let sourceHint = (m[3] ?? '').trim();
    if (!sourceHint) {
      const desde = rest.match(/\s+(?:desde|en|de|con)\s+(efectivo|bancos?|transferencia|cuenta de c[eé]sar|c[eé]sar)\s*$/);
      if (desde) {
        sourceHint = desde[1];
        rest = rest.slice(0, desde.index).trim();
      } else if (/\ba bancos\b/.test(rest)) {
        sourceHint = 'bancos';
        rest = rest.replace(/\ba bancos\b/, '').trim();
      } else if (/\ben efectivo\b/.test(rest)) {
        sourceHint = 'efectivo';
        rest = rest.replace(/\ben efectivo\b/, '').trim();
      }
    }
    const currency = /d[oó]lares|usd/.test(t) ? 'USD' : 'MXN';
    let source: string | undefined;
    if (/efectivo|cash/.test(sourceHint)) source = 'CASH';
    else if (/banco|transfer/.test(sourceHint)) source = 'BANK';
    else if (/c[eé]sar/.test(sourceHint)) source = 'CESAR';
    else if (/crypto|usdt/.test(sourceHint)) source = 'CRYPTO';
    const entities: Record<string, unknown> = {
      amount: String(parseFakeAmount(amountRaw)),
      currency,
      concept: rest || undefined,
    };
    if (source && source !== 'CRYPTO') entities.source = source;
    if (source === 'CRYPTO') entities.sourceAccount = 'CRYPTO';
    const missing: string[] = [];
    if (!source || source === 'CRYPTO') missing.push('source');
    return {
      intent: 'REGISTER_EXPENSE',
      entities,
      missingEntities: missing,
      ambiguities: currency === 'USD' ? [{ field: 'currency', reason: 'USD expenses unsupported in V1' }] : [],
      confidence: 'HIGH',
      language: 'es',
    };
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
    const output = classify(input.userText, input.currentDate, input.conversationContext);
    return {
      output,
      provider: this.providerName,
      model: 'fake-heuristic-v1',
      latencyMs: Date.now() - startedAt,
      tokenUsage: { inputTokens: 0, outputTokens: 0 },
    };
  }
}
