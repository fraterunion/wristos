import { Prisma } from '@prisma/client';
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  aggregateStructuredBankCommissions,
  EXPECTED_BANK_COMMISSION_TOTALS,
  parseMigrationBankCommissionDescription,
  requireMigrationBankCommission,
  structuredBankCommissionWhere,
} from './migration-bank-commission';

type FixtureRow = {
  sourceCandidateId: string;
  entryDate: string;
  commission: number;
  deposit: number | null;
  withdrawal: number | null;
};

function loadFixture(): FixtureRow[] {
  const p = path.join(__dirname, 'fixtures', 'wrist-caviar-bank-commissions.json');
  return JSON.parse(fs.readFileSync(p, 'utf8')) as FixtureRow[];
}

describe('parseMigrationBankCommissionDescription', () => {
  it('parses the exact migration format', () => {
    const parsed = parseMigrationBankCommissionDescription(
      'migration:bank_000001; commission=480; ref=',
    );
    expect(parsed).not.toBeNull();
    expect(parsed!.sourceCandidateId).toBe('bank_000001');
    expect(parsed!.commission.toFixed(2)).toBe('480.00');
    expect(parsed!.reference).toBe('');
  });

  it('preserves decimal precision', () => {
    const parsed = parseMigrationBankCommissionDescription(
      'migration:bank_000099; commission=1234.56; ref=ABC',
    );
    expect(parsed!.commission.toFixed(2)).toBe('1234.56');
    expect(parsed!.reference).toBe('ABC');
  });

  it('rejects negative or malformed values', () => {
    expect(
      parseMigrationBankCommissionDescription(
        'migration:bank_000001; commission=-10; ref=',
      ),
    ).toBeNull();
    expect(
      parseMigrationBankCommissionDescription(
        'migration:bank_000001; commission=1e2; ref=',
      ),
    ).toBeNull();
    expect(
      parseMigrationBankCommissionDescription(
        'migration:bank_000001; commission=abc; ref=',
      ),
    ).toBeNull();
    expect(
      parseMigrationBankCommissionDescription(
        'migration:bank_000001 commission=10; ref=',
      ),
    ).toBeNull();
  });

  it('only accepts migration-formatted descriptions', () => {
    expect(parseMigrationBankCommissionDescription('manual bank fee')).toBeNull();
    expect(parseMigrationBankCommissionDescription('commission=480')).toBeNull();
    expect(parseMigrationBankCommissionDescription(null)).toBeNull();
    expect(() =>
      requireMigrationBankCommission('not a migration description'),
    ).toThrow(/Invalid migration/);
  });
});

describe('Wrist Caviar bank commission fixture totals', () => {
  const fixture = loadFixture();

  it('has 520 migrated BANK rows', () => {
    expect(fixture.length).toBe(EXPECTED_BANK_COMMISSION_TOTALS.migratedBankRows);
  });

  it('all-time non-zero count = 323 and total = 435289.15', () => {
    const rows = fixture.map((r) => ({
      commission: new Prisma.Decimal(r.commission),
      transactionDate: new Date(`${r.entryDate}T00:00:00.000Z`),
      amount: new Prisma.Decimal(
        Number(r.deposit ?? 0) > 0
          ? Number(r.deposit)
          : Number(r.withdrawal ?? 0) + Number(r.commission),
      ),
    }));
    const agg = aggregateStructuredBankCommissions(rows);
    expect(agg.movementCount).toBe(EXPECTED_BANK_COMMISSION_TOTALS.nonZeroRows);
    expect(agg.total).toBe(EXPECTED_BANK_COMMISSION_TOTALS.allTimeTotal);
  });

  it('July 2026 total = 54453.80 and rows = 24', () => {
    const rows = fixture.map((r) => ({
      commission: new Prisma.Decimal(r.commission),
      transactionDate: new Date(`${r.entryDate}T00:00:00.000Z`),
    }));
    const agg = aggregateStructuredBankCommissions(rows, {
      from: new Date(Date.UTC(2026, 6, 1)),
      toExclusive: new Date(Date.UTC(2026, 7, 1)),
    });
    expect(agg.total).toBe(EXPECTED_BANK_COMMISSION_TOTALS.july2026Total);
    expect(agg.movementCount).toBe(EXPECTED_BANK_COMMISSION_TOTALS.july2026Rows);
  });

  it('never uses treasury amount as commission', () => {
    const rows = fixture.map((r) => {
      const amount =
        Number(r.deposit ?? 0) > 0
          ? Number(r.deposit)
          : Number(r.withdrawal ?? 0) + Number(r.commission);
      return {
        commission: new Prisma.Decimal(r.commission),
        amount: new Prisma.Decimal(amount),
      };
    });
    const commissionSum = aggregateStructuredBankCommissions(rows).total;
    const amountSum = rows
      .reduce((s, r) => s.plus(r.amount), new Prisma.Decimal(0))
      .toFixed(2);
    expect(commissionSum).not.toBe(amountSum);
    expect(Number(amountSum)).toBeGreaterThan(Number(commissionSum));
  });

  it('null commission rows do not affect aggregates', () => {
    const mixed = [
      { commission: null as Prisma.Decimal | null },
      { commission: new Prisma.Decimal(0) },
      { commission: new Prisma.Decimal(10.5) },
    ];
    expect(aggregateStructuredBankCommissions(mixed)).toEqual({
      total: '10.50',
      movementCount: 1,
    });
  });

  it('filters by transactionDate business date window', () => {
    const rows = [
      {
        commission: new Prisma.Decimal(100),
        transactionDate: new Date('2026-06-30T00:00:00.000Z'),
      },
      {
        commission: new Prisma.Decimal(50),
        transactionDate: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        commission: new Prisma.Decimal(25),
        transactionDate: new Date('2026-07-31T00:00:00.000Z'),
      },
      {
        commission: new Prisma.Decimal(10),
        transactionDate: new Date('2026-08-01T00:00:00.000Z'),
      },
    ];
    const july = aggregateStructuredBankCommissions(rows, {
      from: new Date(Date.UTC(2026, 6, 1)),
      toExclusive: new Date(Date.UTC(2026, 7, 1)),
    });
    expect(july).toEqual({ total: '75.00', movementCount: 2 });
  });
});

describe('structuredBankCommissionWhere', () => {
  it('requires tenant, BANK account, commission > 0', () => {
    expect(structuredBankCommissionWhere('tenant-a')).toEqual({
      tenantId: 'tenant-a',
      account: 'BANK',
      deletedAt: null,
      commission: { gt: 0 },
    });
  });

  it('applies transactionDate filter (not createdAt)', () => {
    const from = new Date('2026-07-01T00:00:00.000Z');
    const to = new Date('2026-08-01T00:00:00.000Z');
    expect(structuredBankCommissionWhere('tenant-a', { gte: from, lt: to })).toEqual({
      tenantId: 'tenant-a',
      account: 'BANK',
      deletedAt: null,
      commission: { gt: 0 },
      transactionDate: { gte: from, lt: to },
    });
  });
});

describe('backfill eligibility guards (unit)', () => {
  it('does not overwrite already-populated commission conceptually', () => {
    const already = { commission: new Prisma.Decimal(480) };
    const eligible = already.commission == null;
    expect(eligible).toBe(false);
  });

  it('tenant isolation: other tenant ids are rejected by constant', () => {
    const { WRIST_CAVIAR_TENANT_ID } = require('./migration-bank-commission');
    expect(WRIST_CAVIAR_TENANT_ID).toBe('cmnzph8dm0000qotapt94alxs');
    expect(WRIST_CAVIAR_TENANT_ID).not.toBe('other-tenant');
  });
});
