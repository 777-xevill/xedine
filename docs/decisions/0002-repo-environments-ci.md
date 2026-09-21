# ADR 0002 — Repo layout, environments and CI

- Date: 2026-09-22
- Status: accepted

## Context
The kit arrived as a zip inside `E:\xedine.org\files (4)\`. The repo needed a permanent home, and Phase 0 needs to know which Supabase environments exist before writing migrations. `E:\xedine.org` already held `Brand_assets\`, and the folder name matches the product domain.

## Decision
- **Repo root: `E:\xedine.org`.** Kit files (`CLAUDE.md`, `docs/`, `.claude/`, `README-START-HERE.md`) sit at the root alongside `Brand_assets/`, which is tracked in the repo.
- **Git:** local repo with a private GitHub remote. CI via GitHub Actions (typecheck, lint, unit, DB tests incl. RLS isolation).
- **Supabase environments:** local Supabase CLI + Docker for day-to-day development, plus **one free cloud project** used as `dev` — for hosted Realtime, WhatsApp webhook callbacks, and demo URLs. Migrations are authored locally and pushed to `dev`.
- **Production Supabase project is created at Pilot gate A**, on a paid tier (PITR backups, no idle pausing), before any real restaurant's data enters the system.
- `files (4)\` and `files (4).zip` remain as the original archive and are gitignored.

## Alternatives considered
- **Fresh `E:\Xedine` folder** — clean, but orphans the brand assets and the domain-matching folder name.
- **Codebase in an `app/` subfolder** — keeps business material separate from code, but adds a path level to every command and every tool config for no present benefit.
- **Local Docker only, no cloud project until gate A** — cheapest, but WhatsApp webhooks (P4) and hosted Realtime (P1) cannot be exercised, and there is no demo URL for pilot recruitment.
- **Supabase Pro from day one (~$25/mo)** — safest, but pays for production guarantees months before production data exists.

## Consequences
- Easier: one folder holds code, docs and brand; migrations get tested against real Supabase infra before a customer sees them.
- Harder: the free `dev` project **pauses after ~7 days of inactivity** (the exact failure already recorded against Thala). Treat `dev` as disposable — everything must be reproducible from `supabase/migrations` + `supabase/seed` with one command. Never let `dev` become the only copy of anything.
- **Revisit at Pilot gate A:** create the paid production project, and decide whether `dev` also moves to paid or stays free.
