# Xedine — Claude Code Starter Kit

The bones of Xedine: product spec, architecture, metric definitions, phased roadmap, and Claude Code config.
Brand is a placeholder on purpose: docs/BRAND.md gets filled when you share your guideline + logo.

## What's inside
```
xedine/
├── README-START-HERE.md          ← for you (Claude doesn't need it)
├── CLAUDE.md                     ← auto-loaded by Claude Code every session
├── docs/
│   ├── PRODUCT.md                ← modules M1–M18, principles, Bangladesh context
│   ├── ARCHITECTURE.md           ← stack, tenancy, AI layer, jobs, offline POS
│   ├── METRICS.md                ← single source of truth for every number
│   ├── ROADMAP.md                ← Phase 0–10 + "Done when" + planted-leak test oracle
│   ├── BRAND.md                  ← placeholder until guideline + logo arrive
│   ├── DATA-MODEL.md             ← Claude keeps this updated
│   └── decisions/                ← short decision records (ADRs)
└── .claude/                      ← hidden folder — make sure it gets copied
    ├── skills/phase/SKILL.md     ← /phase N runs a whole phase
    └── agents/phase-reviewer.md  ← fresh-eyes review at the end of each phase
```

## One-time setup
1. Install Git, Node.js LTS, pnpm, Docker Desktop (for local Supabase), VS Code + the Claude Code extension; sign in.
2. Accounts, only when needed: GitHub + Supabase (Phase 0) · Anthropic API key for the app's AI (Phase 3) · Vercel (deploy any time) · Meta WhatsApp Cloud API (Phase 4) · Bangladeshi SMS gateway (Phase 8).
3. Make an empty `xedine` folder, run `git init`, copy everything from this kit in (including `.claude`), commit.
4. Open the folder in VS Code, open any file, click the Spark icon (top-right of the editor) to open Claude Code.

## Step 1 — kickoff prompt (paste once)
```
You're the senior engineer on Xedine. Read CLAUDE.md and every file in docs/ first. Don't write any code yet.

1. Summarise Xedine and the 11 phases back to me in 15 bullets or fewer so I can confirm you understood.
2. List anything unclear, contradictory, risky or missing in the docs.
3. Interview me with the AskUserQuestion tool about decisions needed before Phase 0 (Supabase local vs cloud, auth method, hosting, versions, repo/CI setup, anything else). Don't ask what the docs already answer.
4. After I answer: record decisions as ADRs in docs/decisions/, update the docs where needed, and stop.

We'll start Phase 0 in a new conversation with /phase 0.
```

## Step 2 — every phase
1. Start a NEW conversation for each phase.
2. Type `/phase 0` (then 1, 2 …). If the command doesn't show up, paste:
   `Execute Phase 0 of docs/ROADMAP.md following .claude/skills/phase/SKILL.md.`
3. Click the mode indicator (bottom of the prompt box) → Plan. Review the plan document, comment, approve.
4. Let it build. Answer its questions. Don't let it skip tests.
5. Check the phase's "Done when" list yourself, then commit.
6. If something goes wrong: hover a message → Rewind.

## Save your usage limit
- One phase per conversation. Start fresh between phases.
- Build on Sonnet; switch to Opus only for hard design decisions.
- Run `/usage` to see what is eating your limit.
- During active work, reply within a few minutes — when the clock icon next to the context indicator turns red, the cache expired and the next message costs more.
- Corrected the same mistake twice? Start a new conversation with a better prompt.
- Big phases (1 and 5): ask for 1–2 slices per session. Progress lives in the ROADMAP checkboxes, so nothing is lost between sessions.

## Parallel track (don't skip)
While Phases 0–1 are being built, run a manual "leak audit" with 3–5 restaurants (one month of sales, purchases, one stock count, in a spreadsheet). It validates the leak thresholds and gives you pilot customers. Pilot gates are marked in ROADMAP.md.

## When your brand is ready
Send the guideline + logo → BRAND.md gets filled → then prompt Claude Code:
`Apply docs/BRAND.md across the app: update design tokens only, no layout rewrites. Screenshot key screens and compare.`
