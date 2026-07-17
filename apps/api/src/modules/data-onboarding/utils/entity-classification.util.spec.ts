import { DataImportEntityType } from '@prisma/client';

import { classifyEntityFromHeaders } from '../utils/entity-classification.util';

describe('entity classification', () => {
  it('classifies inventory headers conservatively', () => {
    const result = classifyEntityFromHeaders([
      'Marca',
      'Modelo',
      'Referencia',
      'Costo',
      'Precio',
    ]);
    expect(result.entityType).toBe(DataImportEntityType.INVENTORY);
    expect(result.score).toBeGreaterThanOrEqual(4);
  });

  it('returns UNKNOWN when confidence is insufficient', () => {
    const result = classifyEntityFromHeaders(['Columna A', 'Columna B']);
    expect(result.entityType).toBe(DataImportEntityType.UNKNOWN);
  });

  it('classifies client headers', () => {
    const result = classifyEntityFromHeaders(['Cliente', 'Nombre', 'Correo', 'Teléfono']);
    expect(result.entityType).toBe(DataImportEntityType.CLIENTS);
  });
});
