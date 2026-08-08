/**
 * READ-ONLY production Client identity audit for Commit 18A.
 * Counts + hashes only — never prints raw PII.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/audit-client-identity-18a.mts
 */
import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';

const WC = 'cmnzph8dm0000qotapt94alxs';
const DEMO = 'cmp1rirpk0000qt4a2t6rsitb';

function hash(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 12);
}

function normalizeEmail(raw: string | null): string | null {
  if (raw == null) return null;
  const t = raw.trim().toLowerCase();
  return t || null;
}

function phoneKey(raw: string | null): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7) return null;
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return digits;
  return digits;
}

async function auditTenant(prisma: PrismaClient, tenantId: string, label: string) {
  const rows = await prisma.client.findMany({
    where: { tenantId },
    select: { id: true, email: true, phone: true, deletedAt: true, name: true },
  });

  const active = rows.filter((r) => !r.deletedAt);
  const deleted = rows.filter((r) => r.deletedAt);
  const withPhone = active.filter((r) => phoneKey(r.phone));
  const withEmail = active.filter((r) => normalizeEmail(r.email));
  const blankPhone = active.filter((r) => !phoneKey(r.phone)).length;
  const blankEmail = active.filter((r) => !normalizeEmail(r.email)).length;

  const emailGroups = new Map<string, string[]>();
  const phoneGroups = new Map<string, string[]>();
  for (const r of active) {
    const e = normalizeEmail(r.email);
    if (e) {
      const g = emailGroups.get(e) ?? [];
      g.push(r.id);
      emailGroups.set(e, g);
    }
    const p = phoneKey(r.phone);
    if (p) {
      const g = phoneGroups.get(p) ?? [];
      g.push(r.id);
      phoneGroups.set(p, g);
    }
  }

  const dupEmails = [...emailGroups.entries()].filter(([, ids]) => ids.length > 1);
  const dupPhones = [...phoneGroups.entries()].filter(([, ids]) => ids.length > 1);

  // Soft-deleted contact collisions with active
  let deletedEmailClash = 0;
  let deletedPhoneClash = 0;
  for (const d of deleted) {
    const e = normalizeEmail(d.email);
    if (e && emailGroups.has(e)) deletedEmailClash += 1;
    const p = phoneKey(d.phone);
    if (p && phoneGroups.has(p)) deletedPhoneClash += 1;
  }

  return {
    label,
    tenantIdHash: hash(tenantId),
    total: rows.length,
    active: active.length,
    deleted: deleted.length,
    activeWithPhone: withPhone.length,
    activeWithEmail: withEmail.length,
    activeBlankPhone: blankPhone,
    activeBlankEmail: blankEmail,
    exactDuplicateNormalizedEmailGroups: dupEmails.length,
    exactDuplicateNormalizedPhoneGroups: dupPhones.length,
    duplicateEmailGroupSizes: dupEmails.map(([, ids]) => ids.length).sort((a, b) => b - a),
    duplicatePhoneGroupSizes: dupPhones.map(([, ids]) => ids.length).sort((a, b) => b - a),
    // hashed sample of duplicate group keys only
    duplicateEmailKeyHashes: dupEmails.slice(0, 20).map(([k]) => hash(k)),
    duplicatePhoneKeyHashes: dupPhones.slice(0, 20).map(([k]) => hash(k)),
    deletedContactClashWithActiveEmail: deletedEmailClash,
    deletedContactClashWithActivePhone: deletedPhoneClash,
    uniqueEmailIndexSafe: dupEmails.length === 0,
    uniquePhoneIndexSafe: dupPhones.length === 0,
  };
}

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error('DATABASE_URL required');
    process.exit(1);
  }
  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const report = {
      utc: new Date().toISOString(),
      readOnly: true,
      tenants: [
        await auditTenant(prisma, WC, 'WristCaviar'),
        await auditTenant(prisma, DEMO, 'DEMO'),
      ],
    };
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
