import { createHash } from 'crypto';

import {
  CloudinaryImportFileStorage,
  encodeCloudinaryPublicIdPath,
} from './cloudinary-import-file.storage';

describe('encodeCloudinaryPublicIdPath', () => {
  it('keeps slashes as path separators and encodes segments', () => {
    expect(encodeCloudinaryPublicIdPath('folder/tenant/session/file id.pdf')).toBe(
      'folder/tenant/session/file%20id.pdf',
    );
  });
});

describe('CloudinaryImportFileStorage', () => {
  const cloudName = 'demo';
  const apiKey = 'key123';
  const apiSecret = 'secret456';
  const folder = 'wristos/imports';
  let storage: CloudinaryImportFileStorage;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    storage = new CloudinaryImportFileStorage(cloudName, apiKey, apiSecret, folder);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('save', () => {
    it('uploads with type=authenticated on raw/upload endpoint', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: true,
        json: async () => ({ public_id: `${folder}/t1/s1/abc` }),
      });

      const result = await storage.save({
        tenantId: 't1',
        sessionId: 's1',
        filename: 'invoice.pdf',
        buffer: Buffer.from('%PDF-1.4'),
      });

      expect(result.storageKey).toBe(`cloudinary:${folder}/t1/s1/abc`);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.cloudinary.com/v1_1/${cloudName}/raw/upload`);
      expect(init.method).toBe('POST');
      expect(init.body).toBeInstanceOf(FormData);
      const form = init.body as FormData;
      expect(form.get('type')).toBe('authenticated');
      expect(form.get('folder')).toBe(`${folder}/t1/s1`);
      expect(form.get('api_key')).toBe(apiKey);
      expect(form.get('signature')).toEqual(expect.any(String));
    });

    it('throws when upload fails', async () => {
      fetchMock.mockResolvedValueOnce({
        ok: false,
        status: 401,
        text: async () => 'unauthorized',
      });

      await expect(
        storage.save({
          tenantId: 't1',
          sessionId: 's1',
          filename: 'invoice.pdf',
          buffer: Buffer.from('x'),
        }),
      ).rejects.toThrow(/Cloudinary import upload failed \(401\)/);
    });
  });

  describe('read', () => {
    const publicId = `${folder}/t1/s1/file.pdf`;
    const storageKey = `cloudinary:${publicId}`;
    const signedUrl =
      'https://res.cloudinary.com/demo/raw/authenticated/s--signed--/v1/wristos/imports/t1/s1/file.pdf';

    it('fetches metadata via authenticated Admin API path then downloads signed URL once', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ secure_url: signedUrl }),
        })
        .mockResolvedValueOnce({
          ok: true,
          arrayBuffer: async () => Uint8Array.from(Buffer.from('pdf-bytes')).buffer,
        });

      const buf = await storage.read(storageKey);

      expect(buf.toString()).toBe('pdf-bytes');
      expect(fetchMock).toHaveBeenCalledTimes(2);

      const [metaUrl, metaInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(metaUrl).toBe(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/raw/authenticated/${encodeCloudinaryPublicIdPath(publicId)}`,
      );
      expect(metaUrl).toContain('/resources/raw/authenticated/');
      expect(metaUrl).not.toContain('/resources/raw/upload/');
      expect(metaInit.headers).toEqual(
        expect.objectContaining({
          Authorization: expect.stringMatching(/^Basic /),
        }),
      );

      const [downloadUrl, downloadInit] = fetchMock.mock.calls[1] as [string, RequestInit | undefined];
      expect(downloadUrl).toBe(signedUrl);
      expect(downloadInit?.headers?.['Authorization' as never]).toBeUndefined();
    });

    it('fails closed without a second unsigned fetch when download fails', async () => {
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ secure_url: signedUrl }),
        })
        .mockResolvedValueOnce({
          ok: false,
          status: 403,
        });

      await expect(storage.read(storageKey)).rejects.toThrow(
        /Cloudinary import download failed \(403\)/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });

    it('throws when metadata request fails', async () => {
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(storage.read(storageKey)).rejects.toThrow(
        /Cloudinary import read metadata failed \(404\)/,
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('delete', () => {
    it('signs destroy with type=authenticated and posts to raw/destroy', async () => {
      fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: 'ok' }) });

      const publicId = `${folder}/t1/s1/file.pdf`;
      await storage.delete(`cloudinary:${publicId}`);

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`https://api.cloudinary.com/v1_1/${cloudName}/raw/destroy`);
      expect(init.method).toBe('POST');
      expect(init.headers).toEqual(
        expect.objectContaining({ 'Content-Type': 'application/x-www-form-urlencoded' }),
      );

      const body = init.body as URLSearchParams;
      expect(body.get('type')).toBe('authenticated');
      expect(body.get('public_id')).toBe(publicId);
      expect(body.get('api_key')).toBe(apiKey);

      const timestamp = body.get('timestamp')!;
      const expectedSig = createHash('sha1')
        .update(`public_id=${publicId}&timestamp=${timestamp}&type=authenticated${apiSecret}`)
        .digest('hex');
      expect(body.get('signature')).toBe(expectedSig);
    });
  });

  describe('deleteSessionFiles', () => {
    it('lists authenticated resources by prefix then deletes each', async () => {
      const prefix = `${folder}/t1/s1`;
      fetchMock
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({
            resources: [{ public_id: `${prefix}/a.pdf` }, { public_id: `${prefix}/b.pdf` }],
          }),
        })
        .mockResolvedValue({ ok: true, json: async () => ({ result: 'ok' }) });

      await storage.deleteSessionFiles('t1', 's1');

      const [listUrl, listInit] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(listUrl).toBe(
        `https://api.cloudinary.com/v1_1/${cloudName}/resources/raw/authenticated?prefix=${encodeURIComponent(prefix)}&max_results=100`,
      );
      expect(listUrl).not.toContain('/resources/raw/upload');
      expect(listInit.headers).toEqual(
        expect.objectContaining({ Authorization: expect.stringMatching(/^Basic /) }),
      );
      // 1 list + 2 destroys
      expect(fetchMock).toHaveBeenCalledTimes(3);
      expect((fetchMock.mock.calls[1][1] as RequestInit).body as URLSearchParams).toEqual(
        expect.any(URLSearchParams),
      );
      expect(((fetchMock.mock.calls[1][1] as RequestInit).body as URLSearchParams).get('type')).toBe(
        'authenticated',
      );
    });
  });
});
