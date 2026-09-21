# ADR 0010 — External API approvals handled at their own phases

- Date: 2026-09-22
- Status: accepted (with a recorded risk)

## Context
Three third parties must grant access before parts of Xedine can function, and two of them involve manual review with no guaranteed timeline or outcome:

| Dependency | Needed by | Lead time |
|---|---|---|
| Meta / WhatsApp Cloud API — business verification + per-template approval | **Phase 4** (the entire WhatsApp rhythm: briefs, alerts, approvals by reply) | Weeks; can be refused |
| Google Business Profile API — access approval | **Phase 8** (automated review import) | Weeks; manual review, no guaranteed outcome |
| Anthropic API key + billing | **Phase 3** (LLM gateway) | Minutes |

Applying during Phase 0 would overlap the waiting with Phases 0–3 at no cost to build velocity.

## Decision
**Each approval is applied for at the start of the phase that needs it**, not in Phase 0. Phase 0 stays focused on code.

## Alternatives considered
- **Apply for all three in Phase 0** — the risk-minimising choice, and the one I recommended: the waiting would be free, overlapping work already scheduled. Not chosen; the founder prefers not to open third-party processes this early.
- **Meta + Anthropic now, Google later** — partial hedge covering the two nearest dependencies.

## Consequences
- Easier: Phase 0 has no external dependencies, no accounts to manage, and no verification paperwork competing with build time.
- **Risk accepted — Phase 4 may stall.** WhatsApp is not a nice-to-have in Phase 4; it is most of the phase ("WhatsApp-first for owners" is product principle #6). If verification takes three weeks and starts when Phase 4 starts, Phase 4 stalls for three weeks with no fallback, immediately after Pilot gate B has promised pilots their briefs.
- **Risk accepted — Phase 8 review import may never be approved.** Google can refuse. PRODUCT.md already hedges with paste-in reviews for Facebook/foodpanda, so Phase 8 should treat Google import as optional from the start and not gate any "Done when" item on it.
- Mitigations to carry forward, since the lead times are unchanged by this decision:
  - **Build Phase 4's messaging gateway behind an interface with a mock transport**, so briefs, outbox, retries and delivery status are all testable and demonstrable before Meta approves anything. Only the final hop waits.
  - **Start the Meta application at the beginning of Phase 3, not Phase 4** — one phase of overlap costs nothing and removes most of the exposure. Noted as the first item of Phase 3 rather than a separate decision.
  - Get the Anthropic key with a spend limit set before Phase 3 begins; it takes minutes and blocks the whole phase if missing.
- **Revisit at the start of Phase 3**, when the real cost of a Phase 4 stall is closer and easier to judge.
