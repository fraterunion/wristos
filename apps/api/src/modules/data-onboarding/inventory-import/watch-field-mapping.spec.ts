import {
  buildDryRunBase,
  buildMappingVersion,
  isDryRunVersionCurrent,
  matchHeaderToField,
  proposeMapping,
  validateMappingEntries,
} from './watch-field-mapping';
import { SKIP_FIELD } from './watch-import.types';

describe('matchHeaderToField', () => {
  it('returns HIGH confidence for exact Spanish primary aliases', () => {
    expect(matchHeaderToField('Marca')).toEqual({ field: 'brand', confidence: 'HIGH' });
    expect(matchHeaderToField('Modelo')).toEqual({ field: 'model', confidence: 'HIGH' });
    expect(matchHeaderToField('Referencia')).toEqual({ field: 'reference', confidence: 'HIGH' });
    expect(matchHeaderToField('Serie')).toEqual({ field: 'serialNumber', confidence: 'HIGH' });
    expect(matchHeaderToField('Costo')).toEqual({ field: 'cost', confidence: 'HIGH' });
    expect(matchHeaderToField('Condicion')).toEqual({ field: 'condition', confidence: 'HIGH' });
  });

  it('handles accents correctly', () => {
    expect(matchHeaderToField('Condición')).toEqual({ field: 'condition', confidence: 'HIGH' });
    expect(matchHeaderToField('Número de Serie')).toEqual({ field: 'serialNumber', confidence: 'HIGH' });
    expect(matchHeaderToField('Número de Referencia')).toEqual({ field: 'reference', confidence: 'HIGH' });
  });

  it('returns HIGH confidence for English primary aliases', () => {
    expect(matchHeaderToField('brand')).toEqual({ field: 'brand', confidence: 'HIGH' });
    expect(matchHeaderToField('model')).toEqual({ field: 'model', confidence: 'HIGH' });
    expect(matchHeaderToField('cost')).toEqual({ field: 'cost', confidence: 'HIGH' });
    expect(matchHeaderToField('serial')).toEqual({ field: 'serialNumber', confidence: 'HIGH' });
    expect(matchHeaderToField('reference')).toEqual({ field: 'reference', confidence: 'HIGH' });
  });

  it('returns MEDIUM confidence for secondary aliases', () => {
    const result = matchHeaderToField('Moneda');
    expect(result?.field).toBe('costCurrency');
    expect(result?.confidence).toBe('MEDIUM');
  });

  it('returns null for unrecognized headers', () => {
    expect(matchHeaderToField('Notas internas')).toBeNull();
    expect(matchHeaderToField('Año')).toBeNull();
    expect(matchHeaderToField('Proveedor')).toBeNull();
  });

  it('is case-insensitive', () => {
    expect(matchHeaderToField('MARCA')).toEqual({ field: 'brand', confidence: 'HIGH' });
    expect(matchHeaderToField('BRAND')).toEqual({ field: 'brand', confidence: 'HIGH' });
    expect(matchHeaderToField('Brand')).toEqual({ field: 'brand', confidence: 'HIGH' });
  });
});

describe('proposeMapping', () => {
  const sampleRows = [
    { Marca: 'Rolex', Modelo: 'Submariner', Costo: '15000', Moneda: 'USD' },
    { Marca: 'AP', Modelo: 'Royal Oak', Costo: '22000', Moneda: 'USD' },
  ];

  it('auto-assigns HIGH confidence matches', () => {
    const proposals = proposeMapping(['Marca', 'Modelo', 'Costo'], sampleRows);
    const brandProposal = proposals.find((p) => p.sourceColumn === 'Marca');
    expect(brandProposal?.suggested).toBe('brand');
    expect(brandProposal?.confidence).toBe('HIGH');
  });

  it('does not assign LOW-confidence ambiguous matches as HIGH', () => {
    const proposals = proposeMapping(['Notas', 'Descripcion'], sampleRows);
    const notasProposal = proposals.find((p) => p.sourceColumn === 'Notas');
    expect(notasProposal?.suggested).toBeNull();
    expect(notasProposal?.confidence).toBe('NONE');
  });

  it('marks second mapping to same field as LOW confidence', () => {
    const proposals = proposeMapping(['Marca', 'Brand'], sampleRows);
    const first = proposals.find((p) => p.sourceColumn === 'Marca');
    const second = proposals.find((p) => p.sourceColumn === 'Brand');
    expect(first?.confidence).toBe('HIGH');
    expect(second?.confidence).toBe('LOW');
  });

  it('includes sample values from first 3 rows', () => {
    const proposals = proposeMapping(['Marca'], sampleRows);
    expect(proposals[0].sampleValues).toContain('Rolex');
  });
});

describe('buildMappingVersion', () => {
  it('produces a deterministic 16-char hex string', () => {
    const mapping = [
      { sourceColumn: 'Marca', targetField: 'brand' as const },
      { sourceColumn: 'Modelo', targetField: 'model' as const },
    ];
    const v1 = buildMappingVersion(mapping);
    const v2 = buildMappingVersion(mapping);
    expect(v1).toBe(v2);
    expect(v1).toHaveLength(16);
  });

  it('produces different versions for different mappings', () => {
    const a = [{ sourceColumn: 'Marca', targetField: 'brand' as const }];
    const b = [{ sourceColumn: 'Marca', targetField: 'model' as const }];
    expect(buildMappingVersion(a)).not.toBe(buildMappingVersion(b));
  });

  it('is order-independent (same fields, different order)', () => {
    const a = [
      { sourceColumn: 'Marca', targetField: 'brand' as const },
      { sourceColumn: 'Modelo', targetField: 'model' as const },
    ];
    const b = [
      { sourceColumn: 'Modelo', targetField: 'model' as const },
      { sourceColumn: 'Marca', targetField: 'brand' as const },
    ];
    expect(buildMappingVersion(a)).toBe(buildMappingVersion(b));
  });
});

describe('buildDryRunBase / isDryRunVersionCurrent', () => {
  const files = [
    { id: 'file-a', mappingVersion: 'abc123', rowCount: 10 },
    { id: 'file-b', mappingVersion: 'def456', rowCount: 5 },
  ];

  it('is deterministic and order-independent across files', () => {
    const a = buildDryRunBase('sess-1', files);
    const b = buildDryRunBase('sess-1', [files[1], files[0]]);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it('changes when mapping version changes (remapping invalidates)', () => {
    const before = buildDryRunBase('sess-1', files);
    const after = buildDryRunBase('sess-1', [
      { ...files[0], mappingVersion: 'zzz999' },
      files[1],
    ]);
    expect(before).not.toBe(after);
  });

  it('changes when rowCount changes (reprocessing invalidates)', () => {
    const before = buildDryRunBase('sess-1', files);
    const after = buildDryRunBase('sess-1', [{ ...files[0], rowCount: 11 }, files[1]]);
    expect(before).not.toBe(after);
  });

  it('changes when session changes', () => {
    expect(buildDryRunBase('sess-1', files)).not.toBe(buildDryRunBase('sess-2', files));
  });

  it('returns null for empty mapping versions or no files', () => {
    expect(buildDryRunBase('sess-1', [])).toBeNull();
    expect(buildDryRunBase('sess-1', [{ id: 'f', mappingVersion: null, rowCount: 1 }])).toBeNull();
    expect(buildDryRunBase('sess-1', [{ id: 'f', mappingVersion: '', rowCount: 1 }])).toBeNull();
  });

  it('requires exact base equality — startsWith is not enough', () => {
    const base = buildDryRunBase('sess-1', files)!;
    expect(isDryRunVersionCurrent(`${base}:2026-07-18T12:00:00.000Z`, base)).toBe(true);
    // A base that merely prefixes the stored version must be rejected.
    expect(isDryRunVersionCurrent(`${base}extra:2026-07-18T12:00:00.000Z`, base)).toBe(false);
    expect(isDryRunVersionCurrent(`${base}:2026-07-18T12:00:00.000Z`, `${base.slice(0, 8)}`)).toBe(false);
  });

  it('rejects empty or malformed stored versions', () => {
    const base = buildDryRunBase('sess-1', files)!;
    expect(isDryRunVersionCurrent(null, base)).toBe(false);
    expect(isDryRunVersionCurrent('', base)).toBe(false);
    expect(isDryRunVersionCurrent(':2026-07-18T12:00:00.000Z', base)).toBe(false);
    expect(isDryRunVersionCurrent('no-separator', base)).toBe(false);
    expect(isDryRunVersionCurrent(`${base}:2026-07-18T12:00:00.000Z`, null)).toBe(false);
  });

  it('stale after remapping: old stored version no longer matches new base', () => {
    const oldBase = buildDryRunBase('sess-1', files)!;
    const stored = `${oldBase}:2026-07-18T12:00:00.000Z`;
    const newBase = buildDryRunBase('sess-1', [{ ...files[0], mappingVersion: 'newv' }, files[1]]);
    expect(isDryRunVersionCurrent(stored, newBase)).toBe(false);
  });
});

describe('validateMappingEntries', () => {
  it('returns no errors for valid mapping', () => {
    const errors = validateMappingEntries([
      { sourceColumn: 'Marca', targetField: 'brand' },
      { sourceColumn: 'Modelo', targetField: 'model' },
      { sourceColumn: 'Notas', targetField: SKIP_FIELD },
    ]);
    expect(errors).toHaveLength(0);
  });

  it('rejects unknown targetField', () => {
    const errors = validateMappingEntries([
      { sourceColumn: 'X', targetField: 'nonexistentField' as any },
    ]);
    expect(errors.some((e) => e.includes('nonexistentField'))).toBe(true);
  });

  it('rejects duplicate targetField', () => {
    const errors = validateMappingEntries([
      { sourceColumn: 'Marca', targetField: 'brand' },
      { sourceColumn: 'Make', targetField: 'brand' },
    ]);
    expect(errors.some((e) => e.includes('brand'))).toBe(true);
  });

  it('rejects empty sourceColumn', () => {
    const errors = validateMappingEntries([{ sourceColumn: '', targetField: 'brand' }]);
    expect(errors.length).toBeGreaterThan(0);
  });
});
