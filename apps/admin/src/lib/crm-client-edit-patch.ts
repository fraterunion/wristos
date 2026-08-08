/**
 * Builds a changed-fields-only PATCH for CRM client edit, with CAS token.
 * Baseline is the Client state captured when the edit modal opened.
 */

export type ClientEditBaseline = {
  updatedAt: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  budgetRange: string | null;
};

export type ClientEditFormSnapshot = {
  name: string;
  email?: string;
  phone?: string;
  notes?: string;
  tags: string[];
  budgetRange?: string;
};

export type ClientUpdatePatchBody = {
  expectedUpdatedAt: string;
  name?: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[];
  budgetRange?: string | null;
};

function sameTags(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((v, i) => v === b[i]);
}

function blankToNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  return trimmed === '' ? null : trimmed;
}

export function clientToEditBaseline(client: {
  updatedAt: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  tags?: string[] | null;
  budgetRange?: string | null;
}): ClientEditBaseline {
  return {
    updatedAt: client.updatedAt,
    name: client.name,
    email: client.email ?? null,
    phone: client.phone ?? null,
    notes: client.notes ?? null,
    tags: [...(client.tags ?? [])],
    budgetRange: client.budgetRange ?? null,
  };
}

/**
 * Diff baseline vs submitted form. Returns noop when nothing changed.
 * Always includes expectedUpdatedAt when a mutation is needed.
 */
export function buildClientUpdatePatch(
  baseline: ClientEditBaseline,
  values: ClientEditFormSnapshot,
): { noop: true } | { noop: false; body: ClientUpdatePatchBody } {
  const nextName = values.name.trim();
  const nextEmail = blankToNull(values.email);
  const nextPhone = blankToNull(values.phone);
  const nextNotes = blankToNull(values.notes);
  const nextTags = values.tags.map((t) => t.trim()).filter(Boolean);
  const nextBudget = blankToNull(values.budgetRange);

  const body: ClientUpdatePatchBody = {
    expectedUpdatedAt: baseline.updatedAt,
  };

  if (nextName !== baseline.name) body.name = nextName;
  if (nextEmail !== (baseline.email ?? null)) body.email = nextEmail;
  if (nextPhone !== (baseline.phone ?? null)) body.phone = nextPhone;
  if (nextNotes !== (baseline.notes ?? null)) body.notes = nextNotes;
  if (!sameTags(nextTags, baseline.tags ?? [])) body.tags = nextTags;
  if (nextBudget !== (baseline.budgetRange ?? null)) body.budgetRange = nextBudget;

  const keys = Object.keys(body).filter((k) => k !== 'expectedUpdatedAt');
  if (keys.length === 0) return { noop: true };
  return { noop: false, body };
}

export function isClientStaleError(error: { status?: number; payload?: unknown }): boolean {
  if (error.status !== 409) return false;
  const payload = error.payload;
  if (!payload || typeof payload !== 'object') return false;
  const record = payload as Record<string, unknown>;
  if (record.code === 'CLIENT_STALE') return true;
  const nested = record.message;
  if (nested && typeof nested === 'object' && (nested as { code?: string }).code === 'CLIENT_STALE') {
    return true;
  }
  return false;
}
