## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `3c0ed6ce342c0c1a297d739a990e5ea18e8e55d5`. The change dir is untracked, so the artifacts were reviewed as they are on disk. The spawn-cwd guard returned `READY ambient=/home/matt/Development/helio branch=bug/cast-legacy-target-edit-loss/HEL-1514`. I did not reopen the owner's `row-hint` ruling.

### What I verified (with evidence)

**Round-1 change requests:**

1. **CR1 (AC3: the authorization gap had no "pinned" plan and no post-ruling branch): RESOLVED.**
   - design.md D4 now has two branches:
     - (a) Close: add the `secondaryDataSourceId` + `findByIdOwned(caller)` check, which returns create's 404. The test goes from red to green, and a spec requirement and scenario are added.
     - (b) Accept or defer: add a characterization test that pins today's permissive behaviour, with a comment naming the ruling or spinoff. No spec change.
   - tasks.md 1.3 raises the ESCALATION with the repro and the data-reach evidence BEFORE 2.x. Task 2.3 implements whichever branch the owner picks.
   - D5 places the secondary-source check first, and only under branch (a).
2. **CR2 (deferred-decision placeholder in the `pipeline-step-lifecycle` delta): RESOLVED.**
   - The delta now covers only lane and upsert. Each has a concrete scenario.
   - The authorization behaviour lives in design.md D4. Spec text is added only under branch (a).
3. **CR3 (cast delta contradicts the live spec): RESOLVED.**
   - `specs/pipeline-cast-op/spec.md` now has a `## MODIFIED Requirements` block. Its header is byte-identical to the live one (`openspec/specs/pipeline-cast-op/spec.md:65`).
   - Rows are now the schema columns, then the stored keys that are not in the schema, sorted.
   - The table is empty only when both `inputSchema` and `casts` are empty.
   - The "Empty inputSchema" scenario was updated to match.
   - All 7 live scenarios are restated, so none is dropped on archive. A new scenario covers an orphan key.

**Fresh review against the live tree:**

- **Premises in design.md still hold:**
  - `stepCardFieldHandlers.ts:79` is `persist({ casts: next })` with no `captureErrors`.
  - `useStepCardPersist.ts` surfaces a rejection only when `captureErrors` is set, and it clears `saveError` at the start of each new attempt. So the spec claim "after keep as is the error is gone" is mechanically supported once captureErrors is on.
  - `PipelineStepWrites.scala:234-299` `duplicateStep` runs only editor access, `rawConfigProblem` and the codec round-trip. There is no secondary-source, lane or upsert check, so the D4 audit premise is accurate.
- **No conflict with existing lifecycle requirements.** The live requirement at `pipeline-step-lifecycle/spec.md:114` keeps drafts with an unset secondary-source id duplicable. The new ADDED requirement only rejects a lane or upsert reference that create would reject, so it is consistent. The live duplicate requirement (line 53) lists no reference checks, and adding them is additive.
- **D4 handles a scenario that does not reproduce explicitly:** record the evidence, drop the scenario from the delta, and add no check. That avoids normative spec text that has no test behind it.
- **Round-1 non-blocking notes were absorbed:**
  - D1 is now definite (the `FillNullConfig` pattern inside `CastFieldsConfig`).
  - D2 names the `pipeline-detail-page__compute-fields-hint` precedent and uses `useId` ids.
  - D4 covers the lane cycle-via-reorder case.
  - D3 explicitly accepts plain rows for supported orphan keys.
- **AC coverage:**
  - AC1: tasks 3.1 and 4.1 (red-first plus a mutation check).
  - AC2: D2/D3 and tasks 3.2/3.3, implementing the owner's `row-hint` ruling.
  - AC3: tasks 1.2, 1.3, 2.1 to 2.3.
- **Scope and contracts:** no scope beyond the ACs. No API, schema or migration change, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

- **Who adds the branch-(a) spec text.** D4 branch (a) says "The planner adds a requirement and scenario" to the lifecycle delta. By then the run will be in execution. The orchestrator should route that delta edit explicitly, to the executor or a re-plan, so it is not missed. The final gate will check that the delta matches the ruling.
- **A rejected edit stays selected.** After a 422, the local `casts` state keeps the user's rejected selection (for example `qty` = `integer`) next to the error. This is the same as fillnull, window and pivot, and the visible error satisfies AC1. At the final gate I will judge whether the card still reads as "saved".
- **Test-first order for the secondary-source test.** The task 1.2 secondary-source test is red against current behaviour. Under branch (b) it must be inverted into a characterization test (green on today's behaviour), not committed red. Task 2.3 implies this; the executor should not leave a red test in the tree while the ruling is pending.
