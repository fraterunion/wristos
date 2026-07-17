import { PDF_PHASE1_MESSAGE, parsePdfBuffer } from '../parsers/pdf.parser';

describe('pdf parser phase 1', () => {
  it('marks PDF extraction as unsupported with clear message', () => {
    const result = parsePdfBuffer(Buffer.from('%PDF-1.4', 'utf8'));
    expect(result.supported).toBe(false);
    expect(result.message).toBe(PDF_PHASE1_MESSAGE);
  });
});
