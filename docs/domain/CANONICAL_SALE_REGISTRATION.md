# Canonical Sale Registration

Domain command shared by manual Ventas (`POST /deals/register-sale`) and future AI `REGISTER_SALE`.

**Service:** `apps/api/src/modules/deals/sale-registration.service.ts` → `SaleRegistrationService.register`

See also: `docs/ai/REGISTER_SALE_WRITE_BINDING.md`

## Atomic transaction

Deal → Payment? → TreasuryEntry? → OpEx BANK_FEES? → Watch SOLD → AccountEntry (CXC)

All-or-nothing via Prisma `$transaction`.

## Idempotency

`Deal.registerIdempotencyKey` unique per `(tenantId, key)` when non-null.

## Correction

Soft-delete Deal does **not** revive Watch from SOLD.
