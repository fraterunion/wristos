const ACCENT_MAP: Record<string, string> = {
  á: 'a',
  à: 'a',
  ä: 'a',
  â: 'a',
  ã: 'a',
  é: 'e',
  è: 'e',
  ë: 'e',
  ê: 'e',
  í: 'i',
  ì: 'i',
  ï: 'i',
  î: 'i',
  ó: 'o',
  ò: 'o',
  ö: 'o',
  ô: 'o',
  õ: 'o',
  ú: 'u',
  ù: 'u',
  ü: 'u',
  û: 'u',
  ñ: 'n',
  ç: 'c',
};

export function stripAccents(value: string): string {
  return value.replace(/[^\u0000-\u007F]/g, (char) => ACCENT_MAP[char.toLowerCase()] ?? char);
}

/** Canonical comparable header key for classification and duplicate detection. */
export function normalizeHeaderKey(header: string): string {
  return stripAccents(header)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_+/g, '_');
}

export type NormalizedHeaderRow = {
  original: string;
  normalized: string;
};

export function normalizeHeaders(headers: string[]): {
  headers: NormalizedHeaderRow[];
  duplicateNormalized: string[];
} {
  const seen = new Map<string, number>();
  const duplicateNormalized: string[] = [];
  const rows = headers.map((original) => {
    const normalized = normalizeHeaderKey(original);
    const count = (seen.get(normalized) ?? 0) + 1;
    seen.set(normalized, count);
    if (count > 1 && !duplicateNormalized.includes(normalized)) {
      duplicateNormalized.push(normalized);
    }
    return { original, normalized };
  });
  return { headers: rows, duplicateNormalized };
}

export function rowToNormalizedObject(
  headers: NormalizedHeaderRow[],
  values: string[],
): Record<string, string> {
  const out: Record<string, string> = {};
  headers.forEach((header, index) => {
    const value = values[index] ?? '';
    out[header.original] = value;
    if (!(header.normalized in out)) {
      out[header.normalized] = value;
    }
  });
  return out;
}
