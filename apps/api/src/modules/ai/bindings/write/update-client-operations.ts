import { createHash } from 'crypto';
import { BadRequestException } from '@nestjs/common';
import {
  normalizeClientEmail,
  normalizeClientName,
  normalizeClientPhone,
} from '../../../crm/client-identity.util';
import {
  resolveNotesPatch,
  resolveTagsPatch,
  UpdateClientPatch,
} from '../../../crm/client-update.service';
import { JsonValue } from '../../domain/canonical-json';

/**
 * Imperative UPDATE_CLIENT operations (intent layer).
 * Execution always materializes desired FINAL field values and applies one
 * atomic ClientUpdateService.update() patch + expectedUpdatedAt CAS.
 */
export const UPDATE_CLIENT_OPERATIONS = [
  'SET_NAME',
  'SET_EMAIL',
  'CLEAR_EMAIL',
  'SET_PHONE',
  'CLEAR_PHONE',
  'SET_NOTES',
  'APPEND_NOTES',
  'CLEAR_NOTES',
  'REPLACE_TAGS',
  'ADD_TAGS',
  'REMOVE_TAGS',
  'SET_BUDGET_RANGE',
] as const;

export type UpdateClientOperation = (typeof UPDATE_CLIENT_OPERATIONS)[number];

export type ClientSnapshot = {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  tags: string[];
  budgetRange: string | null;
  updatedAt: Date;
};

export type UpdateFieldChange = {
  field: 'name' | 'email' | 'phone' | 'notes' | 'tags' | 'budgetRange';
  operation: UpdateClientOperation;
  beforeMasked: string | null;
  afterMasked: string | null;
  beforeHash: string;
  afterHash: string;
};

export type MaterializedClientUpdate = {
  clientId: string;
  clientName: string;
  expectedUpdatedAt: string;
  /** Imperative ops that produced the patch (for receipts / telemetry). */
  operations: UpdateClientOperation[];
  /** Atomic replace-style patch for ClientUpdateService.update(). */
  patch: UpdateClientPatch;
  changes: UpdateFieldChange[];
  preStateHashes: Record<string, string>;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function hashValue(value: string | null | undefined): string {
  return createHash('sha256')
    .update(value ?? '')
    .digest('hex')
    .slice(0, 16);
}

function hashTags(tags: string[]): string {
  return hashValue(tags.join('\u0001'));
}

export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const [local, domain] = email.split('@');
  if (!local || !domain) return '••••';
  return `${local.slice(0, 1)}•••@${domain}`;
}

export function maskPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 4) return '••••';
  return `•••• ${digits.slice(-4)}`;
}

function maskNotes(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const trimmed = notes.trim();
  if (trimmed.length <= 40) return trimmed;
  return `${trimmed.slice(0, 37)}…`;
}

function parseOps(raw: unknown): UpdateClientOperation[] {
  if (!Array.isArray(raw)) return [];
  const out: UpdateClientOperation[] = [];
  for (const item of raw) {
    const op = String(item).trim().toUpperCase();
    if ((UPDATE_CLIENT_OPERATIONS as readonly string[]).includes(op)) {
      out.push(op as UpdateClientOperation);
    }
  }
  return out;
}

function parseTagList(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((t) => String(t).trim()).filter(Boolean).slice(0, 30);
  }
  if (typeof raw === 'string' && raw.trim()) {
    return raw
      .split(/[,;]/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 30);
  }
  return [];
}

/**
 * Infer operations from convenience entity keys when ops array is absent.
 */
export function inferUpdateOperations(entities: Record<string, JsonValue>): UpdateClientOperation[] {
  const explicit = parseOps(entities.operations ?? entities.ops);
  if (explicit.length) return explicit;

  const ops: UpdateClientOperation[] = [];
  if (asString(entities.setName) || asString(entities.newName)) ops.push('SET_NAME');
  if (entities.clearEmail === true || entities.clearEmail === 'true') ops.push('CLEAR_EMAIL');
  else if (asString(entities.setEmail) || asString(entities.email) || asString(entities.correo)) {
    // Only SET_EMAIL when mutation intent is present (not bare identity lookup email).
    if (
      asString(entities.setEmail) ||
      entities.updateEmail === true ||
      asString(entities.operation) === 'SET_EMAIL'
    ) {
      ops.push('SET_EMAIL');
    } else if (asString(entities.email) || asString(entities.correo)) {
      // Deictic "ponle este correo" often puts value in email.
      ops.push('SET_EMAIL');
    }
  }
  if (entities.clearPhone === true || entities.clearPhone === 'true') ops.push('CLEAR_PHONE');
  else if (
    asString(entities.setPhone) ||
    asString(entities.phone) ||
    asString(entities.telefono) ||
    asString(entities.teléfono)
  ) {
    ops.push('SET_PHONE');
  }
  if (entities.clearNotes === true || entities.clearNotes === 'true') ops.push('CLEAR_NOTES');
  else if (asString(entities.appendNotes) || asString(entities.noteAppend) || asString(entities.notaAppend)) {
    ops.push('APPEND_NOTES');
  } else if (asString(entities.setNotes) || asString(entities.notes) || asString(entities.notas)) {
    // Prefer APPEND when language marker present
    if (entities.append === true || entities.append === 'true') ops.push('APPEND_NOTES');
    else ops.push('SET_NOTES');
  }
  if (asString(entities.replaceTags) || Array.isArray(entities.replaceTags)) ops.push('REPLACE_TAGS');
  if (asString(entities.addTags) || Array.isArray(entities.addTags) || asString(entities.addTag)) {
    ops.push('ADD_TAGS');
  }
  if (
    asString(entities.removeTags) ||
    Array.isArray(entities.removeTags) ||
    asString(entities.removeTag)
  ) {
    ops.push('REMOVE_TAGS');
  }
  if (asString(entities.setBudgetRange) || asString(entities.budgetRange)) {
    ops.push('SET_BUDGET_RANGE');
  }
  return ops;
}

/**
 * Materialize imperative ops into a single replace-style patch against trusted snapshot.
 * APPEND/ADD become desired FINAL values so confirm/retry is idempotent.
 */
export function materializeClientUpdate(
  client: ClientSnapshot,
  entities: Record<string, JsonValue>,
): MaterializedClientUpdate | { kind: 'NOOP' } | { kind: 'INVALID'; message: string } {
  const operations = inferUpdateOperations(entities);
  if (!operations.length) {
    return { kind: 'INVALID', message: '¿Qué quieres cambiar del cliente?' };
  }

  const patch: UpdateClientPatch = {};
  const changes: UpdateFieldChange[] = [];
  const preStateHashes: Record<string, string> = {
    name: hashValue(client.name),
    email: hashValue(client.email),
    phone: hashValue(client.phone),
    notes: hashValue(client.notes),
    tags: hashTags(client.tags ?? []),
    budgetRange: hashValue(client.budgetRange),
  };

  let nextName = client.name;
  let nextEmail = client.email;
  let nextPhone = client.phone;
  let nextNotes = client.notes;
  let nextTags = [...(client.tags ?? [])];
  let nextBudget = client.budgetRange;

  for (const op of operations) {
    switch (op) {
      case 'SET_NAME': {
        const raw = asString(entities.setName) ?? asString(entities.newName) ?? asString(entities.name);
        const name = normalizeClientName(raw ?? '');
        if (!name) return { kind: 'INVALID', message: '¿Cuál es el nombre correcto?' };
        nextName = name;
        break;
      }
      case 'SET_EMAIL': {
        const raw =
          asString(entities.setEmail) ?? asString(entities.email) ?? asString(entities.correo);
        const email = normalizeClientEmail(raw);
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          return { kind: 'INVALID', message: 'El correo no es válido. ¿Cuál es el correo correcto?' };
        }
        nextEmail = email;
        break;
      }
      case 'CLEAR_EMAIL':
        nextEmail = null;
        break;
      case 'SET_PHONE': {
        const raw =
          asString(entities.setPhone) ??
          asString(entities.phone) ??
          asString(entities.telefono) ??
          asString(entities.teléfono);
        const phone = normalizeClientPhone(raw);
        if (!phone) {
          return {
            kind: 'INVALID',
            message: 'El teléfono no es válido. ¿Cuál es el teléfono correcto?',
          };
        }
        nextPhone = phone;
        break;
      }
      case 'CLEAR_PHONE':
        nextPhone = null;
        break;
      case 'SET_NOTES': {
        const raw = asString(entities.setNotes) ?? asString(entities.notes) ?? asString(entities.notas);
        nextNotes = resolveNotesPatch(nextNotes, { replace: raw }) ?? null;
        break;
      }
      case 'APPEND_NOTES': {
        const addition =
          asString(entities.appendNotes) ??
          asString(entities.noteAppend) ??
          asString(entities.notaAppend) ??
          asString(entities.notes) ??
          asString(entities.notas);
        if (!addition) {
          return { kind: 'INVALID', message: '¿Qué nota quieres agregar?' };
        }
        // Materialize final notes from current snapshot (idempotent SET on execute).
        nextNotes = resolveNotesPatch(nextNotes, { append: addition }) ?? nextNotes;
        break;
      }
      case 'CLEAR_NOTES':
        nextNotes = null;
        break;
      case 'REPLACE_TAGS': {
        const tags = parseTagList(entities.replaceTags ?? entities.tags);
        nextTags = resolveTagsPatch(nextTags, { replace: tags }) ?? [];
        break;
      }
      case 'ADD_TAGS': {
        const tags = parseTagList(entities.addTags ?? entities.addTag ?? entities.tags);
        if (!tags.length) return { kind: 'INVALID', message: '¿Qué etiqueta quieres agregar?' };
        nextTags = resolveTagsPatch(nextTags, { add: tags }) ?? nextTags;
        break;
      }
      case 'REMOVE_TAGS': {
        const tags = parseTagList(entities.removeTags ?? entities.removeTag ?? entities.tags);
        if (!tags.length) return { kind: 'INVALID', message: '¿Qué etiqueta quieres quitar?' };
        nextTags = resolveTagsPatch(nextTags, { remove: tags }) ?? nextTags;
        break;
      }
      case 'SET_BUDGET_RANGE': {
        const raw =
          asString(entities.setBudgetRange) ?? asString(entities.budgetRange) ?? '';
        nextBudget = raw.trim() ? raw.trim() : null;
        break;
      }
      default:
        throw new BadRequestException(`Unsupported UPDATE_CLIENT operation: ${op}`);
    }
  }

  const pushChange = (
    field: UpdateFieldChange['field'],
    operation: UpdateClientOperation,
    before: string | null,
    after: string | null,
    beforeMasked: string | null,
    afterMasked: string | null,
  ) => {
    if (before === after) return;
    changes.push({
      field,
      operation,
      beforeMasked,
      afterMasked,
      beforeHash: hashValue(before),
      afterHash: hashValue(after),
    });
  };

  if (nextName !== client.name) {
    patch.name = nextName;
    pushChange('name', 'SET_NAME', client.name, nextName, client.name, nextName);
  }
  if (nextEmail !== (client.email ?? null)) {
    patch.email = nextEmail;
    const op: UpdateClientOperation = nextEmail == null ? 'CLEAR_EMAIL' : 'SET_EMAIL';
    pushChange(
      'email',
      op,
      client.email,
      nextEmail,
      maskEmail(client.email) ?? 'Sin correo',
      nextEmail == null ? 'Sin correo' : maskEmail(nextEmail),
    );
  }
  if (nextPhone !== (client.phone ?? null)) {
    patch.phone = nextPhone;
    const op: UpdateClientOperation = nextPhone == null ? 'CLEAR_PHONE' : 'SET_PHONE';
    pushChange(
      'phone',
      op,
      client.phone,
      nextPhone,
      maskPhone(client.phone) ?? 'Sin teléfono',
      nextPhone == null ? 'Sin teléfono' : maskPhone(nextPhone),
    );
  }
  if (nextNotes !== (client.notes ?? null)) {
    patch.notes = nextNotes;
    const op: UpdateClientOperation = operations.includes('APPEND_NOTES')
      ? 'APPEND_NOTES'
      : nextNotes == null
        ? 'CLEAR_NOTES'
        : 'SET_NOTES';
    pushChange(
      'notes',
      op,
      client.notes,
      nextNotes,
      maskNotes(client.notes) ?? 'Sin notas',
      nextNotes == null ? 'Sin notas' : maskNotes(nextNotes),
    );
  }
  const sameTags =
    nextTags.length === (client.tags ?? []).length &&
    nextTags.every((t, i) => t === (client.tags ?? [])[i]);
  if (!sameTags) {
    patch.tags = nextTags;
    const op: UpdateClientOperation = operations.includes('REPLACE_TAGS')
      ? 'REPLACE_TAGS'
      : operations.includes('REMOVE_TAGS') && !operations.includes('ADD_TAGS')
        ? 'REMOVE_TAGS'
        : 'ADD_TAGS';
    pushChange(
      'tags',
      op,
      (client.tags ?? []).join(', ') || null,
      nextTags.join(', ') || null,
      (client.tags ?? []).join(', ') || 'Sin etiquetas',
      nextTags.join(', ') || 'Sin etiquetas',
    );
  }
  if (nextBudget !== (client.budgetRange ?? null)) {
    patch.budgetRange = nextBudget;
    pushChange(
      'budgetRange',
      'SET_BUDGET_RANGE',
      client.budgetRange,
      nextBudget,
      client.budgetRange ?? 'Sin presupuesto',
      nextBudget ?? 'Sin presupuesto',
    );
  }

  if (!changes.length) {
    return { kind: 'NOOP' };
  }

  return {
    clientId: client.id,
    clientName: client.name,
    expectedUpdatedAt: client.updatedAt.toISOString(),
    operations,
    patch,
    changes,
    preStateHashes,
  };
}

/** True when current row already matches every field in the desired patch. */
export function intendedFieldsMatch(
  current: ClientSnapshot,
  patch: UpdateClientPatch,
): boolean {
  if (patch.name !== undefined && current.name !== patch.name) return false;
  if (patch.email !== undefined && (current.email ?? null) !== (patch.email ?? null)) return false;
  if (patch.phone !== undefined && (current.phone ?? null) !== (patch.phone ?? null)) return false;
  if (patch.notes !== undefined && (current.notes ?? null) !== (patch.notes ?? null)) return false;
  if (patch.budgetRange !== undefined && (current.budgetRange ?? null) !== (patch.budgetRange ?? null)) {
    return false;
  }
  if (patch.tags !== undefined) {
    const a = current.tags ?? [];
    const b = patch.tags;
    if (a.length !== b.length || !a.every((t, i) => t === b[i])) return false;
  }
  return true;
}
