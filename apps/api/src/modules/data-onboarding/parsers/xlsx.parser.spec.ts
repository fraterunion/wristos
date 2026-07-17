import ExcelJS from 'exceljs';

import { parseXlsxBuffer } from '../parsers/xlsx.parser';

describe('xlsx parser', () => {
  it('parses multi-sheet workbook rows', async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Inventario');
    sheet.addRow(['Marca', 'Modelo', 'Precio']);
    sheet.addRow(['Rolex', 'Submariner', 10000]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());

    const parsed = await parseXlsxBuffer(buffer);
    expect(parsed.sheetNames).toContain('Inventario');
    expect(parsed.rows.length).toBeGreaterThanOrEqual(1);
    expect(String(parsed.rows[0]?.rawData.marca ?? parsed.rows[0]?.rawData.Marca)).toContain('Rolex');
  });
});
