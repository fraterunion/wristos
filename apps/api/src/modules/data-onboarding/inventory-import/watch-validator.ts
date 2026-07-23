import { WatchOwnershipType } from '@prisma/client';

import { DryRunContext, NormalizedWatchRow, RowValidationResult, ValidationIssue, WatchRowState } from './watch-import.types';

export const ERROR_CODES = {
  /** No brand, model, or price — row lacks minimum identity for import. */
  IDENTITY_FIELDS_MISSING: 'IDENTITY_FIELDS_MISSING',
  INVALID_OWNERSHIP_TYPE: 'INVALID_OWNERSHIP_TYPE',
  INVALID_CURRENCY: 'INVALID_CURRENCY',
  INVALID_STATUS: 'INVALID_STATUS',
  NEGATIVE_COST: 'NEGATIVE_COST',
  NEGATIVE_PRICE: 'NEGATIVE_PRICE',
  PRICE_MAX_BELOW_MIN: 'PRICE_MAX_BELOW_MIN',
  CONSIGNMENT_MISSING_OWNER: 'CONSIGNMENT_MISSING_OWNER',
  SPLIT_OUT_OF_RANGE: 'SPLIT_OUT_OF_RANGE',
  SERIAL_DUPLICATE_IN_FILE: 'SERIAL_DUPLICATE_IN_FILE',
  AMBIGUOUS_NUMBER_FORMAT: 'AMBIGUOUS_NUMBER_FORMAT',
  CONFLICTING_CURRENCY: 'CONFLICTING_CURRENCY',
  INVALID_NUMBER_FORMAT: 'INVALID_NUMBER_FORMAT',
} as const;

export const WARNING_CODES = {
  COST_IS_ZERO: 'COST_IS_ZERO',
  PRICE_RANGE_IDENTICAL: 'PRICE_RANGE_IDENTICAL',
  STATUS_NOT_AVAILABLE: 'STATUS_NOT_AVAILABLE',
  USD_EXCHANGE_RATE_APPLIED: 'USD_EXCHANGE_RATE_APPLIED',
  CURRENCY_ASSUMED_MXN: 'CURRENCY_ASSUMED_MXN',
  SERIAL_FIRST_DUPLICATE_IN_FILE: 'SERIAL_FIRST_DUPLICATE_IN_FILE',
  // Exact serial conflict against live inventory. A WARNING (not error) so the
  // row stays visible/eligible in review, but commit ALWAYS skips exact serial
  // conflicts regardless of duplicate policy — backend enforcement is
  // authoritative (see WatchImportService.commitImport).
  SERIAL_EXISTS_IN_DB: 'SERIAL_EXISTS_IN_DB',
} as const;

const PARSE_ISSUE_MESSAGES: Record<string, string> = {
  AMBIGUOUS_NUMBER_FORMAT:
    'Formato numérico ambiguo (posible formato europeo, ej. 1.234,56). Use formato US: 1,234.56',
  CONFLICTING_CURRENCY: 'El valor contiene símbolos o códigos de moneda en conflicto o no soportados',
  INVALID_NUMBER_FORMAT: 'El valor no es un número válido',
  INVALID_CURRENCY: 'Moneda no reconocida. Use MXN o USD',
};

/** Canonical serial comparison form: trimmed, exact case. Used by dry-run and commit recheck. */
export function normalizeSerial(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function err(code: string, field: string, message: string): ValidationIssue {
  return { code, field, message };
}

function warn(code: string, field: string, message: string): ValidationIssue {
  return { code, field, message };
}

function hasMeaningfulPrice(normalized: NormalizedWatchRow): boolean {
  return (
    (normalized.cost !== undefined && normalized.cost !== null) ||
    (normalized.priceMin !== undefined && normalized.priceMin !== null) ||
    (normalized.priceMax !== undefined && normalized.priceMax !== null)
  );
}

/**
 * Minimum identity for an importable watch: at least one of brand, model, or price.
 * Optional enrichment fields (condition, prices, year, serial, etc.) must not block import.
 */
export function hasMinimumWatchIdentity(normalized: NormalizedWatchRow): boolean {
  return Boolean(normalized.brand) || Boolean(normalized.model) || hasMeaningfulPrice(normalized);
}

export function validateNormalizedWatch(
  normalized: NormalizedWatchRow,
  ctx: DryRunContext,
  recordId: string,
): RowValidationResult {
  const errors: ValidationIssue[] = [];
  const warnings: ValidationIssue[] = [];

  // Structured parse failures (e.g. ambiguous monetary formats) are hard errors.
  for (const issue of normalized.parseIssues ?? []) {
    errors.push(err(issue.code, issue.field, PARSE_ISSUE_MESSAGES[issue.code] ?? `Valor inválido en ${issue.field}`));
  }

  // Soft identity: brand OR model OR any price. Missing optional fields stay empty.
  if (!hasMinimumWatchIdentity(normalized)) {
    errors.push(
      err(
        ERROR_CODES.IDENTITY_FIELDS_MISSING,
        'brand',
        'Se requiere al menos marca, modelo o precio para importar el reloj',
      ),
    );
  }

  // Numeric constraints (only when values are present)
  if (normalized.cost !== undefined && normalized.cost !== null) {
    if (normalized.cost < 0) {
      errors.push(err(ERROR_CODES.NEGATIVE_COST, 'cost', 'cost no puede ser negativo'));
    } else if (normalized.cost === 0) {
      warnings.push(warn(WARNING_CODES.COST_IS_ZERO, 'cost', 'cost es 0 — inusual para un reloj de lujo'));
    }
  }
  if (normalized.priceMin !== undefined && normalized.priceMin !== null && normalized.priceMin < 0) {
    errors.push(err(ERROR_CODES.NEGATIVE_PRICE, 'priceMin', 'priceMin no puede ser negativo'));
  }
  if (normalized.priceMax !== undefined && normalized.priceMax !== null && normalized.priceMax < 0) {
    errors.push(err(ERROR_CODES.NEGATIVE_PRICE, 'priceMax', 'priceMax no puede ser negativo'));
  }

  // Price range cross-validation
  if (
    normalized.priceMin !== undefined &&
    normalized.priceMax !== undefined &&
    normalized.priceMin !== null &&
    normalized.priceMax !== null
  ) {
    if (normalized.priceMax < normalized.priceMin) {
      errors.push(err(ERROR_CODES.PRICE_MAX_BELOW_MIN, 'priceMax', 'priceMax debe ser mayor o igual a priceMin'));
    } else if (normalized.priceMax === normalized.priceMin) {
      warnings.push(warn(WARNING_CODES.PRICE_RANGE_IDENTICAL, 'priceMax', 'priceMin y priceMax son iguales'));
    }
  }

  // Consignment rules
  if (normalized.ownershipType === WatchOwnershipType.CONSIGNMENT) {
    if (!normalized.consignmentOwnerName) {
      errors.push(
        err(ERROR_CODES.CONSIGNMENT_MISSING_OWNER, 'consignmentOwnerName', 'consignmentOwnerName es requerido para relojes en consignación'),
      );
    }
    if (normalized.consignmentSplitPercentage !== undefined && normalized.consignmentSplitPercentage !== null) {
      if (normalized.consignmentSplitPercentage < 0 || normalized.consignmentSplitPercentage > 100) {
        errors.push(err(ERROR_CODES.SPLIT_OUT_OF_RANGE, 'consignmentSplitPercentage', 'consignmentSplitPercentage debe estar entre 0 y 100'));
      }
    }
  }

  // Status warning
  if (normalized.status && normalized.status !== 'AVAILABLE') {
    warnings.push(warn(WARNING_CODES.STATUS_NOT_AVAILABLE, 'status', `Importando con status "${normalized.status}"`));
  }

  // Currency assumed MXN when document did not label currency explicitly
  if (normalized.currencyAssumedMxn) {
    warnings.push(
      warn(
        WARNING_CODES.CURRENCY_ASSUMED_MXN,
        'costCurrency',
        'Moneda no indicada explícitamente; se interpretó como MXN.',
      ),
    );
  }

  // USD exchange rate disclosure
  if (normalized.costCurrency === 'USD' && normalized.costExchangeRate !== undefined) {
    warnings.push(
      warn(
        WARNING_CODES.USD_EXCHANGE_RATE_APPLIED,
        'cost',
        `Tipo de cambio ${normalized.costExchangeRate.toFixed(4)} aplicado (USD → MXN) al momento del dry-run`,
      ),
    );
  }

  // Serial number checks. Normalization: trimmed exact comparison.
  const sn = normalizeSerial(normalized.serialNumber);
  if (sn) {
    // In-file duplicate (2nd+ occurrence): hard error — never importable.
    const firstRecordId = ctx.fileSerialsSeen.get(sn);
    if (firstRecordId === undefined) {
      ctx.fileSerialsSeen.set(sn, recordId);
    } else if (firstRecordId !== recordId) {
      errors.push(err(ERROR_CODES.SERIAL_DUPLICATE_IN_FILE, 'serialNumber', `Serie "${sn}" aparece más de una vez en el archivo`));
    }

    // Exact conflict against live inventory: WARNING + always skipped at commit.
    if (ctx.existingSerials.has(sn)) {
      warnings.push(
        warn(
          WARNING_CODES.SERIAL_EXISTS_IN_DB,
          'serialNumber',
          `Serie "${sn}" ya existe en el inventario — esta fila siempre se omitirá al importar`,
        ),
      );
    }
  }

  let state: WatchRowState;
  if (errors.length > 0) {
    state = 'INVALID';
  } else if (warnings.length > 0) {
    state = 'WARNING';
  } else {
    state = 'VALID';
  }

  return { state, errors, warnings };
}

export function markFirstSerialWarnings(
  results: Array<{ recordId: string; normalized: NormalizedWatchRow; result: RowValidationResult }>,
  ctx: DryRunContext,
): void {
  // First occurrences of serials that also appear later get a warning
  const duplicateFirsts = new Set<string>();
  for (const r of results) {
    const sn = normalizeSerial(r.normalized.serialNumber);
    if (!sn) continue;
    const firstId = ctx.fileSerialsSeen.get(sn);
    if (firstId && firstId !== r.recordId) {
      duplicateFirsts.add(firstId);
    }
  }

  for (const r of results) {
    if (duplicateFirsts.has(r.recordId) && r.normalized.serialNumber) {
      if (r.result.state !== 'INVALID') {
        r.result.warnings.push(
          warn(
            WARNING_CODES.SERIAL_FIRST_DUPLICATE_IN_FILE,
            'serialNumber',
            `Serie "${r.normalized.serialNumber}" aparece duplicada en el archivo`,
          ),
        );
        if (r.result.state === 'VALID') r.result.state = 'WARNING';
      }
    }
  }
}
