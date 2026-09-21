# ADR 0008 — Provisional pricing

- Date: 2026-09-22
- Status: proposed (provisional — revisit at Pilot gate A)

## Context
PRODUCT.md's pilot success signal is "findings worth ≥ 2× the subscription per month", but no document stated a price, so the gate was unmeasurable. ROADMAP puts billing in Phase 10, roughly 6–8 months out. A provisional number is needed now so that (a) the 2× gate can be tested at Pilot gate A after Phase 2, and (b) per-org AI cost caps in Phase 3 have a margin to sit inside.

## Decision
Provisional list price, **per branch per month**:

| Plan | Price | Includes |
|---|---|---|
| **Starter** | **৳2,500** | POS, KDS, orders, cash, Health Monitor, item velocity, zero-input leaks (P1–P2) |
| **Growth** | **৳4,500** | Everything: recipes & menu profit, AI assistant + WhatsApp, purchasing, inventory & waste, leak detector v2, forecasting, customers & reviews |
| **Chain** (6+ branches) | **৳3,500/branch** | Growth + branch intelligence, benchmarking, transfer audit |

- **Pilot offer:** first 5 restaurants get **50% off Growth (৳2,250/branch/month), locked for 12 months**, billed from Pilot gate A.
- **The 2× gate, made concrete:** Growth at ৳4,500 requires Xedine to evidence **≥ ৳9,000/month** in findings per branch. For a restaurant turning over ৳12 lakh/month, 3% unexplained food-cost variance is ৳36,000 — so the gate should clear on a single over-portioning finding. If it doesn't clear on real pilot data, the product is wrong, not the price.
- Price is ~0.4% of monthly revenue for a ৳12 lakh/month restaurant. Cheap enough to decide quickly, high enough to fund the AI cost.

## Cost floor (why these numbers work)
Verified against Anthropic's current published rates (2026-09-22): Sonnet 5 $2/MTok in, $10/MTok out; Haiku 4.5 $1/$5; cached prefix reads ~10% of input rate; Message Batches 50% off.

Estimated variable cost, one single-branch org, moderate use:

| Item | Estimate |
|---|---|
| Assistant (~450 turns/mo, cached system prompt + tool defs) | ~$4.00 |
| Briefs & narratives (~64/mo via Batches) | ~$0.40 |
| Chit/photo extraction on Haiku (~60/mo) | ~$0.35 |
| **AI subtotal** | **~$4.75 ≈ ৳580** |
| WhatsApp templates (~64/mo) | ৳200–400 `TODO(verify)` — Meta's Bangladesh rates |
| **Total variable** | **≈ ৳800–1,000** |

Growth at ৳4,500 leaves roughly **75–80% gross margin** before shared infrastructure (~৳5,500/month total for Supabase Pro + Vercel Pro across all orgs). That margin is what makes the Phase 3 per-org daily AI cap a business decision rather than a survival one.

## Alternatives considered
- **Defer pricing to Phase 10** — matches the roadmap, but leaves the core product promise untestable for 6–8 months and gives the Phase 3 cost caps no anchor.
- **Undercut local POS vendors (~৳1,000–1,500/month)** — easier first sale, but prices Xedine as a POS. The POS is the cost of data capture, not the product; competing there wins the wrong customers and can't fund per-org LLM spend.
- **% of revenue** — aligns incentives beautifully and would be defensible given the value claim. Rejected for MVP: it requires owners to trust our revenue figure before they trust anything else, and it makes the price unpredictable for them.

## Consequences
- Easier: Pilot gate A becomes a real commercial test ~10 weeks in rather than ~30. Phase 3's AI caps have a margin to be set against.
- Harder: a published price invites negotiation before the product is complete. The 50%-for-12-months pilot lock is the intended answer, and it caps the downside at 5 restaurants.
- **Every figure here is provisional and Bangladesh-market-untested.** It is a number to test, not a number to defend.
- **Revisit at Pilot gate A** with: what did pilots actually say the price should be, what did findings actually total per branch-month, and what did AI cost actually come to in `ai_usage`. Supersede this ADR with a measured one.
