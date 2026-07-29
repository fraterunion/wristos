import ExcelJS from 'exceljs';

import {
  maxFileBytes,
  maxRowsPerSheet,
  RECOGNIZED_SHEETS,
  REQUIRED_CORE_SHEETS,
  XLSX_ZIP_SIGNATURE,
} from '../constants';
import { fingerprintBuffer } from './cell.util';

export type WorkbookIdentityIssue = {
  code: string;
  message: string;
  severity: 'CRITICAL' | 'WARNING';
};

export type LoadedWorkbook = {
  workbook: ExcelJS.Workbook;
  fingerprint: string;
  fingerprintPrefix: string;
  fileName: string;
  fileSizeBytes: number;
  sheetNames: string[];
  unknownSheets: string[];
  missingCoreSheets: string[];
  issues: WorkbookIdentityIssue[];
  blocked: boolean;
};

function looksLikeMacroEnabled(fileName: string, buffer: Buffer): boolean {
  const lower = fileName.toLowerCase();
  if (lower.endsWith('.xlsm') || lower.endsWith('.xltm') || lower.endsWith('.xls')) return true;
  // OLE compound file signature (old xls / some macro containers)
  if (buffer.length >= 8 && buffer[0] === 0xd0 && buffer[1] === 0xcf && buffer[2] === 0x11) return true;
  return false;
}

function hasPathTraversal(fileName: string): boolean {
  return fileName.includes('..') || fileName.includes('/') || fileName.includes('\\') || fileName.includes('\0');
}

export async function loadAndValidateWorkbook(
  buffer: Buffer,
  fileName: string,
): Promise<LoadedWorkbook> {
  const issues: WorkbookIdentityIssue[] = [];
  const fileSizeBytes = buffer.length;
  const maxBytes = maxFileBytes();

  if (hasPathTraversal(fileName)) {
    issues.push({
      code: 'PATH_TRAVERSAL',
      message: 'Nombre de archivo inválido',
      severity: 'CRITICAL',
    });
  }

  if (!fileName.toLowerCase().endsWith('.xlsx')) {
    issues.push({
      code: 'INVALID_EXTENSION',
      message: 'Solo se aceptan archivos .xlsx',
      severity: 'CRITICAL',
    });
  }

  if (fileSizeBytes === 0) {
    issues.push({ code: 'EMPTY_FILE', message: 'Archivo vacío', severity: 'CRITICAL' });
  }

  if (fileSizeBytes > maxBytes) {
    issues.push({
      code: 'FILE_TOO_LARGE',
      message: `Archivo excede el máximo de ${Math.floor(maxBytes / (1024 * 1024))} MB`,
      severity: 'CRITICAL',
    });
  }

  if (
    buffer.length < 4 ||
    buffer[0] !== XLSX_ZIP_SIGNATURE[0] ||
    buffer[1] !== XLSX_ZIP_SIGNATURE[1] ||
    buffer[2] !== XLSX_ZIP_SIGNATURE[2] ||
    buffer[3] !== XLSX_ZIP_SIGNATURE[3]
  ) {
    issues.push({
      code: 'INVALID_SIGNATURE',
      message: 'Firma ZIP/XLSX inválida',
      severity: 'CRITICAL',
    });
  }

  if (looksLikeMacroEnabled(fileName, buffer)) {
    issues.push({
      code: 'MACRO_ENABLED',
      message: 'No se aceptan libros con macros',
      severity: 'CRITICAL',
    });
  }

  const fingerprint = fingerprintBuffer(buffer);
  const fingerprintPrefix = fingerprint.slice(0, 12);

  if (issues.some((i) => i.severity === 'CRITICAL')) {
    return {
      workbook: new ExcelJS.Workbook(),
      fingerprint,
      fingerprintPrefix,
      fileName,
      fileSizeBytes,
      sheetNames: [],
      unknownSheets: [],
      missingCoreSheets: [...REQUIRED_CORE_SHEETS],
      issues,
      blocked: true,
    };
  }

  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    issues.push({
      code: 'WORKBOOK_UNREADABLE',
      message: 'No se pudo leer el libro Excel',
      severity: 'CRITICAL',
    });
    return {
      workbook,
      fingerprint,
      fingerprintPrefix,
      fileName,
      fileSizeBytes,
      sheetNames: [],
      unknownSheets: [],
      missingCoreSheets: [...REQUIRED_CORE_SHEETS],
      issues,
      blocked: true,
    };
  }

  const sheetNames = workbook.worksheets.map((w) => w.name);
  const recognized = new Set<string>(RECOGNIZED_SHEETS);
  const unknownSheets = sheetNames.filter((n) => !recognized.has(n));
  const missingCoreSheets = REQUIRED_CORE_SHEETS.filter((n) => !sheetNames.includes(n));

  for (const name of unknownSheets) {
    issues.push({
      code: 'UNKNOWN_SHEET',
      message: `Hoja desconocida no parseada: ${name}`,
      severity: 'WARNING',
    });
  }

  for (const name of missingCoreSheets) {
    issues.push({
      code: 'MISSING_CORE_SHEET',
      message: `Falta hoja requerida: ${name}`,
      severity: 'CRITICAL',
    });
  }

  const rowLimit = maxRowsPerSheet();
  for (const ws of workbook.worksheets) {
    if (ws.rowCount > rowLimit) {
      issues.push({
        code: 'TOO_MANY_ROWS',
        message: `Hoja ${ws.name} excede el máximo de filas (${rowLimit})`,
        severity: 'CRITICAL',
      });
    }
  }

  return {
    workbook,
    fingerprint,
    fingerprintPrefix,
    fileName,
    fileSizeBytes,
    sheetNames,
    unknownSheets,
    missingCoreSheets,
    issues,
    blocked: issues.some((i) => i.severity === 'CRITICAL'),
  };
}
