/**
 * Production-safe one-off: ensure Wrist Caviar tenant users (Cesar + Regina).
 * Does not delete data, does not run prisma/seed.ts, does not touch other tenants.
 *
 * Resolves the tenant first (by id, slug, or exact name) so production is not
 * misaligned when slug differs from local defaults. Users are matched by email
 * OR username so existing rows get password/username/email updates.
 *
 * Run from monorepo root with DATABASE_URL set.
 */
import { Prisma, PrismaClient, TenantStatus, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const BCRYPT_ROUNDS = 12;

type Tx = Prisma.TransactionClient;

async function resolveWristCaviarTenant(tx: Tx): Promise<{ tenant: { id: string; slug: string; name: string }; via: string }> {
  const byId = process.env.WRIST_CAVIAR_TENANT_ID?.trim();
  if (byId) {
    const tenant = await tx.tenant.findUnique({ where: { id: byId } });
    if (!tenant) {
      throw new Error(`WRIST_CAVIAR_TENANT_ID not found: ${byId}`);
    }
    return { tenant, via: `WRIST_CAVIAR_TENANT_ID` };
  }

  const slug = process.env.WRIST_CAVIAR_TENANT_SLUG?.trim() || 'wrist-caviar';
  const bySlug = await tx.tenant.findUnique({ where: { slug } });
  if (bySlug) {
    return { tenant: bySlug, via: `slug:${slug}` };
  }

  const nameMatch = (process.env.WRIST_CAVIAR_TENANT_NAME ?? 'Wrist Caviar').trim();
  const byName = await tx.tenant.findFirst({
    where: {
      name: { equals: nameMatch, mode: 'insensitive' },
    },
  });
  if (byName) {
    return { tenant: byName, via: `name:${nameMatch}` };
  }

  if (process.env.WRIST_CAVIAR_CREATE_TENANT_IF_MISSING === 'true') {
    const created = await tx.tenant.create({
      data: {
        name: 'Wrist Caviar',
        slug,
        status: TenantStatus.ACTIVE,
      },
    });
    return { tenant: created, via: `created:${slug}` };
  }

  throw new Error(
    [
      'Could not resolve Wrist Caviar tenant.',
      'Set one of:',
      '  WRIST_CAVIAR_TENANT_ID=<cuid>  (strongest)',
      '  WRIST_CAVIAR_TENANT_SLUG=<slug>  (default tries wrist-caviar)',
      '  WRIST_CAVIAR_TENANT_NAME=<exact display name>  (case-insensitive match)',
      'Or set WRIST_CAVIAR_CREATE_TENANT_IF_MISSING=true to create tenant with WRIST_CAVIAR_TENANT_SLUG (default wrist-caviar).',
    ].join('\n'),
  );
}

async function ensureUser(
  tx: Tx,
  input: {
    email: string;
    username: string;
    passwordHash: string;
    displayName: string;
  },
): Promise<{ id: string; email: string; username: string | null }> {
  const byEmail = await tx.user.findUnique({ where: { email: input.email } });
  const byUsername =
    input.username.length > 0
      ? await tx.user.findUnique({ where: { username: input.username } })
      : null;

  if (byEmail && byUsername && byEmail.id !== byUsername.id) {
    throw new Error(
      `User conflict: email ${input.email} and username ${input.username} map to different users. Resolve manually.`,
    );
  }

  const existing = byEmail ?? byUsername;

  if (existing) {
    return tx.user.update({
      where: { id: existing.id },
      data: {
        email: input.email,
        username: input.username,
        passwordHash: input.passwordHash,
        status: UserStatus.ACTIVE,
        displayName: input.displayName,
      },
      select: { id: true, email: true, username: true },
    });
  }

  return tx.user.create({
    data: {
      email: input.email,
      username: input.username,
      passwordHash: input.passwordHash,
      status: UserStatus.ACTIVE,
      displayName: input.displayName,
    },
    select: { id: true, email: true, username: true },
  });
}

async function main() {
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
    const { tenant: resolvedTenant, via: tenantResolvedVia } = await resolveWristCaviarTenant(tx);
    let tenant = resolvedTenant;

    if (tenant.status !== TenantStatus.ACTIVE) {
      await tx.tenant.update({
        where: { id: tenant.id },
        data: { status: TenantStatus.ACTIVE },
      });
      tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenant.id } });
    }

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

    const cesarUser = await ensureUser(tx, {
      email: cesarEmail,
      username: cesarUsername,
      passwordHash: cesarHash,
      displayName: 'Cesar Trejo',
    });

    const reginaUser = await ensureUser(tx, {
      email: reginaEmail,
      username: reginaUsername,
      passwordHash: reginaHash,
      displayName: 'Regina Trejo',
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
      tenantResolvedVia,
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
        tenantResolvedVia: result.tenantResolvedVia,
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
