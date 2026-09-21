---
name: phase
description: Run one Xedine roadmap phase end to end (plan, build in slices, verify with evidence, review, update docs). Invoke as /phase <number>.
disable-model-invocation: true
---

# Run Xedine Phase $ARGUMENTS

1. Read CLAUDE.md, the "Phase $ARGUMENTS" section of docs/ROADMAP.md, and the docs it depends on (PRODUCT, ARCHITECTURE, METRICS, DATA-MODEL). Read the test-oracle section if this phase detects scenarios.
2. Check the previous phase's "Done when" boxes. If any are unticked, stop and tell me which.
3. Plan, no code yet: vertical slices in order; per slice: migrations, RLS, server modules, UI, tests. List open questions, risks, and what is out of scope. Ask me the open questions and wait for my approval.
4. Build one slice at a time. After each slice run typecheck, lint and that slice's tests. Fix root causes; never weaken tests or RLS.
5. Verify every "Done when" item with evidence: test names, command output, screenshots for UI.
6. Ask the phase-reviewer subagent to review this phase's diff. Fix Critical and Important items that affect correctness or the requirements; list the rest.
7. Update docs: tick ROADMAP boxes, update DATA-MODEL.md, add ADRs for decisions, keep CLAUDE.md "Commands" current.
8. End with: what was built, evidence, known gaps, suggested commit message. Do not start the next phase.
