/**
 * One-off / production-safe: ensure Wrist Caviar tenant and Trejo users exist.
 * Does not delete data, does not run prisma/seed.ts, does not touch other tenants.
 *
 * Run from monorepo root with DATABASE_URL set.
 */
import { PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

async function main() {
  const tenantSlug = process.env.WRIST_CAVIAR_TENANT_SLUG?.trim() || 'wrist-caviar';
  const cesarPassword = process.env.CESAR_PASSWORD ?? 'hermanos4ever2012';
  const reginaPassword = process.env.REGINA_PASSWORD ?? 'lakikis12345';

  const cesarEmail =
    (process.env.CESAR_EMAIL ?? 'cesar.trejo@wristcaviar.local').toLowerCase().trim();
  const reginaEmail =
    (process.env.REGINA_EMAIL ?? 'regina.trejo@wristcaviar.local').toLowerCase().trim();

  const cesarUsername = (process.env.CESAR_USERNAME ?? 'cesar.trejo').toLowerCase().trim();
  const reginaUsername = (process.env.REGINA_USERNAME ?? 'regina.trejo').toLowerCase().trim();

  const cesarHash = await bcrypt.hash(cesarPassword, BCRYPT_ROUNDS);
  const reginaHash = await bcrypt.hash(reginaPassword, BCRYPT_ROUNDS);

  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.upsert({
      where: { slug: tenantSlug },
      update: {
        name: 'Wrist Caviar',
        status: TenantStatus.ACTIVE,
      },
      create: {
        name: 'Wrist Caviar',
        slug: tenantSlug,
        status: TenantStatus.ACTIVE,
      },
    });

    const ownerRole = await tx.role.upsert({
      where: {
        tenantId_name: { tenantId: tenant.id, name: 'OWNER' },
      },
      update: {},
      create: { tenantId: tenant.id, name: 'OWNER' },
    });

    const salesRole = await tx.role.upsert({
      where: {
        tenantId_name: { tenantId: tenant.id, name: 'SALES' },
      },
      update: {},
      create: { tenantId: tenant.id, name: 'SALES' },
    });

    const cesarUser = await tx.user.upsert({
      where: { email: cesarEmail },
      update: {
        username: cesarUsername,
        passwordHash: cesarHash,
        status: UserStatus.ACTIVE,
        displayName: 'Cesar Trejo',
      },
      create: {
        email: cesarEmail,
        username: cesarUsername,
        passwordHash: cesarHash,
        status: UserStatus.ACTIVE,
        displayName: 'Cesar Trejo',
      },
    });

    const reginaUser = await tx.user.upsert({
      where: { email: reginaEmail },
      update: {
        username: reginaUsername,
        passwordHash: reginaHash,
        status: UserStatus.ACTIVE,
        displayName: 'Regina Trejo',
      },
      create: {
        email: reginaEmail,
        username: reginaUsername,
        passwordHash: reginaHash,
        status: UserStatus.ACTIVE,
        displayName: 'Regina Trejo',
      },
    });

    await tx.tenantUser.upsert({
      where: {
        tenantId_userId: { tenantId: tenant.id, userId: cesarUser.id },
      },
      update: { roleId: ownerRole.id },
      create: {
        tenantId: tenant.id,
        userId: cesarUser.id,
        roleId: ownerRole.id,
      },
    });

    await tx.tenantUser.upsert({
      where: {
        tenantId_userId: { tenantId: tenant.id, userId: reginaUser.id },
      },
      update: { roleId: salesRole.id },
      create: {
        tenantId: tenant.id,
        userId: reginaUser.id,
        roleId: salesRole.id,
      },
    });

    return {
      tenant,
      ownerRole,
      salesRole,
      cesarUser,
      reginaUser,
    };
  });

  console.log('setup-wrist-caviar-users: success');
  console.log(
    JSON.stringify(
      {
        tenantId: result.tenant.id,
        tenantSlug: result.tenant.slug,
        tenantName: result.tenant.name,
        roles: {
          ownerRoleId: result.ownerRole.id,
          salesRoleId: result.salesRole.id,
        },
        users: {
          cesar: {
            userId: result.cesarUser.id,
            email: result.cesarUser.email,
            username: result.cesarUser.username,
            role: 'OWNER',
          },
          regina: {
            userId: result.reginaUser.id,
            email: result.reginaUser.email,
            username: result.reginaUser.username,
            role: 'SALES',
          },
        },
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error('setup-wrist-caviar-users: failed', error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
