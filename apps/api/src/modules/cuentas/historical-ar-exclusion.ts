/** Source tags that must never create automatic AR (AccountEntry or Receivable). */
export const HISTORICAL_AR_EXCLUDED_SOURCE_TAGS = [
  'wrist-caviar-master-workbook-v1',
  'HISTORICAL_SALES_IMPORT',
] as const;

export type HistoricalArExcludedSourceTag =
  (typeof HISTORICAL_AR_EXCLUDED_SOURCE_TAGS)[number];

export function isHistoricalDealSourceTag(
  sourceTag: string | null | undefined,
): boolean {
  if (!sourceTag) return false;
  return (HISTORICAL_AR_EXCLUDED_SOURCE_TAGS as readonly string[]).includes(
    sourceTag,
  );
}
