import {
  isSettledHistoricalSaleSnapshot,
  isWorkbookHistoricalSaleSourceTag,
  parseHistoricalWatchSnapshotFromNotes,
} from './historical-watch-snapshot';

describe('parseHistoricalWatchSnapshotFromNotes', () => {
  it('parses the importer snapshot format', () => {
    const notes =
      'brand=Rolex; model=Submariner; ref=16610; serial=SN-ROLEX-7788; migration=sale_000001';
    expect(parseHistoricalWatchSnapshotFromNotes(notes)).toEqual({
      brand: 'Rolex',
      model: 'Submariner',
      reference: '16610',
      serial: 'SN-ROLEX-7788',
    });
  });

  it('preserves empty ref/serial as null', () => {
    const notes = 'brand=Omega; model=Seamaster; ref=; serial=; migration=sale_000002';
    expect(parseHistoricalWatchSnapshotFromNotes(notes)).toEqual({
      brand: 'Omega',
      model: 'Seamaster',
      reference: null,
      serial: null,
    });
  });

  it('returns null when notes are not a snapshot', () => {
    expect(parseHistoricalWatchSnapshotFromNotes('cliente pidió factura')).toBeNull();
    expect(parseHistoricalWatchSnapshotFromNotes(null)).toBeNull();
    expect(parseHistoricalWatchSnapshotFromNotes('')).toBeNull();
  });

  it('still parses when trailing override tokens are present', () => {
    const notes =
      'brand=Patek Philippe; model=Nautilus; ref=5711; serial=ABC; migration=sale_000010; extrasNote=fee; override=SALE-001';
    expect(parseHistoricalWatchSnapshotFromNotes(notes)).toEqual({
      brand: 'Patek Philippe',
      model: 'Nautilus',
      reference: '5711',
      serial: 'ABC',
    });
  });
});

describe('isWorkbookHistoricalSaleSourceTag', () => {
  it('recognizes workbook and legacy historical tags', () => {
    expect(isWorkbookHistoricalSaleSourceTag('wrist-caviar-master-workbook-v1')).toBe(true);
    expect(isWorkbookHistoricalSaleSourceTag('HISTORICAL_SALES_IMPORT')).toBe(true);
    expect(isWorkbookHistoricalSaleSourceTag('manual')).toBe(false);
    expect(isWorkbookHistoricalSaleSourceTag(null)).toBe(false);
  });
});

describe('isSettledHistoricalSaleSnapshot', () => {
  it('is true only for historical imports with zero payment rows', () => {
    expect(
      isSettledHistoricalSaleSnapshot({
        sourceTag: 'wrist-caviar-master-workbook-v1',
        paymentCount: 0,
      }),
    ).toBe(true);
    expect(
      isSettledHistoricalSaleSnapshot({
        sourceTag: 'wrist-caviar-master-workbook-v1',
        paymentCount: 1,
      }),
    ).toBe(false);
    expect(
      isSettledHistoricalSaleSnapshot({
        sourceTag: null,
        paymentCount: 0,
      }),
    ).toBe(false);
  });
});
