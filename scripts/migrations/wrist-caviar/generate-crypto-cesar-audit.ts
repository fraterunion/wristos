/**
 * Regenerates private CRIPTO CESAR reconciliation artifacts under
 * `.local/migrations/wrist-caviar/066c10dab5dd/` (gitignored).
 *
 * Does NOT insert production holdings.
 *
 *   npx tsx scripts/migrations/wrist-caviar/generate-crypto-cesar-audit.ts
 */
import * as fs from 'fs';
import * as path from 'path';

const ROOT = path.resolve(
  __dirname,
  '../../../.local/migrations/wrist-caviar/066c10dab5dd',
);

const AUDIT = `# CRYPTO CESAR SOURCE AUDIT — Wrist Caviar

**Status:** PRIVATE / DO NOT IMPORT
**Package:** \`066c10dab5dd\`
**Sheet:** \`CRIPTO CESAR\`
**Disposition in migration:** DEFERRED (\`res_defer_crypto\` / group \`CRIPTO_CESAR\`)

## Verdict

The four deferred rows (\`crypto_000001\`…\`crypto_000004\`) are a **USD float ledger**
(entrada / salida / saldo), not current per-ticker holdings.

| ID | Classification |
|---|---|
| crypto_000001 | Unclear — likely deposit / opening snapshot (entry 56,810 USD) |
| crypto_000002 | Unclear — likely deposit / inflow (entry 58,000 USD) |
| crypto_000003 | Unclear — likely deposit / FX conversion inflow (entry 85,139.6648 USD) |
| crypto_000004 | Unclear — likely withdrawal / outflow (exit 29,000 USD; end bal 170,949.6648) |

Ending balance matches REPORTE CRIPTO USD (\`CRIPTO CESAR!E19\`).

**Do not auto-import into AssetHolding.** Obtain Regina’s confirmed current positions
via \`CRYPTO_INITIAL_HOLDINGS_TEMPLATE.json\`.
`;

const REDACTED = `# CRYPTO CESAR SOURCE AUDIT (REDACTED)

Four deferred CRIPTO CESAR rows are a USD float ledger, not coin holdings.
Do not import. Use CRYPTO_INITIAL_HOLDINGS_TEMPLATE.json after Regina confirms.
`;

const TEMPLATE = {
  _instructions:
    'Fill with Regina-confirmed CURRENT Wrist Caviar crypto positions. Do not invent from CRIPTO CESAR workbook history.',
  _doNotImportFrom: [
    'crypto_000001',
    'crypto_000002',
    'crypto_000003',
    'crypto_000004',
  ],
  tenantId: 'cmnzph8dm0000qotapt94alxs',
  confirmedBy: '',
  confirmedAt: '',
  holdings: [
    {
      ticker: '',
      name: '',
      quantity: '',
      averageCostMxn: '',
      location: '',
      custodian: 'César',
      notes: '',
      currentPriceMxn: '',
      priceCapturedAt: '',
      priceSource: '',
    },
  ],
};

function main() {
  fs.mkdirSync(ROOT, { recursive: true });
  fs.writeFileSync(path.join(ROOT, 'CRYPTO_CESAR_SOURCE_AUDIT.md'), AUDIT);
  fs.writeFileSync(
    path.join(ROOT, 'CRYPTO_CESAR_SOURCE_AUDIT_REDACTED.md'),
    REDACTED,
  );
  fs.writeFileSync(
    path.join(ROOT, 'CRYPTO_INITIAL_HOLDINGS_TEMPLATE.json'),
    `${JSON.stringify(TEMPLATE, null, 2)}\n`,
  );
  console.log(`Wrote crypto audit artifacts under ${ROOT}`);
  console.log('No production holdings were inserted.');
}

main();
