import { Logger } from '@nestjs/common';
import { v2 as cloudinary, type UploadApiResponse } from 'cloudinary';
import { Readable } from 'stream';

import type { ImportFileSaveInput, ImportFileStorage } from './import-file-storage.interface';
import {
  IMPORT_STORAGE_READ_SAFE_MESSAGE,
  ImportStorageError,
} from './import-storage.errors';

/** Default TTL for private download URLs (server-side fetch only). */
const PRIVATE_DOWNLOAD_TTL_SECONDS = 120;

export type CloudinaryClient = {
  config: (options: Record<string, unknown>) => unknown;
  utils: {
    private_download_url: (
      publicId: string,
      format: string,
      options?: Record<string, unknown>,
    ) => string;
  };
  uploader: {
    upload: (
      file: string,
      options?: Record<string, unknown>,
    ) => Promise<UploadApiResponse>;
    destroy: (
      publicId: string,
      options?: Record<string, unknown>,
    ) => Promise<{ result?: string }>;
  };
  api: {
    resources: (options?: Record<string, unknown>) => Promise<{
      resources?: Array<{ public_id: string }>;
    }>;
  };
};

/**
 * Parse `cloudinary:<public_id>` keys written by production uploads.
 * Supports foldered ids and ids that already include a file extension
 * (Cloudinary raw uploads commonly append `.pdf` to public_id).
 */
export function parseCloudinaryStorageKey(storageKey: string): { publicId: string } {
  if (typeof storageKey !== 'string' || !storageKey.startsWith('cloudinary:')) {
    throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
      debugInfo: { reason: 'invalid_storage_key_prefix' },
    });
  }
  const publicId = storageKey.slice('cloudinary:'.length).trim();
  if (!publicId) {
    throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
      debugInfo: { reason: 'empty_public_id' },
    });
  }
  if (publicId.includes('..') || publicId.includes('\0') || publicId.includes('://')) {
    throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
      debugInfo: { reason: 'malformed_public_id' },
    });
  }
  // Reject absolute-looking / leading-slash abuse; Cloudinary public_ids are relative paths.
  if (publicId.startsWith('/') || publicId.startsWith('\\')) {
    throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
      debugInfo: { reason: 'absolute_public_id' },
    });
  }
  return { publicId };
}

export function toCloudinaryStorageKey(publicId: string): string {
  return `cloudinary:${publicId}`;
}

/**
 * Derive the format argument for private_download_url without duplicating
 * an extension already present on public_id in the delivery path.
 * When public_id already ends with `.<ext>`, pass that ext as `format`
 * (Cloudinary download API expects format separately; public_id stays intact).
 */
export function formatForPrivateDownload(publicId: string): string {
  const base = publicId.split('/').pop() ?? publicId;
  const dot = base.lastIndexOf('.');
  if (dot <= 0 || dot === base.length - 1) return '';
  const ext = base.slice(dot + 1).toLowerCase();
  if (!/^[a-z0-9]{1,10}$/.test(ext)) return '';
  return ext;
}

function safePublicIdMeta(publicId: string): Record<string, unknown> {
  const base = publicId.split('/').pop() ?? publicId;
  const ext = formatForPrivateDownload(publicId);
  return {
    publicIdSegmentCount: publicId.split('/').filter(Boolean).length,
    publicIdLength: publicId.length,
    hasExtension: Boolean(ext),
    extension: ext || null,
    leafLength: base.length,
  };
}

function redactDownloadUrl(url: string): Record<string, unknown> {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.host,
      pathname: parsed.pathname,
      queryParamNames: [...parsed.searchParams.keys()].sort(),
    };
  } catch {
    return { host: null, pathname: null, queryParamNames: [] };
  }
}

/**
 * Cloudinary-backed import storage for production (Railway ephemeral FS).
 *
 * Contract:
 * - Upload: resource_type=raw, type=authenticated
 * - Read: server-side private_download_url only (no unsigned secure_url fallback)
 * - Storage key: `cloudinary:<public_id>` (never a delivery URL)
 */
export class CloudinaryImportFileStorage implements ImportFileStorage {
  private readonly logger = new Logger(CloudinaryImportFileStorage.name);
  private readonly client: CloudinaryClient;

  constructor(
    private readonly cloudName: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly folder: string,
    client: CloudinaryClient = cloudinary as unknown as CloudinaryClient,
  ) {
    this.client = client;
    this.client.config({
      cloud_name: cloudName,
      api_key: apiKey,
      api_secret: apiSecret,
      secure: true,
    });
  }

  async save(input: ImportFileSaveInput): Promise<{ storageKey: string }> {
    const ext = (input.filename.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const folder = `${this.folder}/${input.tenantId}/${input.sessionId}`;
    // Keep short id WITHOUT extension — Cloudinary raw upload appends format when provided.
    const shortId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const dataUri = `data:application/octet-stream;base64,${input.buffer.toString('base64')}`;

    let result: UploadApiResponse;
    try {
      result = await this.client.uploader.upload(dataUri, {
        resource_type: 'raw',
        type: 'authenticated',
        folder,
        public_id: shortId,
        format: ext,
      });
    } catch (err) {
      const httpStatus = extractHttpStatus(err);
      this.logger.error(
        `Cloudinary import upload failed: ${JSON.stringify({
          httpStatus,
          folderSegmentCount: folder.split('/').length,
          format: ext,
        })}`,
      );
      throw new ImportStorageError(
        'No fue posible almacenar el archivo. Intenta subirlo nuevamente.',
        { httpStatus, cause: err, debugInfo: { operation: 'upload', format: ext } },
      );
    }

    if (!result?.public_id) {
      throw new ImportStorageError(
        'No fue posible almacenar el archivo. Intenta subirlo nuevamente.',
        { debugInfo: { operation: 'upload', reason: 'missing_public_id' } },
      );
    }

    // Avoid double-extension in storage key if SDK already included format on public_id.
    const publicId = result.public_id;
    this.logger.log(
      `Cloudinary import uploaded: ${JSON.stringify({
        ...safePublicIdMeta(publicId),
        resourceType: result.resource_type ?? 'raw',
        type: result.type ?? 'authenticated',
        bytes: result.bytes ?? null,
      })}`,
    );

    return { storageKey: toCloudinaryStorageKey(publicId) };
  }

  async read(storageKey: string): Promise<Buffer> {
    const { publicId } = parseCloudinaryStorageKey(storageKey);
    const format = formatForPrivateDownload(publicId);
    const expiresAt = Math.floor(Date.now() / 1000) + PRIVATE_DOWNLOAD_TTL_SECONDS;

    let downloadUrl: string;
    try {
      downloadUrl = this.client.utils.private_download_url(publicId, format, {
        resource_type: 'raw',
        type: 'authenticated',
        expires_at: expiresAt,
        attachment: false,
      });
    } catch (err) {
      this.logger.error(
        `Cloudinary private_download_url generation failed: ${JSON.stringify({
          ...safePublicIdMeta(publicId),
          resourceType: 'raw',
          type: 'authenticated',
        })}`,
      );
      throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
        cause: err,
        debugInfo: { operation: 'private_download_url', ...safePublicIdMeta(publicId) },
      });
    }

    this.logger.debug(
      `Cloudinary import download starting: ${JSON.stringify({
        ...safePublicIdMeta(publicId),
        ...redactDownloadUrl(downloadUrl),
        strategy: 'private_download_url',
        resourceType: 'raw',
        type: 'authenticated',
      })}`,
    );

    let fileRes: Response;
    try {
      fileRes = await fetch(downloadUrl);
    } catch (err) {
      this.logger.error(
        `Cloudinary import download network failure: ${JSON.stringify({
          ...safePublicIdMeta(publicId),
          strategy: 'private_download_url',
        })}`,
      );
      throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
        cause: err,
        debugInfo: { operation: 'download_fetch', ...safePublicIdMeta(publicId) },
      });
    }

    if (!fileRes.ok) {
      this.logger.error(
        `Cloudinary import download failed: ${JSON.stringify({
          httpStatus: fileRes.status,
          ...safePublicIdMeta(publicId),
          strategy: 'private_download_url',
          resourceType: 'raw',
          type: 'authenticated',
        })}`,
      );
      throw new ImportStorageError(IMPORT_STORAGE_READ_SAFE_MESSAGE, {
        httpStatus: fileRes.status,
        debugInfo: {
          operation: 'download',
          httpStatus: fileRes.status,
          ...safePublicIdMeta(publicId),
        },
      });
    }

    return Buffer.from(await fileRes.arrayBuffer());
  }

  readStream(storageKey: string): NodeJS.ReadableStream {
    const readable = new Readable({ read() {} });
    void this.read(storageKey)
      .then((buf) => {
        readable.push(buf);
        readable.push(null);
      })
      .catch((err: unknown) => {
        readable.destroy(err instanceof Error ? err : new Error(String(err)));
      });
    return readable;
  }

  async delete(storageKey: string): Promise<void> {
    const { publicId } = parseCloudinaryStorageKey(storageKey);
    let result: { result?: string };
    try {
      result = await this.client.uploader.destroy(publicId, {
        resource_type: 'raw',
        type: 'authenticated',
        invalidate: true,
      });
    } catch (err) {
      this.logger.error(
        `Cloudinary import delete failed: ${JSON.stringify({
          ...safePublicIdMeta(publicId),
          resourceType: 'raw',
          type: 'authenticated',
        })}`,
      );
      throw new ImportStorageError(
        'No fue posible eliminar el archivo almacenado.',
        {
          cause: err,
          httpStatus: extractHttpStatus(err),
          debugInfo: { operation: 'destroy', ...safePublicIdMeta(publicId) },
        },
      );
    }

    const destroyResult = result?.result;
    // Explicit idempotency: already-missing assets are accepted.
    if (destroyResult === 'ok' || destroyResult === 'not found') {
      this.logger.log(
        `Cloudinary import delete result: ${JSON.stringify({
          result: destroyResult,
          ...safePublicIdMeta(publicId),
        })}`,
      );
      return;
    }

    this.logger.error(
      `Cloudinary import delete unexpected result: ${JSON.stringify({
        result: destroyResult ?? null,
        ...safePublicIdMeta(publicId),
      })}`,
    );
    throw new ImportStorageError(
      'No fue posible eliminar el archivo almacenado.',
      {
        debugInfo: {
          operation: 'destroy',
          result: destroyResult ?? null,
          ...safePublicIdMeta(publicId),
        },
      },
    );
  }

  async deleteSessionFiles(tenantId: string, sessionId: string): Promise<void> {
    const prefix = `${this.folder}/${tenantId}/${sessionId}`;
    let listed: { resources?: Array<{ public_id: string }> };
    try {
      listed = await this.client.api.resources({
        resource_type: 'raw',
        type: 'authenticated',
        prefix,
        max_results: 100,
      });
    } catch (err) {
      this.logger.error(
        `Cloudinary import list-for-delete failed: ${JSON.stringify({
          prefixSegmentCount: prefix.split('/').length,
          resourceType: 'raw',
          type: 'authenticated',
        })}`,
      );
      throw new ImportStorageError(
        'No fue posible eliminar los archivos de la sesión.',
        {
          cause: err,
          httpStatus: extractHttpStatus(err),
          debugInfo: { operation: 'list', prefixSegmentCount: prefix.split('/').length },
        },
      );
    }

    for (const r of listed.resources ?? []) {
      await this.delete(toCloudinaryStorageKey(r.public_id));
    }
  }
}

function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const withHttp = err as { http_code?: unknown; statusCode?: unknown; status?: unknown };
  for (const candidate of [withHttp.http_code, withHttp.statusCode, withHttp.status]) {
    if (typeof candidate === 'number') return candidate;
  }
  return undefined;
}
