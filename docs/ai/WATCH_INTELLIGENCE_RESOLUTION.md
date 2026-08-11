# Watch Intelligence Resolution (26W)

Jarvis understands **watch-dealer language**. Tenant inventory remains the only source of trusted `watchId`.

## Trust boundary

| Layer | May do | Must not do |
| --- | --- | --- |
| Provider / LLM | Extract raw `watchQuery` text | Invent `watchId`, bind nicknames to DB rows |
| Watch knowledge catalog | Expand abbreviations, nicknames, families, references into search concepts | Imply ownership or invent inventory |
| Watch inventory resolver | Score **tenant** rows → `UNIQUE` / `PICKER` / `NO_MATCH` | Cross-tenant match, soft-bind weak fuzzy, fuzzy serials |

```
normalizeWatchQuery()
  → expandWatchKnowledge()
  → searchTenantInventory() (eligibility-filtered)
  → scoreWatchCandidates()
  → UNIQUE | PICKER | NO_MATCH
```

## Knowledge catalog

- Location: `apps/api/src/modules/ai/watch-intelligence/`
- Version: `WATCH_KNOWLEDGE_VERSION` (`1.0.0`)
- Code/data only — **no Prisma schema** in V1
- Independent of tenant inventory
- Deterministic and unit-tested

### Brand abbreviations

Scoped to watch resolution (not arbitrary prose rewrite):

| Abbrev | Canonical |
| --- | --- |
| AP | Audemars Piguet |
| PP | Patek Philippe |
| VC | Vacheron Constantin |
| JLC | Jaeger-LeCoultre |
| RM | Richard Mille |
| IWC | IWC |

Inventory often stores abbreviated brands (`AP`, `ROLEX`, `PATEK`). Catalog `inventoryBrandTokens` match both full and abbreviated forms.

### Nicknames

High-value secondary-market nicknames (Pepsi, Batman, Batgirl, Bruce Wayne, Sprite, Elephant, Panda, …). Ambiguous nicknames (`Panda`, `Ghost`, `Tiffany`, …) produce **multiple concepts**; inventory decides.

### Families

GMT / Daytona / Sub / RO / ROO / Nautilus / Aquanaut / Overseas / Speedmaster / Santos, etc.

## Reference normalization

`126710BLNR` ≡ `126710 BLNR` ≡ `126710-BLNR`

Exact reference outranks nickname/fuzzy. Serial numbers are **never** fuzzy-matched.

## Scoring (deterministic)

| Rank | Kind | Typical score |
| --- | --- | --- |
| VERY HIGH | Exact reference | 100 |
| HIGH | Brand + nickname | ~85–95 |
| MEDIUM | Nickname-only strong inventory hit | ~62–70 |
| LOW | Weak fuzzy | rejected below threshold (55) |

Never silently bind weak fuzzy results.

## Inventory eligibility

| Capability | Eligible statuses |
| --- | --- |
| `REGISTER_SALE` | `AVAILABLE`, `RESERVED` (not deleted, not `SOLD`, tenant-scoped) |
| `SEARCH_INVENTORY` | Active non-`SOLD` (same as prior search semantics) |

## Clarification Field Lock

Pending `watchId` → watch intelligence + inventory only. **Never** opens CLIENT picker first (e.g. “Bruce Wayne” stays a watch answer).

`NO_MATCH` on watch lock → contextual Spanish clarify (stay on WATCH), not unrestricted NLP.

## Picker policy

Multiple strong candidates → WATCH `ENTITY_PICKER` with brand / model / reference (no raw DB IDs in labels; no serials unless already required by UX).

## Typo policy

Conservative edit distance for brand names (≥5 chars, max distance 2). Used to **generate candidates**, not to force weak binds.

## Privacy / performance

- No full inventory dump to the LLM for nickname reasoning
- Local deterministic expansion + in-memory score over modest tenant inventory (≤500 rows loaded)
- Telemetry: alias hit, exact reference, unique/picker/no-match, confidence bucket, nickname collision — **no serials / raw query text**

## Catalog maintenance

1. Add entries to `catalog.ts` with established market usage only
2. Mark `ambiguousNickname: true` when not globally unique
3. Extend `watch-knowledge.spec.ts` test table
4. Bump `WATCH_KNOWLEDGE_VERSION` on material catalog changes
5. Run API watch-intelligence + clarification + AI suite tests

## Integration points

- `WatchInventoryResolver` — shared resolver
- `ClarificationFieldLockService.resolveWatch`
- `StructuredAssistantService` `REGISTER_SALE` (before customer resolver)
- `search_inventory` read tool (intelligence first, legacy contains fallback)

## Invariants preserved

- Exactly 12 WRITE bindings
- Composition V1 unchanged
- `REVERSE_EXPENSE` unbound
- No confirmation / planner economics / reversal changes
