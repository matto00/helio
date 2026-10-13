## Standing Constraints

## 1. Security: access before lane check (AC3)

- [x] 1.1 Write the red-first route test (stranger: lane ref to existing step vs random UUID vs trunk-last step -> identical status/body; viewer-grantee variant -> identical 403s); run it against UNMODIFIED code and capture the failing output in the executor report.
- [x] 1.2 Reorder `StepReferenceChecks.referenceChecksF` to access -> ownership -> lane -> upsert (D4); adapt create/update/duplicate call sites; 1.1 passes; existing StepReferenceChecks/DuplicateStepReferenceChecks/lane specs pass (any moved expectation updated with reason).
- [x] 1.3 Audit patch-set create/update lane paths and `PipelineCreatePreflight.laneChecks` for the same probe; record evidence (file:line) in the report.

## 2. Create position anchor (AC2)

- [x] 2.1 Derive create's `prospectiveParent` from `StepPlacement.resolveCreateAnchor` for every successful arm (D3); keep the fallback on placement failure; remove the "pre-existing mismatch" comment. Verify with a test whose outcome CHANGES between old and new code: single-root trunk A->B->C with a tail T of A (assert the placement that actually happened -- e.g. the created step's `parentStepId == T` -- rather than recomputing execution order), create at `position=2` (anchor T, re-parents nothing) with lane ref to B -> step is created (201) and B is not moved under it (red on old code: 400 "ancestor", because old code took ancestors from trunk-last C); same placement with lane ref to T or A -> 400 naming the cycle, nothing persisted.

## 3. Reorder lane cycles (AC1)

- [x] 3.1 Add ONE pure lane-cycle-violations function (D1), in a package both the repository and the service can reach (e.g. `com.helio.domain.pipelines`; `ancestorChainOf`/`descendantStepIds` are private[pipelines] to services), with unit tests (self/ancestor/descendant, tails included, no-lane pipelines empty).
- [x] 3.2 Check newly introduced violations inside `reorderTrunkInternal`'s transaction; roll back via `DBIO.failed` inside `.transactionally` (a `Left` after the updates would COMMIT them), with a `.recover` in `reorderSteps` mapping it to 400 (never a 500), and return a distinct lane-cycle result mapped to 400 by `reorderSteps` (D2). Verify with tests: the tail-of-A-lanes-to-C example reordered to C,A,B -> 400 naming the cycle and every step's parent/root/position unchanged (red on old code); a benign reorder still 200; a pre-existing violation not introduced by the reorder does not block it.
- [x] 3.3 Verify the web editor's reorder-failure path handles a non-2xx (cite the code); no UI change.

## 4. Ownership-check dedup (AC6)

- [x] 4.1 Expose the secondary-source ownership primitive from `StepReferenceChecks` (D5); route `PipelineCreateTransaction` and both `PatchSetPipelineStepResolvers` sites through it; delete the inline copies; messages byte-identical. Verify: `grep -rn "secondaryDataSourceId(" backend/src/main/scala` shows only the codec definition and `StepReferenceChecks` (root-source/proposal `findByIdOwned` checks are out of scope and untouched); existing patch-set/pipeline-create ownership tests pass.

## 5. Pins (AC4, AC5)

- [x] 5.1 Characterization test pinning patch-set rollback (and undo) outcome when a failed apply deleted a tail-adjacent lane step (D6); report whether reality matches the ticket's description.
- [x] 5.2 Test: an edit both stale (target changed since preview) and lane-cyclic gets `409 PATCH_SET_STALE`.

## 6. Gates

- [x] 6.1 Scoped backend tests for every touched spec plus the full backend suite in shards that each finish under 600s (record which shards ran); frontend untouched -> `npm run typecheck`/lint only if any frontend file changed.
- [x] 6.2 `files-modified.md` lists every touched file as a full repo-relative path.
