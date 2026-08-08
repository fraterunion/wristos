import { Injectable } from '@nestjs/common';
import { AccountEntryType, Prisma } from '@prisma/client';
import { CrmService } from '../../../crm/crm.service';
import { CuentasService } from '../../../cuentas/cuentas.service';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';

export type OpenAccountRow = {
  id: string;
  concept: string;
  counterpartyName: string;
  currency: string;
  balance: string;
  clientId?: string | null;
};

export type PaymentEntityClarify = {
  field: 'customerId' | 'accountId' | 'payableAccountId';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
};

export type PaymentEntityResolution = {
  entities: Record<string, JsonValue>;
  clarify: PaymentEntityClarify | null;
  uniqueReceivableSelected: boolean;
  uniquePayableSelected: boolean;
};

function asString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function asAmount(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function destinationLabel(destination: string): string {
  if (destination === 'CASH') return 'Efectivo';
  if (destination === 'BANK') return 'Bancos';
  if (destination === 'CESAR') return 'Cuenta César';
  if (destination === 'APPLY_TO_PAYABLE') return 'Aplicar a cuenta por pagar';
  return destination;
}

/**
 * Trusted CXC/CXP resolution for REGISTER_RECEIVABLE_PAYMENT preview.
 * Never trusts LLM-supplied account IDs. Unique open account may be selected
 * deterministically and surfaced in preview labels; multiples must clarify.
 */
@Injectable()
export class ReceivablePaymentEntityResolver {
  constructor(
    private readonly cuentas: CuentasService,
    private readonly crm: CrmService,
  ) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<PaymentEntityResolution> {
    let next: Record<string, JsonValue> = { ...entities };
    let uniqueReceivableSelected = false;
    let uniquePayableSelected = false;

    const accountEntryId = asString(next.accountEntryId);
    if (accountEntryId && !asString(next.accountId)) {
      next = { ...next, accountId: accountEntryId };
    }

    if (!asString(next.customerId) && !asString(next.clientId)) {
      const customerQuery = asString(next.customerQuery);
      if (customerQuery) {
        const clients = await this.crm.searchClientsForTools(tenantId, customerQuery, 5);
        if (clients.length === 1) {
          next = {
            ...next,
            customerId: clients[0]!.id,
            customerName: clients[0]!.name,
          };
        } else if (clients.length > 1) {
          return {
            entities: next,
            clarify: {
              field: 'customerId',
              entityType: 'CLIENT',
              message:
                'Hay varios clientes que coinciden. ¿Cuál es? Di “el primero”, “el segundo”, o elige uno.',
              candidates: clients.slice(0, 10).map((c, i) => ({
                id: c.id,
                label: c.name.slice(0, 160),
                ordinal: i + 1,
              })),
              items: clients.slice(0, 10).map((c) => ({
                id: c.id,
                label: c.name,
                name: c.name,
              })),
            },
            uniqueReceivableSelected,
            uniquePayableSelected,
          };
        }
      }
    }

    const customerId = asString(next.customerId) ?? asString(next.clientId);
    if (customerId && !asString(next.accountId)) {
      const open = await this.loadOpen(tenantId, AccountEntryType.RECEIVABLE, customerId);
      if (open.length === 1) {
        const row = open[0]!;
        next = {
          ...next,
          accountId: row.id,
          customerId,
          customerName: asString(next.customerName) ?? row.counterpartyName,
          receivableLabel: row.concept,
          accountLabel: row.concept,
          currency: row.currency,
          outstandingAmount: row.balance,
          outstandingBefore: row.balance,
          uniqueReceivableSelected: true,
        };
        uniqueReceivableSelected = true;
      } else if (open.length > 1) {
        return {
          entities: next,
          clarify: {
            field: 'accountId',
            entityType: 'ACCOUNT_ENTRY',
            message:
              'Este cliente tiene varias cuentas por cobrar abiertas. ¿Cuál quieres usar? Di “la primera”, “la segunda”, o elige una.',
            candidates: open.slice(0, 10).map((row, i) => ({
              id: row.id,
              label: `${row.concept} · ${row.balance} ${row.currency}`.slice(0, 160),
              ordinal: i + 1,
            })),
            items: open.slice(0, 10).map((row) => ({
              id: row.id,
              label: row.concept,
              name: row.concept,
              concept: row.concept,
              balance: row.balance,
              currency: row.currency,
              counterpartyName: row.counterpartyName,
            })),
          },
          uniqueReceivableSelected,
          uniquePayableSelected,
        };
      }
    }

    const accountId = asString(next.accountId);
    if (accountId) {
      const open = await this.loadOpen(tenantId, AccountEntryType.RECEIVABLE);
      const row = open.find((r) => r.id === accountId);
      if (row) {
        next = {
          ...next,
          customerName: asString(next.customerName) ?? row.counterpartyName,
          receivableLabel: asString(next.receivableLabel) ?? row.concept,
          accountLabel: asString(next.accountLabel) ?? row.concept,
          currency: asString(next.currency) ?? row.currency,
          outstandingAmount: asString(next.outstandingAmount) ?? row.balance,
          outstandingBefore: asString(next.outstandingBefore) ?? row.balance,
        };
        if (next.uniqueReceivableSelected === true || next.uniqueReceivableSelected === 'true') {
          uniqueReceivableSelected = true;
        }
      }
    }

    const destination = asString(next.destination)?.toUpperCase();
    if (destination) {
      next = { ...next, destination, destinationLabel: destinationLabel(destination) };
    }

    if (
      destination === 'APPLY_TO_PAYABLE' &&
      !asString(next.payableAccountId) &&
      !asString(next.payableEntryId)
    ) {
      let payableClientId = asString(next.payableClientId) ?? asString(next.payableCustomerId);
      const payableQuery = asString(next.payableQuery);
      if (!payableClientId && payableQuery) {
        const clients = await this.crm.searchClientsForTools(tenantId, payableQuery, 5);
        if (clients.length === 1) {
          payableClientId = clients[0]!.id;
          next = {
            ...next,
            payableClientId,
            payableLabel: clients[0]!.name,
          };
        } else if (clients.length > 1) {
          return {
            entities: next,
            clarify: {
              field: 'payableAccountId',
              entityType: 'CLIENT',
              message:
                'Hay varios destinatarios de pago que coinciden. ¿Cuál es? Di “el primero”, “el segundo”, o elige uno.',
              candidates: clients.slice(0, 10).map((c, i) => ({
                id: c.id,
                label: c.name.slice(0, 160),
                ordinal: i + 1,
              })),
              items: clients.slice(0, 10).map((c) => ({
                id: c.id,
                label: c.name,
                name: c.name,
              })),
            },
            uniqueReceivableSelected,
            uniquePayableSelected,
          };
        }
      }

      if (payableClientId) {
        const payables = await this.loadOpen(tenantId, AccountEntryType.PAYABLE, payableClientId);
        const currency = asString(next.currency);
        const eligible = currency ? payables.filter((p) => p.currency === currency) : payables;
        if (eligible.length === 1) {
          const row = eligible[0]!;
          next = {
            ...next,
            payableAccountId: row.id,
            payableEntryId: row.id,
            payableLabel: asString(next.payableLabel) ?? row.counterpartyName,
            payableOutstandingAmount: row.balance,
            payableOutstandingBefore: row.balance,
            uniquePayableSelected: true,
          };
          uniquePayableSelected = true;
        } else if (eligible.length > 1) {
          return {
            entities: next,
            clarify: {
              field: 'payableAccountId',
              entityType: 'ACCOUNT_ENTRY',
              message:
                'Hay varias cuentas por pagar elegibles. ¿Cuál quieres usar? Di “la primera”, “la segunda”, o elige una.',
              candidates: eligible.slice(0, 10).map((row, i) => ({
                id: row.id,
                label: `${row.counterpartyName} · ${row.concept} · ${row.balance} ${row.currency}`.slice(
                  0,
                  160,
                ),
                ordinal: i + 1,
              })),
              items: eligible.slice(0, 10).map((row) => ({
                id: row.id,
                label: `${row.counterpartyName} — ${row.concept}`,
                name: row.counterpartyName,
                concept: row.concept,
                balance: row.balance,
                currency: row.currency,
                counterpartyName: row.counterpartyName,
              })),
            },
            uniqueReceivableSelected,
            uniquePayableSelected,
          };
        }
      }
    }

    const payableId = asString(next.payableAccountId) ?? asString(next.payableEntryId);
    if (payableId) {
      const payables = await this.loadOpen(tenantId, AccountEntryType.PAYABLE);
      const row = payables.find((p) => p.id === payableId);
      if (row) {
        next = {
          ...next,
          payableAccountId: row.id,
          payableEntryId: row.id,
          payableLabel: asString(next.payableLabel) ?? row.counterpartyName,
          payableOutstandingAmount: asString(next.payableOutstandingAmount) ?? row.balance,
          payableOutstandingBefore: asString(next.payableOutstandingBefore) ?? row.balance,
        };
      }
    }

    const amount = asAmount(next.amount);
    const outstanding = asAmount(next.outstandingAmount);
    if (amount !== null && outstanding !== null && amount > 0 && amount <= outstanding) {
      next = { ...next, outstandingAfter: (outstanding - amount).toFixed(2) };
    }
    const payableOutstanding = asAmount(next.payableOutstandingAmount);
    if (
      amount !== null &&
      payableOutstanding !== null &&
      amount > 0 &&
      amount <= payableOutstanding
    ) {
      next = { ...next, payableOutstandingAfter: (payableOutstanding - amount).toFixed(2) };
    }

    return {
      entities: next,
      clarify: null,
      uniqueReceivableSelected,
      uniquePayableSelected,
    };
  }

  private async loadOpen(
    tenantId: string,
    type: AccountEntryType,
    clientId?: string,
  ): Promise<OpenAccountRow[]> {
    const items = await this.cuentas.getOpenAccountsForTools(tenantId, type, clientId);
    return items.map((row) => ({
      id: String(row.id),
      concept: String(row.concept ?? 'Cuenta'),
      counterpartyName: String(row.counterpartyName ?? 'Cliente'),
      currency: String(row.currency ?? 'MXN'),
      balance: (() => {
        const bal = row.balance as unknown;
        if (bal instanceof Prisma.Decimal) return bal.toFixed(2);
        if (typeof bal === 'number' && Number.isFinite(bal)) return bal.toFixed(2);
        return String(bal ?? '0.00');
      })(),
      clientId: row.clientId ?? null,
    }));
  }
}
