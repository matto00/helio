## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `f0dfc8a73153883904c191cc203d1039ccb46ee2`.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=bug/dedupe-dashboard-list-duplicate/HEL-1119`.
- **Artifacts read in full:** `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/frontend-dashboard-creation/spec.md`, plus `.concertino/laws/systematic-debugging.md`.
- **The plan genuinely gates the fix behind a probe (the assignment's central question).** This is not
  boilerplate: tasks are ordered `1. Probe (root cause, before any fix)` → `2. Fix` → `3. Regression
  guard`, task 1.1 requires the probe go **RED against today's code** and names that as "the AC1
  evidence, not an inference", and task 1.2 pre-authorizes a **pivot** if the reducer-race hypothesis
  is refuted. design.md Decision 1 says the probe "must go red ... before any fix lands" and
  explicitly instructs *not* to force "the slice narrative to fit"; the Risks section states "the
  probe governs, not this document." Critically, the plan **does not assume the ticket's stated
  hypothesis** — design.md Context actively argues the ticket's narrated race is *not* obviously
  mechanical and offers a competing double-POST hypothesis. That is the correct posture under the law.
- **Premise claims checked against real code, not the narrative** (`frontend/src/features/dashboards/state/dashboardsSlice.ts`):
  - L291-292 `createDashboard.fulfilled` → `state.items.push(action.payload)` — append, no de-dupe. Confirmed.
  - L259-260 `fetchDashboards.fulfilled` → `state.items = action.payload` — full replace, not merge. Confirmed.
  - L236-240 `upsertDashboard` already implements push-or-replace-by-id — a working in-file sibling.
- **e2e assertion is real and as described:** `e2e/focus-presence-guard.spec.ts` L162-165 —
  `getByRole("button", { name: "HEL-520 Guard Dashboard", exact: true })`, strict/`exact: true`.
  The non-goal "do not loosen to `.first()`" therefore protects a real assertion.
- **Spec delta is well-formed and grounded:** the MODIFIED requirement header
  "Frontend dashboard creation is backend-backed" matches `openspec/specs/frontend-dashboard-creation/spec.md:6`
  verbatim; the original scenario is preserved and one is added. `npx openspec validate
  dedupe-dashboard-list-entries --strict` → `Change 'dedupe-dashboard-list-entries' is valid`.
- **Spec scenario 2 is mechanically achievable** (I checked rather than assumed): fetch resolves
  first and replaces `items` with a list already containing the new row, then `createDashboard.fulfilled`
  pushes it again → duplicate id. So the requirement is not written against an impossible race.
- **AC coverage:** AC1 → tasks 1.1/1.2; AC2 → tasks 2.1/2.2 (+ non-goal against `.first()`); AC3 → task 3.1
  (which requires stating the exact mutation, satisfying the "failable by mutation" standard).
- **Scope discipline:** proposal Non-goals and design Decision 3 both bound the sibling-slice sweep to
  "state findings, fix only if small and same-shape, else file a follow-up" — no silent widening.
- **No placeholders/TBDs; no contradiction found** between ticket, proposal, design, and tasks. The one
  place they differ (ticket asserts the refetch race; design doubts it) is a *deliberate, labelled*
  correction of the ticket's hypothesis, which is exactly what this gate wants to see.

### Verdict: CONFIRM

### Non-blocking notes

1. `dashboardsSlice.ts` L318, L325, L329 (`duplicate`/`import`-shaped `fulfilled` reducers) use the
   identical bare `state.items.push(...)` shape as the implicated L292. Task 2.3's sibling sweep is
   scoped to *other* slices (panels/sources/pipelines) and would miss these same-file siblings.
   Suggest widening 2.3 to cover them — and note L318/325/329 are plausibly the actual HEL-706
   double-click surface, which task 1.3 must rule on anyway.
2. `upsertDashboard` (L236-240) is already the exact push-or-replace-by-id pattern Decision 2 proposes.
   Reuse it rather than reinventing the branch inline; it also serves as the law's Phase-3
   "compare to a working example" sibling.
3. Task 3.3 (is the duplicate user-visible on a throttled connection?) is stated as a finding to
   report, with no acceptance signal attached. That is fine as an investigation note, but it should
   not be mistaken for a gate — nothing fails if it goes unanswered.
