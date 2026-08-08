import { OperatingExpenseCategory } from '@prisma/client';
import { REGISTERABLE_EXPENSE_CATEGORIES } from '../../../expenses/expense-registration.service';

export type ExpenseCategoryResolve =
  | { kind: 'RESOLVED'; category: OperatingExpenseCategory; concept: string }
  | { kind: 'CLARIFY'; reason: string }
  | { kind: 'UNSUPPORTED'; reason: string };

const ALIASES: Array<{ category: OperatingExpenseCategory; patterns: RegExp[] }> = [
  {
    category: OperatingExpenseCategory.GASOLINE,
    patterns: [/\bgasolina\b/, /\bcombustible\b/, /\bgasolina\b/, /\bfuel\b/],
  },
  {
    category: OperatingExpenseCategory.TOLLS,
    patterns: [/\bcasetas?\b/, /\bpeaje\b/, /\btolls?\b/],
  },
  {
    category: OperatingExpenseCategory.WATCHMAKER,
    patterns: [/\brelojero\b/, /\bservicio (del )?reloj/, /\bwatchmaker\b/],
  },
  {
    category: OperatingExpenseCategory.PARKING,
    patterns: [/\bestacionamiento\b/, /\bparking\b/, /\bvalet\b/],
  },
  {
    category: OperatingExpenseCategory.MEALS,
    patterns: [/\bcomida\b/, /\bcomidas\b/, /\balmuerzo\b/, /\bcena\b/, /\brestaurante\b/, /\bmeals?\b/],
  },
  {
    category: OperatingExpenseCategory.FLIGHTS,
    patterns: [/\bvuelo\b/, /\bvuelos\b/, /\bboleto de avi[oó]n\b/, /\bflights?\b/],
  },
  {
    category: OperatingExpenseCategory.TRAVEL,
    patterns: [/\bvi[aá]ticos?\b/, /\bhotel (de )?viaje\b/, /\bviaje\b/, /\btravel\b/],
  },
  {
    category: OperatingExpenseCategory.MARKETING,
    patterns: [/\bmarketing\b/, /\bpublicidad\b/, /\banuncios?\b/, /\bads?\b/],
  },
  {
    category: OperatingExpenseCategory.COMMISSIONS,
    patterns: [/\bcomisi[oó]n(es)? (de )?ventas?\b/, /\bagente\b/, /\bbroker\b/, /\breferral\b/],
  },
];

const BANK_FEE_PATTERNS = [
  /\bcomisi[oó]n(es)? bancaria(s)?\b/,
  /\bcargo bancario\b/,
  /\bbank fee\b/,
  /\bme cobraron\b.*\bbanco/,
];

const RENT_PATTERNS = [/\brenta\b/, /\balquiler\b/, /\brent\b/];

function normalizeText(raw: string): string {
  return raw
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ');
}

/**
 * Deterministic expense category resolution for AI planner (Commit 15B).
 * Never invents enums. BANK_FEES → unsupported. Uncertain → clarify.
 */
export function resolveExpenseCategory(input: {
  category?: string | null;
  concept?: string | null;
  notes?: string | null;
}): ExpenseCategoryResolve {
  const text = normalizeText(
    [input.concept, input.notes].filter(Boolean).join(' '),
  );

  // Bank-fee language wins over LLM-invented categories — never duplicate Control Bancos.
  if (BANK_FEE_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: 'UNSUPPORTED',
      reason:
        'Esa frase parece una comisión bancaria. No la registro como gasto operativo para evitar doble conteo.',
    };
  }

  const explicit = String(input.category ?? '').trim().toUpperCase();
  if (explicit === 'BANK_FEES') {
    return {
      kind: 'UNSUPPORTED',
      reason:
        'Las comisiones bancarias canónicas no se registran como gasto operativo. Usa Control Bancos / el flujo de venta.',
    };
  }
  if (explicit && (REGISTERABLE_EXPENSE_CATEGORIES as string[]).includes(explicit)) {
    const concept =
      String(input.concept ?? input.notes ?? '').trim() ||
      categoryDefaultConcept(explicit as OperatingExpenseCategory);
    return {
      kind: 'RESOLVED',
      category: explicit as OperatingExpenseCategory,
      concept,
    };
  }
  if (explicit && explicit !== 'OTHER') {
    return { kind: 'CLARIFY', reason: 'Categoría de gasto no reconocida.' };
  }

  if (!text) {
    return { kind: 'CLARIFY', reason: 'Necesito el concepto o la categoría del gasto.' };
  }

  if (RENT_PATTERNS.some((p) => p.test(text))) {
    return {
      kind: 'RESOLVED',
      category: OperatingExpenseCategory.OTHER,
      concept: extractRentConcept(input.concept ?? input.notes ?? 'Renta'),
    };
  }

  const hits: OperatingExpenseCategory[] = [];
  for (const row of ALIASES) {
    if (row.patterns.some((p) => p.test(text))) hits.push(row.category);
  }
  const unique = [...new Set(hits)];
  if (unique.length === 1) {
    return {
      kind: 'RESOLVED',
      category: unique[0]!,
      concept: String(input.concept ?? input.notes ?? text).trim(),
    };
  }
  if (unique.length > 1) {
    return {
      kind: 'CLARIFY',
      reason: 'El concepto coincide con varias categorías. ¿Cuál es la categoría correcta?',
    };
  }

  // Explicit OTHER with concept, or free-text with no alias → OTHER only if caller set OTHER
  if (explicit === 'OTHER') {
    return {
      kind: 'RESOLVED',
      category: OperatingExpenseCategory.OTHER,
      concept: String(input.concept ?? input.notes ?? text).trim(),
    };
  }

  return {
    kind: 'CLARIFY',
    reason:
      'No pude mapear el concepto a una categoría canónica. Indica la categoría (por ejemplo Gasolina, Marketing u Otro).',
  };
}

function extractRentConcept(raw: string): string {
  const t = String(raw).trim();
  if (!t) return 'Renta';
  if (/^renta$/i.test(t)) return 'Renta';
  return t;
}

function categoryDefaultConcept(category: OperatingExpenseCategory): string {
  const labels: Partial<Record<OperatingExpenseCategory, string>> = {
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
  return labels[category] ?? category;
}

export function resolveExpenseSource(raw: unknown): 'CASH' | 'BANK' | 'CESAR' | null {
  if (typeof raw !== 'string') return null;
  const t = normalizeText(raw);
  if (!t) return null;
  if (t === 'cash' || t === 'efectivo' || /\ben efectivo\b/.test(t) || /\bde efectivo\b/.test(t)) {
    return 'CASH';
  }
  if (
    t === 'bank' ||
    t === 'bancos' ||
    t === 'banco' ||
    /\ba bancos\b/.test(t) ||
    /\bde bancos\b/.test(t) ||
    /\bdesde bancos\b/.test(t) ||
    /\btransferencia\b/.test(t)
  ) {
    return 'BANK';
  }
  if (
    t === 'cesar' ||
    t === 'césar' ||
    /\bcuenta de c[eé]sar\b/.test(t) ||
    /\bdesde (la )?cuenta de c[eé]sar\b/.test(t) ||
    /\blo pag[oó] c[eé]sar\b/.test(t)
  ) {
    return 'CESAR';
  }
  if (t === 'crypto' || t === 'usdt' || t === 'bitcoin') return null;
  const upper = raw.trim().toUpperCase();
  if (upper === 'CASH' || upper === 'BANK' || upper === 'CESAR') return upper;
  return null;
}

export const EXPENSE_CATEGORY_LABELS: Record<string, string> = {
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
  BANK_FEES: 'Comisiones de bancos',
};

export const EXPENSE_SOURCE_LABELS: Record<string, string> = {
  CASH: 'Efectivo',
  BANK: 'Bancos',
  CESAR: 'Cuenta César',
};
