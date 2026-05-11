# AI Market Radar — Backend Smoke Test Guide

Manual QA checklist for Phases 3A–3C: WhatsApp import ingestion, AI classification, and listings management API.

---

## Safety Rules

- **Never run `prisma migrate reset` against Neon or any production database.**
- **Do not use real customer WhatsApp exports in local tests.** The fixture below is synthetic.
- **Do not push commits during this session.** There are 5 local commits ahead of origin/main.
- All commands target `http://localhost:4000/api` (local dev only).

---

## 1. Prerequisites

| Requirement | Check |
|---|---|
| PostgreSQL running locally on port 55432 | `pg_isready -h localhost -p 55432` |
| Neon DB (if using cloud local) | connection string in `.env` |
| Migrations applied | `npx prisma migrate dev` |
| Seed catalog loaded | `npx prisma db seed` |
| API running | `cd apps/api && npm run start:dev` |
| Valid auth token | see §3 |
| `ANTHROPIC_API_KEY` set | required for classification steps only |

---

## 2. DB Setup

### Local PostgreSQL (Docker)

```bash
# Start local Postgres if using Docker
docker run -d \
  --name wristos-pg \
  -e POSTGRES_USER=wristos \
  -e POSTGRES_PASSWORD=wristos \
  -e POSTGRES_DB=wristos \
  -p 55432:5432 \
  postgres:16

# Set connection string in .env (root level)
echo 'DATABASE_URL="postgresql://wristos:wristos@localhost:55432/wristos"' >> .env
```

### Apply Migrations and Seed

```bash
# From repo root
npx prisma migrate dev --schema=./prisma/schema.prisma

# Seed WatchReference catalog (68 entries: Rolex, AP, Patek, Cartier, RM, Omega, Tudor)
npx prisma db seed
```

Expected seed output:
```
Seeded: { watchReferences: 68 }
```

---

## 3. Get Auth Token

The API uses email/password login returning a JWT.

```bash
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | jq -r '.accessToken')

echo "Token: $TOKEN"
```

Verify token works:

```bash
curl -s http://localhost:4000/api/auth/me \
  -H "Authorization: Bearer $TOKEN" | jq
```

Expected: `{ userId, email, tenantId, role }`

> If no user exists yet, create one via the admin UI or directly in the DB.
> The `tenantId` from `/auth/me` determines which tenant all radar data belongs to.

---

## 4. WhatsApp .txt Fixture

Save this as `/tmp/test-chat.txt`. It is a synthetic export covering all message categories.

```
[12/05/25, 9:01:00 AM] Carlos Relojes: Looking to sell my Rolex Pepsi GMT, full set, great condition. Asking $18,500. DM if interested!
[12/05/25, 9:03:15 AM] Marco Watches: WTB AP Royal Oak 15202ST Jumbo. Budget 80k. Anyone?
[12/05/25, 9:05:30 AM] Diego: Did you catch the game last night? Insane final quarter.
[12/05/25, 9:07:44 AM] Carlos Relojes: <Media omitted>
[12/05/25, 9:08:00 AM] Messages and calls are end-to-end encrypted. No one outside of this chat, not even WhatsApp, can read or listen to them.
[12/05/25, 9:10:22 AM] Sofia Luxury: Selling 126710BLRO full set, box papers 2024. Asking 22k EUR. Urgent, relocating.
[12/05/25, 9:12:00 AM] Pedro Deals: Heard the Daytona Panda is going for 35k now. Anyone confirm?
[12/05/25, 9:14:05 AM] Ana: Thanks for the info!
[12/05/25, 9:15:30 AM] Marco Watches: image omitted
```

**Expected classification outcomes:**

| Message | Intent | Notes |
|---|---|---|
| Carlos — Pepsi sell | `SELL_OFFER` | alias "Pepsi" → `watchReferenceId` set, `INFERRED` |
| Marco — AP Jumbo WTB | `BUY_REQUEST` | alias "Jumbo" → `watchReferenceId` set, `INFERRED` |
| Diego — game | `IRRELEVANT` | no listing created |
| Carlos — media | skipped at ingestion | `SKIPPED_MEDIA`, no AI call |
| System message | skipped at ingestion | `SKIPPED_SYSTEM`, no AI call |
| Sofia — 126710BLRO | `SELL_OFFER` | ref number explicit → `referenceNumberExplicit` set, `EXPLICIT` |
| Pedro — Panda price | `PRICE_SIGNAL` | alias "Panda" → `INFERRED` |
| Ana — thanks | `IRRELEVANT` or pre-filtered | no listing created |
| Marco — image | skipped at ingestion | `SKIPPED_MEDIA` |

---

## 5. Smoke Test Commands

Replace `$TOKEN`, `$IMPORT_ID`, `$LISTING_ID`, `$CONTACT_ID` with actual values from each response.

---

### Step 1 — Upload WhatsApp Export

```bash
curl -s -X POST http://localhost:4000/api/radar/imports \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-chat.txt" \
  | jq
```

**Expected response:**
```json
{
  "importId": "clxxx...",
  "status": "COMPLETED",
  "sourceGroupName": "test-chat",
  "totalMessagesParsed": 9,
  "validMessagesStored": 6,
  "systemMessagesSkipped": 1,
  "mediaMessagesSkipped": 2,
  "duplicatesSkipped": 0,
  "parseErrors": 0,
  "uniqueSenders": 5,
  "listingsCreated": 4,
  "classified": 4,
  "skippedPrefilter": 2,
  "classificationFailed": 0
}
```

> The exact counts depend on AI classification. `listingsCreated` should be 3–4 (IRRELEVANT messages produce no listing).

Save import ID:
```bash
IMPORT_ID="clxxx..."
```

---

### Step 2 — Get Import Status

```bash
curl -s http://localhost:4000/api/radar/imports/$IMPORT_ID \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

**Check:** `status` is `COMPLETED` or `PARTIAL`. If `PARTIAL`, some messages failed classification — use Step 3 to retry.

---

### Step 3 — Retry Classification (if needed)

```bash
curl -s -X POST http://localhost:4000/api/radar/imports/$IMPORT_ID/classify \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

**Check:**
- `classificationFailed` should decrease or reach 0
- Re-running on a fully classified import is a safe no-op (returns current summary)
- No duplicate listings are created (idempotency via `messageId` uniqueness)

---

### Step 4 — List Listings (default filter)

```bash
curl -s "http://localhost:4000/api/radar/listings" \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

**Check:**
- `DISMISSED` listings are excluded by default
- Raw message `content` field is NOT present in any listing card
- `aiRawResponse` is NOT present in any listing
- Each card has: `id`, `intent`, `brand`, `rawModelMention`, `feedConfidence`, `contact`, `message.importId`

---

### Step 4a — List with filters

```bash
# Filter by intent
curl -s "http://localhost:4000/api/radar/listings?intent=SELL_OFFER" \
  -H "Authorization: Bearer $TOKEN" | jq '.listings | length'

# Filter by brand
curl -s "http://localhost:4000/api/radar/listings?brand=Rolex" \
  -H "Authorization: Bearer $TOKEN" | jq '.listings[].brand'

# Search by keyword
curl -s "http://localhost:4000/api/radar/listings?q=Pepsi" \
  -H "Authorization: Bearer $TOKEN" | jq '.listings[].rawModelMention'

# Sort by confidence
curl -s "http://localhost:4000/api/radar/listings?sort=confidence&limit=5" \
  -H "Authorization: Bearer $TOKEN" | jq '.listings[].feedConfidence'

# Price range
curl -s "http://localhost:4000/api/radar/listings?priceMin=10000&priceMax=25000" \
  -H "Authorization: Bearer $TOKEN" | jq

# Invalid date — should return 400, not 500
curl -s "http://localhost:4000/api/radar/listings?dateFrom=not-a-date" \
  -H "Authorization: Bearer $TOKEN" | jq '.statusCode'
# Expected: 400
```

Save a listing ID for subsequent steps:
```bash
LISTING_ID=$(curl -s "http://localhost:4000/api/radar/listings" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.listings[0].id')
echo "LISTING_ID=$LISTING_ID"
```

---

### Step 5 — Review Queue

```bash
curl -s "http://localhost:4000/api/radar/listings/review" \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

**Check:**
- Only `PENDING_REVIEW` listings appear
- Sorted by `feedConfidence` descending (highest-confidence first)
- `message.content` IS present (detail-level response — acceptable for review UI)
- `aiRawResponse` is NOT present
- Bad pagination falls back to defaults, not 500:

```bash
# Invalid pagination — should not 500
curl -s "http://localhost:4000/api/radar/listings/review?page=abc&limit=xyz" \
  -H "Authorization: Bearer $TOKEN" | jq '.listings | length'
# Expected: valid response, default page=1 limit=10
```

---

### Step 6 — Listing Detail

```bash
curl -s "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq
```

**Check:**
- `message.content` IS present (raw body exposed only at detail level)
- `message.senderRaw` IS present
- `message.import.sourceGroupName` IS present
- `aiRawResponse` is NOT a key anywhere in the response
- `watchReference` is present if normalization matched (Pepsi → 126610LV)
- `referenceSource` is `EXPLICIT` for the 126710BLRO message, `INFERRED` for alias matches
- Cross-tenant access returns 404:

```bash
# Tampered ID — should 404, not leak data
curl -s "http://localhost:4000/api/radar/listings/clFAKEID000000000000000000" \
  -H "Authorization: Bearer $TOKEN" | jq '.statusCode'
# Expected: 404
```

---

### Step 7 — PATCH Editable Fields

```bash
curl -s -X PATCH "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dealerNotes":"Verified seller, good history","conditionNotes":"Mint condition, worn twice"}' \
  | jq '.dealerNotes'
# Expected: "Verified seller, good history"
```

**Check immutable field rejection:**

```bash
# Attempt to set tenantId — must be rejected with 400
curl -s -X PATCH "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"hacker","brand":"Fake"}' \
  | jq '.statusCode'
# Expected: 400

# Attempt to set confirmedBy — must be rejected with 400
curl -s -X PATCH "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirmedBy":"hacker"}' \
  | jq '.statusCode'
# Expected: 400

# Attempt to set aiRawResponse — must be rejected with 400
curl -s -X PATCH "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"aiRawResponse":{"intent":"SELL_OFFER"}}' \
  | jq '.statusCode'
# Expected: 400
```

**Check watchReferenceId validation:**

```bash
# Non-existent watchReferenceId — must return 400
curl -s -X PATCH "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"watchReferenceId":"clFAKEREF000000000000000"}' \
  | jq '.statusCode'
# Expected: 400
```

---

### Step 8 — Confirm Listing

```bash
curl -s -X POST "http://localhost:4000/api/radar/listings/$LISTING_ID/confirm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dealerNotes":"Confirmed by senior dealer"}' \
  | jq '{reviewStatus, confirmedAt, confirmedBy, dismissedAt, dismissedBy}'
```

**Expected:**
```json
{
  "reviewStatus": "CONFIRMED",
  "confirmedAt": "<timestamp>",
  "confirmedBy": "<your userId from /auth/me>",
  "dismissedAt": null,
  "dismissedBy": null
}
```

**Check:** `confirmedBy` must equal the `userId` from `GET /auth/me`, never a value from the request body.

---

### Step 9 — Dismiss Listing

```bash
# Use a different listing ID for dismiss test, or re-use same one
curl -s -X POST "http://localhost:4000/api/radar/listings/$LISTING_ID/dismiss" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"reason":"Duplicate listing, already handled"}' \
  | jq
```

**Expected:**
```json
{
  "id": "...",
  "reviewStatus": "DISMISSED",
  "dismissedAt": "<timestamp>"
}
```

**Check `dealerNotes` accumulation:**

```bash
curl -s "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.dealerNotes'
# Expected: contains "Dismissed: Duplicate listing, already handled"
```

**Check dismissed listing is excluded from default list:**

```bash
curl -s "http://localhost:4000/api/radar/listings" \
  -H "Authorization: Bearer $TOKEN" \
  | jq "[.listings[] | select(.id == \"$LISTING_ID\")] | length"
# Expected: 0 (DISMISSED excluded by default)

# Explicitly include dismissed
curl -s "http://localhost:4000/api/radar/listings?reviewStatus=DISMISSED" \
  -H "Authorization: Bearer $TOKEN" \
  | jq "[.listings[] | select(.id == \"$LISTING_ID\")] | length"
# Expected: 1
```

**Check confirm after dismiss clears dismissal fields:**

```bash
curl -s -X POST "http://localhost:4000/api/radar/listings/$LISTING_ID/confirm" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '{reviewStatus, dismissedAt, dismissedBy}'
# Expected: { reviewStatus: "CONFIRMED", dismissedAt: null, dismissedBy: null }
```

---

### Step 10 — WatchReference Search

```bash
# Search by alias
curl -s "http://localhost:4000/api/radar/references?q=pepsi" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[].reference'
# Expected: "126710BLRO"

# Search by model
curl -s "http://localhost:4000/api/radar/references?q=submariner" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | {brand, model, reference}]'

# Filter by brand
curl -s "http://localhost:4000/api/radar/references?brand=Rolex&limit=5" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '.[].brand'

# Confirm limit is respected
curl -s "http://localhost:4000/api/radar/references?limit=200" \
  -H "Authorization: Bearer $TOKEN" \
  | jq 'length'
# Expected: <= 50 (max enforced server-side)
```

---

### Step 11 — Contact Profile

Get a contact ID from a listing:

```bash
CONTACT_ID=$(curl -s "http://localhost:4000/api/radar/listings/$LISTING_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq -r '.contact.id')
echo "CONTACT_ID=$CONTACT_ID"
```

```bash
curl -s "http://localhost:4000/api/radar/contacts/$CONTACT_ID" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{id, displayName, listingCount, messageCount, firstSeenAt, lastSeenAt}'
```

**Check:**
- `listingCount` >= 1
- `recentListings` contains SELL_OFFER and PRICE_SIGNAL listings for this contact
- `recentRequests` contains BUY_REQUEST listings
- No `aiRawResponse` in nested listings
- Cross-tenant access returns 404:

```bash
curl -s "http://localhost:4000/api/radar/contacts/clFAKECONTACT00000000000" \
  -H "Authorization: Bearer $TOKEN" | jq '.statusCode'
# Expected: 404
```

---

## 6. Expected Results Summary

| Scenario | Expected |
|---|---|
| Import completes | `status: COMPLETED` or `PARTIAL` |
| System message | `SKIPPED_SYSTEM`, no listing |
| Media placeholder | `SKIPPED_MEDIA`, no listing |
| Irrelevant chatter | `SKIPPED_PREFILTER` or `IRRELEVANT` from AI, no listing |
| "Pepsi" alias | Listing with `watchReferenceId` set, `referenceSource: INFERRED` |
| "126710BLRO" explicit | Listing with `referenceNumberExplicit: "126710BLRO"`, `referenceSource: EXPLICIT` |
| Retry classify | Same listing count, no duplicates |
| List endpoint | No `content` field, no `aiRawResponse` |
| Detail endpoint | `message.content` present, no `aiRawResponse` |
| PATCH immutable field | HTTP 400 |
| PATCH with valid fields | Updated listing returned |
| Confirm | `reviewStatus: CONFIRMED`, `confirmedBy: <userId>`, dismissal cleared |
| Dismiss | `reviewStatus: DISMISSED`, reason appended to `dealerNotes` |
| Cross-tenant ID | HTTP 404 |
| Invalid date filter | HTTP 400 |
| Invalid page param | Defaults used, no 500 |

---

## 7. Troubleshooting

### DB unreachable
```
Error: Can't reach database server at localhost:55432
```
- Check Docker: `docker ps | grep wristos-pg`
- Restart: `docker start wristos-pg`
- Check `.env` at repo root contains correct `DATABASE_URL`

### Seed fails — duplicate key or auth conflict
```
Unique constraint failed on the fields: (`brand`,`model`,`reference`)
```
- Seed is idempotent via upsert — this should not happen. If it does, check that `prisma/seed.ts` imports `seedWatchReferences` correctly.
- If seed fails on auth/user data, check that the auth user seed is separate from the watch reference seed.

### `ANTHROPIC_API_KEY` missing
```
Classification failed for message clxxx: AuthenticationError: No API key provided
```
- Set key in `.env`: `ANTHROPIC_API_KEY=sk-ant-...`
- Restart the API after updating `.env`
- All messages will be marked `FAILED`; use the retry endpoint once the key is configured

### No listings created after import
- Check `classificationFailed` count in import summary
- Check API logs for `RadarClassifierService` error output
- Verify `ANTHROPIC_API_KEY` is set and valid
- Check that the `.txt` file contains parseable WhatsApp format (bracket or dash timestamp)
- Run `POST /api/radar/imports/:id/classify` to retry

### `401 Unauthorized`
- Token expired — re-login: `POST /api/auth/login`
- Token not in `Authorization: Bearer <token>` format
- Confirm `GET /api/auth/me` works before attempting radar endpoints

### `400 Bad Request` on import
- File must be `.txt` extension
- File must not be empty
- Form field must be named `file` (`-F "file=@..."`)
- Only multipart/form-data accepted — do not use `-H "Content-Type: application/json"` on import

### `500` on listing queries
- If `?dateFrom=<invalid>` returns 500, check that `@IsDateString()` is applied in `SearchListingsDto` (Phase 3C fix)
- If review queue `?page=abc` returns 500, check the NaN guard in `radar-listings.controller.ts` (Phase 3C fix)
- Otherwise check API logs for Prisma errors — usually a missing relation or invalid ID format

### Listings created but `watchReferenceId` is null
- The AI did not produce a matching extraction, or the alias is not in the seed catalog
- Check `rawModelMention` in listing detail — if it says "Pepsi" but no match, verify seed was run
- Run `GET /api/radar/references?q=pepsi` — if empty, seed did not complete
- Check `referenceSource` — `null` means normalizer found no match

---

## 8. Full Session Example

```bash
# 1. Auth
TOKEN=$(curl -s -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"your@email.com","password":"yourpassword"}' \
  | jq -r '.accessToken')

# 2. Import
IMPORT_ID=$(curl -s -X POST http://localhost:4000/api/radar/imports \
  -H "Authorization: Bearer $TOKEN" \
  -F "file=@/tmp/test-chat.txt" \
  | jq -r '.importId')

# 3. Check status
curl -s http://localhost:4000/api/radar/imports/$IMPORT_ID \
  -H "Authorization: Bearer $TOKEN" | jq '{status, listingsCreated, classificationFailed}'

# 4. Retry if needed
curl -s -X POST http://localhost:4000/api/radar/imports/$IMPORT_ID/classify \
  -H "Authorization: Bearer $TOKEN" | jq '{status, classificationFailed}'

# 5. First listing
LISTING_ID=$(curl -s http://localhost:4000/api/radar/listings \
  -H "Authorization: Bearer $TOKEN" | jq -r '.listings[0].id')

# 6. Detail
curl -s http://localhost:4000/api/radar/listings/$LISTING_ID \
  -H "Authorization: Bearer $TOKEN" | jq '{id, intent, referenceSource, watchReferenceId}'

# 7. Confirm
curl -s -X POST http://localhost:4000/api/radar/listings/$LISTING_ID/confirm \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' | jq '{reviewStatus, confirmedBy}'

# 8. Contact
CONTACT_ID=$(curl -s http://localhost:4000/api/radar/listings/$LISTING_ID \
  -H "Authorization: Bearer $TOKEN" | jq -r '.contact.id')
curl -s http://localhost:4000/api/radar/contacts/$CONTACT_ID \
  -H "Authorization: Bearer $TOKEN" | jq '{displayName, listingCount, messageCount}'
```

---

## 9. What Is Not Tested Here

- Frontend UI (Phase 4+)
- Live WhatsApp API integration (not in scope)
- Multi-tenant isolation beyond cross-tenant 404 checks
- Performance at scale (>10k listings)
- Production Railway deployment
