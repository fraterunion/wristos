export interface ImportFileSaveInput {
  tenantId: string;
  sessionId: string;
  filename: string;
  buffer: Buffer;
}

export interface ImportFileStorage {
  save(input: ImportFileSaveInput): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  /** Returns a readable stream for the stored file. Prefer this over read() for HTTP responses. */
  readStream(storageKey: string): NodeJS.ReadableStream;
  delete(storageKey: string): Promise<void>;
  deleteSessionFiles(tenantId: string, sessionId: string): Promise<void>;
}
