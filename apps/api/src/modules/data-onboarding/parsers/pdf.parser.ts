import type { PdfParseResult } from './parser.types';

export const PDF_PHASE1_MESSAGE =
  'PDF intelligent extraction will be processed in the next onboarding phase.';

export function parsePdfBuffer(_buffer: Buffer): PdfParseResult {
  return {
    supported: false,
    message: PDF_PHASE1_MESSAGE,
  };
}
