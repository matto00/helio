## Standing Constraints

(none yet)

## 1. Red first

- [x] 1.1 Backend route-level repro on UNMODIFIED code: seed trunk `head -> a -> d`, step `x` (not under `a`) with a lane to `d`; PATCH `a` to a lane-kind join/union/lookup naming `x`. Record the 200 (red), then run the pipeline and record the `Cyclic or unresolved lane reference` failure. Commit the test only after it goes green with the fix; record the red evidence in the executor report.
- [x] 1.2 Same for create (an insert that re-parents `d` under the new step, lane to `x`) and reorder (a reorder that makes an existing lane reference lane-transitively cyclic), each red on unmodified code.

## 2. Backend: one implementation

- [x] 2.1 `LaneCycleViolations`: add `dependentsOf` (cycle-safe reverse closure over parent + lane edges), the `DependentViaLane` relation, and the single classifier (design D1/D2); `of` reports lane-linked dependents.
- [x] 2.2 `LaneScope` gains `dependents`; update/create/duplicate build it per design D4; `validateLaneReference` uses the classifier and keeps every existing message, status and precedence byte-identical; adds the D3 message.
- [x] 2.3 Reorder message uses the new relation's `describe` (D3); `introduced` semantics unchanged.
- [x] 2.4 Positive proof (design D2(b)), scoped to the write-time lane cycle check on create/update/duplicate/reorder: show (grep + code citation) that `validateLaneReference` and `LaneCycleViolations.of` get the relation and its sets only from `LaneCycleViolations`, and that the `LaneScope` built by create/update/duplicate uses `LaneCycleViolations`' builders. Root removal (`PipelineRootWrites`), the engine's run-time check and `PipelineCreatePreflight` are out of scope and unchanged.

## 3. Backend tests

- [x] 3.1 Pure unit tests for `dependentsOf` and the classifier: descendant, lane-linked dependent, multi-hop (two lane hops), diamond, legacy cyclic graph terminates, precedence (a descendant reports Descendant, not DependentViaLane).
- [x] 3.2 Route tests: update/create/reorder lane-transitive rejections (400, exact message, no persistence/placement change); re-saving a step's current valid lane target succeeds; a lane to a node upstream only through another step's lane link succeeds; duplicate of a valid lane step succeeds; every pre-existing lane-check test unchanged and green.

## 4. Frontend

- [x] 4.1 `computeDependentIds` in `laneLayout.ts` + unit tests (D6).
- [x] 4.2 `SecondaryInputPicker` disables ancestors and dependents with the existing cycle label; picker test.
- [x] 4.3 e2e `e2e/hel1521-lane-picker-dependents.spec.ts` (D7), run green locally with the run's own dev servers.

## 5. Follow-up

- [x] 5.0 Follow-up filed by the orchestrator at Planning: HEL-1543 (label Follow-up, relatedTo HEL-1521) -- the picker's `computeAncestorIds` disables the step's own current lane target and nodes upstream only through another step's lane link, both of which the server accepts (design Non-Goals). The executor does NOT change `computeAncestorIds`; the PR body cites HEL-1543.

## 6. Gates

- [x] 6.1 Backend: the relevant ScalaTest packages as foreground shards (pipelines services, routes/pipelines, domain/pipelines, patchsets), each under 600 s; report exactly what ran.
- [x] 6.2 Frontend: lint, typecheck, format:check, jest (maxWorkers 3, nice -n 19).
- [x] 6.3 `openspec validate lane-link-cycle-rejection --type change`.
- [x] 6.4 `files-modified.md` with complete repo-relative paths.
