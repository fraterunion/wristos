import { createHash, randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import path from 'path';

import type { ImportFileSaveInput, ImportFileStorage } from './import-file-storage.interface';

function assertSafeSegment(value: string, label: string): string {
  if (!value || value.includes('..') || value.includes('/') || value.includes('\\')) {
    throw new Error(`Invalid ${label} for storage path`);
  }
  return value;
}

export class LocalImportFileStorage implements ImportFileStorage {
  constructor(private readonly basePath: string) {}

  private resolveAbsolute(storageKey: string): string {
    const absolute = path.resolve(this.basePath, storageKey);
    const base = path.resolve(this.basePath);
    if (!absolute.startsWith(base + path.sep) && absolute !== base) {
      throw new Error('Invalid storage key');
    }
    return absolute;
  }

  async save(input: ImportFileSaveInput): Promise<{ storageKey: string }> {
    const tenantId = assertSafeSegment(input.tenantId, 'tenantId');
    const sessionId = assertSafeSegment(input.sessionId, 'sessionId');
    const ext = path.extname(input.filename).toLowerCase().replace(/[^a-z0-9.]/g, '');
    const safeExt = ext.length > 0 && ext.length <= 10 ? ext : '.bin';
    const storageKey = path.join(tenantId, sessionId, `${randomUUID()}${safeExt}`);
    const absolute = this.resolveAbsolute(storageKey);
    await mkdir(path.dirname(absolute), { recursive: true });
    await writeFile(absolute, input.buffer);
    return { storageKey: storageKey.replace(/\\/g, '/') };
  }

  async read(storageKey: string): Promise<Buffer> {
    return readFile(this.resolveAbsolute(storageKey));
  }

  async delete(storageKey: string): Promise<void> {
    await rm(this.resolveAbsolute(storageKey), { force: true });
  }

  async deleteSessionFiles(tenantId: string, sessionId: string): Promise<void> {
    const dir = this.resolveAbsolute(path.join(assertSafeSegment(tenantId, 'tenantId'), assertSafeSegment(sessionId, 'sessionId')));
    await rm(dir, { recursive: true, force: true });
  }
}

export function sha256Checksum(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}
