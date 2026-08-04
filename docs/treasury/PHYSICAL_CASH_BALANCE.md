# Physical CASH balance corrections (Wrist Caviar / WristOS)

## Official rule

Dashboard **CASH** is **physical MXN cash only**.

It is **not**:
- all-time `SUM(INFLOW − OUTFLOW)` across currencies;
- MXN + converted USD blended into one number.

USD cash remains in the Treasury ledger with `currency=USD` but does **not** enter the physical MXN KPI.

## How the KPI is computed

1. Take the latest `physical_cash_balance_adjustments` row for the tenant (`currency=MXN`, not deleted), ordered by `effectiveDate` then `createdAt`.
2. Start from `resultingBalance`.
3. Add subsequent **MXN** `treasury_entries` on account `CASH` with `transactionDate` **strictly after** that `effectiveDate`.
4. If no adjustment exists yet, fall back to MXN-only movement net (still excludes USD).

## How to enter a future manual physical-cash correction

### Preferred (product API)

`POST /api/treasury/cash/physical-balance` (authenticated)

```json
{
  "resultingBalance": 731200,
  "reason": "Saldo físico confirmado por César; conteo de caja",
  "effectiveDate": "2026-09-01",
  "source": "wristos-ui",
  "previousBalance": 731200
}
```

- `resultingBalance` = the new physical count (absolute).
- `previousBalance` optional; if omitted, WristOS uses the current official CASH KPI.
- Does **not** delete or rewrite historical CASH movements.
- Creates an auditable `physical_cash_balance_adjustments` row (`actor` = signed-in user email).

### Do not

- Hardcode a Dashboard number in frontend code.
- Mix USD into the MXN physical KPI.
- Rewrite historical EFECTIVO rows to force a total.
- Add unexplained balancing OUTFLOWs outside this adjustment model.

## Regina 2026-08-04 adjustment (reference)

| Field | Value |
|---|---|
| resultingBalance | 731,200.00 |
| previousBalance (prior Dashboard KPI) | 3,920,252.00 |
| adjustmentAmount | −3,188,052.00 |
| reason | Saldo físico confirmado por Regina/César; ajuste manual de caja |
| source | business-owner-confirmation |
| effectiveDate | 2026-08-04 |
