import { BadRequestException } from '@nestjs/common';

import {
  detectFileType,
  maxImportFileSizeBytes,
  validateImportUpload,
} from '../utils/file-validation.util';

describe('file validation', () => {
  it('detects allowed file types by extension', () => {
    expect(detectFileType('inventory.csv')).toBe('CSV');
    expect(detectFileType('clients.xlsx')).toBe('XLSX');
    expect(detectFileType('notes.pdf')).toBe('PDF');
    expect(detectFileType('data.json')).toBe('JSON');
    expect(detectFileType('archive.zip')).toBeNull();
  });

  it('rejects empty files', () => {
    expect(() => validateImportUpload('data.csv', 'text/csv', 0)).toThrow(BadRequestException);
  });

  it('rejects unsupported extensions', () => {
    expect(() => validateImportUpload('run.exe', 'application/octet-stream', 100)).toThrow(
      BadRequestException,
    );
  });

  it('rejects PDF MIME mismatch', () => {
    expect(() => validateImportUpload('doc.pdf', 'text/plain', 100)).toThrow(BadRequestException);
  });

  it('rejects oversized files', () => {
    const tooBig = maxImportFileSizeBytes() + 1;
    expect(() => validateImportUpload('data.csv', 'text/csv', tooBig)).toThrow(BadRequestException);
  });
});
