/**
 * Client-side import file accept / validation for Inventory Import.
 * Keeps CSV/XLSX (Sprint 2) and PDF (Sprint 3) on separate post-upload workflows.
 */

export const IMPORT_FILE_ACCEPT =
  '.csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf';

export const IMPORT_FILE_HELPER_TEXT =
  'PDF, XLSX, CSV · máx. 25 MB · 5,000 filas para hojas de cálculo';

export const IMPORT_FILE_REJECT_MESSAGE =
  'Tipo de archivo no soportado. Use PDF, XLSX o CSV.';

export type ImportFileKind = 'PDF' | 'CSV' | 'XLSX';

export type ImportWorkflow = 'pdf-extraction' | 'spreadsheet-mapping';

const PDF_MIME = 'application/pdf';
const CSV_MIME = 'text/csv';
const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

function extensionOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  return i >= 0 ? filename.slice(i).toLowerCase() : '';
}

/**
 * Classify an uploaded File (or file-like) by extension and MIME.
 * Extension wins when present; MIME is used when the name has no known extension.
 */
export function classifyImportFile(file: { name: string; type?: string }): ImportFileKind | null {
  const ext = extensionOf(file.name);
  const mime = (file.type ?? '').toLowerCase().trim();

  if (ext === '.pdf') return 'PDF';
  if (ext === '.csv') return 'CSV';
  if (ext === '.xlsx') return 'XLSX';

  if (mime === PDF_MIME) return 'PDF';
  if (mime === CSV_MIME) return 'CSV';
  if (mime === XLSX_MIME) return 'XLSX';

  return null;
}

export function isAcceptedImportFile(file: { name: string; type?: string }): boolean {
  return classifyImportFile(file) !== null;
}

/** Post-upload UI workflow: PDFs never enter spreadsheet parse/header detection. */
export function getImportWorkflow(kind: ImportFileKind): ImportWorkflow {
  return kind === 'PDF' ? 'pdf-extraction' : 'spreadsheet-mapping';
}

/** True when the session already has a PDF file (Sprint 3 path). */
export function isPdfImportSession(files: Array<{ fileType: string }>): boolean {
  return files.some((f) => f.fileType === 'PDF');
}
