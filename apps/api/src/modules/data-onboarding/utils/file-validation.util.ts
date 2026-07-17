import { BadRequestException } from '@nestjs/common';
import { DataImportFileType } from '@prisma/client';

const ALLOWED_EXTENSIONS = new Set(['.pdf', '.xlsx', '.csv', '.json']);
const BLOCKED_EXTENSIONS = new Set([
  '.exe',
  '.sh',
  '.bat',
  '.cmd',
  '.js',
  '.mjs',
  '.ts',
  '.php',
  '.py',
  '.dll',
  '.so',
  '.zip',
  '.rar',
  '.7z',
]);

const MIME_BY_TYPE: Record<DataImportFileType, string[]> = {
  [DataImportFileType.PDF]: ['application/pdf'],
  [DataImportFileType.XLSX]: [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'application/octet-stream',
  ],
  [DataImportFileType.CSV]: ['text/csv', 'application/csv', 'text/plain', 'application/vnd.ms-excel'],
  [DataImportFileType.JSON]: ['application/json', 'text/json', 'text/plain'],
};

export function maxImportFileSizeBytes(): number {
  const mb = Number(process.env.IMPORT_MAX_FILE_SIZE_MB ?? '25');
  if (!Number.isFinite(mb) || mb <= 0) return 25 * 1024 * 1024;
  return mb * 1024 * 1024;
}

export function extensionOf(filename: string): string {
  const idx = filename.lastIndexOf('.');
  if (idx <= 0) return '';
  return filename.slice(idx).toLowerCase();
}

export function detectFileType(filename: string): DataImportFileType | null {
  const ext = extensionOf(filename);
  switch (ext) {
    case '.pdf':
      return DataImportFileType.PDF;
    case '.xlsx':
      return DataImportFileType.XLSX;
    case '.csv':
      return DataImportFileType.CSV;
    case '.json':
      return DataImportFileType.JSON;
    default:
      return null;
  }
}

export function validateImportUpload(filename: string, mimeType: string, size: number): DataImportFileType {
  const ext = extensionOf(filename);
  if (!ext || BLOCKED_EXTENSIONS.has(ext) || !ALLOWED_EXTENSIONS.has(ext)) {
    throw new BadRequestException('Tipo de archivo no soportado. Use PDF, XLSX, CSV o JSON.');
  }

  const fileType = detectFileType(filename);
  if (!fileType) {
    throw new BadRequestException('Extensión de archivo no reconocida.');
  }

  if (size <= 0) {
    throw new BadRequestException('El archivo está vacío.');
  }

  const maxSize = maxImportFileSizeBytes();
  if (size > maxSize) {
    throw new BadRequestException(
      `El archivo excede el tamaño máximo permitido (${Math.round(maxSize / (1024 * 1024))} MB).`,
    );
  }

  const allowedMimes = MIME_BY_TYPE[fileType];
  if (mimeType && !allowedMimes.includes(mimeType)) {
    // Extension wins; MIME is advisory only for CSV/JSON/plain variants.
    if (fileType === DataImportFileType.PDF && mimeType !== 'application/pdf') {
      throw new BadRequestException('El archivo PDF no tiene un tipo MIME válido.');
    }
  }

  return fileType;
}

export function sniffJson(buffer: Buffer): boolean {
  const start = buffer.toString('utf8', 0, Math.min(buffer.length, 32)).trim();
  return start.startsWith('{') || start.startsWith('[');
}

export function sniffXlsx(buffer: Buffer): boolean {
  return buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}
