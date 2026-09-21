# Xedine — Data Model (living)

Claude Code updates this file whenever a migration adds or changes tables.

Format per table:
**name** — purpose · key columns · tenant scope (org / branch) · RLS policy summary · indexes · written by (module) · added in phase

Constraints already decided (see `decisions/`): every tenant table carries `org_id` (+ `branch_id` where relevant) with RLS via helper functions; money is `bigint` poisha; order lines store the full VAT decomposition (ADR 0005); cost/margin columns are gated by `can_see_money(org)` (ADR 0007). Phase 0 migrates the full core schema (ADR 0006), so this file should be complete for core tables by the end of Phase 0 even where no feature reads them yet.

_(empty until Phase 0)_
