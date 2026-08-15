## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, the full current `design.md` (142 lines), `tasks.md`, and all four
  spec deltas (`patch-set-undo`, `patch-set-apply`, `patch-set-preview`, `mcp-patch-set-tools`) fresh
  from the worktree, plus `skeptic-design-{1,2,3,4}.md` (treated as claims to re-verify, not fact —
  all four prior rounds REFUTEd).
- Confirmed no implementation code exists yet for this change (`git status --porcelain` shows only the
  untracked `openspec/changes/undo-patch-set-apply/` directory; `git log` tops out at HEL-411 #336) —
  this is genuinely still a design-gate review, not a review of code already written.

**Re-verification target 1 — `PatchSetApplyForward.applyOne`'s current signature/return type.**
Confirmed exactly as design.md D2a describes: `applyOne(edit: ResolvedEdit, user: AuthenticatedUser,
services: PatchSetApplyServices)(implicit ec): Future[Either[ServiceError, EditOutcome]]`
(`PatchSetApplyForward.scala:20-24`) — no `panelRepo`, no context parameter, single return channel is
`EditOutcome`.

**Re-verification target 2 — does `PatchSetApplyContext` genuinely carry `panelRepo`, and is it
currently threaded only into `resolveAll`?**
Confirmed. `PatchSetApplyContext` (`PatchSetApplyTypes.scala:85-94`) has `panelRepo: PanelRepository`
as its first field. `PatchSetApplyService` constructs one `context: PatchSetApplyContext`
(`PatchSetApplyService.scala:58-59`) and threads it only into
`PatchSetApplyResolvers.resolveAll(patchSet.edits, user, context)` (line 65); the call to
`PatchSetApplyForward.applyOne(edit, user, services)` (line 90) passes `services`, never `context`.
Threading the already-constructed `context` value into that one call site is a genuinely trivial,
non-disruptive one-line change — `context` is already in scope in the same class, `PatchSetApplyContext`
is `private[services]` with no other consumers to disturb, and `PatchSetApplyResolvers` (the only other
consumer of `PatchSetApplyContext`, all 15 `resolve*` functions in `PatchSetApplyResolvers.scala`) is
untouched by this. This half of the round-4 fix is sound.

**Re-verification target 3 — does widening `applyResolved`'s `applied` accumulator to carry the
raw-config value disrupt `PatchSetApplyRollback.rollback`, which consumes the same accumulator shape?**

This is where I found a real, unaddressed gap — **a NEW second-order consequence of round 4's own
endorsed remedy, not caught by round 4 itself.**

- `PatchSetApplyService.applyResolved`'s `loop` builds `applied: Vector[(ResolvedEdit, EditOutcome)]`
  (`PatchSetApplyService.scala:85`), appending `(edit -> outcome)` per iteration (line 92). On success it
  returns `applied.map(_._2)` (line 98) — the collection design.md correctly says is "unchanged." **But
  on a mid-set failure**, the exact same `applied` value (renamed `appliedSoFar`) is passed directly to
  `PatchSetApplyRollback.rollback(appliedSoFar, user, services)` (line 100).
- `PatchSetApplyRollback.rollback`'s signature is hard-typed to `appliedInOrder: Vector[(ResolvedEdit,
  EditOutcome)]` — a 2-tuple (`PatchSetApplyRollback.scala:53-57`).
- Design.md D2a's literal instruction is: "`applyResolved`'s accumulator carries the raw-config value
  alongside `(ResolvedEdit, EditOutcome)`" — i.e. widen the SAME `applied` collection to a 3-element
  shape (a 3-tuple or an equivalent case class). If that is done as written, `appliedSoFar` at line 100
  no longer type-checks against `PatchSetApplyRollback.rollback`'s 2-tuple parameter — a Scala compile
  error, not a semantic ambiguity resolvable by convention.
- Neither design.md D2a nor tasks.md 1.3/1.5 says anything about this call site. Both are silent on the
  failure path entirely — every sentence about "the accumulator" only discusses the success path
  (`applied.map(_._2)`/`the Vector[EditOutcome] that becomes PatchSetApplyResponse.edits`).
  Design.md's own framing — "Needs **two** mechanical signature changes" — undercounts the actual
  surface: a third touch point (`PatchSetApplyRollback.rollback`'s call site, or `rollback`'s own
  signature) also needs an explicit, named treatment.
- Confirmed this is a genuinely new finding: round 4's own Change Request 1, option (a) — the option
  design.md visibly adopted — reads "extend `PatchSetApplyService.applyResolved`'s `applied` accumulator
  to carry it alongside `ResolvedEdit`/`EditOutcome` — used only when building the journal payload,
  never merged into the `EditOutcome`s that become `PatchSetApplyResponse.edits`" (skeptic-design-4.md
  line ~153) — this sentence has the identical gap baked in; round 4 was focused on the *response*-side
  leak and did not itself trace the *failure*-side consumer. This round's specific ask ("does adding a
  third element … disrupt that call site?") is exactly what surfaces it.

**Severity, honestly calibrated against round 4's finding.** This is real, but meaningfully lower-risk
than round 4's: round 4's gap (an undocumented field silently leaking onto the public `/apply` HTTP
response) could ship, compile, and pass every currently-planned test undetected — nothing in
tasks.md's test list would have caught it. This round's gap is **self-revealing at compile time** —
`sbt compile` cannot succeed with the type mismatch left unresolved, so an executor cannot silently ship
past it. It also has an obviously-correct resolution (the raw-config value is journal-only per D2 — it
is never needed by `rollback`, which only fires on a **failed** apply that, per D2, is never journaled
at all) — e.g. strip the third element before calling `rollback` (`appliedSoFar.map(t => (t._1, t._2))`),
or avoid widening the shared tuple at all by collecting the raw-config value in a **separate**,
index-keyed accumulator built alongside `applied` in the same loop, used only by the terminal success
branch — the latter also sidesteps needing `applyOne`'s return type to change at all. Either is a small,
mechanical fix; design.md just needs to say which, given how explicitly it documents every other
channel-separation decision (e.g. the dedicated paragraph justifying why `targetKind`/`op` are threaded
separately rather than through `EditOutcome`, design.md D1).

**Fresh whole-design pass — everything else re-verified against ground truth, nothing else disturbed.**

- D4a's field-scoped conflict-check claims cross-checked against the real `PatchSetApplyRollback`
  inverse builders: `dataSource` → `name` only (`UpdateDataSourceRequest(name = Some(prior.name))`,
  `PatchSetApplyRollback.scala:142`); `dataType` → `name`/`fields`/`computedFields`
  (`fullDataTypeInverse`, lines 315-320); `dashboard` → `name`/`appearance`/`layout`
  (`fullDashboardInverse`, lines 300-313); `pipeline` → `name` only (`UpdatePipelineRequest(name =
  prior.name)`, line 171); `pipelineStep` → `type`/`config`/`position` (`fullPipelineStepInverse`, lines
  322-327). All match D4a's claims exactly.
- `PipelineSummaryResponse` (`PipelineProtocol.scala:15-27`) does carry `lastRunStatus`/`lastRunAt`/
  `lastRunRowCount` as claimed — confirms D4a's justification for excluding them from the pipeline
  conflict check is grounded, not invented.
- `MetricPanelConfig` (`MetricPanel.scala:25-33`) does carry exactly `dataTypeId`/`fieldMapping`/
  `aggregation`/`unit` (plus `label`/`metricId`/`metricDeprecated`) — confirms D4a's "four
  metric-materialized effective fields" list is accurate.
- `PanelService.update` → `patchApplier.apply(panelId, spec, p => resolveSingleBinding(p, user))`
  (`PanelService.scala:462`) confirmed materializing via `resolveSingleBinding` →
  `withMaterializedMetric`; `PanelRepository.findByIdInternal` (`PanelRepository.scala:99-101`) confirmed
  a bare, no-materialization DB read (`ctx.withSystemContext(table.filter(...).result.headOption)`) —
  the raw/materialized distinction D2a/D4a depend on is real.
- `EditOutcome` (`PatchSetApplyProtocol.scala:33-39`) confirmed still exactly 5 fields, `jsonFormat5`,
  no `rawResultingConfig` added — design correctly keeps it off this type. `PatchSetRoutes.scala:38-44`
  confirmed the `/apply` route still marshals the service's `PatchSetApplyResponse` with no filtering
  step — the round-4 wire-leak risk this round's fix targets is real and the fix's *intent* (keep the
  raw config off `EditOutcome`) is correctly reflected in `specs/patch-set-apply/spec.md`'s new "The raw
  config never appears on the apply response" scenario (lines 38-41).
- Flyway: `V79` confirmed still the correct next-unclaimed migration number (`ls
  backend/src/main/resources/db/migration` tops out at `V78__refinement_conversations.sql`); `V77`
  confirmed to establish exactly the `FORCE ROW LEVEL SECURITY` + `owner_id =
  current_setting('app.current_user_id')::uuid` pattern D1 cites; `V78` confirmed to be a pure
  `ALTER TABLE ADD COLUMN` onto that already-RLS-enabled table.
- `PipelineRunRepository.deleteOldRunsInternal` (`PipelineRunRepository.scala:154-161`) confirmed to use
  the "keep top-N via a `NOT IN` subselect" shape D3 cites for the journal's retention prune.
- Frontend: `Toast`/`toastsSlice` (`Toast.tsx`, `toastsSlice.ts`) confirmed to already support
  `action: {label, onClick}` and `duration` (default 4000ms, `duration === 0` never auto-dismissing) —
  D6's frontend claims are grounded, not invented. `PatchSetReviewPage.handleAccept`
  (`PatchSetReviewPage.tsx:74-85`) confirmed to be the real call site `dispatch(applyPatchSet(patchSet))
  .unwrap()` then `navigate("/")` — the described toast-before-navigate insertion point exists as
  claimed.
- `helio-mcp`: `refinement.ts`/`refinementHandlers.ts` confirmed to have the real `propose_patch_set`/
  `apply_patch_set` pair `undo_patch_set` is described as joining; the `HelioApi.applyPatchSet` pattern
  `undoPatchSet` would mirror is real and tested (`refinementHandlers.test.ts`).
- All three of the other spec deltas (`patch-set-undo`, `mcp-patch-set-tools`, `patch-set-preview`) read
  internally consistent with the current design.md and with each other; no contradiction found.

### Verdict: REFUTE

This is a **new finding** (a second-order consequence of round 4's own endorsed fix, not the same
finding recurring), and — after four consecutive REFUTEs on progressively narrower issues — I want to be
explicit that the pattern across rounds 4 and 5 is the same *class* of gap (design.md naming a channel
separation but not tracing every downstream consumer of the changed shape), even though the specific
defect differs each time. Unlike round 4's finding, this one is low severity: it is self-revealing at
`sbt compile` time (cannot silently ship), and has an obvious, low-risk resolution. I considered
CONFIRM-with-non-blocking-note on exactly that basis, but given (a) this design doc has held itself to
documenting every other channel-separation decision this explicitly, (b) the round's own brief
specifically asked this precise question, and (c) the fix is genuinely a one-line addition to design.md
D2a + tasks.md 1.3, I'm asking for it to be closed rather than left implicit, since it appears to be the
only remaining gap in an otherwise now-sound design.

### Change Requests

1. **(Blocking, narrow) D2a / tasks.md 1.3 don't name how `applyResolved`'s widened accumulator reaches
   the failure-path call to `PatchSetApplyRollback.rollback`, whose signature is hard-typed to the
   OLD 2-tuple shape.**
   Evidence: `PatchSetApplyService.scala:85` (`applied: Vector[(ResolvedEdit, EditOutcome)]`), line 90
   (`applyOne` call), line 98 (`applied.map(_._2)`, success path — unaffected, as design.md already
   says), **line 100** (`PatchSetApplyRollback.rollback(appliedSoFar, user, services)` — the SAME
   `applied` value, on the failure path); `PatchSetApplyRollback.scala:53-57`
   (`rollback(appliedInOrder: Vector[(ResolvedEdit, EditOutcome)], ...)`, a 2-tuple parameter). If
   `applied` is widened to carry a third (raw-config) element as D2a's prose describes, `appliedSoFar` at
   line 100 no longer type-checks against `rollback`'s parameter.
   **Required revision — pick one, name it explicitly in design.md D2a (mirroring the existing explicit
   note for why `targetKind`/`op` are threaded separately, design.md D1), and update tasks.md 1.3 to
   match:**
   - (a) Do not widen the shared `applied` tuple at all. Collect the raw-config value in a **separate**,
     index-or-position-aligned accumulator built in the same `loop` (e.g. `Vector[Option[JsValue]]` or a
     `Map[Int, JsValue]` keyed by `edit.index`), consumed only by the success branch when constructing
     the journal payload. This also avoids needing to change `applyOne`'s return type at all — the extra
     `panelRepo.findByIdInternal` fetch for a panel-update edit could instead happen in `applyResolved`'s
     loop itself (which already has direct field access to `panelRepo` as a `PatchSetApplyService`
     constructor parameter, `PatchSetApplyService.scala:45` — no `PatchSetApplyContext`/`applyOne`
     signature change needed for this half at all), OR remain inside `applyOne` as D2a currently
     describes, feeding the separate accumulator via its unchanged `Either[ServiceError, EditOutcome]`
     result plus a value read back from `ResolvedEdit`/pattern-matching at the call site. **or**
   - (b) Widen `applied` to a 3-element shape as D2a's prose currently implies, and explicitly say the
     failure-path call strips the third element before calling `rollback`
     (`appliedSoFar.map(t => (t._1, t._2))`), since the raw-config value is journal-only and D2 already
     guarantees a partially-rolled-back apply (the only case that reaches `rollback`) is never journaled,
     so nothing is lost by dropping it there.
   Either way, name the choice in design.md and reflect it in tasks.md 1.3, the same way round 4's fix
   was closed for the response-side channel.

### Non-blocking notes

- Whichever of CR1's options is chosen, `applyOne`'s return-type change (if kept) touches every branch
  of the `edit.action match { ... }` in `PatchSetApplyForward.applyOne` (`PatchSetApplyForward.scala:
  26-96`, 11 cases), not just the panel-`update` case — each non-panel-update branch would need to wrap
  its existing `edit.toOutcome(...)` result as `(outcome, None)`. This is mechanical, not ambiguous, but
  tasks.md 1.5's current wording ("the panel `update` case … additionally issues one bare … fetch")
  could read as scoped to one branch's body only; a one-clause addition noting every other branch just
  wraps with `None` would save the executor a moment's hesitation.
- If CR1 option (a)'s sub-choice of moving the fetch into `applyResolved` (bypassing `applyOne`/context
  entirely) is taken, the "applyOne gains `panelRepo` access via `PatchSetApplyContext`" half of D2a's
  "two mechanical signature changes" becomes unnecessary — worth deciding explicitly rather than paying
  for a signature change that isn't load-bearing.
