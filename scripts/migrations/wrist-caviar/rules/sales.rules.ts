import type { RuleDispositionPatch } from './types';

const POLLUTED_SERIALS = new Set(
  [
    'dolares',
    'dólares',
    'usd',
    'mxn',
    'n/a',
    'na',
    'null',
    'none',
    'sin serie',
    's/n',
    'sn',
    '-',
    '--',
    'xxx',
    'tbd',
  ].map((s) => s.toLowerCase()),
);

/**
 * Historical sales: missing serial/reference must not block Deal creation.
 * Polluted placeholder serials → null with audit.
 */
export function applyHistoricalSaleFieldRules(input: {
  serial: string | null | undefined;
  reference: string | null | undefined;
}): {
  serial: string | null;
  reference: string | null | undefined;
  audits: RuleDispositionPatch[];
} {
  const audits: RuleDispositionPatch[] = [];
  let serial = input.serial ?? null;
  const reference = input.reference;

  if (serial != null) {
    const norm = String(serial).normalize('NFKC').trim().toLowerCase();
    if (!norm || POLLUTED_SERIALS.has(norm)) {
      serial = null;
      audits.push({
        disposition: 'CREATE',
        dispositionReason: 'polluted_serial_nullified',
        payloadPatch: { serial: null },
        audit: {
          ruleId: 'WC_POLLUTED_SERIAL_AS_NULL',
          description: 'Placeholder/non-serial token cleared to null for historical sale',
          changesData: true,
          appliedAt: new Date().toISOString(),
        },
      });
    }
  } else {
    audits.push({
      disposition: 'CREATE',
      dispositionReason: 'serial_optional_historical_sale',
      audit: {
        ruleId: 'WC_SERIAL_OPTIONAL_FOR_HISTORICAL_SALE',
        description: 'Missing serial allowed for historical Deal (watchId null)',
        changesData: false,
        appliedAt: new Date().toISOString(),
      },
    });
  }

  if (reference == null || String(reference).trim() === '') {
    audits.push({
      disposition: 'CREATE',
      dispositionReason: 'reference_optional_historical_sale',
      audit: {
        ruleId: 'WC_REFERENCE_OPTIONAL_FOR_HISTORICAL_SALE',
        description: 'Missing reference allowed for historical Deal',
        changesData: false,
        appliedAt: new Date().toISOString(),
      },
    });
  }

  audits.push({
    disposition: 'CREATE',
    dispositionReason: 'historical_sale_no_current_watch',
    payloadPatch: { mutatesInventory: false },
    audit: {
      ruleId: 'WC_HISTORICAL_SALE_NO_CURRENT_WATCH',
      description: 'Historical sales create Deal with watchId null; no Watch mutation',
      changesData: false,
      appliedAt: new Date().toISOString(),
    },
  });

  return { serial, reference, audits };
}
