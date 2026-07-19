import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  IMPORT_FILE_ACCEPT,
  IMPORT_FILE_HELPER_TEXT,
  classifyImportFile,
  getImportWorkflow,
  isAcceptedImportFile,
  isPdfImportSession,
} from './import-file-validation';

describe('IMPORT_FILE_ACCEPT', () => {
  it('includes PDF so the file picker can select PDFs', () => {
    assert.equal(
      IMPORT_FILE_ACCEPT,
      '.csv,.xlsx,.pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/pdf',
    );
    assert.ok(IMPORT_FILE_ACCEPT.includes('.pdf'));
    assert.ok(IMPORT_FILE_ACCEPT.includes('application/pdf'));
  });

  it('still includes CSV and XLSX', () => {
    assert.ok(IMPORT_FILE_ACCEPT.includes('.csv'));
    assert.ok(IMPORT_FILE_ACCEPT.includes('.xlsx'));
    assert.ok(IMPORT_FILE_ACCEPT.includes('text/csv'));
    assert.ok(
      IMPORT_FILE_ACCEPT.includes(
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      ),
    );
  });
});

describe('IMPORT_FILE_HELPER_TEXT', () => {
  it('mentions PDF, XLSX, CSV and spreadsheet row limit', () => {
    assert.equal(
      IMPORT_FILE_HELPER_TEXT,
      'PDF, XLSX, CSV · máx. 25 MB · 5,000 filas para hojas de cálculo',
    );
  });
});

describe('isAcceptedImportFile / classifyImportFile', () => {
  it('accepts PDF by extension and MIME', () => {
    assert.equal(classifyImportFile({ name: 'factura.pdf', type: 'application/pdf' }), 'PDF');
    assert.equal(classifyImportFile({ name: 'factura.pdf', type: '' }), 'PDF');
    assert.equal(classifyImportFile({ name: 'factura', type: 'application/pdf' }), 'PDF');
    assert.equal(isAcceptedImportFile({ name: 'factura.pdf', type: 'application/pdf' }), true);
  });

  it('accepts CSV by extension and MIME', () => {
    assert.equal(classifyImportFile({ name: 'inv.csv', type: 'text/csv' }), 'CSV');
    assert.equal(classifyImportFile({ name: 'inv.csv', type: '' }), 'CSV');
    assert.equal(classifyImportFile({ name: 'inv', type: 'text/csv' }), 'CSV');
    assert.equal(isAcceptedImportFile({ name: 'inv.csv', type: 'text/csv' }), true);
  });

  it('accepts XLSX by extension and MIME', () => {
    assert.equal(
      classifyImportFile({
        name: 'inv.xlsx',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'XLSX',
    );
    assert.equal(classifyImportFile({ name: 'inv.xlsx', type: '' }), 'XLSX');
    assert.equal(
      classifyImportFile({
        name: 'inv',
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      }),
      'XLSX',
    );
    assert.equal(isAcceptedImportFile({ name: 'inv.xlsx', type: '' }), true);
  });

  it('rejects unsupported formats', () => {
    assert.equal(classifyImportFile({ name: 'notes.txt', type: 'text/plain' }), null);
    assert.equal(classifyImportFile({ name: 'doc.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }), null);
    assert.equal(classifyImportFile({ name: 'photo.png', type: 'image/png' }), null);
    assert.equal(classifyImportFile({ name: 'legacy.xls', type: 'application/vnd.ms-excel' }), null);
    assert.equal(isAcceptedImportFile({ name: 'notes.txt', type: 'text/plain' }), false);
  });
});

describe('getImportWorkflow', () => {
  it('routes PDF to Sprint 3 extraction', () => {
    assert.equal(getImportWorkflow('PDF'), 'pdf-extraction');
  });

  it('routes CSV/XLSX to Sprint 2 spreadsheet mapping', () => {
    assert.equal(getImportWorkflow('CSV'), 'spreadsheet-mapping');
    assert.equal(getImportWorkflow('XLSX'), 'spreadsheet-mapping');
  });
});

describe('isPdfImportSession', () => {
  it('detects PDF sessions for extract/review UI', () => {
    assert.equal(isPdfImportSession([{ fileType: 'PDF' }]), true);
    assert.equal(isPdfImportSession([{ fileType: 'CSV' }]), false);
    assert.equal(isPdfImportSession([{ fileType: 'XLSX' }]), false);
    assert.equal(isPdfImportSession([]), false);
  });
});
