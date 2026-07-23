import { createHash } from 'crypto';
import { Readable } from 'stream';

import type { ImportFileSaveInput, ImportFileStorage } from './import-file-storage.interface';

/**
 * Encode a Cloudinary public_id for use in Admin API path segments.
 * Keeps `/` as path separators (Cloudinary expects the full folder path);
 * encodes each segment so special characters remain safe.
 */
export function encodeCloudinaryPublicIdPath(publicId: string): string {
  return publicId
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

/**
 * Cloudinary-backed import storage for production (Railway ephemeral FS).
 * Stores raw authenticated resources; reads via authenticated Admin API download.
 * Storage key format: `cloudinary:<public_id>` (never a public URL).
 */
export class CloudinaryImportFileStorage implements ImportFileStorage {
  constructor(
    private readonly cloudName: string,
    private readonly apiKey: string,
    private readonly apiSecret: string,
    private readonly folder: string,
  ) {}

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.apiKey}:${this.apiSecret}`).toString('base64')}`;
  }

  private toStorageKey(publicId: string): string {
    return `cloudinary:${publicId}`;
  }

  private fromStorageKey(storageKey: string): string {
    if (!storageKey.startsWith('cloudinary:')) {
      throw new Error('Invalid Cloudinary storage key');
    }
    const publicId = storageKey.slice('cloudinary:'.length);
    if (!publicId || publicId.includes('..')) {
      throw new Error('Invalid Cloudinary public id');
    }
    return publicId;
  }

  async save(input: ImportFileSaveInput): Promise<{ storageKey: string }> {
    const ext = (input.filename.split('.').pop() ?? 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
    const folder = `${this.folder}/${input.tenantId}/${input.sessionId}`;
    const shortId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = `folder=${folder}&public_id=${shortId}&timestamp=${timestamp}&type=authenticated${this.apiSecret}`;
    const signature = createHash('sha1').update(toSign).digest('hex');

    const form = new FormData();
    form.append('api_key', this.apiKey);
    form.append('timestamp', String(timestamp));
    form.append('folder', folder);
    form.append('public_id', shortId);
    form.append('type', 'authenticated');
    form.append('signature', signature);
    form.append('file', new Blob([input.buffer]), `file.${ext}`);

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${this.cloudName}/raw/upload`,
      { method: 'POST', body: form },
    );
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Cloudinary import upload failed (${res.status}): ${text.slice(0, 200)}`);
    }
    const json = (await res.json()) as { public_id: string };
    return { storageKey: this.toStorageKey(json.public_id) };
  }

  async read(storageKey: string): Promise<Buffer> {
    const publicId = this.fromStorageKey(storageKey);
    // Authenticated raw download via Admin API (type=authenticated, not upload).
    const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/raw/authenticated/${encodeCloudinaryPublicIdPath(publicId)}`;
    const metaRes = await fetch(url, { headers: { Authorization: this.authHeader() } });
    if (!metaRes.ok) {
      throw new Error(`Cloudinary import read metadata failed (${metaRes.status})`);
    }
    const meta = (await metaRes.json()) as { secure_url?: string; url?: string };
    const downloadUrl = meta.secure_url ?? meta.url;
    if (!downloadUrl) {
      throw new Error('Cloudinary import resource missing download URL');
    }
    // Signed delivery URL from metadata — fetch once, fail closed (no unsigned retry).
    const fileRes = await fetch(downloadUrl);
    if (!fileRes.ok) {
      throw new Error(`Cloudinary import download failed (${fileRes.status})`);
    }
    return Buffer.from(await fileRes.arrayBuffer());
  }

  readStream(storageKey: string): NodeJS.ReadableStream {
    // Lazy stream via buffered read (PDFs are bounded by import size limits).
    const readable = new Readable({
      read() {},
    });
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
    const publicId = this.fromStorageKey(storageKey);
    const timestamp = Math.floor(Date.now() / 1000);
    const toSign = `public_id=${publicId}&timestamp=${timestamp}&type=authenticated${this.apiSecret}`;
    const signature = createHash('sha1').update(toSign).digest('hex');
    const body = new URLSearchParams({
      public_id: publicId,
      timestamp: String(timestamp),
      api_key: this.apiKey,
      signature,
      type: 'authenticated',
    });
    await fetch(`https://api.cloudinary.com/v1_1/${this.cloudName}/raw/destroy`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
  }

  async deleteSessionFiles(tenantId: string, sessionId: string): Promise<void> {
    const prefix = `${this.folder}/${tenantId}/${sessionId}`;
    const url = `https://api.cloudinary.com/v1_1/${this.cloudName}/resources/raw/authenticated?prefix=${encodeURIComponent(prefix)}&max_results=100`;
    const res = await fetch(url, { headers: { Authorization: this.authHeader() } });
    if (!res.ok) return;
    const json = (await res.json()) as { resources?: Array<{ public_id: string }> };
    for (const r of json.resources ?? []) {
      await this.delete(this.toStorageKey(r.public_id));
    }
  }
}
