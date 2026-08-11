import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../../../../../..');
const REGISTRY = join(
  ROOT,
  'apps/api/src/modules/ai/bindings/write-capability-binding-registry.ts',
);
const COMPOSITION = join(
  ROOT,
  'apps/api/src/modules/ai/composition/composition.types.ts',
);
const MANIFEST = join(ROOT, 'docs/ai/command-coverage.json');
const AUDIT_DOC = join(ROOT, 'docs/ai/COMMAND_COVERAGE_AUDIT.md');

const EXPECTED_FOURTEEN = [
  'REGISTER_SALE',
  'REGISTER_RECEIVABLE_PAYMENT',
  'REGISTER_EXPENSE',
  'REGISTER_PURCHASE',
  'CREATE_CLIENT',
  'UPDATE_CLIENT',
  'REGISTER_PAYABLE_PAYMENT',
  'REGISTER_TREASURY_TRANSFER',
  'REGISTER_CAPITAL_CONTRIBUTION',
  'REGISTER_CAPITAL_DISTRIBUTION',
  'CREATE_RECEIVABLE',
  'CREATE_PAYABLE',
  'REVERSE_EXPENSE',
  'REVERSE_TREASURY_TRANSFER',
] as const;

const UNBOUND = [
  'REGISTER_SETTLEMENT',
  'REGISTER_CRYPTO_POSITION',
  'REGISTER_CRYPTO_PRICE',
] as const;

describe('Command Coverage Audit 26D (REVERSE_TREASURY_TRANSFER wired)', () => {
  it('keeps production write registry at exactly FOURTEEN executable bindings', () => {
    const src = readFileSync(REGISTRY, 'utf8');
    expect(src).toContain('this.bindings.size !== 14');
    for (const capability of EXPECTED_FOURTEEN) {
      expect(src).toContain(`'${capability}'`);
    }
    expect(src).toContain('ReverseExpenseWriteBinding');
    expect(src).toContain('ReverseTreasuryTransferWriteBinding');
    // No settlement/crypto executable bindings.
    expect(src).not.toMatch(/RegisterSettlementWriteBinding/);
    expect(src).not.toMatch(/RegisterCryptoPositionWriteBinding/);
    expect(src).not.toMatch(/RegisterCryptoPriceWriteBinding/);
  });

  it('keeps known catalogued writes unbound in the registry source', () => {
    const src = readFileSync(REGISTRY, 'utf8');
    for (const capability of UNBOUND) {
      expect(src).not.toContain(`!this.bindings.has('${capability}')`);
    }
  });

  it('keeps Composition V1 closed to the two CREATE_CLIENT edges', () => {
    const src = readFileSync(COMPOSITION, 'utf8');
    expect(src).toMatch(/PURCHASE_SELLER/);
    expect(src).toMatch(/SALE_CUSTOMER/);
    expect(src).toMatch(/CREATE_CLIENT/);
    // No Capital / manual-account composition edges.
    expect(src).not.toMatch(/REGISTER_CAPITAL_CONTRIBUTION[\s\S]{0,80}CREATE_CLIENT/);
    expect(src).not.toMatch(/REGISTER_CAPITAL_DISTRIBUTION[\s\S]{0,80}CREATE_CLIENT/);
    expect(src).not.toMatch(/CREATE_RECEIVABLE[\s\S]{0,80}CREATE_CLIENT/);
    expect(src).not.toMatch(/CREATE_PAYABLE[\s\S]{0,80}CREATE_CLIENT/);
  });

  it('keeps command-coverage manifest aligned with the FOURTEEN executable writes', () => {
    const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8')) as {
      productionExecutableWrites: string[];
      cataloguedUnboundWrites: string[];
      compositionV1: Array<{ parent: string; child: string; reason?: string }>;
      metrics: { full: number };
    };
    expect(manifest.productionExecutableWrites).toEqual([...EXPECTED_FOURTEEN]);
    expect(manifest.cataloguedUnboundWrites).toEqual([...UNBOUND]);
    expect(manifest.metrics.full).toBe(14);
    expect(manifest.compositionV1).toEqual([
      {
        parent: 'REGISTER_PURCHASE',
        reason: 'PURCHASE_SELLER',
        child: 'CREATE_CLIENT',
      },
      {
        parent: 'REGISTER_SALE',
        reason: 'SALE_CUSTOMER',
        child: 'CREATE_CLIENT',
      },
    ]);
  });

  it('ships the human audit document', () => {
    const doc = readFileSync(AUDIT_DOC, 'utf8');
    expect(doc).toContain('Command Coverage Audit');
    expect(doc).toContain('LEVEL 1');
    expect(doc).toContain('LEVEL 2');
  });

  it('binds REVERSE_EXPENSE and REVERSE_TREASURY_TRANSFER after 26D', () => {
    const src = readFileSync(REGISTRY, 'utf8');
    expect(src).toContain('REVERSE_EXPENSE');
    expect(src).toMatch(/ReverseExpenseWriteBinding/);
    expect(src).toContain('REVERSE_TREASURY_TRANSFER');
    expect(src).toContain('this.bindings.size !== 14');
    expect(src).toContain('ReverseTreasuryTransferWriteBinding');
  });
});
