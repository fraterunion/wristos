import { LocalImportFileStorage } from './local-import-file.storage';
import { CloudinaryImportFileStorage } from './cloudinary-import-file.storage';
import { createImportFileStorage } from './import-file-storage.factory';

describe('createImportFileStorage', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  function clearCloudinaryEnv() {
    delete process.env.CLOUDINARY_CLOUD_NAME;
    delete process.env.CLOUDINARY_API_KEY;
    delete process.env.CLOUDINARY_API_SECRET;
    delete process.env.IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION;
  }

  it('returns LocalImportFileStorage by default in test/dev', () => {
    delete process.env.IMPORT_STORAGE_PROVIDER;
    clearCloudinaryEnv();
    process.env.NODE_ENV = 'test';

    const storage = createImportFileStorage();
    expect(storage).toBeInstanceOf(LocalImportFileStorage);
  });

  it('returns LocalImportFileStorage when IMPORT_STORAGE_PROVIDER=local in development', () => {
    process.env.IMPORT_STORAGE_PROVIDER = 'local';
    process.env.NODE_ENV = 'development';
    clearCloudinaryEnv();

    const storage = createImportFileStorage();
    expect(storage).toBeInstanceOf(LocalImportFileStorage);
  });

  it('throws when cloudinary is requested without env credentials', () => {
    process.env.IMPORT_STORAGE_PROVIDER = 'cloudinary';
    process.env.NODE_ENV = 'test';
    clearCloudinaryEnv();

    expect(() => createImportFileStorage()).toThrow(/CLOUDINARY_CLOUD_NAME/);
  });

  it('returns CloudinaryImportFileStorage when cloudinary env is complete', () => {
    process.env.IMPORT_STORAGE_PROVIDER = 'cloudinary';
    process.env.NODE_ENV = 'test';
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';

    const storage = createImportFileStorage();
    expect(storage).toBeInstanceOf(CloudinaryImportFileStorage);
  });

  it('auto-selects Cloudinary in development when credentials are present', () => {
    delete process.env.IMPORT_STORAGE_PROVIDER;
    process.env.NODE_ENV = 'development';
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';

    const storage = createImportFileStorage();
    expect(storage).toBeInstanceOf(CloudinaryImportFileStorage);
  });

  it('throws in production when Cloudinary credentials are missing', () => {
    delete process.env.IMPORT_STORAGE_PROVIDER;
    process.env.NODE_ENV = 'production';
    clearCloudinaryEnv();

    expect(() => createImportFileStorage()).toThrow(/Production requires Cloudinary/);
  });

  it('throws when IMPORT_STORAGE_PROVIDER=local in production without allow flag', () => {
    process.env.IMPORT_STORAGE_PROVIDER = 'local';
    process.env.NODE_ENV = 'production';
    clearCloudinaryEnv();

    expect(() => createImportFileStorage()).toThrow(
      /IMPORT_STORAGE_PROVIDER=local is not allowed in production/,
    );
  });

  it('allows local in production only when IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION=true', () => {
    process.env.IMPORT_STORAGE_PROVIDER = 'local';
    process.env.NODE_ENV = 'production';
    clearCloudinaryEnv();
    process.env.IMPORT_STORAGE_ALLOW_LOCAL_IN_PRODUCTION = 'true';

    const storage = createImportFileStorage();
    expect(storage).toBeInstanceOf(LocalImportFileStorage);
  });

  it('returns CloudinaryImportFileStorage in production when credentials are present', () => {
    delete process.env.IMPORT_STORAGE_PROVIDER;
    process.env.NODE_ENV = 'production';
    process.env.CLOUDINARY_CLOUD_NAME = 'demo';
    process.env.CLOUDINARY_API_KEY = 'key';
    process.env.CLOUDINARY_API_SECRET = 'secret';

    const storage = createImportFileStorage();
    expect(storage).toBeInstanceOf(CloudinaryImportFileStorage);
  });
});
