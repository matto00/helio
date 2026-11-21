## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 13180246ad2ab41bfed697e422ff419321d9df78 (the planning artifacts are untracked). Paths are under
`backend/src/main/scala/com/helio/` unless stated otherwise.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-undo-panel-naming/hel-1792`.
- **Round-2 CR1 (alert-rule repo) is addressed.**
  - D2 and task 2.2 now use `outputRepo.findVisibleAlertRuleIds`. I read it at `infrastructure/persistence/pipelines/OutputRepository.scala:202-209`.
  - It is batched and runs `withUserContext(user)`, with an `r.ownerId === ownerUuid` filter.
  - `outputRepo` is already a `DraftRestore` constructor argument (`services/pipelines/draft/DraftRestore.scala:24`), so it is never null.
  - Task 2.5 now says `dashboardRepo` is the only new argument. The `ApiRoutes.scala:668` construction site matches.
- **Round-2 CR2 (alert-rule tests) is addressed.** Task 1.2a, D6 cases (e) and (f), mutation (3) and the delta scenario
  "Alert rules on a created Output are named only for their owner" were added. I confirmed that case (f) can be reached
  through the services:
  - `DraftSaveService.editable` (:55-64) admits a pipeline `editor` grantee.
  - `DraftSaveTransaction.apply` inserts with `actingOwner = ownerId` (the pipeline owner, :189), so O belongs to A.
  - `AlertRuleService.create` checks `outputRepo.findByIdOwned(target, user)` (:57), so A can create the rule.
  - The journal row is written under `actor.id` (:215), and `PatchSetApplicationRepository.findById` is scoped to the
    owner (:96-100). So B can undo B's own save, and A's rule is counted for B.
- **The premise and today's leaks are as stated.**
  - `DraftRestore.scala:63,65,83,84` build `panel <id> (Output <id>)` and `alert rule <id> "<name>" (Output <id>)`.
  - `DraftSaveTransaction.cascadeGate`'s Restore branch (:160-168) builds `panel <id>` and `alert rule <id>`.
  - All three refusals are `ServiceError.Conflict`, and none writes anything.
- **D1 reuse is feasible and minimal.** `PatchSetUndoBoundPanels.blocker` (:63-83) and `describe` (:86-91) touch only
  `ctx.panelRepo` and `ctx.dashboardRepo`. Extracting a helper that takes the two repos leaves `blocker`'s text unchanged.
- **D4 (unreachable in-transaction branch, count-only defence in depth):**
  - The fingerprint compare (`DraftSaveTransaction.scala:88`) runs before `impactOf` and `cascadeGate` (:99-100).
  - `PatchSetPipelineDefinition` puts `panelIds` and `alertRules` into each Output's JSON (:49-50, :96-97).
  - So a later bind changes the fingerprint, and D6(d) and mutation (2) expect `PATCH_SET_STALE`, which is sound.
  - The stale message comes from `PatchSetStaleMessage` with a pipeline target only (:66-67).
- **D5 logs.** The draft dispatch (`PatchSetUndoService.scala:76-78`) skips the walk's `log.error` (:104).
  `ServiceResponse.scala:128` maps Conflict to 409, and there is no log call in `ServiceResponse` or in
  `PatchSetUndoRoutes`. Nothing logs the refusal text.
- **D6 fixture mechanics.**
  - P2: `PanelService.duplicate` (:212-222) needs only editor on the dashboard.
  - P3: grant, create and revoke were verified in round 2. I did not re-derive them.
  - Case (d) hook: `ApiRoutes` does not pass `DraftSaveHooks` (the default is `None`, `DraftSaveService.scala:40`). The
    spec must therefore build its own `DraftSaveService(..., hooks)` plus `DraftRestore`/`PatchSetUndoService`, as
    `DraftSaveHarness` and `PatchSetUndoBoundOutputPanelsSpec` already do. That is feasible; see the notes below.
- **Existing assertions that must change** are listed in task 3.1: `DraftSaveUndoSpec` "late-panel" (A's panel on
  `d1`, titled `late`, so it becomes named), and the cascade-removed id assertions.
- **Scope:** the five restated ACs map to D2, D2a, D3, D4, D5 and D6 and to tasks 1.x, 2.x and 3.x. No client change is
  planned, and HEL-1795, HEL-1796 and HEL-1797 are excluded. I found no TODO, TBD or deferred decision.

### Verdict: CONFIRM

### Non-blocking notes

- **D2a wording.** Read literally, "the D3 sentence followed by the D2 sentence with its prefix dropped" would give two
  `nothing was changed.` endings. The parenthetical (one `Undo refused:` at the start, one `nothing was changed.` at
  the end) is the binding reading. The executor should drop D3's trailing clause in the combined form, and test (c)
  should assert the clause appears exactly once.
- **D2 alert-rule clause.** When no owned rule is named, write `K alert rule(s) you do not own`, without a leading
  `and`.
- **Case (d) and the red run.** Case (d) is already green on main, because the fingerprint backstop exists today. The
  red-run record should label it as a guard, not a red-first test. Its hook needs a `DraftSaveService` built with hooks,
  because `ApiRoutes` cannot inject them.
- **Optional mutation.** Swapping `describe`'s RLS-scoped `findById` for an internal read should turn case P3 red,
  because P3's title and E's name would leak. That would make the "counted, not named" half falsifiable by mutation,
  not only by assertion.
