import {
  intendedFieldsMatch,
  materializeClientUpdate,
  maskEmail,
  maskPhone,
} from '../write/update-client-operations';

const baseClient = {
  id: 'client-1',
  name: 'José Hernández',
  email: 'jose@old.com',
  phone: '+525511112222',
  notes: 'Cliente frecuente',
  tags: ['VIP'],
  budgetRange: null as string | null,
  updatedAt: new Date('2026-08-08T12:00:00.000Z'),
};

describe('materializeClientUpdate', () => {
  it('SET_PHONE materializes final phone + expectedUpdatedAt', () => {
    const result = materializeClientUpdate(baseClient, { setPhone: '55 1234 5678' });
    expect('kind' in result).toBe(false);
    if ('kind' in result) return;
    expect(result.expectedUpdatedAt).toBe('2026-08-08T12:00:00.000Z');
    expect(result.patch.phone).toBe('+525512345678');
    expect(result.operations).toContain('SET_PHONE');
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]!.beforeMasked).toBe(maskPhone(baseClient.phone));
    expect(result.changes[0]!.afterMasked).toBe(maskPhone('+525512345678'));
  });

  it('APPEND_NOTES materializes FINAL notes (idempotent SET path)', () => {
    const result = materializeClientUpdate(baseClient, {
      appendNotes: 'Prefiere AP',
      operations: ['APPEND_NOTES'],
    });
    expect('kind' in result).toBe(false);
    if ('kind' in result) return;
    expect(result.patch.notes).toBe('Cliente frecuente\nPrefiere AP');
    expect(result.changes[0]!.operation).toBe('APPEND_NOTES');
  });

  it('ADD_TAGS materializes FINAL tags without duplicating existing', () => {
    const noop = materializeClientUpdate(baseClient, { addTag: 'VIP' });
    expect(noop).toEqual({ kind: 'NOOP' });

    const result = materializeClientUpdate(baseClient, { addTag: 'REPEAT' });
    expect('kind' in result).toBe(false);
    if ('kind' in result) return;
    expect(result.patch.tags).toEqual(['VIP', 'REPEAT']);
  });

  it('CLEAR_EMAIL is explicit and previews Sin correo', () => {
    const result = materializeClientUpdate(baseClient, { clearEmail: true });
    expect('kind' in result).toBe(false);
    if ('kind' in result) return;
    expect(result.patch.email).toBeNull();
    expect(result.changes[0]!.afterMasked).toBe('Sin correo');
    expect(result.changes[0]!.beforeMasked).toBe(maskEmail(baseClient.email));
  });

  it('composes phone + append notes into one atomic patch', () => {
    const result = materializeClientUpdate(baseClient, {
      setPhone: '55 9999 8888',
      appendNotes: 'Prefiere AP',
      operations: ['SET_PHONE', 'APPEND_NOTES'],
    });
    expect('kind' in result).toBe(false);
    if ('kind' in result) return;
    expect(Object.keys(result.patch).sort()).toEqual(['notes', 'phone']);
    expect(result.changes).toHaveLength(2);
  });

  it('returns NOOP when normalized desired equals current', () => {
    expect(materializeClientUpdate(baseClient, { setName: '  José   Hernández ' })).toEqual({
      kind: 'NOOP',
    });
    expect(materializeClientUpdate(baseClient, { setEmail: 'JOSE@OLD.COM' })).toEqual({
      kind: 'NOOP',
    });
  });

  it('rejects invalid email before preview', () => {
    const result = materializeClientUpdate(baseClient, { setEmail: 'not-an-email' });
    expect(result).toMatchObject({ kind: 'INVALID' });
  });
});

describe('intendedFieldsMatch', () => {
  it('matches only intended patch fields', () => {
    expect(
      intendedFieldsMatch(baseClient, { phone: '+525512345678' }),
    ).toBe(false);
    expect(
      intendedFieldsMatch(
        { ...baseClient, phone: '+525512345678', notes: 'changed elsewhere' },
        { phone: '+525512345678' },
      ),
    ).toBe(true);
  });
});
