## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### Context

This is round 4, following a human-directed `apply-fix-and-continue` after round 3's
budget-exhausted escalation (a narrow test-harness finding, not an architectural fork). Per the
orchestrator's brief, I re-reviewed the FULL artifact set fresh (ticket.md, proposal.md, design.md,
tasks.md, specs/patch-set-preview/spec.md) — not just the round-3 fix — cross-checking every claim
against actual source myself, and did a final broad pass for anything else that might have drifted
or been missed across four rounds.

### What I verified (with evidence)

**Round-3 fix (test harness) — confirmed genuine, not just claimed:**
- `WorkspaceTeardownServiceSpec.scala:27-40`'s doc comment, cited by design.md D4 and tasks.md 6.5,
  reads exactly as claimed: "Real RLS, not the simplified `DbContext(db, db)` pattern most ACL
  specs use" — and its `beforeAll` (lines 69-131) genuinely builds a non-superuser `helio_app_test`
  role (`CREATE ROLE helio_app_test NOSUPERUSER ... NOLOGIN`, `SET ROLE helio_app_test` on the app
  pool's connection-init SQL) distinct from the privileged `helio_privileged` pool — a real,
  structurally different harness from `DbContext(db, db)`, not a relabeled version of it.
- Confirmed the dominant pattern claim: `grep -rl "DbContext(db, db)"` in `backend/src/test` returns
  54 files; only a handful (`RlsSharingAwareTablesSpec`, `RlsOwnerTablesSpec`,
  `WorkspaceTeardownServiceSpec`, etc.) use the real `helio_app_test` dual-pool harness. The
  round-3 claim that the simplified pattern is dominant and would silently bypass RLS is accurate.
- `tasks.md` 6.5 correctly specifies this harness ONLY for the `existsBoundToType` RLS-narrowing
  assertion, isolated into its own test/file, with the other assertions free to use the simplified
  harness — matches the human-approved fix exactly.

**Round-1/2 corrections re-verified against source, not just re-read:**
- `PatchSetApplyResolvers.resolveAll` (`PatchSetApplyResolvers.scala:56-73`), `ResolvedEdit`/
  `priorStateJson` (`PatchSetApplyTypes.scala:69-77`), `private[services]` visibility — all confirmed
  exactly as design.md's Context section states.
- `DbContext.scala:33-64`'s two entry points (`withUserContext`/`withSystemContext`) each independently
  run `db.run(...).transactionally` — confirms the "no shared session an outer preview transaction
  could roll back across" claim underlying the "pure projection, not write-then-rollback" decision.
- `PanelServiceHelpers.resolvePatch` (line 21, public), `PanelConfigCodec.applyConfigPatch`
  (`backend/.../domain/panels/PanelConfigCodec.scala:77`, public, returns full `Panel`),
  `PanelAppearance.applyPatchJson` (`model.scala:387`), `PipelineStepConfigCodec.decode` (line 75),
  `PanelServiceHelpers.buildNewPanel`/`resolveCreateConfig`/`resolveCreateAppearance` (lines
  130/109/68) — every cited line number and signature matches source exactly.
- `PanelService.validateScatterAggregationConflict` call site at `PanelService.scala:450` and
  `PipelineService.updateName`'s blank-name check at `PipelineService.scala:154-155` — both confirmed
  verbatim, including the exact `if (req.name.trim.isEmpty) ...BadRequest` phrasing.
- `DataTypeService.delete` (`DataTypeService.scala:127-141`) confirmed to call `checkSourceLink`
  FIRST, `existsBoundToAnyOwnedPanel` SECOND — the opposite order design.md's D1 enumerates, exactly
  as the round-3 non-blocking note stated. The new mutual-exclusivity justification closing that note
  also checks out: `rejectCompanionBinding` (`PanelService.scala:483-494`, and its
  `PatchSetApplyResolvers.scala:191-202` mirror) rejects binding any panel to a `sourceId`-defined
  DataType, and `sourceId` is set only at DataType creation with no update path that mutates it
  (`DataTypeService.applyUpdate` only touches name/fields/computedFields/updatedAt) — so a DataType
  can never simultaneously satisfy both conflict conditions, and check order genuinely cannot change
  the verdict. This closes the note validly, not just plausibly.
- The RLS citations are exact: `V36__rls_sharing_aware_tables.sql:146-148` is precisely
  `CREATE POLICY panels_select ON panels FOR SELECT USING (helio_can_access_dashboard(dashboard_id));`
  and `helio_can_access_dashboard` (same file, lines 1-60ish) does encode owner-OR-grant visibility
  as claimed. `V5__panel_type_binding.sql:1` is exactly `... type_id TEXT REFERENCES data_types(id)
  ON DELETE SET NULL`. `PanelRepository.scala:331` confirms the `type_id` column exists on the
  Slick table def the new `existsBoundToType` method would query.
- `DataTypeRepository.existsBoundToAnyOwnedPanelAction` (lines 202-204) confirmed to run
  `SELECT COUNT(*) FROM panels WHERE type_id = ... AND owner_id = ...` under `withUserContext` — the
  new `existsBoundToType`'s design (same pattern, `owner_id` predicate deliberately dropped) is a
  coherent, buildable diff against real, existing code.
- `EditOutcome` (`PatchSetApplyProtocol.scala:33-39`) confirmed to have exactly
  `index/status/newId/priorState/resultingState` — matches D5's "mirrors EditOutcome's shape...
  without being the same type" characterization precisely.
- `PatchSetRoutes.scala` and its `ApiRoutes.scala:199-203,419` construction site confirmed to be
  exactly the single-route, single-service shape D5/task 3 describes adding `/preview` alongside.

**New finding from this round's broad pass — the D6 frontend precedent is factually wrong:**

design.md D6 (echoed in proposal.md's Non-Goals and `tasks.md` 5.1) justifies shipping
`PatchSetReview.tsx` with **zero route/page wiring** by citing established precedent: *"`ProposalReview.tsx`
itself shipped (HEL-224) before `ProposalReviewPage`/`AuthoringChatDrawer` gave it an entry point."*
I checked this against git history rather than accepting it:

```
git log --diff-filter=A --format="%h %ad %s" --date=short -- \
  frontend/src/features/dashboards/ui/ProposalReview.tsx \
  frontend/src/features/dashboards/ui/ProposalReviewPage.tsx
→ 60980e4d 2026-07-05 HEL-148 Phase 6: Proposal -> Review -> Apply (HEL-223/224/225)
```

Both files were added in the **same commit**. That commit's own message explicitly attributes both
to the same sub-ticket: *"Frontend (HEL-224): Proposal Review UI ... ProposalReviewPage container at
/proposals/review: proposal from router state or a demo synthesized from the first pipeline-output
type (fixture path, kept applyable)."* `App.tsx`'s `/proposals/review` route was wired in that same
commit. `ProposalReview.tsx` never shipped unwired — it always had a reachable route, using a
fixture/demo data source specifically because no NL-authoring flow existed yet at the time.
`AuthoringChatDrawer.tsx` (confirmed via its own git history: added 2026-08-13, HEL-395/#328, over a
month later) doesn't render `ProposalReview` itself and doesn't "give it" a first entry point — it
merely `navigate("/proposals/review", ...)`s to the pre-existing route (confirmed via grep at
`AuthoringChatDrawer.tsx:190`) as a second caller of an entry point that already existed from day one.

This matters beyond a citation nitpick: it is the design's sole justification for a formally-numbered
Decision (D6) that leaves this ticket's entire user-facing deliverable — the diff/impact review
surface — **unreachable in the running app**. The actual precedent it claims to follow did the
opposite: it shipped a fixture/demo-driven page alongside the component specifically to keep it
reachable and manually verifiable before any real caller existed. Practically, this also creates a
downstream problem for this same review process: the final-gate skeptic's mandate is to "navigate to
each changed view" and screenshot it — with the design as currently written, there would be no route
to navigate to for this ticket's own core UI deliverable.

### Verdict: REFUTE

### Change Requests

1. **design.md D6 / proposal.md Non-Goals / tasks.md 5.1 — fix the false precedent and re-justify
   (or reverse) the "no route/page wiring" decision.** `git log --diff-filter=A` on
   `ProposalReview.tsx`/`ProposalReviewPage.tsx` shows both shipped in the same commit
   (`60980e4d`, HEL-224) with `/proposals/review` wired from day one via a fixture/demo patch-set
   equivalent ("a demo synthesized from the first pipeline-output type... kept applyable") — not
   component-first-then-wired-later as currently written. Since the cited precedent doesn't support
   the decision, either: (a) add a minimal fixture/demo-driven entry point for `PatchSetReview.tsx`
   (e.g. a `PatchSetReviewPage` at a new route, feeding it a synthesized/fixture `PatchSetPreviewResponse`
   the same way `ProposalReviewPage` synthesizes a demo proposal), mirroring what the actual
   precedent did — this keeps the component reachable/screenshot-verifiable at the final gate; or
   (b) keep it component-only but replace the false "matches precedent" justification with an
   honest one, and explicitly accept (documented, not implied) that this ticket's UI cannot be
   verified in the running app until a future ticket wires an entry point — which the final-gate
   skeptic and evaluator should be told up front so they don't treat its absence as a surprise
   environmental blocker.

### Non-blocking notes

- design.md D3's dashboard-update mirror (`existing.copy(name = ..., appearance = ...,
  layout = ...)`, repeated verbatim in tasks.md 2.2) omits `meta`/`updatedAt`, while the real
  `DashboardService.applyUpdate` (`DashboardService.scala:147-184`) always bumps
  `meta.copy(lastUpdated = now)` on every branch — and every other kind's real update path
  (`DataSourceService`, `DataTypeService.applyUpdate` at line 117, etc.) does the same for its own
  `updatedAt`. Neither design.md nor tasks.md mentions bumping the timestamp anywhere in the "after"
  projection for any kind. This means D3's "byte-identical in FORMAT... differing only in that
  nothing was written" claim will, in practice, differ in one field's *value* (a stale
  `updatedAt`/`lastUpdated` vs. what a real apply's `resultingState` would show). I read "byte-identical
  in FORMAT" as a hedge that already excludes exact value equality (no preview can ever predict the
  literal future write timestamp exactly, since Accept happens later, at a different wall-clock
  moment) — so I'm not blocking on this, but recommend either (a) explicitly noting in D3 that
  timestamp fields in `after` are not attempted to be projected forward, so a future reader
  doesn't mistake the "byte-identical" claim as covering them, or (b) having the implementer bump
  timestamps in every kind's projection for consistency with the real update paths it's mirroring.
