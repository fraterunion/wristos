import ExcelJS from 'exceljs';

/** Build synthetic workbooks that mirror real sheet structures without real PII/financials. */
export async function buildSyntheticWorkbook(options?: {
  includeExtraSheet?: boolean;
  omitVentas?: boolean;
}): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const reporte = wb.addWorksheet('REPORTE');
  reporte.getCell('A2').value = '';
  reporte.getCell('B2').value = 'PESOS';
  reporte.getCell('C2').value = 'DOLARES';
  reporte.getCell('A3').value = 'BANCOS';
  reporte.getCell('B3').value = 1000;
  reporte.getCell('A4').value = 'EFECTIVO PESOS';
  reporte.getCell('B4').value = 200;
  reporte.getCell('C4').value = 50;
  reporte.getCell('A5').value = 'CXC';
  reporte.getCell('B5').value = 100;
  reporte.getCell('C5').value = 10;
  reporte.getCell('A6').value = 'CXP';
  reporte.getCell('B6').value = 50;
  reporte.getCell('C6').value = 0;
  reporte.getCell('A7').value = 'INVENTARIO';
  reporte.getCell('B7').value = 500;
  reporte.getCell('A8').value = 'UTILIDADES';
  reporte.getCell('B8').value = 100;
  reporte.getCell('A9').value = 'DINERO OSCAR';
  reporte.getCell('B9').value = 230;
  reporte.getCell('A10').value = 'CUENTA CESAR';
  reporte.getCell('B10').value = 80;
  reporte.getCell('A11').value = 'CRIPTO';
  reporte.getCell('C11').value = 40;

  if (!options?.omitVentas) {
    const ventas = wb.addWorksheet('VENTAS');
    ventas.getCell('A1').value = 'CTW';
    ventas.getCell('A2').value = 'AGOSTO';
    ventas.getRow(3).values = [
      undefined,
      'FECHA VENTA',
      'CLIENTE',
      'MARCA',
      'MODELO',
      'REFERENCIA',
      'NUMERO DE SERIE',
      'COSTO',
      'PRECIO DE VENTA',
      'EXTRAS',
      'UTILIDAD',
      'NUMERO DE PAGOS',
    ];
    ventas.getCell('A4').value = new Date('2025-08-01T00:00:00.000Z');
    ventas.getCell('B4').value = 'Cliente Alpha';
    ventas.getCell('C4').value = 'ROLEX';
    ventas.getCell('D4').value = 'Submariner';
    ventas.getCell('E4').value = '126610';
    ventas.getCell('F4').value = 'SERIAL-A1';
    ventas.getCell('G4').value = 100;
    ventas.getCell('H4').value = 150;
    ventas.getCell('I4').value = 10;
    ventas.getCell('J4').value = { formula: 'H4-G4-I4', result: 40 };
    ventas.getCell('A5').value = new Date('2025-08-02T00:00:00.000Z');
    ventas.getCell('B5').value = 'Cliente Beta';
    ventas.getCell('C5').value = 'AP';
    ventas.getCell('D5').value = 'Royal Oak';
    ventas.getCell('F5').value = 'SERIAL-A1'; // duplicate serial
    ventas.getCell('G5').value = 200;
    ventas.getCell('H5').value = 300;
    ventas.getCell('I5').value = 0;
    ventas.getCell('J5').value = { formula: 'H5-G5', result: 99 }; // mismatch vs calc 100
    // Excel serial date
    ventas.getCell('A6').value = 45870; // ~2025-08-01-ish serial
    ventas.getCell('B6').value = 'Cliente Gamma';
    ventas.getCell('C6').value = 'CARTIER';
    ventas.getCell('D6').value = 'Santos';
    ventas.getCell('G6').value = 50;
    ventas.getCell('H6').value = 80;
    ventas.getCell('J6').value = 30;
  }

  const inv = wb.addWorksheet('INVENTARIO');
  inv.getCell('A1').value = 'CTW';
  inv.getRow(3).values = [undefined, 'MARCA', 'MODELO', 'REF', 'SERIE', 'COSTO', 'DOLARES', 'EXTRA', 'COSTO TOTAL'];
  inv.getCell('A5').value = 'OMEGA';
  inv.getCell('B5').value = 'Speedmaster';
  inv.getCell('C5').value = 'REF-1';
  inv.getCell('D5').value = 'INV-SER-1';
  inv.getCell('E5').value = 500;
  inv.getCell('H5').value = 500;
  inv.getCell('A6').value = 'ROLEX';
  inv.getCell('B6').value = 'Datejust';
  inv.getCell('D6').value = 'SERIAL-A1'; // overlap with sold
  inv.getCell('E6').value = 400;
  inv.getCell('H6').value = 400;
  inv.getCell('A7').value = 'PATEK';
  inv.getCell('B7').value = 'Nautilus';
  inv.getCell('D7').value = 'DOLARES'; // sparse
  inv.getCell('E7').value = 900;
  inv.getCell('H7').value = 900;
  inv.getCell('A8').value = 'TOTAL';
  inv.getCell('H8').value = 1800;

  const cxc = wb.addWorksheet('CTAS X COBRAR');
  cxc.getCell('B5').value = 'CLIENTE:';
  cxc.getCell('C5').value = 'Cliente Alpha';
  cxc.getCell('D5').value = 'RELOJ';
  cxc.getCell('A6').value = new Date('2025-08-01');
  cxc.getCell('B6').value = 'MONTO:';
  cxc.getCell('C6').value = 100;
  cxc.getCell('D6').value = 'Prestamo demo';
  cxc.getCell('B7').value = 'PAGO 1:';
  cxc.getCell('C7').value = 40;
  cxc.getCell('D7').value = 'CASH';
  cxc.getCell('B8').value = 'POR COBRAR';
  cxc.getCell('C8').value = { formula: 'C6-C7', result: 60 };

  // Right card
  cxc.getCell('G10').value = 'CLIENTE:';
  cxc.getCell('H10').value = 'Cliente Delta';
  cxc.getCell('I10').value = 'RELOJ';
  cxc.getCell('F11').value = new Date('2025-08-05');
  cxc.getCell('G11').value = 'MONTO:';
  cxc.getCell('H11').value = 200;
  cxc.getCell('I11').value = 'Watch USD';
  cxc.getCell('G12').value = 'PAGO 1:';
  cxc.getCell('H12').value = 50;
  cxc.getCell('G13').value = 'PAGO 2:';
  cxc.getCell('H13').value = 25;
  cxc.getCell('G14').value = 'POR COBRAR';
  cxc.getCell('H14').value = 100; // mismatch vs 125

  // Ambiguous
  cxc.getCell('B20').value = 'CLIENTE:';
  cxc.getCell('C20').value = '';
  cxc.getCell('B21').value = 'MONTO:';

  const cxp = wb.addWorksheet('CTAS X PAGAR');
  cxp.getCell('B6').value = 'AACREDOR';
  cxp.getCell('C6').value = 'Proveedor Uno';
  cxp.getCell('D6').value = 'RELOJ';
  cxp.getCell('B7').value = 'MONTO:';
  cxp.getCell('C7').value = 500;
  cxp.getCell('B8').value = 'PAGO 1:';
  cxp.getCell('C8').value = 100;
  cxp.getCell('B9').value = 'POR COBRAR';
  cxp.getCell('C9').value = { formula: 'C7-C654847', result: undefined }; // broken

  cxp.getCell('G16').value = 'ACREDOR';
  cxp.getCell('H16').value = 'Proveedor Dos';
  cxp.getCell('G17').value = 'MONTO:';
  cxp.getCell('H17').value = 300;
  cxp.getCell('G18').value = 'PAGO 1:';
  cxp.getCell('H18').value = 50;
  cxp.getCell('G19').value = 'POR COBRAR';
  cxp.getCell('H19').value = 200; // mismatch vs 250

  const gastos = wb.addWorksheet('GASTOS');
  gastos.getCell('A2').value = 'AGOSTO';
  gastos.getRow(3).values = [undefined, 'FECHA', 'CONCEPTO', 'CUENTA', 'SALIDA'];
  gastos.getCell('A4').value = new Date('2025-08-03');
  gastos.getCell('B4').value = 'Gasolina demo';
  gastos.getCell('D4').value = 25;

  const efectivo = wb.addWorksheet('EFECTIVO');
  efectivo.getRow(2).values = [undefined, 'FECHA', 'CONCEPTO', 'ENTRADAS', 'SALIDAS', 'SALDO'];
  efectivo.getCell('A4').value = new Date('2025-08-01');
  efectivo.getCell('B4').value = 'Apertura MXN';
  efectivo.getCell('C4').value = 100;
  efectivo.getCell('E4').value = 100;
  const hidden = efectivo.getRow(5);
  hidden.hidden = true;
  hidden.getCell(1).value = new Date('2025-08-02');
  hidden.getCell(2).value = 'Hidden movement';
  hidden.getCell(4).value = 10;
  hidden.getCell(5).value = 90;

  efectivo.getCell('G2').value = 'DOLARES';
  efectivo.getRow(3).values = [];
  efectivo.getCell('G4').value = new Date('2025-08-01');
  efectivo.getCell('H4').value = 'USD open';
  efectivo.getCell('I4').value = 20;
  efectivo.getCell('J4').value = 17.5;
  efectivo.getCell('L4').value = 20;

  const bancos = wb.addWorksheet('CONTROL BANCOS');
  bancos.getRow(2).values = [
    undefined,
    'FECHA',
    'REF',
    'CONCEPTO',
    'DEPOSITO',
    'COMISIÓN',
    'RETIRO',
    'SALDOS',
    'COMENTARIO',
  ];
  bancos.getCell('A3').value = new Date('2025-08-01');
  bancos.getCell('C3').value = 'Deposito inicial';
  bancos.getCell('D3').value = 1000;
  bancos.getCell('E3').value = 10; // 1%
  bancos.getCell('G3').value = 990;
  bancos.getCell('A4').value = new Date('2025-08-02');
  bancos.getCell('C4').value = 'Retiro';
  bancos.getCell('F4').value = 100;
  bancos.getCell('G4').value = 890;
  bancos.getCell('I2').value = 'TOTAL SIN COMISION';
  bancos.getCell('J2').value = 500; // drift vs last saldo

  const cesar = wb.addWorksheet('CUENTA CESAR');
  cesar.getCell('A2').value = new Date('2025-08-01');
  cesar.getCell('B2').value = 'Movimiento demo';
  cesar.getCell('C2').value = 50;
  cesar.getCell('E2').value = 50;

  const util = wb.addWorksheet('COBRO UTILIDADES');
  util.getCell('A1').value = 'CESAR UTILIDAD';
  util.getCell('B1').value = 'AGOSTO';
  util.getCell('C1').value = 'SEPTIEMBRE';
  util.getCell('D1').value = 'OCTUBRE';
  util.getCell('A2').value = 'UTILIDAD ACUMULADA';
  util.getCell('B2').value = 75;
  util.getCell('C2').value = 150;
  util.getCell('D2').value = 75;
  util.getCell('A3').value = 'EDGAR UTILIDAD';
  util.getCell('A4').value = 'UTILIDAD ACUMULADA';
  util.getCell('B4').value = 25;
  util.getCell('C4').value = 50;
  util.getCell('D4').value = 25;

  const crypto = wb.addWorksheet('CRIPTO CESAR');
  crypto.getCell('A2').value = new Date('2025-08-01');
  crypto.getCell('B2').value = 'Crypto open';
  crypto.getCell('C2').value = 40;
  crypto.getCell('E2').value = 40;

  const oscar = wb.addWorksheet('OSCAR PAPA CAMI');
  oscar.getCell('A1').value = 'Camioneta';
  oscar.getCell('B1').value = 230;

  if (options?.includeExtraSheet) {
    wb.addWorksheet('HOJA RARA');
  }

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

export async function buildMacroLikeBuffer(): Promise<Buffer> {
  // OLE compound signature — rejected as macro/old excel
  return Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0x00, 0x00]);
}
