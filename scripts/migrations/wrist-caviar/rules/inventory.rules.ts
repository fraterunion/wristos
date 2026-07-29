/**
 * Inventory rules for Wrist Caviar one-time import.
 * Current inventory requires schema-required fields only.
 * Historical sales never create/mutate current Watch records.
 */

export function currentInventoryRequiresSerial(serial: string | null | undefined): boolean {
  return serial != null && String(serial).trim().length > 0;
}

export const INVENTORY_RULE_IDS = [
  'WC_HISTORICAL_SALE_NO_CURRENT_WATCH',
  'WC_SERIAL_OPTIONAL_FOR_HISTORICAL_SALE',
  'WC_REFERENCE_OPTIONAL_FOR_HISTORICAL_SALE',
] as const;
