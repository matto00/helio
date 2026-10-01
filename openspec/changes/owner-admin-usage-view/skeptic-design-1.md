## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket.md, proposal, design, tasks, spec delta.
- V113 (db/migration/V113__product_events.sql): rollup tables carry no RLS; its header says the app-pool role owns them and helio_privileged gets explicit GRANTs. So design Decision 2's "app pool can SELECT as owner, no V114" is plausible, but the design correctly leaves it to be proven under a non-BYPASSRLS role.
- TIER_FORBIDDEN exists in TierErrorCompletion.scala, but it is typed to ChatAccessError (chat/AI-specific). Reuse needs a small adapter; see note.
- Tier source: users.tier / UserTier.Owner exist server-side; frontend user.tier exists (features/auth/types/user.ts).
- ProductEventRepository exposes rollupDay / tickAt, so the real-rollup seeded test (C1) is feasible.
- Every AC maps to a task (403 red-first 1.1; exact numbers 1.5; both themes 2.4/3.2; non-BYPASSRLS 1.6).

### Verdict: REFUTE

### Change Requests
1. Missing contract delta. The repo treats schemas/ (JSON Schema) and openspec as the API contract source of truth, with a schema-drift pre-commit check. No task adds a response schema (e.g. schemas/admin/usage-response.schema.json), JsonProtocols formatters, or an OpenAPI entry for GET /api/admin/usage. Add a task (and a design line) defining the response shape: per-day arrays of signups, ttfd {day, sampleCount, medianSeconds, p90Seconds}, funnel, templates incl. `other`, provenanceOpens, dau/wau (nullable wau), rolledThrough (nullable date).
2. Ambiguity on `days`: "1..90, default 30" does not say whether out-of-range or non-numeric values return 400 or are clamped. Pick one and add a test scenario.
3. Ambiguity on funnel/empty states: specify the response when the rollup tables are empty or rolled_through is null (200 with empty arrays and null rolledThrough, and the page's empty state), and say whether zero-count days are filled in or omitted (this drives the chart gaps and the WAU-null "gap, not 0" rule).
4. TIER_FORBIDDEN reuse: completeTierError takes ChatAccessError, so say explicitly how the owner gate yields the same wire shape (e.g. call it with ChatAccessError.TierForbidden or extract a shared helper). Otherwise the executor may invent a new shape, which Decision 1 forbids.
5. Task 1.2 should state the pool choice as an explicit decision (design says "executor MUST determine"). Add acceptance wording: design.md is updated before 1.6 is ticked, with the evidence from the non-superuser test.

### Non-blocking notes
- Decision 3's by-event-day funnel caveat should also appear on the page as a label (a funnel can show >100% conversion across days).
- 1.1 "red-first on main": since the route is absent on main, the test would 404, not 403; state that the red is 404/absent and the green is 403.
