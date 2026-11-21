## Context

`POST /api/patch-sets/:id/undo` (non-draft) runs `PatchSetUndoConflictCheck.checkAll` (Phase 1), then `PatchSetUndoService.restoreAll` (Phase 2). Deleting a created pipeline, step or Output cascades in the database (FK cascades ignore RLS):

- `alert_rules.target_output_id -> outputs(id) ON DELETE CASCADE` (V94:391), and `alert_events` with them (V61).
- `pipeline_schedules.pipeline_id -> pipelines(id) ON DELETE CASCADE` (V62), one per pipeline, owner-only writes (`PipelineScheduleService` uses `findByIdOwned`).
- `pipeline_roots.pipeline_id -> pipelines(id) ON DELETE CASCADE` (V98); `PipelineRootWrites.addRoot` admits the owner or an editor grantee (HEL-1652), attaching a data source the caller owns.

Already guarded: panels (HEL-1720, `PatchSetUndoBoundPanels`), later Outputs and steps (HEL-1795, `PatchSetUndoLaterChildren`, over `PatchSetUndoBoundPanels.doomedRows`), inline dataset roots' later work (HEL-1796, `PatchSetUndoDatasetLaterWork`). Not guarded: alert rules, schedules, extra roots. The draft-save undo (`DraftRestore.dependentsOfCreatedOutputs`) already refuses on alert rules targeting created Outputs, naming a rule only for its owner (`OutputRepository.findAlertRuleDefinitionsInternal` + `findVisibleAlertRuleIds`).

Alert-rule creation (`AlertRuleService.create`) validates the target with `OutputRepository.findByIdOwned`: only the Output's owner can alert on it. A created Output is owned by the applier, so in practice a rule on it is the applier's; an editor alerts only on an Output the editor owns, which on a created pipeline is a later Output that HEL-1795 already refuses. The check still covers every owner (rules can be owned by anyone in principle, and the naming rule hides non-owned ones).

Out of scope (ticket): runs, history, insights (pipeline by-products). Also out of scope: HEL-1797's tidy/split of `PatchSetUndoService` (keep its diff minimal).

## Goals / Non-Goals

Goals: refuse (409, nothing restored) the whole undo when a `pipeline`/`pipelineStep`/`output` create's undo would delete an alert rule, or a `pipeline` create's undo would delete a schedule or a root the create did not make; message per HEL-1720/HEL-1792 naming rules; Phase-2 re-check.

Non-goals: new routes, response schema, client or MCP changes; migrations (V147 stays free); refactoring `PatchSetUndoService`.

## Decisions

### D1. Doomed Outputs: one computation for all three arms
The Outputs an arm's undo deletes are exactly what HEL-1795 computes: `doomedRows(edit).outputs` for `pipeline` and `pipelineStep`, and the created Output (`newId`) for `output`. Add one shared accessor in `PatchSetUndoBoundPanels` (e.g. `doomedOutputIds(edit, ctx)`) and use it for the panel check's Output arms where convenient, and for the alert-rule check, so the sets never drift. Alert rules are read with the existing internal read `findAlertRuleDefinitionsInternal(doomedOutputIds)`.

### D2. Excused sets
- Alert rules: none. A patch set has no alert-rule target kind (verify against the apply's target kinds and say so in the code doc), so every rule on a doomed Output was added after the apply and blocks, whether or not its Output is itself a later Output.
- Schedule: none; a patch set never creates one. Any schedule on a created pipeline blocks.
- Roots (`pipeline` arm only): roots the create made are excused. Extend `JournaledCreatedChildren` with `rootIds: Option[Vector[String]] = None`, filled by `PatchSetApplyService.captureCreatedChildren` from the same post-create read. A row whose `createdChildren` has no `rootIds` (or no `createdChildren` at all) falls back to the HEL-1795 rule for steps: a root is excused iff `created_at <= appliedAt`. Blocking is the safe direction in doubt. Add one small internal read if no existing one returns root ids with `created_at` and data source id.

### D3. Where the code lives (extend, no parallel mechanism)
Extend `PatchSetUndoLaterChildren`: `Later` gains `alertRules`, `schedule` (Boolean) and `roots`; `blocking` computes them; `blockers` emits one string per blocking kind, joined by `checkAll` with `; ` as today. Widen the guarded arms so the alert-rule part also runs for `output` create (the Outputs/steps part stays `pipeline`/`pipelineStep` only, schedule/roots `pipeline` only). Phase 1 wiring stays in `PatchSetUndoConflictCheck.guarded`.

### D4. Message, naming, disclosure
- Alert rules: extract the draft-save undo's rule clause from `DraftRestore.dependentsOfCreatedOutputs` into one shared function (in `PatchSetUndoBoundPanels`, beside `describeBlocking`/`nameList`) and use it from both places. Rule named as `alert rule "<name>"` only when `findVisibleAlertRuleIds` says the undoing user owns it; others counted as `N alert rule(s) you do not own`. `DraftRestore`'s output text must stay byte-identical (its existing specs prove this).
- Schedule: `the pipeline has a schedule that was added after the patch set was applied and would be deleted; remove it before undoing` (no expression, no id).
- Roots: named as `root on data source "<name>"` when the undoing user can read that source (a sharing-aware read), else counted as `N root(s) on data sources you cannot see`, through `nameList`.
- Strings follow the existing shape `edit N (<kind> create): K <noun>(s) were added after the patch set was applied and would be deleted: <parts>; remove them before undoing`. No id anywhere; nothing new logged at INFO+ with ids.

### D5. Phase 2 re-check
- `pipeline`/`pipelineStep` arms: `ifStillUnbound` already re-runs `PatchSetUndoLaterChildren.blocking` before the delete; because D3 extends `Later` (and `isEmpty`/`size`), the re-check covers alert rules, schedule and roots with no new call site. Update `addedDuringUndo` to a count phrase that covers the new kinds (counts only, never names; it is logged at ERROR). Residual window to the service-owned delete transaction unchanged (HEL-1720 D4 / V130 RESIDUAL).
- `output` arm: `OutputRepository.deleteIfUnboundInternal` already locks the Output and counts panels in its transaction; also count `alert_rules` targeting it there and refuse when either is non-zero (no residual window for this arm). Its `Left` must still let `deleteCreatedOutput` produce a counts-only phrase. Keep the existing `PatchSetUndoLaneSpec` caller compiling. Phase 1 for the `output` arm comes from D3.
- `PatchSetUndoService` changes are limited to what this needs (HEL-1797 owns the tidy).

### D6. Tests (red first, `helio_app_test`, assert `rolbypassrls = false`)
New spec file (e.g. `PatchSetUndoLaterAlertRulesSpec`), modelled on `PatchSetUndoLaterOutputsSpec`:
- RED (commit the run before implementation): A applies a pipeline-with-Output patch set; A creates an alert rule on that Output through `AlertRuleService.create`; A undoes through `PatchSetUndoService.undo`: today the undo succeeds and the rule row is gone. Same red for: a schedule A sets via `PipelineScheduleService.put`; a root B (editor) adds via the real `addRoot` path on B's own source; an alert rule on an `output`-create's Output; an alert rule on an Output under a `pipelineStep` create. Probe and record which path each hits today (proving no fingerprint/stale check pre-empts it).
- After the fix: 409 `Conflict`; pipeline, Outputs, rules, schedule, roots and every journaled resource unchanged (row-level assertions); message names A's rule, mentions the schedule, counts B's root without B's source name; no id (assert every relevant id absent from the message).
- A rule A does not own is counted not named (if reachable only by direct insert, label the test as not reachable through the API).
- Excusal: a pipeline create with its roots (multi-root if the create supports it), nothing added: undo succeeds (proves `rootIds`); legacy row without `rootIds`: excused by timestamp, a later root still blocks.
- Phase 2: the re-check string for an alert rule inserted between Phase 1 and the delete (via the helper or a hook, as HEL-1795 did); the `output` arm's in-transaction count.
- Draft-save undo's existing alert-rule specs still pass unchanged (shared helper).
- One route-level check (`PatchSetUndoRoutes` -> 409 body) proving the REST path reaches this blocker and not `PATCH_SET_STALE`.
- Mutations (each must go red, record them): drop the alert-rule blocker; drop the schedule blocker; drop the root blocker; drop the `rootIds` excusal; break the legacy timestamp fallback; drop the in-transaction alert-rule count on the `output` arm.

## Risks / Trade-offs

- [An undo becomes impossible while a rule/schedule/root remains] -> the message says what to remove; owner chose refusal (HEL-1720).
- [A schedule is configuration, not "work"] -> the ticket lists schedules beside extra roots as cascades to check, and a rename of a created pipeline already refuses its undo; a schedule is a later change to the pipeline the patch set did not make, so it blocks like the rename. Not an owner ruling beyond that; the PR states it.
- [Legacy fallback misjudges a root] -> timestamp rule as HEL-1795; blocks in doubt.
- [Phase 2 window] -> unchanged documented residual for the service-owned deletes; none for the `output` arm.

## Migration Plan

None. No schema change (V147 unused). `rootIds` is an optional JSON field with a default; spray reads a missing `Option` as `None`, and older code ignores the extra field (HEL-1493 `inlineSources` precedent).

## Design-gate notes adopted (skeptic-design-1, non-blocking)

- `output` arm Phase 2: widen `deleteIfUnboundInternal`'s `Left` to carry panel and alert-rule counts separately (or use one combined counts-only phrase); never report rules under the panel phrase.
- The shared alert-rule clause is deliberately uncapped (DraftRestore names every owned rule today, byte-identical); say so in its doc so nobody "fixes" it to match `nameList`'s `NameCap`.
- Roots are named through a sharing-aware data-source read for the undoing user (for example `DataSourceRepository.findById(id, Some(user))` or its equivalent; name the read used in the code doc); counting is the default when unreadable.
