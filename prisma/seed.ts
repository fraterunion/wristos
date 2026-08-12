/**
 * CLI provisioning + operational reset for the compiled-in demo tenant.
 *
 * Schema migration only adds Tenant.isDemo DEFAULT false and does not assume
 * wristos-demo exists. This CLI:
 *   1. Provisions the demo tenant (slug wristos-demo, isDemo=true)
 *   2. Optionally attaches a demo operator when SEED_USER_EMAIL and
 *      SEED_USER_PASSWORD are both set (does not overwrite an existing
 *      user's passwordHash)
 *   3. Resets operational data to the canonical MXN baseline
 *   4. Upserts the global WatchReference catalog (not tenant-scoped)
 *
 * The API reset path calls resetDemoOperationalData() directly and never
 * provisions users or runs this file.
 */
import { PrismaClient } from '@prisma/client';

import { resetDemoOperationalData } from '../apps/api/src/modules/platform-demo/demo-data-reset';
import { provisionDemoTenant } from '../apps/api/src/modules/platform-demo/demo-tenant-provisioning';
import { seedWatchReferences } from './seeds/watch-references';

const prisma = new PrismaClient();

async function main() {
  const provisioned = await provisionDemoTenant(prisma, {
    tenantName: process.env.SEED_TENANT_NAME,
    userEmail: process.env.SEED_USER_EMAIL,
    userPassword: process.env.SEED_USER_PASSWORD,
  });

  const reset = await resetDemoOperationalData(prisma);
  const watchReferenceCount = await seedWatchReferences(prisma);

  console.log('Demo tenant provisioned and operational data reset');
  console.log({
    tenantId: provisioned.tenantId,
    tenantSlug: provisioned.tenantSlug,
    isDemo: provisioned.isDemo,
    userProvisioned: provisioned.userProvisioned,
    durationMs: reset.durationMs,
    counts: reset.counts,
    watchReferences: watchReferenceCount,
  });
}

const isDirectRun = import.meta.url === `file://${process.argv[1]}`;
if (isDirectRun) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
