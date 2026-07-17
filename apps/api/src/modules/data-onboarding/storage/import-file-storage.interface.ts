export interface ImportFileSaveInput {
  tenantId: string;
  sessionId: string;
  filename: string;
  buffer: Buffer;
}

export interface ImportFileStorage {
  save(input: ImportFileSaveInput): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<Buffer>;
  delete(storageKey: string): Promise<void>;
  deleteSessionFiles(tenantId: string, sessionId: string): Promise<void>;
}
