# Agent handoff — clean slate (2026-11-13)

Read this first if you just pulled `main` on another laptop / Cursor agent.

## Where you are

Repo: `https://github.com/shauryaR790/GIMK.git` (remote name often `gimk` or `origin`).
Production site: `https://gimk.vercel.app` (Vercel project `gimk`).
Local workspace on the other machine may still be named `gymk` — same app.

**Pos a** = PetPooja (legacy tag/branch `pos-a-petpooja`). **Pos b** = current Odoo POS under `src/features/pos/odoo` (what production serves). Do not swap them.

## What just landed on `main`

Commit: **Clear POS operational data for production handover.**

1. **Clean slate data**
   - Demo members / bookings / sample cafe orders are **off by default**.
   - Opt in only with `SEED_DEMO=true` (see `.env.example`).
   - One-time seed mark `handover_clean_v1` wipes operational rows on boot when demo seed is off (members, orders, bookings, check-ins, join requests, campaigns, etc.).
   - Keeps catalog: staff users, facilities, plans, trainers, menu.
   - Manager/admin can also call `POST /api/gym/ops/reset`.
   - Local `data/habsos.db*` was wiped before ship; production Blob DB clears once via the same handover mark after this deploy.

2. **Production-safer POS UI**
   - Raw `o-track__error` page dumps removed from gym centre / comms / inventory / reporting.
   - Load failures go to **toasts**.
   - POS login no longer shows “Demo PIN” (PIN `2580` still works against seeded admin).
   - Public register “Use demo member” filler removed.

3. **Member door / register / login** (verified locally before push)
   - Flow: `/register` → pass cookie → `/in` (door QR) check-in → `/member` toast → `/login` with email+password.
   - Gate softens unknown failures; 401 still prompts Register once / Login.

## What we are about to do next

**User-side (member / public site) changes** — not started yet. Wait for the owner’s next instructions on the other Cursor agent. Do **not** invent a redesign until they say what to change.

Likely touch areas when they start: `src/features/site/*`, `src/features/member/*`, silk / home / member shell, register/login/gate copy and layout. POS clean slate should stay unless they ask otherwise.

## Quick run

```bash
git pull
npm install
npm run dev
```

- POS: `/pos` — PIN `2580` or admin email/password from `.env.example`.
- Door QR target: `/in`
- Do not set `SEED_DEMO=true` unless you intentionally want fake members back.

## Do not

- Re-seed demo people into production.
- Swap pos-a and pos-b deploys.
- Commit untracked Figma/icon dump PNGs / `bgjimk.mp4` unless the owner asks.
