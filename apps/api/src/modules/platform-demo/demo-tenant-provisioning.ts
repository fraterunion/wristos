import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

import { DEMO_TENANT_DEFAULT_NAME, DEMO_TENANT_SLUG } from './demo-tenant.constants';

export type DemoProvisioningInput = {
  tenantName?: string;
  /** When both are set, upsert a demo operator and attach them to the demo tenant. */
  userEmail?: string;
  userPassword?: string;
  roleName?: string;
};

export type DemoProvisioningResult = {
  tenantId: string;
  tenantSlug: string;
  isDemo: true;
  userProvisioned: boolean;
};

/**
 * CLI / admin setup only. Creates or updates the compiled-in demo tenant and
 * sets isDemo=true. Optional identity provisioning is explicit — the API reset
 * path must never call this.
 *
 * Always targets DEMO_TENANT_SLUG. Environment slugs cannot retarget this.
 */
export async function provisionDemoTenant(
  prisma: PrismaClient,
  input: DemoProvisioningInput = {},
): Promise<DemoProvisioningResult> {
  const tenantName = input.tenantName?.trim() || DEMO_TENANT_DEFAULT_NAME;
  const roleName = input.roleName?.trim() || 'OWNER';

  const tenant = await prisma.tenant.upsert({
    where: { slug: DEMO_TENANT_SLUG },
    update: { name: tenantName, status: TenantStatus.ACTIVE, isDemo: true },
    create: {
      name: tenantName,
      slug: DEMO_TENANT_SLUG,
      status: TenantStatus.ACTIVE,
      isDemo: true,
    },
  });

  const email = input.userEmail?.trim().toLowerCase();
  const password = input.userPassword;
  let userProvisioned = false;

  if (email && password) {
    const role = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: tenant.id, name: roleName } },
      update: {},
      create: { tenantId: tenant.id, name: roleName },
    });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        passwordHash,
        status: UserStatus.ACTIVE,
        displayName: 'WristOS Demo Operator',
      },
    });

    await prisma.tenantUser.upsert({
      where: { tenantId_userId: { tenantId: tenant.id, userId: user.id } },
      update: { roleId: role.id },
      create: { tenantId: tenant.id, userId: user.id, roleId: role.id },
    });
    userProvisioned = true;
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    isDemo: true,
    userProvisioned,
  };
}
