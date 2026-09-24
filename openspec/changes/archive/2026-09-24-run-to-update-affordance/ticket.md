# HEL-1096: "Run to update" affordance when the gate denies

## Description

A pipeline that fails the cheapness verdict must not silently do nothing. Surface why ("this pipeline calls AI" / "too many rows") and offer a manual run.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627), Epic 4 "Write → run → refresh loop":

> **Auto-run.** A dataset write whose downstream pipelines all pass the verdict schedules a debounced run. Failing pipelines surface a "run to update" affordance instead.

Epic: HEL-1091 (v0.8 Interactive Data & Write-Back). Blocked by (and builds on): HEL-1092 (cheapness verdict).

## Acceptance Criteria

- The reason shown names the specific rule that denied (e.g. "this pipeline calls AI" / "too many rows"), not a generic message — one line of copy per `CostReason.code` the estimator can produce, including the deny-by-default codes (`unclassified-op`, `unclassified-source`).
- A pipeline that fails the verdict on a dataset write offers a manual "Run to update" action instead of silently doing nothing.
- Triggering that action goes through the existing `POST /api/pipelines/:id/run`, respecting its existing authorization (owner or editor grantee only) and existing run guards (HEL-505 rate limit / concurrency cap, 429 + Retry-After) — a guard rejection gets its own clear message, distinct from a gate-denial message.
- A successful manual run refreshes bound panels via the existing SSE fan-out (HEL-1094/1168) — no new refresh mechanism.
- a11y: the reason and the action are announced and associated (computed ARIA, not just DOM presence). Matches DESIGN.md in both themes.
- The AC's specific-rule copy is provably load-bearing: removing the rule→copy mapping (or any one entry in it) must fail a test, not merely reduce coverage.

## Standing Constraints (carried from the driver brief — see tasks.md `## Standing Constraints` for the promoted/bulleted form)

- a11y: reason + action announced and associated; assert COMPUTED ARIA; compare against the RUNNING app in both themes (DESIGN.md binding).
- Show the red: the specific-rule copy test must fail when the rule→copy mapping is removed (mutation-provable).
- Models: SONNET on all roles (orchestrator/executor/evaluator/skeptic/auditor) — no promotion regardless of budget/escalation outcome.
- ONE LANE: no concurrent delivery lane against this repo for the duration of this run.
- Migration ledger: V110 is the highest applied migration as of Setup; V111 is the next free number if this ticket needs a migration (verify fresh at Execution — do not trust this as of Setup once Execution begins, per `check-schema-drift`/Flyway's own ordering).
- Every `- [Cn]` constraint promoted into `workflow-state.md`'s `CONSTRAINTS` must ALSO get a matching bullet under tasks.md's `## Standing Constraints` heading, or `check-constraints-carryover.sh` blocks Delivery.
- Every `git commit` inside the worktree: Bash `timeout: 600000`; never re-run a commit while one is in flight; never `git add -A`.
- Budget exhaustion on any gate (evaluator cycles, skeptic design/final rounds, debug attempts) is a mandatory escalation to the human — never a self-approval.
- Follow-ups filed from this ticket: `origin_kind: followup`, `origin_ticket: HEL-1096`, `relatedTo: ["HEL-1096"]`, `Follow-up` label, and `project: 28f119e2-5738-46b1-a53b-42f73e06b053` (v0.8 project).
- Do not change epic HEL-1091's own state (this ticket is a child of it, not the epic itself).
