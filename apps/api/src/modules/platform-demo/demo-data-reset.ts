import { PrismaClient } from '@prisma/client';

import { seedDemoOperationalData } from './demo-operational-seed';
import { wipeDemoOperationalData } from './demo-operational-wipe';
import { DEMO_TENANT_SLUG } from './demo-tenant.constants';

export class DemoResetRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DemoResetRefusedError';
  }
}

export type DemoResetResult = {
  tenantId: string;
  tenantSlug: string;
  durationMs: number;
  counts: Record<string, number>;
};

const RESET_TIMEOUT_MS = 180_000;
const RESET_MAX_WAIT_MS = 15_000;

/**
 * Wipe + reseed demo operational data only.
 *
 * Never creates/updates User, passwordHash, or TenantUser.
 * Target slug is compiled-in. isDemo must already be true (set by provisioning).
 * Destructive work + reseed run in one interactive transaction so a failure
 * rolls back instead of leaving a half-reset tenant.
 */
export async function resetDemoOperationalData(
  prisma: PrismaClient,
): Promise<DemoResetResult> {
  const startedAt = Date.now();

  const existing = await prisma.tenant.findUnique({
    where: { slug: DEMO_TENANT_SLUG },
    select: { id: true, slug: true, isDemo: true },
  });

  if (!existing || !existing.isDemo || existing.slug !== DEMO_TENANT_SLUG) {
    throw new DemoResetRefusedError(
      `Demo tenant ("${DEMO_TENANT_SLUG}") not found or not flagged isDemo — refusing to reset. Provision it first via the seed CLI.`,
    );
  }

  const result = await prisma.$transaction(
    async (tx) => {
      const tenant = await tx.tenant.findUnique({
        where: { slug: DEMO_TENANT_SLUG },
        select: { id: true, slug: true, isDemo: true },
      });

      if (!tenant || !tenant.isDemo || tenant.slug !== DEMO_TENANT_SLUG) {
        throw new DemoResetRefusedError(
          `Demo tenant ("${DEMO_TENANT_SLUG}") not found or not flagged isDemo — refusing to reset.`,
        );
      }

      await wipeDemoOperationalData(tx, tenant.id);
      const counts = await seedDemoOperationalData(tx, tenant.id);
      return { tenantId: tenant.id, tenantSlug: tenant.slug, counts };
    },
    { timeout: RESET_TIMEOUT_MS, maxWait: RESET_MAX_WAIT_MS },
  );

  return { ...result, durationMs: Date.now() - startedAt };
}
