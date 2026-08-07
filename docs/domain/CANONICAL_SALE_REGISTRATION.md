# Canonical Sale Registration

Domain command shared by manual Ventas (`POST /deals/register-sale`) and future AI `REGISTER_SALE`.

**Service:** `apps/api/src/modules/deals/sale-registration.service.ts` → `SaleRegistrationService.register`

See also: `docs/ai/REGISTER_SALE_WRITE_BINDING.md`

## Atomic transaction

Deal → Payment? → Treasury INFLOW? → Treasury bank-fee OUTFLOW? → Watch SOLD → AccountEntry (CXC)

BANCOS fee: gross INFLOW + fee OUTFLOW (`commission`); Payment stays gross. No OpEx BANK_FEES on new sales.

## Idempotency

- `Deal.registerIdempotencyKey` unique per `(tenantId, key)` when non-null
- `TreasuryEntry.provenanceKey` unique per `(tenantId, key)` for `…:inflow` / `…:bank-fee`

## Correction

Soft-delete Deal does **not** revive Watch from SOLD.
