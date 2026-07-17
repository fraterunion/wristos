import { parseCsvBuffer } from '../parsers/csv.parser';

describe('csv parser', () => {
  it('parses comma-separated values with headers', () => {
    const buffer = Buffer.from('Marca,Modelo,Precio\nRolex,Submariner,10000\n', 'utf8');
    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rawData.marca).toBe('Rolex');
    expect(parsed.rows[0]?.sourceRowNumber).toBe(2);
  });

  it('handles UTF-8 BOM and semicolon delimiter', () => {
    const buffer = Buffer.from('\uFEFFMarca;Modelo\nOmega;Speedmaster\n', 'utf8');
    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows[0]?.rawData.marca).toBe('Omega');
  });

  it('handles quoted delimiters and escaped quotes', () => {
    const buffer = Buffer.from('Marca,Modelo,Notas\nRolex,"Sub, Date","He said ""ok"""\n', 'utf8');
    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows).toHaveLength(1);
    expect(parsed.rows[0]?.rawData.modelo).toBe('Sub, Date');
    expect(parsed.rows[0]?.rawData.notas).toBe('He said "ok"');
  });

  it('skips blank data rows', () => {
    const buffer = Buffer.from('Marca,Modelo\nRolex,Sub\n,\nOmega,Speedy\n', 'utf8');
    const parsed = parseCsvBuffer(buffer);
    expect(parsed.rows).toHaveLength(2);
  });
});
