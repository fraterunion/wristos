import {
  CloudinaryImportFileStorage,
  formatForPrivateDownload,
  parseCloudinaryStorageKey,
  toCloudinaryStorageKey,
  type CloudinaryClient,
} from './cloudinary-import-file.storage';
import {
  IMPORT_STORAGE_ERROR_CODE,
  IMPORT_STORAGE_READ_SAFE_MESSAGE,
  ImportStorageError,
} from './import-storage.errors';

describe('parseCloudinaryStorageKey', () => {
  it('parses legacy production keys with foldered public_id and .pdf extension', () => {
    const key =
      'cloudinary:wristos/watches/imports/tenant/session/1785276545870-w8huq1xd.pdf';
    expect(parseCloudinaryStorageKey(key)).toEqual({
      publicId: 'wristos/watches/imports/tenant/session/1785276545870-w8huq1xd.pdf',
    });
  });

  it('rejects traversal and malformed keys', () => {
    expect(() => parseCloudinaryStorageKey('s3:foo')).toThrow(ImportStorageError);
    expect(() => parseCloudinaryStorageKey('cloudinary:')).toThrow(ImportStorageError);
    expect(() => parseCloudinaryStorageKey('cloudinary:a/../b')).toThrow(ImportStorageError);
    expect(() => parseCloudinaryStorageKey('cloudinary:/absolute')).toThrow(ImportStorageError);
    expect(() => parseCloudinaryStorageKey('cloudinary:https://evil')).toThrow(ImportStorageError);
  });
});

describe('formatForPrivateDownload', () => {
  it('extracts extension without duplicating path segments', () => {
    expect(formatForPrivateDownload('folder/file.pdf')).toBe('pdf');
    expect(formatForPrivateDownload('folder/file')).toBe('');
    expect(formatForPrivateDownload('folder/file.tar.gz')).toBe('gz');
  });
});

describe('CloudinaryImportFileStorage', () => {
  const cloudName = 'demo';
  const apiKey = 'key123';
  const apiSecret = 'secret456';
  const folder = 'wristos/imports';

  let privateDownloadUrl: jest.Mock;
  let upload: jest.Mock;
  let destroy: jest.Mock;
  let resources: jest.Mock;
  let config: jest.Mock;
  let client: CloudinaryClient;
  let storage: CloudinaryImportFileStorage;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    privateDownloadUrl = jest.fn();
    upload = jest.fn();
    destroy = jest.fn();
    resources = jest.fn();
    config = jest.fn();
    client = {
      config,
      utils: { private_download_url: privateDownloadUrl },
      uploader: { upload, destroy },
      api: { resources },
    };
    storage = new CloudinaryImportFileStorage(cloudName, apiKey, apiSecret, folder, client);
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('configures the SDK with cloud credentials on construct', () => {
    expect(config).toHaveBeenCalledWith(
      expect.objectContaining({
        cloud_name: cloudName,
        api_key: apiKey,
        api_secret: apiSecret,
        secure: true,
      }),
    );
  });

  describe('save', () => {
    it('uploads with resource_type=raw and type=authenticated', async () => {
      upload.mockResolvedValue({
        public_id: `${folder}/t1/s1/abc.pdf`,
        resource_type: 'raw',
        type: 'authenticated',
        bytes: 8,
      });

      const result = await storage.save({
        tenantId: 't1',
        sessionId: 's1',
        filename: 'invoice.pdf',
        buffer: Buffer.from('%PDF-1.4'),
      });

      expect(result.storageKey).toBe(`cloudinary:${folder}/t1/s1/abc.pdf`);
      expect(upload).toHaveBeenCalledTimes(1);
      const [dataUri, options] = upload.mock.calls[0] as [string, Record<string, unknown>];
      expect(dataUri.startsWith('data:application/octet-stream;base64,')).toBe(true);
      expect(options).toEqual(
        expect.objectContaining({
          resource_type: 'raw',
          type: 'authenticated',
          folder: `${folder}/t1/s1`,
          format: 'pdf',
        }),
      );
      expect(typeof options.public_id).toBe('string');
      // short public_id must not already include .pdf (format is separate)
      expect(String(options.public_id)).not.toMatch(/\.pdf$/);
    });

    it('throws ImportStorageError when upload fails', async () => {
      upload.mockRejectedValue(Object.assign(new Error('denied'), { http_code: 401 }));
      await expect(
        storage.save({
          tenantId: 't1',
          sessionId: 's1',
          filename: 'invoice.pdf',
          buffer: Buffer.from('x'),
        }),
      ).rejects.toMatchObject({
        code: IMPORT_STORAGE_ERROR_CODE,
        httpStatus: 401,
      });
    });
  });

  describe('read', () => {
    const publicId = `${folder}/t1/s1/1785276545870-w8huq1xd.pdf`;
    const storageKey = toCloudinaryStorageKey(publicId);
    const privateUrl =
      'https://api.cloudinary.com/v1_1/demo/raw/download?timestamp=1&public_id=x&signature=abc&api_key=key123';

    it('uses private_download_url with raw + authenticated and returns original bytes', async () => {
      privateDownloadUrl.mockReturnValue(privateUrl);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from(Buffer.from('%PDF-bytes')).buffer,
      });

      const buf = await storage.read(storageKey);

      expect(buf.toString()).toBe('%PDF-bytes');
      expect(privateDownloadUrl).toHaveBeenCalledTimes(1);
      expect(privateDownloadUrl).toHaveBeenCalledWith(
        publicId,
        'pdf',
        expect.objectContaining({
          resource_type: 'raw',
          type: 'authenticated',
          attachment: false,
          expires_at: expect.any(Number),
        }),
      );
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock.mock.calls[0][0]).toBe(privateUrl);
    });

    it('does not fall back to unsigned secure_url / delivery URL strategies', async () => {
      privateDownloadUrl.mockReturnValue(privateUrl);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

      await expect(storage.read(storageKey)).rejects.toBeInstanceOf(ImportStorageError);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(privateDownloadUrl).toHaveBeenCalledTimes(1);
      // No Admin API metadata lookup, no second unsigned fetch
      const calledUrls = fetchMock.mock.calls.map((c) => String(c[0]));
      expect(calledUrls.every((u) => u.includes('/raw/download'))).toBe(true);
      expect(calledUrls.some((u) => u.includes('/raw/authenticated/') || u.includes('/raw/upload/'))).toBe(
        false,
      );
    });

    it('classifies 401 as ImportStorageError IMPORT_STORAGE_ERROR', async () => {
      privateDownloadUrl.mockReturnValue(privateUrl);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 401 });

      await expect(storage.read(storageKey)).rejects.toMatchObject({
        name: 'ImportStorageError',
        code: IMPORT_STORAGE_ERROR_CODE,
        httpStatus: 401,
        safeMessage: IMPORT_STORAGE_READ_SAFE_MESSAGE,
      });
    });

    it('classifies 403 as ImportStorageError', async () => {
      privateDownloadUrl.mockReturnValue(privateUrl);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 403 });

      await expect(storage.read(storageKey)).rejects.toMatchObject({
        code: IMPORT_STORAGE_ERROR_CODE,
        httpStatus: 403,
      });
    });

    it('classifies 404 as ImportStorageError', async () => {
      privateDownloadUrl.mockReturnValue(privateUrl);
      fetchMock.mockResolvedValueOnce({ ok: false, status: 404 });

      await expect(storage.read(storageKey)).rejects.toMatchObject({
        code: IMPORT_STORAGE_ERROR_CODE,
        httpStatus: 404,
      });
    });

    it('supports foldered public_ids from legacy storage keys', async () => {
      const legacy =
        'cloudinary:wristos/watches/imports/cmnzph8dm0000qotapt94alxs/cms57jt3e0001pk01cpvfmibi/1785276545870-w8huq1xd.pdf';
      privateDownloadUrl.mockReturnValue(privateUrl);
      fetchMock.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: async () => Uint8Array.from(Buffer.from('ok')).buffer,
      });

      await storage.read(legacy);

      expect(privateDownloadUrl.mock.calls[0][0]).toBe(
        'wristos/watches/imports/cmnzph8dm0000qotapt94alxs/cms57jt3e0001pk01cpvfmibi/1785276545870-w8huq1xd.pdf',
      );
      expect(privateDownloadUrl.mock.calls[0][1]).toBe('pdf');
    });
  });

  describe('delete', () => {
    const publicId = `${folder}/t1/s1/file.pdf`;

    it('destroys with resource_type=raw type=authenticated and accepts ok', async () => {
      destroy.mockResolvedValue({ result: 'ok' });
      await storage.delete(toCloudinaryStorageKey(publicId));
      expect(destroy).toHaveBeenCalledWith(
        publicId,
        expect.objectContaining({
          resource_type: 'raw',
          type: 'authenticated',
        }),
      );
    });

    it('treats already-missing assets as explicit success (not found)', async () => {
      destroy.mockResolvedValue({ result: 'not found' });
      await expect(storage.delete(toCloudinaryStorageKey(publicId))).resolves.toBeUndefined();
    });

    it('fails loudly on unexpected destroy result', async () => {
      destroy.mockResolvedValue({ result: 'error' });
      await expect(storage.delete(toCloudinaryStorageKey(publicId))).rejects.toMatchObject({
        code: IMPORT_STORAGE_ERROR_CODE,
      });
    });

    it('fails loudly when destroy throws', async () => {
      destroy.mockRejectedValue(Object.assign(new Error('boom'), { http_code: 500 }));
      await expect(storage.delete(toCloudinaryStorageKey(publicId))).rejects.toMatchObject({
        code: IMPORT_STORAGE_ERROR_CODE,
        httpStatus: 500,
      });
    });
  });

  describe('deleteSessionFiles', () => {
    it('lists authenticated raw resources by prefix then deletes each', async () => {
      const prefix = `${folder}/t1/s1`;
      resources.mockResolvedValue({
        resources: [{ public_id: `${prefix}/a.pdf` }, { public_id: `${prefix}/b.pdf` }],
      });
      destroy.mockResolvedValue({ result: 'ok' });

      await storage.deleteSessionFiles('t1', 's1');

      expect(resources).toHaveBeenCalledWith(
        expect.objectContaining({
          resource_type: 'raw',
          type: 'authenticated',
          prefix,
          max_results: 100,
        }),
      );
      expect(destroy).toHaveBeenCalledTimes(2);
    });
  });
});
