import type { ParsedJsonFile, ParsedTabularRow } from './parser.types';

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectToRow(obj: Record<string, unknown>, rowNumber: number): ParsedTabularRow {
  const headers = Object.keys(obj);
  return {
    sourceSheet: 'JSON',
    sourceRowNumber: rowNumber,
    headers,
    rawData: obj,
  };
}

export function parseJsonBuffer(buffer: Buffer): ParsedJsonFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(buffer.toString('utf8'));
  } catch {
    throw new Error('JSON inválido o ilegible.');
  }

  if (Array.isArray(parsed)) {
    const rows = parsed.flatMap((item, index) => {
      if (!isPlainObject(item)) return [];
      return [objectToRow(item, index + 1)];
    });
    return { structure: 'array', rows };
  }

  if (isPlainObject(parsed)) {
    const arrayEntries = Object.entries(parsed).filter(([, value]) => Array.isArray(value));
    if (arrayEntries.length > 0) {
      const rows: ParsedTabularRow[] = [];
      let rowNumber = 1;
      for (const [key, value] of arrayEntries) {
        for (const item of value as unknown[]) {
          if (!isPlainObject(item)) continue;
          rows.push({
            sourceSheet: key,
            sourceRowNumber: rowNumber++,
            headers: Object.keys(item),
            rawData: { _collection: key, ...item },
          });
        }
      }
      return { structure: 'object_with_arrays', rows };
    }

    return {
      structure: 'single_object',
      rows: [objectToRow(parsed, 1)],
    };
  }

  throw new Error('JSON debe ser un arreglo u objeto.');
}
