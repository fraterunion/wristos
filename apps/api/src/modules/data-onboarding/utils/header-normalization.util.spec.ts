import { normalizeHeaderKey, normalizeHeaders } from '../utils/header-normalization.util';

describe('header normalization', () => {
  it('normalizes accents, case, and punctuation', () => {
    expect(normalizeHeaderKey('Marca')).toBe('marca');
    expect(normalizeHeaderKey('Watch Brand')).toBe('watch_brand');
    expect(normalizeHeaderKey('Teléfono')).toBe('telefono');
  });

  it('detects duplicate normalized headers', () => {
    const result = normalizeHeaders(['Marca', 'MARCA', 'Modelo']);
    expect(result.duplicateNormalized).toContain('marca');
  });
});
