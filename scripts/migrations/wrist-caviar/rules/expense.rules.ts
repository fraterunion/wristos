import type { RuleDispositionPatch } from './types';

/** Explicit alias table for repeated GASTOS labels with clear destination meaning. */
export const EXPENSE_ALIAS_TABLE: Record<
  string,
  { destinationCategory: string; ruleId: 'WC_EXPENSE_ALIAS_MAP'; reason: string }
> = {
  gas: { destinationCategory: 'GASOLINE', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'gas shorthand for gasoline' },
  gasolina: { destinationCategory: 'GASOLINE', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'gasoline label' },
  gasolibna: { destinationCategory: 'GASOLINE', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'gasoline typo alias confirmed by pattern' },
  combustible: { destinationCategory: 'GASOLINE', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'fuel alias' },
  pemex: { destinationCategory: 'GASOLINE', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'fuel station alias' },
  caseta: { destinationCategory: 'TOLLS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'toll booth alias' },
  casetas: { destinationCategory: 'TOLLS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'toll booths alias' },
  peaje: { destinationCategory: 'TOLLS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'toll alias' },
  relojero: { destinationCategory: 'WATCHMAKER', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'watchmaker alias' },
  estacionamiento: { destinationCategory: 'PARKING', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'parking alias' },
  parking: { destinationCategory: 'PARKING', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'parking alias' },
  comida: { destinationCategory: 'MEALS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'meals alias' },
  comidas: { destinationCategory: 'MEALS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'meals alias' },
  cena: { destinationCategory: 'MEALS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'meals alias' },
  almuerzo: { destinationCategory: 'MEALS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'meals alias' },
  restaurante: { destinationCategory: 'MEALS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'meals alias' },
  subway: { destinationCategory: 'MEALS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'meal vendor alias' },
  vuelo: { destinationCategory: 'FLIGHTS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'flights alias' },
  vuelos: { destinationCategory: 'FLIGHTS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'flights alias' },
  avion: { destinationCategory: 'FLIGHTS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'flights alias' },
  aeropuerto: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel/airport alias' },
  viaje: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel alias' },
  viaticos: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel per-diem alias' },
  'viáticos': { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel per-diem alias' },
  'viatico colombia': { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel per-diem alias' },
  hotel: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel lodging alias' },
  uber: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel transport alias' },
  taxi: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'travel transport alias' },
  chofer: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'driver/travel alias' },
  pauta: { destinationCategory: 'MARKETING', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'ads/marketing alias' },
  marketing: { destinationCategory: 'MARKETING', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'marketing alias' },
  publicidad: { destinationCategory: 'MARKETING', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'marketing alias' },
  instagram: { destinationCategory: 'MARKETING', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'marketing channel alias' },
  comision: { destinationCategory: 'COMMISSIONS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'commission alias' },
  comisión: { destinationCategory: 'COMMISSIONS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'commission alias' },
  'comisión jaziel': { destinationCategory: 'COMMISSIONS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'named commission alias' },
  'comision jaziel': { destinationCategory: 'COMMISSIONS', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'named commission alias' },
  internet: {
    destinationCategory: 'OTHER',
    ruleId: 'WC_EXPENSE_ALIAS_MAP',
    reason: 'internet/telecom ops spend — never bank commission',
  },
  'ruben ajuste reloj': {
    destinationCategory: 'WATCHMAKER',
    ruleId: 'WC_EXPENSE_ALIAS_MAP',
    reason: 'watchmaker adjustment label',
  },
  'correa ap': {
    destinationCategory: 'WATCHMAKER',
    ruleId: 'WC_EXPENSE_ALIAS_MAP',
    reason: 'watch strap service/parts',
  },
  pila: { destinationCategory: 'WATCHMAKER', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'watch battery' },
  'caja rolex': {
    destinationCategory: 'WATCHMAKER',
    ruleId: 'WC_EXPENSE_ALIAS_MAP',
    reason: 'watch case/box related service',
  },
  acapulco: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'trip location expense' },
  vegas: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'trip location expense' },
  colombia: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'trip location expense' },
  'gastos colombia': {
    destinationCategory: 'TRAVEL',
    ruleId: 'WC_EXPENSE_ALIAS_MAP',
    reason: 'trip location expense',
  },
  'gasto miami': { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'trip location expense' },
  'gasto cartagena': {
    destinationCategory: 'TRAVEL',
    ruleId: 'WC_EXPENSE_ALIAS_MAP',
    reason: 'trip location expense',
  },
  'gasto qro': { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'trip location expense' },
  'guia dary': { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'shipping guide expense' },
  guia: { destinationCategory: 'TRAVEL', ruleId: 'WC_EXPENSE_ALIAS_MAP', reason: 'shipping guide expense' },
};

/**
 * Pattern precedence matters:
 * 1. Bank-specific commission expressions MUST run before generic commission matching.
 * 2. Generic /comision|comisión/ must not capture "comisión bancaria", "comisión BBVA", etc.
 */
export const EXPENSE_CATEGORY_PATTERNS: Array<{ pattern: RegExp; category: string }> = [
  { pattern: /gasolin|combustible|pemex|^gas$|gas\s+y\s+envio|gasolibna/i, category: 'GASOLINE' },
  { pattern: /caseta|peaje|toll/i, category: 'TOLLS' },
  { pattern: /relojero|watchmaker|pulida|eslabon|eslabón|servicio reloj|guia reloj|guía reloj|ajuste reloj|correa|\bpila\b|caja rolex/i, category: 'WATCHMAKER' },
  { pattern: /estacionamiento|parking/i, category: 'PARKING' },
  { pattern: /comida|cena|almuerzo|desayuno|restaurante|meals?|subway|vino\b/i, category: 'MEALS' },
  { pattern: /vuelo|vuelos|avion|avión|airline|flight/i, category: 'FLIGHTS' },
  { pattern: /viaje|hotel|uber|taxi|travel|viaticos|viáticos|viatico|chofer|aeropuerto|\bguia\b|\bguía\b/i, category: 'TRAVEL' },
  { pattern: /marketing|publicidad|pauta|instagram|\bads?\b/i, category: 'MARKETING' },
  // Bank-specific BEFORE generic sales commissions
  {
    pattern:
      /comisi[oó]n(?:es)?\s+banc\w*|comisi[oó]n(?:es)?\s+(?:bbva|santander|spei)\b|cargo\s+bancario|bank\s+fee|\btransfer\s+fee\b|\bspei\b|\bbanco\b/i,
    category: 'BANK_FEES',
  },
  { pattern: /comision|comisión|commission/i, category: 'COMMISSIONS' },
  { pattern: /dhl|envio|envío|fedex|ups\b/i, category: 'TRAVEL' },
  {
    pattern:
      /gastos?\s+(colombia|miami|qro|gdl|mty|cartagena|angeles|cancun|acapulco|vegas)|^(acapulco|vegas|colombia|miami|cartagena|cancun|los angeles)$/i,
    category: 'TRAVEL',
  },
];

export function normalizeExpenseLabel(concept: string): string {
  return concept
    .normalize('NFKC')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

/**
 * Map a GASTOS concept to a destination category.
 * Clear aliases/patterns first; unmapped free-form labels → OTHER (WC_EXPENSE_UNMAPPED_AS_OTHER).
 */
export function resolveExpenseCategory(concept: string): {
  category: string;
  patch: RuleDispositionPatch;
} {
  const normalized = normalizeExpenseLabel(concept || '');
  const alias = EXPENSE_ALIAS_TABLE[normalized];
  if (alias) {
    return {
      category: alias.destinationCategory,
      patch: {
        disposition: 'CREATE',
        dispositionReason: 'expense_alias_mapped',
        payloadPatch: { category: alias.destinationCategory },
        audit: {
          ruleId: 'WC_EXPENSE_ALIAS_MAP',
          description: alias.reason,
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      },
    };
  }
  for (const rule of EXPENSE_CATEGORY_PATTERNS) {
    if (rule.pattern.test(normalized)) {
      return {
        category: rule.category,
        patch: {
          disposition: 'CREATE',
          dispositionReason: 'expense_pattern_mapped',
          payloadPatch: { category: rule.category },
          audit: {
            ruleId: 'WC_EXPENSE_ALIAS_MAP',
            description: `pattern mapped to ${rule.category}`,
            changesData: true,
            appliedAt: new Date().toISOString(),
          },
        },
      };
    }
  }
  return {
    category: 'OTHER',
    patch: {
      disposition: 'CREATE',
      dispositionReason: 'expense_unmapped_as_other',
      payloadPatch: { category: 'OTHER' },
      audit: {
        ruleId: 'WC_EXPENSE_UNMAPPED_AS_OTHER',
        description:
          'Free-form GASTOS label with no clear enum alias; import as OTHER with concept preserved in notes',
        changesData: true,
        appliedAt: new Date().toISOString(),
      },
    },
  };
}
