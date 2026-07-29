/** Capital / profit distribution rules for Wrist Caviar. */

export const CESAR_PROFIT_SHARE = 0.75;
export const EDGAR_PROFIT_SHARE = 0.25;

export function expectedProfitShare(partner: string): number | null {
  if (partner === 'CESAR') return CESAR_PROFIT_SHARE;
  if (partner === 'EDGAR') return EDGAR_PROFIT_SHARE;
  return null;
}

export function isSupportedProfitPartner(partner: string): boolean {
  return partner === 'CESAR' || partner === 'EDGAR';
}
