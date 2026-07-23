import {
  dealEffectiveSaleDateInclusiveRangeWhere,
  dealEffectiveSaleDateRangeWhere,
  effectiveSaleDate,
} from './effective-sale-date';

describe('effectiveSaleDate', () => {
  const updatedAt = new Date('2026-07-23T12:00:00.000Z');
  const createdAt = new Date('2026-07-01T12:00:00.000Z');
  const soldAt = new Date('2024-03-15T12:00:00.000Z');

  it('prefers soldAt when present', () => {
    expect(effectiveSaleDate({ soldAt, updatedAt, createdAt }).toISOString()).toBe(
      soldAt.toISOString(),
    );
  });

  it('falls back to updatedAt when soldAt is null', () => {
    expect(effectiveSaleDate({ soldAt: null, updatedAt, createdAt }).toISOString()).toBe(
      updatedAt.toISOString(),
    );
  });

  it('falls back to createdAt when soldAt and updatedAt missing (typed)', () => {
    expect(
      effectiveSaleDate({
        soldAt: null,
        updatedAt: undefined as unknown as Date,
        createdAt,
      }).toISOString(),
    ).toBe(createdAt.toISOString());
  });
});

describe('dealEffectiveSaleDateRangeWhere', () => {
  it('matches soldAt in range or legacy updatedAt when soldAt null', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const end = new Date('2025-01-01T00:00:00.000Z');
    expect(dealEffectiveSaleDateRangeWhere(start, end)).toEqual({
      OR: [
        { soldAt: { gte: start, lt: end } },
        { soldAt: null, updatedAt: { gte: start, lt: end } },
      ],
    });
  });

  it('inclusive helper uses lte', () => {
    const start = new Date('2026-07-01T00:00:00.000Z');
    const end = new Date('2026-07-31T23:59:59.999Z');
    expect(dealEffectiveSaleDateInclusiveRangeWhere(start, end)).toEqual({
      OR: [
        { soldAt: { gte: start, lte: end } },
        { soldAt: null, updatedAt: { gte: start, lte: end } },
      ],
    });
  });
});
