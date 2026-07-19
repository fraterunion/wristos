/**
 * Neutralize spreadsheet formula injection: any cell whose first
 * non-whitespace character is =, +, -, @ (or a control char Excel treats as a
 * formula trigger) is prefixed with a single quote so spreadsheet apps render
 * it as text.
 */
export function neutralizeFormula(value: string): string {
  if (/^\s*[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/** Standard CSV quoting for commas, quotes, and newlines. */
export function quoteCsvValue(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n') || value.includes('\r')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** Full escaping pipeline for a user-controlled CSV cell. */
export function escapeCsvCell(value: string): string {
  return quoteCsvValue(neutralizeFormula(value));
}
