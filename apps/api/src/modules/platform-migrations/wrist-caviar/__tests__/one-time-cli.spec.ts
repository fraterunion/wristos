import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { buildSyntheticWorkbook } from '../fixtures/synthetic-workbook';
import { assertExecuteSafety } from '../../../../../../../scripts/migrations/wrist-caviar/execute-import';
import { buildPackage } from '../../../../../../../scripts/migrations/wrist-caviar/build-package';
import { validatePackage } from '../../../../../../../scripts/migrations/wrist-caviar/validate-package';
import { prefix } from '../../../../../../../scripts/migrations/wrist-caviar/hash';

describe('wrist-caviar one-time CLI', () => {
  it('23-26. execute safety gates reject missing controls', () => {
    const fp = 'a'.repeat(64);
    const prevAllow = process.env.WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT;
    const prevDb = process.env.DATABASE_URL;
    delete process.env.WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT;

    expect(() =>
      assertExecuteSafety({ execute: true, environment: 'local' }, fp),
    ).toThrow(/WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT/);

    process.env.WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT = 'true';
    process.env.DATABASE_URL = 'postgresql://u:p@localhost:5432/wristos';

    expect(() =>
      assertExecuteSafety(
        {
          environment: 'local',
          'package-fingerprint': fp,
          'database-host-confirmation': 'localhost',
          confirmation: `IMPORT WRIST CAVIAR ${prefix(fp)}`,
        },
        fp,
      ),
    ).toThrow(/--execute/);

    expect(() =>
      assertExecuteSafety(
        {
          execute: true,
          environment: 'local',
          'package-fingerprint': 'bbbb',
          'database-host-confirmation': 'localhost',
          confirmation: `IMPORT WRIST CAVIAR ${prefix(fp)}`,
        },
        fp,
      ),
    ).toThrow(/package-fingerprint/);

    expect(() =>
      assertExecuteSafety(
        {
          execute: true,
          environment: 'local',
          'package-fingerprint': fp,
          'database-host-confirmation': 'neon.tech',
          confirmation: `IMPORT WRIST CAVIAR ${prefix(fp)}`,
        },
        fp,
      ),
    ).toThrow(/database host/);

    expect(() =>
      assertExecuteSafety(
        {
          execute: true,
          environment: 'production',
          'package-fingerprint': fp,
          'database-host-confirmation': 'localhost',
          confirmation: `IMPORT WRIST CAVIAR ${prefix(fp)}`,
        },
        fp,
      ),
    ).toThrow(/backup-verified/);

    if (prevAllow === undefined) delete process.env.WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT;
    else process.env.WRIST_CAVIAR_ALLOW_ONE_TIME_IMPORT = prevAllow;
    if (prevDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevDb;
  });

  it('3-6. synthetic package generation is deterministic and accounts for all candidates', async () => {
    const buf = await buildSyntheticWorkbook();
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'wc-pkg-'));
    const workbook = path.join(dir, 'synthetic.xlsx');
    fs.writeFileSync(workbook, buf);
    const resolutions = path.join(dir, 'resolutions.json');
    fs.writeFileSync(
      resolutions,
      JSON.stringify({
        version: 1,
        migrationSource: 'wrist-caviar-master-workbook-v1',
        notes: 'test',
        resolutions: [
          {
            id: 'd1',
            resolutionType: 'DEFER',
            reason: 'crypto',
            actor: 'test',
            date: '2026-07-28',
            resolvedValue: { group: 'CRIPTO_CESAR' },
          },
          {
            id: 'd2',
            resolutionType: 'DEFER',
            reason: 'oscar',
            actor: 'test',
            date: '2026-07-28',
            resolvedValue: { group: 'OSCAR_PAPA_CAMI' },
          },
        ],
      }),
    );

    const a = await buildPackage({
      workbookPath: workbook,
      resolutionsPath: resolutions,
      outRoot: path.join(dir, 'out'),
      allowOutOfRangeCounts: true,
    });
    const b = await buildPackage({
      workbookPath: workbook,
      resolutionsPath: resolutions,
      outRoot: path.join(dir, 'out2'),
      allowOutOfRangeCounts: true,
    });
    expect(a.packageFingerprint).toBe(b.packageFingerprint);

    const v = validatePackage(a.packageDir);
    expect(v.ok).toBe(true);

    const manifest = JSON.parse(
      fs.readFileSync(path.join(a.packageDir, 'manifest.json'), 'utf8'),
    );
    for (const counts of Object.values(manifest.groupAccounting) as Array<{
      source: number;
      CREATE: number;
      LINK: number;
      SKIP: number;
      CONFLICT: number;
      DEFERRED: number;
      EXCLUDED: number;
    }>) {
      const sum =
        counts.CREATE +
        counts.LINK +
        counts.SKIP +
        counts.CONFLICT +
        counts.DEFERRED +
        counts.EXCLUDED;
      expect(sum).toBe(counts.source);
    }
  }, 60_000);
});
