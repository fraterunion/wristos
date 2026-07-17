import ExcelJS from 'exceljs';

import type { ParsedTabularFile } from './parser.types';
import { normalizeHeaders, rowToNormalizedObject } from '../utils/header-normalization.util';

function cellToString(value: ExcelJS.CellValue): string {
  if (value == null) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') {
    if ('text' in value && typeof value.text === 'string') return value.text;
    if ('result' in value && value.result != null) return String(value.result);
    if ('richText' in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text ?? '').join('');
    }
    return JSON.stringify(value);
  }
  return String(value);
}

export async function parseXlsxBuffer(buffer: Buffer): Promise<ParsedTabularFile> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const sheetNames: string[] = [];
  const rows: ParsedTabularFile['rows'] = [];

  workbook.eachSheet((worksheet) => {
    if (worksheet.state === 'hidden' || worksheet.state === 'veryHidden') return;
    if (worksheet.rowCount === 0) return;
    sheetNames.push(worksheet.name);

    const headerRow = worksheet.getRow(1);
    const headerValues = headerRow.values as ExcelJS.CellValue[];
    const headersRaw = headerValues.slice(1).map((cell) => cellToString(cell).trim());
    if (headersRaw.every((h) => !h)) return;

    const { headers } = normalizeHeaders(headersRaw);

    worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const values = row.values as ExcelJS.CellValue[];
      const stringValues = values.slice(1).map((cell) => cellToString(cell).trim());
      const hasContent = stringValues.some((cell) => cell.length > 0);
      if (!hasContent) return;

      rows.push({
        sourceSheet: worksheet.name,
        sourceRowNumber: rowNumber,
        headers: headersRaw,
        rawData: rowToNormalizedObject(headers, stringValues),
      });
    });
  });

  return { sheetNames, rows };
}
