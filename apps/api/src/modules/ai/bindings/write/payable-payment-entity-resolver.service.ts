import { Injectable } from '@nestjs/common';
import { AccountEntrySource, AccountEntryType, Prisma } from '@prisma/client';
import { CrmService } from '../../../crm/crm.service';
import { CuentasService } from '../../../cuentas/cuentas.service';
import { ContextEntityType, PresentedCandidate } from '../../context/working-context';
import { JsonValue } from '../../domain/canonical-json';

export type OpenPayableRow = {
  id: string;
  concept: string;
  counterpartyName: string;
  currency: string;
  balance: string;
  source: string;
  clientId?: string | null;
};

export type PayablePaymentEntityClarify = {
  field: 'customerId' | 'accountId';
  entityType: ContextEntityType;
  message: string;
  candidates: PresentedCandidate[];
  items: Array<Record<string, JsonValue>>;
};

export type PayablePaymentEntityResolution = {
  entities: Record<string, JsonValue>;
  clarify: PayablePaymentEntityClarify | null;
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

function asBool(value: unknown): boolean {
  return value === true || value === 'true';
}

function sourceLabel(source: string): string {
  if (source === 'CASH') return 'Efectivo';
  if (source === 'BANK') return 'Bancos';
  if (source === 'CESAR') return 'Cuenta César';
  return source;
}

/**
 * Trusted PAYABLE resolution for REGISTER_PAYABLE_PAYMENT preview.
 * Never trusts LLM-supplied account IDs. Unique open payable may be selected
 * deterministically and surfaced; multiples must clarify via ENTITY_PICKER.
 * No CREATE_CLIENT composition.
 */
@Injectable()
export class PayablePaymentEntityResolver {
  constructor(
    private readonly cuentas: CuentasService,
    private readonly crm: CrmService,
  ) {}

  async resolve(
    tenantId: string,
    entities: Record<string, JsonValue>,
  ): Promise<PayablePaymentEntityResolution> {
    let next: Record<string, JsonValue> = { ...entities };
    let uniquePayableSelected = false;

    const accountEntryId = asString(next.accountEntryId);
    if (accountEntryId && !asString(next.accountId) && !asString(next.payableEntryId)) {
      next = { ...next, accountId: accountEntryId, payableEntryId: accountEntryId };
    }

    // Normalize sourceAccount aliases (destination is receivable vocabulary — map if cash-like).
    const sourceRaw =
      asString(next.sourceAccount)?.toUpperCase() ??
      asString(next.source)?.toUpperCase() ??
      asString(next.destination)?.toUpperCase();
    if (sourceRaw === 'CASH' || sourceRaw === 'BANK' || sourceRaw === 'CESAR') {
      next = {
        ...next,
        sourceAccount: sourceRaw,
        sourceAccountLabel: sourceLabel(sourceRaw),
      };
    } else if (sourceRaw === 'CRYPTO') {
      next = { ...next, sourceAccount: 'CRYPTO' };
    }

    if (!asString(next.customerId) && !asString(next.clientId) && !asString(next.supplierClientId)) {
      const counterpartyQuery =
        asString(next.counterpartyQuery) ??
        asString(next.customerQuery) ??
        asString(next.supplierQuery) ??
        asString(next.payableQuery);
      if (counterpartyQuery) {
        const clients = await this.crm.searchClientsForTools(tenantId, counterpartyQuery, 5);
        if (clients.length === 1) {
          next = {
            ...next,
            customerId: clients[0]!.id,
            customerName: clients[0]!.name,
            counterpartyLabel: clients[0]!.name,
          };
        } else if (clients.length > 1) {
          return {
            entities: next,
            clarify: {
              field: 'customerId',
              entityType: 'CLIENT',
              message:
                'Hay varios contactos que coinciden. ¿A quién le pagamos? Di “el primero”, “el segundo”, o elige uno.',
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
            uniquePayableSelected,
          };
        } else {
          // Also try open payables by counterparty name substring when no Client match.
          const byName = await this.loadEligiblePayables(tenantId);
          const q = counterpartyQuery.toLowerCase();
          const matches = byName.filter((p) =>
            p.counterpartyName.toLowerCase().includes(q),
          );
          if (matches.length === 1) {
            next = this.bindPayable(next, matches[0]!, true);
            uniquePayableSelected = true;
          } else if (matches.length > 1) {
            return this.payablePicker(next, matches, uniquePayableSelected);
          }
        }
      }
    }

    const customerId =
      asString(next.customerId) ??
      asString(next.clientId) ??
      asString(next.supplierClientId);
    if (
      customerId &&
      !asString(next.accountId) &&
      !asString(next.payableEntryId) &&
      !asString(next.payableAccountId)
    ) {
      const open = await this.loadEligiblePayables(tenantId, customerId);
      if (open.length === 1) {
        next = this.bindPayable(next, open[0]!, true);
        uniquePayableSelected = true;
      } else if (open.length > 1) {
        return this.payablePicker(next, open, uniquePayableSelected);
      }
    }

    const accountId =
      asString(next.payableEntryId) ??
      asString(next.payableAccountId) ??
      asString(next.accountId);
    if (accountId) {
      const open = await this.loadEligiblePayables(tenantId);
      const row = open.find((r) => r.id === accountId);
      if (row) {
        next = this.bindPayable(next, row, asBool(next.uniquePayableSelected));
        if (asBool(next.uniquePayableSelected)) uniquePayableSelected = true;
      }
    }

    // Full-payment language: amount = current outstanding (backend math only).
    const payFull =
      asBool(next.payFullOutstanding) ||
      asBool(next.liquidate) ||
      asString(next.paymentAmountMode)?.toUpperCase() === 'FULL';
    const outstanding = asAmount(next.outstandingAmount ?? next.outstandingBefore);
    if (payFull && outstanding !== null && outstanding > 0) {
      next = {
        ...next,
        amount: outstanding,
        payFullOutstanding: true,
      };
    }

    const amount = asAmount(next.amount);
    if (amount !== null && outstanding !== null && amount > 0 && amount <= outstanding) {
      next = {
        ...next,
        outstandingAfter: (outstanding - amount).toFixed(2),
        paymentCompletes: amount === outstanding,
      };
    }

    return {
      entities: next,
      clarify: null,
      uniquePayableSelected,
    };
  }

  private bindPayable(
    next: Record<string, JsonValue>,
    row: OpenPayableRow,
    unique: boolean,
  ): Record<string, JsonValue> {
    return {
      ...next,
      accountId: row.id,
      payableEntryId: row.id,
      payableAccountId: row.id,
      counterpartyLabel: asString(next.counterpartyLabel) ?? row.counterpartyName,
      customerName: asString(next.customerName) ?? row.counterpartyName,
      payableLabel: asString(next.payableLabel) ?? row.concept,
      accountLabel: asString(next.accountLabel) ?? row.concept,
      currency: asString(next.currency) ?? row.currency,
      outstandingAmount: row.balance,
      outstandingBefore: row.balance,
      payableSource: row.source,
      uniquePayableSelected: unique,
    };
  }

  private payablePicker(
    next: Record<string, JsonValue>,
    open: OpenPayableRow[],
    uniquePayableSelected: boolean,
  ): PayablePaymentEntityResolution {
    return {
      entities: next,
      clarify: {
        field: 'accountId',
        entityType: 'ACCOUNT_ENTRY',
        message:
          'Hay varias cuentas por pagar abiertas. ¿Cuál quieres pagar? Di “la primera”, “la segunda”, o elige una.',
        candidates: open.slice(0, 10).map((row, i) => ({
          id: row.id,
          label: `${row.concept} — $${row.balance} ${row.currency} pendiente`.slice(0, 160),
          ordinal: i + 1,
        })),
        items: open.slice(0, 10).map((row) => ({
          id: row.id,
          label: `${row.concept} — $${row.balance} pendiente`,
          name: row.counterpartyName,
          concept: row.concept,
          balance: row.balance,
          currency: row.currency,
          source: row.source,
          counterpartyName: row.counterpartyName,
        })),
      },
      uniquePayableSelected,
    };
  }

  private async loadEligiblePayables(
    tenantId: string,
    clientId?: string,
  ): Promise<OpenPayableRow[]> {
    const items = await this.cuentas.getOpenAccountsForTools(
      tenantId,
      AccountEntryType.PAYABLE,
      clientId,
    );
    return items
      .filter((row) => {
        const source = String((row as { source?: string }).source ?? '');
        const dealId = (row as { dealId?: string | null }).dealId;
        // Prefer MANUAL + PURCHASE_AUTO; exclude deal-linked if surfaced.
        if (source === AccountEntrySource.DEAL_AUTO) return false;
        if (dealId) return false;
        if (
          source &&
          source !== AccountEntrySource.MANUAL &&
          source !== AccountEntrySource.PURCHASE_AUTO
        ) {
          return false;
        }
        return true;
      })
      .map((row) => ({
        id: String(row.id),
        concept: String(row.concept ?? 'Cuenta por pagar'),
        counterpartyName: String(row.counterpartyName ?? 'Proveedor'),
        currency: String(row.currency ?? 'MXN'),
        balance: (() => {
          const bal = row.balance as unknown;
          if (bal instanceof Prisma.Decimal) return bal.toFixed(2);
          if (typeof bal === 'number' && Number.isFinite(bal)) return bal.toFixed(2);
          return String(bal ?? '0.00');
        })(),
        source: String(row.source ?? 'MANUAL'),
        clientId: row.clientId ?? null,
      }));
  }
}
