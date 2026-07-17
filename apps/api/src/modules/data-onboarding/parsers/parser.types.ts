export type ParsedTabularRow = {
  sourceSheet?: string;
  sourceRowNumber: number;
  rawData: Record<string, unknown>;
  headers: string[];
};

export type ParsedTabularFile = {
  sheetNames: string[];
  rows: ParsedTabularRow[];
};

export type ParsedJsonFile = {
  rows: ParsedTabularRow[];
  structure: 'array' | 'object_with_arrays' | 'single_object';
};

export type PdfParseResult = {
  supported: false;
  message: string;
};
