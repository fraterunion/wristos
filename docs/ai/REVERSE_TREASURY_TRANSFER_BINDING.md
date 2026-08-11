# REVERSE_TREASURY_TRANSFER Binding (26D — WRITE #14)

## Capability
`REVERSE_TREASURY_TRANSFER` — conversational reversal of a logical treasury transfer pair.

## Domain call
Only `TreasuryTransferService.reverse(tenantId, transferId, { reversalIdempotencyKey })`.

- `transferId` = logical key (not a TreasuryEntry row id)
- `reversalIdempotencyKey` = `ai-action-run:<actionRunId>` (server-owned)

## Target resolution
Trusted sources only:
1. last reversible action (`REGISTER_TREASURY_TRANSFER` → reverse allowlist)
2. selected / picker `TREASURY_TRANSFER`
3. deterministic pair search (amount+source+dest / amount+date+source / amount+date+dest / source+dest+date)

Never trust provider TreasuryEntry IDs or silent latest transfer.

## Pair invariant
Valid reverse requires one OUTFLOW + one INFLOW with coherent provenance, amount, accounts, and active/reversed state. Missing/partial/mismatched causal keys → `INVARIANT` (no executable preview, no partial reverse).

## Confirmation
HIGH risk. Confirm only via `POST /api/ai/action-runs/:id/confirm`.

## Recovery
- SAME_COMMAND: both legs reversed with the **same** command key → recovered COMPLETED
- EXTERNAL: already reversed by another actor → stale / non-success
- INVARIANT: fail closed

## Natural language
Deterministic transfer correction language (before Anthropic) for:
- “Revierte la transferencia…”
- “Borra esa transferencia…”
- “Me equivoqué con el traspaso…”

Last-action deixis (“Deshaz eso.”) routes by closed allowlist:
- expense last write → `REVERSE_EXPENSE`
- transfer last write → `REVERSE_TREASURY_TRANSFER`
- other writes → no guess

## Composition
Unchanged. No reverse composition edges.

## Schema
No migration. Uses live `TreasuryEntry.reversalIdempotencyKey` (26B).
