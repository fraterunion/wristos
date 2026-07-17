import { parse } from 'csv-parse/sync';

import type { ParsedTabularFile } from './parser.types';
import { normalizeHeaders, rowToNormalizedObject } from '../utils/header-normalization.util';

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function detectDelimiter(text: string): ',' | ';' {
  const firstLine = text.split(/\r?\n/, 1)[0] ?? '';
  const commas = (firstLine.match(/,/g) ?? []).length;
  const semis = (firstLine.match(/;/g) ?? []).length;
  return semis > commas ? ';' : ',';
}

export function parseCsvBuffer(buffer: Buffer): ParsedTabularFile {
  const text = stripBom(buffer.toString('utf8')).trim();
  if (!text) {
    return { sheetNames: ['CSV'], rows: [] };
  }

  const delimiter = detectDelimiter(text);
  const records = parse(text, {
    delimiter,
    columns: false,
    skip_empty_lines: true,
    relax_quotes: true,
    trim: true,
  }) as string[][];

  if (records.length === 0) {
    return { sheetNames: ['CSV'], rows: [] };
  }

  const headerRow = records[0] ?? [];
  const { headers } = normalizeHeaders(headerRow.map(String));
  const rows = records.slice(1).flatMap((values, index) => {
    const hasContent = values.some((cell) => String(cell ?? '').trim().length > 0);
    if (!hasContent) return [];
    return [
      {
        sourceSheet: 'CSV',
        sourceRowNumber: index + 2,
        headers: headerRow.map(String),
        rawData: rowToNormalizedObject(headers, values.map(String)),
      },
    ];
  });

  return { sheetNames: ['CSV'], rows };
}
