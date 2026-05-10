const PRICE_RE =
  /(?:[$€£]|USD|EUR|GBP|CHF|AED|SGD|HKD)?\s*[\d,]+(?:\.\d{1,2})?(?:\s*(?:[$€£]|USD|EUR|GBP|CHF|AED|SGD|HKD|k|K))?/gi;

export function looksLikePriceSignal(content: string): boolean {
  const matches = content.match(PRICE_RE);
  if (!matches) return false;
  // At least one match that looks like a plausible watch price (> 100)
  return matches.some((m) => {
    const digits = m.replace(/[^\d.]/g, '');
    if (!digits) return false;
    const value = parseFloat(digits.replace(/,/g, ''));
    return value > 100;
  });
}
