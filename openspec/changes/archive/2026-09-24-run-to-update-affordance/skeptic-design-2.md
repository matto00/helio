## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 Change Request 1 (cross-tenant disclosure) — resolved as described.**
- `design.md` D1 now computes `visible: Boolean` (owner OR any grant — `pipelineRepo.findGrantRole` returns
  `Some(_)`, viewer or editor) **per denied pipeline**, and states plainly: "When `visible` is false, that
  pipeline's entry is OMITTED from the response entirely — no name, no reasons, nothing." `canRun` is
  described as "only meaningful/present on an entry that already passed the `visible` gate above" — the two
  checks are computed together but only a visible entry is ever surfaced, so `canRun` is never exposed for an
  invisible pipeline either. Internally consistent.
- `specs/dataset-write-auto-run/spec.md`'s MODIFIED requirement text now reads "for each denied downstream
  pipeline the writer has visibility into" and is explicitly "SUBJECT TO the visibility requirement below,"
  with a new scenario "A denied pipeline the writer has no relationship to at all is omitted" (lines 34-38)
  that states the pipeline appears nowhere in the response while the denial is still logged server-side.
- `specs/run-to-update-affordance/spec.md` gained the exact scenario named in the round-2 brief — "A write
  denying only pipelines the writer cannot see produces no toast" (lines 47-50) — matching D1's "no leak"
  posture on the frontend side too.
- `tasks.md` 1.2 explicitly computes both `visible` and `canRun` "for the WRITING user" and states "a
  pipeline the writer has no grant on at all is dropped before it ever reaches the response," citing CR1 by
  name. Task 3.2 explicitly requires a test proving the no-grant case is "OMITTED entirely from the
  response," not just `canRun: false`.
- This is a real fix, not a re-wording: the omission behavior is now specified at the requirement level, the
  scenario level, and the task level, all three agreeing.

**Round-1 Change Request 2 (`replaceRows` excluded) — resolved for the three call sites it named.**
- `design.md` D1 explicitly states the shared `triggerAutoRun` helper "is AWAITED by all THREE call sites
  (not just the two form-adjacent ones)," citing `DataSourceService.scala:80-84, called at lines
  796/828/849`. I verified these exact line numbers against the live file
  (`backend/src/main/scala/com/helio/services/sources/DataSourceService.scala`) — `triggerAutoRun` is defined
  at line 80, and called at exactly 796 (`appendRows`), 828 (`appendFormRow`), 849 (`replaceRows`). Accurate.
- `specs/dataset-write-auto-run/spec.md`'s requirement text now says "This requirement SHALL apply
  identically to every row-mutation entry point sharing the underlying trigger path (append, form-append,
  and replace)," with a new scenario "A replace write reports a denial identically to an append write"
  (lines 40-44).
- `tasks.md` 1.3 explicitly awaits `triggerAutoRun` "at all THREE call sites," citing CR2 by name; 3.2 adds a
  matching test case for `replaceRows`; 3.4/D2 extend the latency measurement to `replaceRows` too.
- As far as it goes, this is a real fix and internally consistent across design.md/spec/tasks.

**No inconsistency introduced among design.md/spec-deltas/tasks.md by these specific edits**, and the rest
of D2-D7 (toast/page dual-surface, dedup, 429-vs-deny distinction, copy-mapping module) is textually
unchanged from round 1 and still sound — I re-read all of it and found no drift.

### Verdict: REFUTE

Both round-1 Change Requests are genuinely resolved, not just asserted. But re-deriving the "three call
sites" claim from the live tree — rather than accepting design.md's Context section's own enumeration at
face value — surfaces a fresh, unaddressed gap of the identical shape as round 1's CR2, and materially more
severe on the UI-reachability axis than the one just fixed.

### Change Requests

1. **`triggerAutoRun` actually has FIVE call sites, not three — `patchRow` and `deleteRow` share the exact
   same silent-discard bug and are live, UI-reachable, and completely unaddressed.**
   `grep -n "triggerAutoRun" backend/src/main/scala/com/helio/services/sources/DataSourceService.scala`
   returns calls at lines **796** (`appendRows`), **828** (`appendFormRow`), **849** (`replaceRows`) — the
   three design.md D1 now covers — **plus 876 (`patchRow`, line 860-881) and 901 (`deleteRow`, line
   885-906)**, neither mentioned anywhere in `design.md`, `proposal.md`, the two spec deltas, or `tasks.md`.

   Both are wired to `POST`/`PATCH`/`DELETE /api/data-sources/:id/rows/:rowId`
   (`DataSourceRoutes.scala:187,200`) and, critically, **both are live in the running app today** — unlike
   `replaceRows`, which round 1 confirmed has "no UI consumer yet." `patchSourceRow`/`deleteSourceRow`
   (`frontend/src/features/sources/services/dataSourceService.ts:351+`) are called from
   `datasetRowsSlice.ts`'s `patchRow`/`deleteRow` thunks (lines 153,171), which `DatasetRowGrid.tsx` imports
   and dispatches (as `patchDatasetRow`/`deleteDatasetRow`), and `DatasetRowGrid` is rendered from
   `SourceDetailPanel.tsx` — a real, non-test page in the app. A user editing or deleting a row in that grid
   today silently triggers the identical fire-and-forget `triggerAutoRun` call this whole ticket exists to
   fix, and after this design ships as currently scoped, it will **still** silently discard the denial for
   those two actions while `append`/`form-append`/`replace` surface it — reproducing this ticket's own bug
   on two live call sites, one layer deeper than the gap round 1 caught.

   This isn't a "trivial, symmetric extension" the way `replaceRows` was, which is likely why it wasn't
   caught by generalizing round 1's fix: `patchRow` returns `RowMutationResult` (single-row shape, not
   `RowWriteResult`/`RowWriteResponse`) and converts to `RowResponse`
   (`DataSourceRoutes.scala:187` — `RowResponse.fromDomain`); `deleteRow` returns `Unit` behind a `204 No
   Content` (`ServiceResponse.runNoContent`, `DataSourceRoutes.scala:200`) — there is no response body at all
   today to carry a `deniedPipelines`-shaped field. Extending to these two would be a genuine wire-shape
   decision (add a body to what's currently 204; add a new field to a different response type than the one
   `design.md` D1 designed), not a copy-paste of the `replaceRows` fix. That's exactly why it needs an
   explicit design decision and documentation, not silent omission.

   Resolve one of:
   - Extend scope to `patchRow`/`deleteRow` symmetrically — decide and document the wire-shape change (a
     `deniedPipelines` field on `RowResponse`/`RowMutationResult`, and turning `deleteRow`'s `204` into a
     `200` with a body, or an alternative such as a response header) in `design.md`, with matching spec-delta
     and task coverage, or
   - Explicitly scope `dataset-write-auto-run`'s requirement and `design.md`'s Non-Goals to the three
     call sites already covered, stating `patchRow`/`deleteRow` are deliberately excluded and why (e.g. "the
     single-row edit/delete UI's silent-discard behavior is pre-existing and out of scope for this ticket;
     tracked as a follow-up per C11") — the same kind of explicit, documented scope line round 1's CR2
     resolution modeled for `replaceRows`, just correctly extended to name these two sites too.
   - Given `patchRow`/`deleteRow` are live and UI-reachable (unlike `replaceRows`), silently leaving them out
     is a materially worse gap than the one round 1 caught — I'd lean toward the first option or an explicit
     owner escalation if scope/timeline don't allow it, but either documented resolution clears this CR.

2. **(Minor, non-blocking on its own, but a real drift) `proposal.md` was not updated for CR2's
   `replaceRows` extension and now disagrees with `design.md`/the spec delta/`tasks.md`.** `proposal.md`'s
   "What Changes" (line 9: "is awaited by `DataSourceService.appendFormRow`/`appendRows`") and "Impact"
   (line 38: "Backend: ... `DataSourceService.appendFormRow`/`appendRows`, ...") sections still describe
   two-call-site scope and never mention `replaceRows`, even though `design.md` D1, the
   `dataset-write-auto-run` spec delta, and `tasks.md` 1.1-1.3/3.2/3.4 all now correctly describe
   three-call-site scope. `proposal.md`'s "Modified Capabilities" summary for `dataset-write-auto-run` also
   doesn't mention the visibility/omission behavior CR1 introduced. An implementer skimming `proposal.md`
   alone (its purpose) would under-scope the change. Trivial fix: update both `proposal.md` sections to
   mention `replaceRows` (and, ideally, one sentence on the visibility gate) alongside the append/form-append
   sites already listed — no design decision required, just propagating text that's already settled
   elsewhere in the change.

### Non-blocking notes

- Carried from round 1, still applicable and still not blocking: the a11y wiring for the pipeline-page
  denial block is left to the executor's judgment beyond "reuse the same copy module" — acceptable, revisit
  only if the final-gate visual pass finds an orphaned/confusing control.
