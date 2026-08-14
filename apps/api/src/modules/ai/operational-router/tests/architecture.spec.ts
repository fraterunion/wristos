import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { OperationalIntentRouterService } from '../operational-intent-router.service';
import { saleLexicon } from '../lexicon/sale.lexicon';
import { purchaseLexicon } from '../lexicon/purchase.lexicon';
import { expenseLexicon } from '../lexicon/expense.lexicon';
import { receivablePaymentLexicon } from '../lexicon/receivable-payment.lexicon';
import { payablePaymentLexicon } from '../lexicon/payable-payment.lexicon';
import { treasuryTransferLexicon } from '../lexicon/treasury-transfer.lexicon';
import { capitalContributionLexicon } from '../lexicon/capital-contribution.lexicon';
import { capitalDistributionLexicon } from '../lexicon/capital-distribution.lexicon';
import { createReceivableLexicon } from '../lexicon/create-receivable.lexicon';
import { createPayableLexicon } from '../lexicon/create-payable.lexicon';
import { normalizeMessage } from '../text-normalize';

const moduleRoot = dirname(__dirname);

const sourceFiles = (directory: string): string[] =>
  readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts') ? [path] : [];
  });

describe('Operational Intent Router — architecture boundary', () => {
  it('has zero Prisma / HTTP surface — it is pure, synchronous text-in, verdict-out', () => {
    const source = sourceFiles(moduleRoot).map((path) => readFileSync(path, 'utf8')).join('\n');
    // Checks actual usage, not the bare word — a comment may reference
    // "Prisma" as context (e.g. explaining a default that mirrors the
    // schema's own) without importing or calling it.
    expect(source).not.toMatch(/\bPrismaService\b|\bPrismaClient\b|\.prisma\./);
    expect(source).not.toMatch(/@(Controller|Get|Post|Put|Patch|Delete)\(/);
    expect(source).not.toMatch(/\.(create|update|delete|findFirst|findMany|findUnique)\s*\(/);
  });

  it('never declares an *Id-shaped entity field — only *Query/free-text fields the existing resolvers already validate', () => {
    const lexiconDir = join(moduleRoot, 'lexicon');
    const source = sourceFiles(lexiconDir).map((path) => readFileSync(path, 'utf8')).join('\n');
    // Matches entities.someId = ... / entities['someId'] = ... anywhere in a lexicon.
    expect(source).not.toMatch(/entities\.\w*Id\b\s*=/);
    expect(source).not.toMatch(/entities\[['"]\w*Id['"]\]/);
  });

  it('every lexicon capability is one of the 10 the task scopes this router to — never a 15th write capability', () => {
    const lexicons = [
      saleLexicon,
      purchaseLexicon,
      expenseLexicon,
      receivablePaymentLexicon,
      payablePaymentLexicon,
      treasuryTransferLexicon,
      capitalContributionLexicon,
      capitalDistributionLexicon,
      createReceivableLexicon,
      createPayableLexicon,
    ];
    const capabilities = new Set(lexicons.map((l) => l.capability));
    expect(capabilities.size).toBe(10);
    expect([...capabilities].sort()).toEqual(
      [
        'CREATE_PAYABLE',
        'CREATE_RECEIVABLE',
        'REGISTER_CAPITAL_CONTRIBUTION',
        'REGISTER_CAPITAL_DISTRIBUTION',
        'REGISTER_EXPENSE',
        'REGISTER_PAYABLE_PAYMENT',
        'REGISTER_PURCHASE',
        'REGISTER_RECEIVABLE_PAYMENT',
        'REGISTER_SALE',
        'REGISTER_TREASURY_TRANSFER',
      ].sort(),
    );
  });

  it('route() is a pure synchronous function — same input always produces the same verdict', () => {
    const router = new OperationalIntentRouterService();
    const text = 'Vendí Bruce Wayne en 500k MXN a Abraham Díaz y me pagó por Bancos.';
    const first = router.route(text);
    const second = router.route(text);
    expect(second).toEqual(first);
  });

  it('normalizeMessage never changes string length (raw/folded index alignment invariant)', () => {
    const samples = [
      'Vendí Bruce Wayne en 500k MXN a Abraham Díaz y me pagó por Bancos.',
      '¿Vendimos el Bruce Wayne?',
      'César aportó 300 mil.',
      'vendi bruce 500 bancos',
    ];
    for (const sample of samples) {
      const { raw, folded } = normalizeMessage(sample);
      expect(folded.length).toBe(raw.length);
    }
  });
});
