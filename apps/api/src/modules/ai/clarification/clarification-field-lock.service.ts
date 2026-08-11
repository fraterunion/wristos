import { Injectable } from '@nestjs/common';
import { CrmService } from '../../crm/crm.service';
import { InventoryService } from '../../inventory/inventory.service';
import { ContextEntityType, PresentedCandidate } from '../context/working-context';
import { mapClarificationAnswer } from './clarification-presenter';

export type FieldLockBound = {
  kind: 'BOUND';
  entities: Record<string, string | number | boolean>;
};

export type FieldLockPicker = {
  kind: 'PICKER';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, string>>;
  /** Draft entities to retain while the picker is open. */
  entities: Record<string, string | number | boolean>;
};

export type FieldLockNoMatch = {
  kind: 'NO_MATCH';
};

export type FieldLockResult = FieldLockBound | FieldLockPicker | FieldLockNoMatch;

function asLabel(entities: Record<string, string | number | boolean>, keys: string[]): string | null {
  for (const key of keys) {
    const value = entities[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

function normalizeField(field: string): string {
  return field.trim();
}

function isWatchInventoryField(field: string, intent: string): boolean {
  const f = normalizeField(field);
  if (f === 'watchId') return true;
  return intent === 'REGISTER_SALE' && (f === 'watch' || f === 'brand' || f === 'model');
}

function isClientField(field: string): boolean {
  const f = normalizeField(field);
  return (
    f === 'customerId' ||
    f === 'customer' ||
    f === 'clientId' ||
    f === 'client' ||
    f === 'seller' ||
    f === 'sellerClientId'
  );
}

function isInvestorField(field: string): boolean {
  const f = normalizeField(field);
  return f === 'investorId' || f === 'investor';
}

function watchLabel(item: {
  brand: string | null;
  model: string | null;
  reference: string | null;
}): string {
  return [item.brand, item.model, item.reference].filter(Boolean).join(' ').trim().slice(0, 160) || 'Reloj';
}

/**
 * Clarification Field Lock — while a missing field is pending, the next
 * utterance is resolved as an answer to that field before any unrestricted NLP.
 */
@Injectable()
export class ClarificationFieldLockService {
  constructor(
    private readonly inventory: InventoryService,
    private readonly crm: CrmService,
  ) {}

  async resolve(args: {
    tenantId: string;
    intent: string;
    pendingField: string;
    answer: string;
    draftEntities: Record<string, string | number | boolean>;
    now?: Date;
  }): Promise<FieldLockResult> {
    const answer = args.answer.trim();
    if (!answer) return { kind: 'NO_MATCH' };

    const field = normalizeField(args.pendingField);
    const closed = mapClarificationAnswer(field, answer);
    if (closed) {
      let fieldKey = closed.field;
      let fieldValue: string | number | boolean = closed.value;
      if (args.intent === 'REGISTER_EXPENSE' && (fieldKey === 'sourceAccount' || fieldKey === 'cashAccount')) {
        fieldKey = 'source';
      }
      const entities: Record<string, string | number | boolean> = {
        ...args.draftEntities,
        [fieldKey]: fieldValue,
      };
      if (fieldKey === 'source') entities.sourceAccount = fieldValue;
      if (fieldKey === 'destination') entities.destinationAccount = fieldValue;
      return { kind: 'BOUND', entities };
    }

    if (isWatchInventoryField(field, args.intent)) {
      return this.resolveWatch(args.tenantId, answer, args.draftEntities, args.now ?? new Date());
    }

    if (isClientField(field)) {
      return this.resolveClient(args.tenantId, field, answer, args.draftEntities, args.intent);
    }

    if (isInvestorField(field)) {
      return this.resolveInvestor(args.tenantId, answer, args.draftEntities);
    }

    // Free-text bind: the pending field owns the utterance as its value.
    return {
      kind: 'BOUND',
      entities: this.bindFreeText(field, answer, args.draftEntities, args.intent),
    };
  }

  private bindFreeText(
    field: string,
    answer: string,
    draft: Record<string, string | number | boolean>,
    intent: string,
  ): Record<string, string | number | boolean> {
    const next = { ...draft };
    if (field === 'watch' || field === 'brand' || field === 'model') {
      next.watchQuery = answer;
      if (field === 'brand') next.brand = answer;
      if (field === 'model') next.model = answer;
      return next;
    }
    if (field === 'amount' || field === 'price' || field === 'cost') {
      const parsed = Number(answer.replace(/,/g, '').replace(/[^\d.]/g, ''));
      if (Number.isFinite(parsed) && parsed > 0) {
        next[field === 'price' ? 'price' : field === 'cost' ? 'cost' : 'amount'] = parsed;
      } else {
        next[field] = answer;
      }
      return next;
    }
    if (field === 'counterparty' || field === 'counterpartyName' || field === 'clientQuery') {
      next.counterpartyName = answer;
      next.clientQuery = answer;
      return next;
    }
    if (intent === 'REGISTER_PURCHASE' && field === 'seller') {
      next.seller = answer;
      next.supplierQuery = answer;
      return next;
    }
    next[field] = answer;
    return next;
  }

  private async resolveWatch(
    tenantId: string,
    answer: string,
    draft: Record<string, string | number | boolean>,
    now: Date,
  ): Promise<FieldLockResult> {
    // Entity lock: pending WATCH never opens a CLIENT/account search.
    const items = await this.inventory.searchInventory(tenantId, answer, 'ALL', 10, now);
    if (items.length === 0) {
      return { kind: 'NO_MATCH' };
    }

    // Preserve already-known customer/price — do not reinterpret answer as customerQuery.
    const base: Record<string, string | number | boolean> = { ...draft, watchQuery: answer };
    delete base.customerQuery;
    delete base.clientQuery;

    if (items.length === 1) {
      const watch = items[0]!;
      return {
        kind: 'BOUND',
        entities: {
          ...base,
          watchId: watch.id,
          watchLabel: watchLabel(watch),
        },
      };
    }

    const candidates: PresentedCandidate[] = items.slice(0, 10).map((w, i) => ({
      id: w.id,
      label: watchLabel(w),
      ordinal: i + 1,
    }));
    const who = asLabel(draft, ['customerName', 'customerQuery', 'clientLabel', 'seller']);
    const message = who
      ? `Encontré varios relojes que coinciden. ¿Cuál le vendiste a ${who}? Di “el primero”, “el segundo”, o elige uno.`
      : 'Encontré varios relojes que coinciden. ¿Cuál es? Di “el primero”, “el segundo”, o elige uno.';

    return {
      kind: 'PICKER',
      entityType: 'WATCH',
      message,
      candidates,
      items: candidates.map((c) => ({ id: c.id, label: c.label, name: c.label })),
      entities: base,
    };
  }

  private async resolveClient(
    tenantId: string,
    field: string,
    answer: string,
    draft: Record<string, string | number | boolean>,
    intent: string,
  ): Promise<FieldLockResult> {
    // Entity lock: pending CLIENT never opens a WATCH picker.
    const clients = await this.crm.searchClientsForTools(tenantId, answer, 5);
    if (clients.length === 0) {
      return { kind: 'NO_MATCH' };
    }

    const isSeller = field === 'seller' || field === 'sellerClientId' || intent === 'REGISTER_PURCHASE';
    const base = { ...draft };

    if (clients.length === 1) {
      const client = clients[0]!;
      if (isSeller && intent === 'REGISTER_PURCHASE') {
        return {
          kind: 'BOUND',
          entities: {
            ...base,
            sellerClientId: client.id,
            sellerLabel: client.name,
            seller: client.name,
          },
        };
      }
      return {
        kind: 'BOUND',
        entities: {
          ...base,
          customerId: client.id,
          clientId: client.id,
          customerName: client.name,
        },
      };
    }

    const candidates: PresentedCandidate[] = clients.slice(0, 10).map((c, i) => ({
      id: c.id,
      label: c.name.slice(0, 160),
      ordinal: i + 1,
    }));
    return {
      kind: 'PICKER',
      entityType: 'CLIENT',
      message: isSeller
        ? 'Hay varios contactos que coinciden. ¿Quién es el vendedor? Di “el primero”, “el segundo”, o elige uno.'
        : 'Hay varios clientes que coinciden. ¿Cuál es el comprador? Di “el primero”, “el segundo”, o elige uno.',
      candidates,
      items: candidates.map((c) => ({ id: c.id, label: c.label, name: c.label })),
      entities: {
        ...base,
        ...(isSeller ? { supplierQuery: answer, seller: answer } : { customerQuery: answer }),
      },
    };
  }

  private async resolveInvestor(
    tenantId: string,
    answer: string,
    draft: Record<string, string | number | boolean>,
  ): Promise<FieldLockResult> {
    // Keep fail-closed: without a dedicated investor search here, bind query and continue.
    // Capital resolver in the orchestrator owns investor disambiguation.
    return {
      kind: 'BOUND',
      entities: {
        ...draft,
        investorQuery: answer,
        investor: answer,
      },
    };
  }
}
