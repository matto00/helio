## Standing Constraints

- [C1] The D3 needs-repo predicate must be total: pattern-match (`case o: JsObject`/`case arr: JsArray`), never `asJsObject`/`fields(...)`, so a malformed journal priorState cannot throw before Phase 1.
- [C2] Red-first evidence records the failure mode actually observed (e.g. 200 with a `failed` outcome and half-restored lane vs a 500), never a narrative copied from ticket.md/design.md.
- [C3] The executor's audit evidence names `PanelService.create`'s null-guarded outputId check (PanelService.scala:635) as an out-of-scope collaborator-owned silent skip on the undo restore path.

## 1. Backend

### Backend

- [x] 1.1 Remove `= null` from `PatchSetUndoContext.outputRepo`; add required-param `PatchSetUndoContext.build`; verify compile
- [x] 1.2 Remove `= null` from `PatchSetUndoService.outputRepo`; build context via `build`, expose `private[services] val context`; verify compile
- [x] 1.3 Route all undo `outputRepo` reads through `context.outputRepo` (restoreBoundOutputs, countPlacementsForStep); verify by grep (no bare `outputRepo.` reads left)
- [x] 1.4 Add a pre-Phase-1 needs-repo guard in `undo` returning `PatchSetApplyContext.outputRepoUnavailable`; drop the now-unreachable null branch in countPlacementsForStep; verify via tests 2.x
- [x] 1.5 Pass `OutputRepository` in `PatchSetUndoRoutesSpec`; confirm ApiRoutes:560 named arg is unchanged; verify compile
- [x] 1.6 Update the HEL-914 "nullable-optional" comments and `services/patchsets/README.md` if it describes the old convention; verify by grep

## 2. Tests

### Tests

- [x] 2.1 Structural parity test (undo context == supplied, non-null, same instance; undo fields subset of apply context fields) in PatchSetUndoServiceSpec
- [x] 2.2 Typed-rejection test: null repo + pipelineStep delete with bound Output -> InternalError, nothing recreated (DB-asserted)
- [x] 2.3 Typed-rejection test: null repo + pipelineStep create -> InternalError, created step still present (DB-asserted)
- [x] 2.4 Panel-only application undoes successfully with null repo
- [x] 2.5 Red-first: show 2.2 failing with the 1.4 guard removed, passing with it; record the transcript
- [x] 2.6 Grep unit tests and repo-root `e2e/` for patch-set undo coverage; record result
- [x] 2.7 `nice -n 19 sbt testFull` (<=2 workers) green; record any FirstRunRoutesSpec timeout
