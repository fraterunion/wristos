import { parseJsonBuffer } from '../parsers/json.parser';

describe('json parser', () => {
  it('parses root array of objects', () => {
    const buffer = Buffer.from(
      JSON.stringify([
        { marca: 'Rolex', modelo: 'Daytona' },
        { marca: 'Omega', modelo: 'Seamaster' },
      ]),
      'utf8',
    );
    const parsed = parseJsonBuffer(buffer);
    expect(parsed.structure).toBe('array');
    expect(parsed.rows).toHaveLength(2);
  });

  it('parses object with array properties without flattening nested objects blindly', () => {
    const buffer = Buffer.from(
      JSON.stringify({
        clients: [{ name: 'Ana', email: 'ana@test.com' }],
        meta: { source: 'legacy' },
      }),
      'utf8',
    );
    const parsed = parseJsonBuffer(buffer);
    expect(parsed.structure).toBe('object_with_arrays');
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rawData._collection).toBe('clients');
  });

  it('rejects invalid json', () => {
    expect(() => parseJsonBuffer(Buffer.from('{invalid', 'utf8'))).toThrow('JSON inválido');
  });
});
