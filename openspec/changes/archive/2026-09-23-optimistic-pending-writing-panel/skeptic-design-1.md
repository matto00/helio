## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **Owner-ruling deviation (D1/C1/C2) is stated plainly, not buried.**
   - `proposal.md` has an explicit `**Deviation, per owner ruling:**` bullet under "What Changes".
   - `design.md` Decision **D1 — Reinterpret "on run success" as "on write success" (owner ruling)**
     spells out the rationale and explicitly says it "must be called out plainly in the PR body so no
     gate reads it as a missed AC."
   - `workflow-state.md` CONSTRAINTS C1/C2 record the same ruling with escalation sub-IDs.
   - Verdict: this requirement is satisfied — not refuting the deviation itself, per instructions.

2. **`dataset_rows` schema / index claims (D4) — verified against the actual migration.**
   - Read `backend/src/main/resources/db/migration/V106__dataset_rows.sql`: confirms `data` is a
     positional JSONB array (not object-keyed), and confirms
     `CREATE INDEX idx_dataset_rows_data_source_id ON dataset_rows(data_source_id, seq);` exists
     exactly as design.md D4 describes.
   - Confirmed `DataSourceService.DatasetMaxRows = 500` (`DataSourceService.scala:1264`) is an
     enforced write-time hard cap (`staticMaxRows` used in `appendRows`/`replaceRows`/`appendBuiltRow`
     rejection checks), so D4's "full-index-scan-then-sum over ≤500 rows is trivial, no new index
     needed" reasoning holds against current ground truth.
   - Confirmed no migration exists in this change dir and none is claimed — D4's "V111 is NOT
     claimed" statement is accurate (no V111 file present).

3. **RLS-respecting read pattern (D3) — verified against actual code.**
   - `DataSourceRepository.listRows` (line 882) and `DataSourceService.getDatasetSchema` (line 943)
     both follow exactly the two-step pattern design.md describes: service-layer `findByIdOwned`
     first, then repository-layer `ctx.withUserContext(user.id.value)(...)` — never
     `DbContext.withSystemContext`. D3's claim to mirror this pattern is accurate.

4. **`fetchDatasetSchema` mirror target (task 2.1) exists** at
   `frontend/src/features/sources/services/dataSourceService.ts:381`, confirming the task's
   "mirroring `fetchDatasetSchema`" reference is real, not invented.

5. **Standing Constraints carryover (tasks.md vs. workflow-state.md CONSTRAINTS).** Compared
   verbatim. C2, C4, C5, C7 match exactly. C1 and C6 differ only in capitalization
   ("This DELIBERATELY reinterprets…" / "COMPUTED ARIA state" vs. sentence-case), and C3 in
   tasks.md drops the trailing parenthetical "(schema-drift gate)" present in workflow-state.md.
   None of these three changes the obligation's meaning — flagged as a non-blocking nit below, not
   a Change Request, since the instructions' concern (methodology-carryover / no silent scope
   change) is not actually violated.

### A real design gap I found (blocking)

**The reconciliation design (D5) requires overlapping in-flight submit requests that the
existing, explicitly-preserved code architecture currently makes impossible — and nothing in
design.md or tasks.md resolves this.**

Read `frontend/src/features/panels/ui/form/FormPanelView.tsx:114-150` (`handleImmediateStep`,
ground truth for what HEL-1087 shipped and what this design's Non-Goals says stays "unchanged,
only extended"):

```
async function handleImmediateStep(direction: 1 | -1) {
    if (!schema || submitState === "pending") return;
    ...
    setSubmitState("pending");
    try {
      await submitFormPanel(...);
      setSubmitState("succeeded");
      ...
```

`submitState` is a single enum value (`"idle" | "pending" | "succeeded" | "failed"`,
`FormPanelView.tsx:34`), not per-request state. **A second click that arrives while the first
submit is still pending is silently dropped** — `handleImmediateStep` returns immediately, before
even touching `values.setValue`, so the local optimistic tally is not even bumped, let alone a
second network request fired. I also checked `CounterControl.tsx`/`FormFieldControl.tsx`: the
compact-counter's `+`/`-` `IconButton`s are never passed a `disabled` prop bound to `submitState`,
so this drop happens entirely inside `handleImmediateStep`'s own early-return guard, not at the UI
layer — but the effect is the same: only the *first* click of a burst ever does anything today.

Design.md's D5 ("Reconciliation merges with in-flight optimistic deltas; it never overwrites") and
its worked example explicitly presuppose **multiple concurrent in-flight submit requests** — it
talks about "a click that started before the refetch and is still in flight," a `pendingDeltaSum`
that sums "every optimistic delta from a submit request not yet settled" (plural), and the
Risks/Trade-offs section worries about "a burst of clicks each triggering its own aggregate
refetch" producing "redundant requests." Task 2.2 requires a unit test "simulating two overlapping
clicks," and task 3.3 / Standing Constraint C4 require "ten rapid clicks" to each fire their own
submit and accumulate. **None of this is reachable under the current guard** — clicks 2 through N
of a rapid burst are dropped outright before they can become second in-flight request, so
`pendingDeltaSum` as described is vacuous (there is never more than one request in flight to sum).

Nowhere in design.md (not D5, D7, or D8) or tasks.md is there a decision to relax or restructure
this reentrancy guard (e.g. replacing the single `submitState` enum with a per-request outstanding
count/set). D7's Non-Goals framing ("Preserve HEL-1087's existing... rollback behavior unchanged;
only extend it") and D8 ("computed from the same `submitState`/pending-delta bookkeeping D5
introduces") both read as if `submitState` itself survives unchanged in shape — which is
inconsistent with what D5's own reconciliation math requires to ever be exercised.

This is exactly the kind of "ambiguity a competent implementer could read two ways" the design
gate exists to catch: either (a) the guard must change from a single boolean-ish state to
something that tracks multiple outstanding requests — a real architectural decision the design
should make explicitly and tasks.md should assign a task to — or (b) the "ten rapid clicks
accumulate" requirement (C4, the form-panel-submit spec's "Ten rapid increments accumulate"
scenario) is unimplementable as currently scoped and needs to be revisited. Right now the design
silently assumes (a) without ever stating it, leaving the executor to discover and improvise this
mid-implementation — which is precisely the kind of decision that should be pinned down at the
design gate, not left for execution to guess.

### Verdict: REFUTE

### Change Requests

1. **(Blocking)** Add an explicit design.md decision (or amend D5) that states how
   `handleImmediateStep`'s single-value `submitState` reentrancy guard is being changed to allow
   multiple concurrent in-flight submit requests per counter — e.g., tracking outstanding request
   count/pending-delta sum instead of a single `"pending"` enum value — and add a corresponding
   task to tasks.md's Frontend section (a sibling to 2.2) that calls this out as its own step,
   since it touches code the design's own Non-Goals imply stays untouched. Without this, task 2.2's
   "unit test simulating two overlapping clicks" and task 3.3's "ten rapid clicks" test cannot
   exercise the code path they're meant to test — the guard as it exists today drops every click
   after the first during a pending window.

### Non-blocking notes

- `tasks.md`'s `## Standing Constraints` section differs from `workflow-state.md`'s `CONSTRAINTS`
  in three cosmetic ways: C1 and C6 differ only in capitalization ("This DELIBERATELY…"/"COMPUTED
  ARIA state…" vs. sentence case), and C3 drops the trailing "(schema-drift gate)" parenthetical.
  None change the obligation's meaning; worth a find-and-fix pass for hygiene but not blocking.
- Consider having design.md briefly note the Pekko route-matching order between the new
  `GET .../rows/aggregate` and the existing `path(DataSourceIdSegment / "rows" / Segment)`
  patch/delete route (`DataSourceRoutes.scala:172`) — Pekko's rejection-based backtracking across
  `concat` alternatives handles this correctly regardless of route declaration order (verified by
  reading the existing route composition), so this is not a defect, just worth a one-line
  implementation note so the executor doesn't second-guess route ordering.
