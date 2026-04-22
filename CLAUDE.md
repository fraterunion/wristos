# WristOS — Project Context for Claude Code

## What this project is
WristOS is a Luxury Watch Dealer Operating System for Frater Union. The production tenant is **Wrist Caviar** (wristcaviar.fraterunion.com).

## Monorepo structure
```
apps/
  api/      → NestJS backend (Railway)
  admin/    → Next.js App Router frontend (Vercel)
prisma/     → Schema and migrations (root level)
docs/prompts/ → System prompts for AI agent roles
```

## Stack
- **Backend**: NestJS + Prisma + PostgreSQL (Neon)
- **Frontend**: Next.js App Router + Tailwind CSS
- **DB**: Neon PostgreSQL
- **Frontend hosting**: Vercel (auto-deploys on merge to main)
- **Backend hosting**: Railway (auto-deploys on merge to main)

## Production URLs
- Frontend: https://wristcaviar.fraterunion.com
- Backend: https://wristos-api-prod-production.up.railway.app
- Frontend env var: `NEXT_PUBLIC_API_BASE_URL=https://wristos-api-prod-production.up.railway.app/api`

## Critical rules for all agents
- **Never work directly on `main`** — always create a branch first (`feature/`, `fix/`, `chore/`, `db/`)
- **Prisma migrations are manual in production** — `prisma migrate deploy` must be run manually after merging schema changes; Railway deploys code only
- **TypeScript build verification required before merging backend changes**: `npx tsc -p apps/api/tsconfig.build.json`
- **Backend has no staging environment** — Railway is single production; backend changes carry real risk
- **Frontend local validation required** before any PR: run `npm run dev` in `apps/admin` and verify affected pages

## Change classification (use when planning work)
- **TYPE A** — Frontend only (`apps/admin` only, no Prisma change) → Low risk
- **TYPE B** — Backend only (`apps/api`, no Prisma change) → Medium risk
- **TYPE C** — Prisma/DB change → High risk, always treat with extra care

## Automatic git workflow (do this after every change)

After implementing any change, always complete this workflow automatically without being asked:

### 1. Check current branch
```bash
git branch --show-current
```
- If on `main` → create a new branch before touching any file (`git checkout -b feature/<short-description>`)
- If already on a feature branch → continue on it

### 2. Run the right verification for the change type
- **TYPE A (frontend)**: `cd apps/admin && npx tsc --noEmit` — fix any type errors before committing
- **TYPE B (backend)**: `npx tsc -p apps/api/tsconfig.build.json` — must pass with zero errors
- **TYPE C (Prisma)**: stop and tell the user — do NOT auto-push DB changes, they need manual migration steps

### 3. Commit only the changed files (never `git add .`)
```bash
git add <specific files changed>
git commit -m "<type>: <what changed and why>"
```

### 4. Push the branch
```bash
git push -u origin <branch-name>
```

### 5. Report back with
- What branch was pushed
- The Vercel preview URL pattern: `https://<branch-slug>.wristos-admin.vercel.app` (Vercel generates this automatically within ~1 min)
- Whether this is ready to merge to main or needs review first
- If TYPE B: warn that merging to main auto-deploys the backend to Railway

### Rules
- Never push directly to `main`
- Never use `git add -A` or `git add .`
- Never skip the TypeScript check for backend changes
- For TYPE C changes: implement and commit locally, then STOP and explain the manual migration steps the user must run

## API modules
`analytics`, `automations`, `core`, `crm`, `deals`, `inventory`, `matching`, `payments`

## Frontend pages
`login`, `dashboard`, `automations`, `crm`, `deals`, `inventory`, `matching`

## Build commands
```bash
# Backend build check
npx tsc -p apps/api/tsconfig.build.json

# Frontend dev server
cd apps/admin && npm run dev

# DB migration (local)
npx prisma migrate dev --name <migration_name>

# DB migration (production — manual only)
npx prisma migrate deploy --schema=./prisma/schema.prisma
```
