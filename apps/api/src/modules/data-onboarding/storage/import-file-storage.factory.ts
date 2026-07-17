import path from 'path';

import type { ImportFileStorage } from './import-file-storage.interface';
import { LocalImportFileStorage } from './local-import-file.storage';

export function createImportFileStorage(): ImportFileStorage {
  const provider = (process.env.IMPORT_STORAGE_PROVIDER ?? 'local').toLowerCase();
  if (provider !== 'local') {
    throw new Error(
      `Import storage provider "${provider}" is not implemented. Use IMPORT_STORAGE_PROVIDER=local for development.`,
    );
  }
  const basePath = path.resolve(
    process.env.IMPORT_STORAGE_LOCAL_PATH ?? path.join(process.cwd(), 'storage', 'imports'),
  );
  return new LocalImportFileStorage(basePath);
}
