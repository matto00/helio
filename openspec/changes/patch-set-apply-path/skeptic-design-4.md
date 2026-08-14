## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### Context

This round follows explicit human direction after round 3's budget-exhausted escalation (see
design.md's Planner Notes and `skeptic-design-3.md`): the human chose `implement-full-fix` for the
four embedded-cross-resource-reference ACL checks round 3 identified, now recorded as design.md's
new D2a, tasks.md's new task 3.2 (+ extended task 7.9), and a new "Pre-validation also authorizes
resources referenced inside a patch" requirement in `specs/patch-set-apply/spec.md`. Per the brief,
I re-reviewed the FULL artifact set fresh — not just D2a — and re-verified every grounding claim
(old and new) against the actual backend source myself, treating all three prior skeptic reports as
claims to re-check, not fact.

### What I verified (with evidence)

**Round 1/2/3 findings — spot-re-verified as still fixed, independently, against current source:**
- `PanelService.create` (`PanelService.scala:168-186`) really does call
  `accessChecker.requireAccess("dashboard", dashboardId.value, Some(user), ...)` at line 176 before
  building/inserting — matches D2a's panel-create claim exactly (line-for-line, not just "close
  enough").
- `PanelService.update`/`.create`'s `buildForCreate` (`:199-235,434-473`) both call
  `rejectCompanionBinding` and `rejectUnresolvableMetric`, defined at exactly
  `PanelService.scala:483-524` as design.md cites.
- `PipelineRepository.create` (`infrastructure/PipelineRepository.scala:205-212`) really does call
  `dataSourceRepo.findByIdOwned(sourceDataSourceId, user)` at line 212 — the exact line design.md
  D2a cites — before any insert; `PipelineService.create` (`services/PipelineService.scala:133,143`)
  delegates straight into it.
- `PipelineService.addStep`'s three "Pre-flight ACL" comments really sit at exactly lines 448, 457,
  469 (`services/PipelineService.scala`), and `updateStep`'s mirrored Join/Union/Lookup checks really
  sit at exactly lines 568-597 — both cited ranges in D2a are precise, not approximate.
- Re-confirmed panel/pipelineStep's update-vs-delete ACL identity, dashboard's update-vs-delete
  divergence (`DashboardService.delete` at line 86, owner-only, no `accessChecker` call), and the
  `ifExists` create-rollback fix, all unchanged from rounds 1-2's fixes and still accurate.
- Confirmed the six per-resource request shapes (`CreatePipelineRequest`, `UpdatePipelineRequest`,
  `UpdatePanelRequest`, `CreateDashboardRequest`, `UpdateDashboardRequest`,
  `UpdatePipelineStepRequest`, `StaticDataSourceRequest`) carry no embedded ownership-gated
  reference beyond the four D2a already names — checked `DashboardService.update`'s `layout` field
  specifically (panel ids embedded in `DashboardLayout`) since it's the most plausible remaining
  candidate: `DashboardService.update`/`applyUpdate` (`DashboardService.scala:123-180`) persists
  `layoutOpt` wholesale with **no** per-panel-id ownership check at all, so there is nothing for
  pre-validation to be "missing" there — the real route doesn't check it either. No other
  undocumented embedded-reference gap found in this pass.

**New problem found while independently verifying D2a's check *semantics* (not just method names/
line numbers) against the real code bodies, as the brief specifically asked** — see Change Request
1. This is a fresh defect in this round's own new artifacts (D2a / task 3.2 / task 7.9 /
`specs/patch-set-apply/spec.md`'s new requirement), not a re-surfacing of a prior round's finding.

### Verdict: REFUTE

### Change Requests

1. **The new "foreign-owned `dataTypeId` is rejected pre-apply" scenario (spec.md) and its matching
   test requirement (task 7.9) describe behavior the actual mirrored check — `rejectCompanionBinding`
   — cannot produce, contradicting design.md's own (accurate) description of the same check two
   sections earlier.**

   Read `PanelService.scala:476-495` directly:
   ```scala
   /** 400 when `dataTypeIdOpt` resolves to a companion DataType (`sourceId`
    *  defined) — panels may only bind to pipeline-output types. A `None`
    *  input (no binding attempted) or a type that doesn't resolve for this
    *  owner (nonexistent / cross-user) both pass through unchanged: the
    *  latter preserves the existing silent-unbind-on-read behavior instead
    *  of turning it into a 400. */
   private def rejectCompanionBinding(
       dataTypeIdOpt: Option[DataTypeId],
       user: AuthenticatedUser
   ): Future[Either[ServiceError, Unit]] =
     dataTypeIdOpt match {
       case None => Future.successful(Right(()))
       case Some(dataTypeId) =>
         dataTypeRepo.findByIdOwned(dataTypeId, user).map {
           case Some(dt) if dt.sourceId.isDefined =>
             Left(ServiceError.BadRequest("Panels can only bind to pipeline-output data types"))
           case _ => Right(())
         }
     }
   ```
   `dataTypeRepo.findByIdOwned` (`infrastructure/DataTypeRepository.scala:85-90`) filters by
   `r.ownerId === ownerUuid` **at the query level** — a foreign-owned `dataTypeId` returns `None`
   just like a nonexistent one, and `None` falls into `case _ => Right(())`: **no rejection**. The
   function's own doc comment says this explicitly: a cross-user dataType "pass[es] through
   unchanged," preserving "the existing silent-unbind-on-read behavior instead of turning it into a
   400." The ONLY trigger that actually 400s is an **owned** dataType whose `sourceId` is defined
   (a companion, non-pipeline-output type) — ownership is not the discriminator at all.

   design.md's own D2a text gets this right: *"rejectCompanionBinding (`dataTypeRepo.findByIdOwned`,
   rejects a companion, non-pipeline-output binding)"* — no "foreign-owned" claim. But two artifacts
   downstream of that same decision assert the wrong trigger:
   - `specs/patch-set-apply/spec.md` (new requirement, "Scenario: A panel-update edit referencing a
     foreign-owned dataTypeId is rejected pre-apply"): *"WHEN a patch set includes a panel-update
     edit whose config patch sets `dataTypeId` to a DataType the caller does not own THEN
     pre-validation rejects the whole patch set"* — this is factually false for the mirrored check.
   - `tasks.md` task 7.9: *"a panel-update edit whose config patch carries a foreign-owned
     `dataTypeId` is rejected pre-apply"* — same false claim, framed as a required test.

   This is a real, blocking inconsistency, not a nit: task 3.2 explicitly instructs "run
   `rejectCompanionBinding`/`rejectUnresolvableMetric`'s SAME checks... mirrors
   `PanelService.scala:483-524` exactly, not reimplemented, just invoked earlier" (design.md D2a's
   own words). A faithful implementation of that instruction will NOT reject a foreign-owned, non-
   companion `dataTypeId` — so task 7.9's required test, written as specified, would either (a) fail
   against a correct implementation, forcing the executor to notice the contradiction mid-execution,
   or (b) get "fixed" by bolting on an ownership check that doesn't exist on the real
   `PanelService.update` path — which would silently reintroduce exactly the class of bug the last
   three rounds have been hunting (pre-validation diverging from the real service's actual ACL rule),
   just inverted: **too restrictive** instead of missing a check, rejecting patch sets the real
   `PATCH /api/panels/:id` route would actually accept (and merely normalize/clear on read).

   By contrast, the other three D2a checks are correctly grounded and semantically accurate:
   `rejectUnresolvableMetric` (`PanelService.scala:508-524`) genuinely 400s on `None` (foreign or
   nonexistent `metricId`, confirmed at line 516-517) — the "foreign-owned X is rejected" framing IS
   true for `metricId`. Pipeline-create's `sourceDataSourceId` check and pipelineStep-update's
   Join/Union/Lookup `DataSource` checks likewise genuinely reject on `None` (confirmed
   `PipelineRepository.scala:212-213`, `PipelineService.scala:451-453,570-573` etc. all
   `case None => Left(...)`). Only the `dataTypeId`/`rejectCompanionBinding` case is mischaracterized.

   **Fix:** correct `specs/patch-set-apply/spec.md`'s scenario and task 7.9 to match
   `rejectCompanionBinding`'s REAL trigger — e.g. retitle/rewrite the scenario as "A panel-update
   edit binding to an owned companion (non-pipeline-output) `dataTypeId` is rejected pre-apply," with
   the WHEN naming an *owned* companion-type `dataTypeId`, not a foreign-owned one. If a genuine
   "foreign-owned reference is rejected" test is wanted for this bullet of D2a, use `metricId`
   instead (whose real check does support that framing) rather than `dataTypeId`. Either way, the
   scenario/test text must stop asserting a rejection trigger `rejectCompanionBinding` cannot
   produce, since D2a's explicit instruction is to mirror the real check exactly, not invent a new
   one.

### Non-blocking notes

- `PipelineService.addStep`/`updateStep`'s `LookupConfig` check only runs
  `dataSourceRepo.findByIdOwned` when `lc.referenceDataSourceId.nonEmpty` (the picker's own default-
  empty seed value is treated as an incomplete draft, not a violation — `PipelineService.scala:477-
  482`). Task 3.2/D2a's "mirrored, not reimplemented" instruction should cover this automatically if
  followed literally (e.g. by extracting/reusing the exact existing check rather than hand-rewriting
  it), but neither design.md nor tasks.md calls out the `nonEmpty` guard explicitly the way it calls
  out other nuances — worth a one-line mention so an implementer copying the check by hand doesn't
  drop it and start rejecting benign empty-draft Lookup steps.
- (Carried from round 1, still open, still non-blocking) D4's `EditOutcome{index, status, newId}`
  has no per-edit failure reason.
