import path from 'path';

import type { ImportFileStorage } from './import-file-storage.interface';
import { CloudinaryImportFileStorage } from './cloudinary-import-file.storage';
import { LocalImportFileStorage } from './local-import-file.storage';

function createLocalImportFileStorage(): ImportFileStorage {
  const basePath = path.resolve(
    process.env.IMPORT_STORAGE_LOCAL_PATH ?? path.join(process.cwd(), 'storage', 'imports'),
  );
  return new LocalImportFileStorage(basePath);
}

/**
 * Storage provider selection:
 * - Production: Cloudinary required (credentials mandatory) unless
 *   IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true.
 * - Development/test: local by default; Cloudinary when
 *   IMPORT_STORAGE_PROVIDER=cloudinary or when credentials are present (auto).
 */
export function createImportFileStorage(): ImportFileStorage {
  const explicit = (process.env.IMPORT_STORAGE_PROVIDER ?? '').toLowerCase().trim();
  const isProduction = process.env.NODE_ENV === 'production';
  const allowLocalInProduction =
    (process.env.IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION ?? '').toLowerCase() === 'true';
  const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
  const apiKey = process.env.CLOUDINARY_API_KEY;
  const apiSecret = process.env.CLOUDINARY_API_SECRET;
  const folder =
    process.env.CLOUDINARY_IMPORT_FOLDER ??
    `${process.env.CLOUDINARY_UPLOAD_FOLDER ?? 'wristos'}/imports`;
  const hasCloudinaryCreds = Boolean(cloudName && apiKey && apiSecret);

  if (explicit && explicit !== 'local' && explicit !== 'cloudinary') {
    throw new Error(
      `Import storage provider "${explicit}" is not implemented. Use local or cloudinary.`,
    );
  }

  if (isProduction) {
    if (explicit === 'local') {
      if (!allowLocalInProduction) {
        throw new Error(
          'IMPORT_STORAGE_PROVIDER=local is not allowed in production unless IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true.',
        );
      }
      return createLocalImportFileStorage();
    }

    // Production always requires Cloudinary — never silently fall back to local.
    if (!hasCloudinaryCreds) {
      throw new Error(
        'Production requires Cloudinary import storage. Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET (or set IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true for emergency local disk only).',
      );
    }
    return new CloudinaryImportFileStorage(cloudName!, apiKey!, apiSecret!, folder);
  }

  // development / test
  const useCloudinary = explicit === 'cloudinary' || (explicit === '' && hasCloudinaryCreds);
  if (useCloudinary) {
    if (!hasCloudinaryCreds) {
      throw new Error(
        'IMPORT_STORAGE_PROVIDER=cloudinary requires CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET.',
      );
    }
    return new CloudinaryImportFileStorage(cloudName!, apiKey!, apiSecret!, folder);
  }

  return createLocalImportFileStorage();
}
