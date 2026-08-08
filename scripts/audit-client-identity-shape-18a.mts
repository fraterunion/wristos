/**
 * READ-ONLY production Client email/phone *shape* audit for Commit 18A final gate.
 * Counts + hashes only — never prints raw PII.
 *
 * Usage: DATABASE_URL=... npx tsx scripts/audit-client-identity-shape-18a.mts
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

function phoneIdentityKey(raw: string | null): string | null {
  if (raw == null) return null;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  if (digits.length === 10) return `52${digits}`;
  if (digits.length === 12 && digits.startsWith('52')) return digits;
  return digits;
}

function isCanonicalEmail(raw: string): boolean {
  return raw === raw.trim().toLowerCase() && raw.trim() !== '';
}

function isCanonicalPlus52Phone(raw: string): boolean {
  return /^\+52\d{10}$/.test(raw.trim());
}

async function auditTenant(prisma: PrismaClient, tenantId: string, label: string) {
  const rows = await prisma.client.findMany({
    where: { tenantId },
    select: { id: true, email: true, phone: true, deletedAt: true },
  });
  const active = rows.filter((r) => !r.deletedAt);

  let nonNullEmail = 0;
  let nonNullPhone = 0;
  let canonicalEmail = 0;
  let nonCanonicalEmail = 0;
  let plus52Phone = 0;
  let otherPhoneFormat = 0;

  const storedEmailGroups = new Map<string, number>();
  const storedPhoneGroups = new Map<string, number>();
  const normEmailGroups = new Map<string, number>();
  const normPhoneGroups = new Map<string, number>();

  for (const r of active) {
    if (r.email != null && r.email.trim() !== '') {
      nonNullEmail += 1;
      if (isCanonicalEmail(r.email)) canonicalEmail += 1;
      else nonCanonicalEmail += 1;
      storedEmailGroups.set(r.email, (storedEmailGroups.get(r.email) ?? 0) + 1);
      const ne = normalizeEmail(r.email)!;
      normEmailGroups.set(ne, (normEmailGroups.get(ne) ?? 0) + 1);
    }
    if (r.phone != null && r.phone.trim() !== '') {
      nonNullPhone += 1;
      if (isCanonicalPlus52Phone(r.phone)) plus52Phone += 1;
      else otherPhoneFormat += 1;
      storedPhoneGroups.set(r.phone, (storedPhoneGroups.get(r.phone) ?? 0) + 1);
      const pk = phoneIdentityKey(r.phone);
      if (pk) normPhoneGroups.set(pk, (normPhoneGroups.get(pk) ?? 0) + 1);
    }
  }

  const exactStoredEmailDupes = [...storedEmailGroups.values()].filter((n) => n > 1);
  const exactStoredPhoneDupes = [...storedPhoneGroups.values()].filter((n) => n > 1);
  const normEmailDupes = [...normEmailGroups.entries()].filter(([, n]) => n > 1);
  const normPhoneDupes = [...normPhoneGroups.entries()].filter(([, n]) => n > 1);

  return {
    label,
    tenantIdHash: hash(tenantId),
    active: active.length,
    deleted: rows.length - active.length,
    nonNullEmail,
    nonNullPhone,
    alreadyCanonicalEmail: canonicalEmail,
    nonCanonicalEmailFormatting: nonCanonicalEmail,
    canonicalPlus52Phone: plus52Phone,
    otherPhoneFormats: otherPhoneFormat,
    exactStoredDuplicateEmailGroups: exactStoredEmailDupes.length,
    exactStoredDuplicatePhoneGroups: exactStoredPhoneDupes.length,
    normalizedDuplicateEmailGroups: normEmailDupes.length,
    normalizedDuplicatePhoneGroups: normPhoneDupes.length,
    normalizedEmailDupGroupSizes: normEmailDupes.map(([, n]) => n).sort((a, b) => b - a),
    normalizedPhoneDupGroupSizes: normPhoneDupes.map(([, n]) => n).sort((a, b) => b - a),
    // hashes only
    sampleNormEmailDupHashes: normEmailDupes.slice(0, 10).map(([k]) => hash(k)),
    sampleNormPhoneDupHashes: normPhoneDupes.slice(0, 10).map(([k]) => hash(k)),
    uniqueActiveEmailIndexSafe: normEmailDupes.length === 0,
    uniqueActivePhoneIndexSafe: normPhoneDupes.length === 0,
    storedFieldsSafeAsPlainUnique:
      exactStoredEmailDupes.length === 0 &&
      exactStoredPhoneDupes.length === 0 &&
      nonCanonicalEmail === 0,
    recommendation:
      normEmailDupes.length === 0 && normPhoneDupes.length === 0
        ? 'PROCEED_EXPRESSION_UNIQUE_INDEXES'
        : 'STOP_RECONCILE_DUPLICATES',
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
    console.log(
      JSON.stringify(
        {
          utc: new Date().toISOString(),
          readOnly: true,
          semantics: {
            email: 'lower(btrim(email))',
            phone: 'clientPhoneIdentityKey (10-digit MX → 52…)',
          },
          tenants: [
            await auditTenant(prisma, WC, 'WristCaviar'),
            await auditTenant(prisma, DEMO, 'DEMO'),
          ],
        },
        null,
        2,
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
