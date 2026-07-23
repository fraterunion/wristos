import {
  ERROR_CODES,
  NormalizedHistoricalSale,
  SalesDryRunContext,
  SalesRowState,
  SalesRowValidationResult,
  SalesValidationIssue,
  WARNING_CODES,
} from './historical-sale.types';
import { profitsMismatch } from './sales-normalizer';

const PARSE_ISSUE_MESSAGES: Record<string, string> = {
  AMBIGUOUS_NUMBER_FORMAT:
    'Formato numérico ambiguo (posible formato europeo, ej. 1.234,56). Use formato US: 1,234.56',
  CONFLICTING_CURRENCY: 'El valor contiene símbolos o códigos de moneda en conflicto o no soportados',
  INVALID_NUMBER_FORMAT: 'El valor no es un número válido',
  INVALID_CURRENCY: 'Moneda no reconocida. Use MXN o USD',
  INVALID_DATE: 'Fecha inválida. Use DD/MM/YYYY o YYYY-MM-DD',
};

function err(code: string, field: string, message: string): SalesValidationIssue {
  return { code, field, message };
}

function warn(code: string, field: string, message: string): SalesValidationIssue {
  return { code, field, message };
}

/**
 * Minimum identity for an importable historical sale: at least one of
 * customerName | brand | model | reference | serialNumber | salePrice.
 */
export function hasMinimumSaleIdentity(normalized: NormalizedHistoricalSale): boolean {
  return Boolean(
    normalized.customerName ||
      normalized.brand ||
      normalized.model ||
      normalized.reference ||
      normalized.serialNumber ||
      (normalized.salePrice !== undefined && normalized.salePrice !== null),
  );
}

export function normalizeClientName(value: string | null | undefined): string | null {
  const trimmed = value?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

/** Accent-insensitive form for possible-duplicate hints only (never auto-merge). */
export function looseClientName(value: string | null | undefined): string | null {
  const exact = normalizeClientName(value);
  if (!exact) return null;
  return exact.normalize('NFD').replace(/\p{M}/gu, '');
}

export function normalizeSerial(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function referenceModelKey(reference?: string | null, model?: string | null): string | null {
  const ref = reference?.trim().toLowerCase();
  const mod = model?.trim().toLowerCase();
  if (!ref || !mod) return null;
  return `${ref}|${mod}`;
}

function flagNegative(
  warnings: SalesValidationIssue[],
  field: string,
  value: number | undefined,
): void {
  if (value !== undefined && value < 0) {
    warnings.push(
      warn(
        WARNING_CODES.NEGATIVE_AMOUNT_REVIEW,
        field,
        `${field} es negativo (${value}) — se preserva el valor; revise antes de importar`,
      ),
    );
  }
}

export function validateNormalizedSale(
  normalized: NormalizedHistoricalSale,
  ctx: SalesDryRunContext,
  recordId: string,
): SalesRowValidationResult {
  const errors: SalesValidationIssue[] = [];
  const warnings: SalesValidationIssue[] = [];

  for (const issue of normalized.parseIssues ?? []) {
    errors.push(
      err(issue.code, issue.field, PARSE_ISSUE_MESSAGES[issue.code] ?? `Valor inválido en ${issue.field}`),
    );
  }

  if (!hasMinimumSaleIdentity(normalized)) {
    errors.push(
      err(
        ERROR_CODES.IDENTITY_FIELDS_MISSING,
        'customerName',
        'Se requiere al menos cliente, marca, modelo, referencia, serie o precio de venta',
      ),
    );
  }

  if (normalized.salePrice === undefined || normalized.salePrice === null) {
    errors.push(
      err(
        ERROR_CODES.SALE_PRICE_REQUIRED_FOR_COMMIT,
        'salePrice',
        'El precio de venta es obligatorio para importar la fila',
      ),
    );
  }

  flagNegative(warnings, 'cost', normalized.cost);
  flagNegative(warnings, 'salePrice', normalized.salePrice);
  flagNegative(warnings, 'extras', normalized.extras);
  flagNegative(warnings, 'reportedProfit', normalized.reportedProfit);

  if (normalized.currencyAssumedMxn) {
    warnings.push(
      warn(
        WARNING_CODES.CURRENCY_ASSUMED_MXN,
        'currency',
        'Moneda no indicada explícitamente; se interpretó como MXN.',
      ),
    );
  }

  const fxApplied =
    normalized.costExchangeRate != null ||
    normalized.saleExchangeRate != null ||
    normalized.extrasExchangeRate != null;
  if (fxApplied) {
    const rate =
      normalized.saleExchangeRate ?? normalized.costExchangeRate ?? normalized.extrasExchangeRate ?? 0;
    warnings.push(
      warn(
        WARNING_CODES.USD_EXCHANGE_RATE_APPLIED,
        'salePrice',
        `Tipo de cambio ${rate.toFixed(4)} aplicado (USD → MXN) al momento del dry-run`,
      ),
    );
  }

  if (profitsMismatch(normalized.reportedProfit, normalized.calculatedProfit ?? null)) {
    warnings.push(
      warn(
        WARNING_CODES.PROFIT_MISMATCH,
        'reportedProfit',
        `Utilidad reportada (${normalized.reportedProfit}) ≠ calculada (${normalized.calculatedProfit})`,
      ),
    );
  }

  // Client matching
  const exactName = normalizeClientName(normalized.customerName);
  if (exactName) {
    const matchedId = ctx.existingClientsByName.get(exactName);
    if (matchedId) {
      normalized.matchedClientId = matchedId;
      normalized.proposedClientCreate = false;
      warnings.push(
        warn(WARNING_CODES.CLIENT_MATCHED, 'customerName', `Cliente existente coincidente: "${normalized.customerName}"`),
      );
    } else {
      normalized.proposedClientCreate = true;
      normalized.matchedClientId = null;
      warnings.push(
        warn(
          WARNING_CODES.CLIENT_WILL_BE_CREATED,
          'customerName',
          `Se creará un cliente histórico: "${normalized.customerName}"`,
        ),
      );
      const loose = looseClientName(normalized.customerName);
      if (loose) {
        const possibleId = ctx.existingClientsByLooseName.get(loose);
        if (possibleId && !ctx.existingClientsByName.has(exactName)) {
          warnings.push(
            warn(
              WARNING_CODES.CLIENT_POSSIBLE_DUPLICATE,
              'customerName',
              `Posible cliente duplicado (acentos/variantes) — no se fusionará automáticamente`,
            ),
          );
        }
      }
    }
  }

  // Watch serial exact match (propose only)
  const sn = normalizeSerial(normalized.serialNumber);
  if (sn) {
    const watchId = ctx.existingSerials.get(sn);
    if (watchId) {
      normalized.matchedWatchId = watchId;
      normalized.matchedWatchBy = 'serial';
      warnings.push(
        warn(
          WARNING_CODES.WATCH_SERIAL_MATCH,
          'serialNumber',
          `Serie "${sn}" coincide con un reloj existente — propuesta de coincidencia (no se vinculará al importar)`,
        ),
      );
    }
  }

  // Reference + model possible match (no auto-link)
  if (!normalized.matchedWatchId) {
    const key = referenceModelKey(normalized.reference, normalized.model);
    if (key) {
      const ids = ctx.existingByReferenceModel.get(key);
      if (ids && ids.length > 0) {
        normalized.matchedWatchBy = 'reference';
        warnings.push(
          warn(
            WARNING_CODES.WATCH_REFERENCE_MATCH,
            'reference',
            `Posible coincidencia por referencia/modelo (${ids.length}) — no se vinculará automáticamente`,
          ),
        );
      }
    }
  }

  // Fingerprint duplicates
  const fp = normalized.importFingerprint;
  if (fp) {
    const firstId = ctx.fileFingerprintsSeen.get(fp);
    if (firstId === undefined) {
      ctx.fileFingerprintsSeen.set(fp, recordId);
    } else if (firstId !== recordId) {
      errors.push(
        err(ERROR_CODES.DUPLICATE_IN_FILE, 'importFingerprint', 'Fila duplicada dentro del archivo de importación'),
      );
    }

    if (ctx.existingFingerprints.has(fp)) {
      warnings.push(
        warn(
          WARNING_CODES.DUPLICATE_IN_DB,
          'importFingerprint',
          'Venta histórica con la misma huella ya existe en la base de datos',
        ),
      );
    }
  }

  let state: SalesRowState;
  if (errors.length > 0) {
    state = 'INVALID';
  } else if (warnings.length > 0) {
    state = 'WARNING';
  } else {
    state = 'VALID';
  }

  return { state, errors, warnings };
}
