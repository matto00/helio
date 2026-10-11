## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `e8161b17bdb969eae5b844f7cdd0b753ab1023ac`. The planning artifacts under `openspec/changes/window-rolling-frame/` are uncommitted (`git status`: `?? openspec/changes/window-rolling-frame/`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/window-rolling-frame/HEL-1316`.

#### Round-1 change requests, checked against the live tree

**CR1: the seam's client half asserts the real PATCH body. Addressed.**
- Decision 8 and task 4.8 now drive `StepOpEditor` plus `useStepCardState` with a mocked `updatePipelineStep`, and assert the body with an exact key set.
- C10 makes this binding.
- The precedent exists and works this way: `JoinConfig.seam.test.tsx:19-22,89-95,134-135` reads `calls[last][1]`, then checks `toEqual` and the sorted `Object.keys`.
- The pipeline-window-op delta adds a scenario ("Editor builds a rolling config ...") that names the exact seven keys.

**CR2: the hard-coded field-carrying list. Addressed.**
- I confirmed the list is still at `stepCardFieldHandlers.ts:144-147` (`running_sum|lag|lead`).
- Decision 7a and task 2.3 now name it and require the shared constant instead of a second list.
- Task 4.11 adds a mutation-proven payload guard.

**CR3: a non-integral or out-of-Int-range `frameSize` dropped at write. Addressed for write and analyze.**
- I confirmed the hazard is real:
  - `StepCodecUtil.intOpt` (`StepCodecUtil.scala:103-108`) maps `7.5` and `5000000000` to `None`.
  - Every write surface calls `PipelineStep.rawConfigProblem(kind, <caller JSON>.compactPrint)` before decoding: `PipelineStepCreate.scala:36`, `PipelineStepWrites.scala:71`, `PipelineProposalService.scala:295`, `PipelineCreatePreflight.scala:154`, and `PatchSetPipelineStepResolvers.scala:50,223`.
  - So a raw-JSON check inside `validateRawConfig` sees the caller's actual number.
- The plan covers it in four places:
  - Decision 7a and task 1.3 specify the raw check.
  - Task 4.4 tests `7.5` and `5000000000` through REST create, asserting that nothing is stored.
  - The config-rejection delta adds the scenario "Unrepresentable or out-of-range rolling frameSize is rejected, never stored as a draft".
  - The window-op delta says "rejected, never dropped and stored as a draft".

**CR4: what the editor shows for a stored config with no `frameSize`. Addressed.**
- Decision 7a specifies `frameSize: number | null`, that an absent value displays empty, and that 7/`rows` is filled only when the function changes.
- Task 2.2 and task 4.10 ("stored-without-frameSize shows empty") cover it, along with a new spec scenario.
- I confirmed the contrasting pattern is still live: `stepNarrowing.ts:717` normalises an absent `offset` to 1.

#### Round-1 non-blocking notes

- **Analyze-order quirk:** task 1.6 now states that order parity holds only for drafts.
- **Second capability:** there is a new `pipeline-step-config-rejection` MODIFIED delta. I diffed it against the living requirement (`openspec/specs/pipeline-step-config-rejection/spec.md:198`). It is purely additive: one rejection bullet, the extended draft list, and one scenario. Every existing scenario is carried verbatim, and the header matches exactly.
- **`running_sum` float note:** the delta now says "this corrects the earlier `number` wording". Task 3.1 fixes `helio-mcp/src/tools/write.ts:399` ("number for running_sum", confirmed present).
- **"Ascending" is now defined:** "a key is ascending unless its `direction` is `desc`, compared case-insensitively". This matches `rowOrdering` at `WindowStep.scala:183`.
- **Input bounds:** the frame-size input gets `min={1}` and `max={1000}` (7a, 2.2).
- **Labels:** task 2.4 covers them. Both sites are still present: `PipelineStepCatalogService.scala:71` and `stepNarrowing.ts:121`. No spec or test pins the label string (grep found zero hits in `openspec/specs`, `backend/src/test` and `helio-mcp/src`).
- **Living spec Purpose:** task 1.10 covers it. Confirmed that `openspec/specs/pipeline-window-op/spec.md:4-7` still lists six functions.

#### Independent sweep

- **MODIFIED headers:** all three pipeline-window-op MODIFIED requirement titles match living spec lines 11, 70 and 90 exactly.
- **Touchpoints are still accurate at this HEAD:**
  - `WindowStep.scala:95-96` (SupportedFunctions/FieldRequired).
  - `enumProblems` at `:107` is shared by `validateRawConfig` at `:288-291`, by `StepConfigValidation.validateWindow` at `:97-107`, and by `apply` at `:130`.
  - `AnalyzeSchemaWarnings.scala:281` uses `WindowStep.FieldRequired`, so the Decision 2 claim holds.
  - `DateBucketStep.parseToUtcDate` is `private` at `:162`, the same package as `WindowStep`.
  - `pipelineStep.ts:104` has the `WindowFunction` union.
  - No file in `schemas/` enumerates window functions.
- **Draft persistence of `frameSize: null`:** `StepCodecUtil.present` (`:64-65`) treats `JsNull` as absent. So if the editor persists a draft with `frameSize: null`, it stays a draft, provided the raw check uses the same absent semantics (see note 2).
- **Hand fixtures:** re-confirmed unchanged from round 1. Rows N=7 gives 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7. Days N=3 gives 1, 6, 6, 4, 9.
- **Coverage of the three ticket ACs:**
  - AC1 (7-row fixture plus documented partial frames) is covered by task 4.1 and the ADDED scenario.
  - AC2 (partitioning) is covered by task 4.1 and the "Partitions are computed independently" scenario.
  - AC3 (apply/infer parity plus editor) is covered by tasks 4.6, 4.8-4.11 and 2.x.
  - No task is out of scope beyond the owner-approved doc and label edits.

### Verdict: CONFIRM

All four round-1 change requests are addressed in design.md, tasks.md and both spec deltas, and each fix is grounded in code I confirmed live. There are no placeholders and no contradictions that block implementation. Owner rulings C1-C5 are respected.

### Non-blocking notes

1. **Decision 7a's claim that "the check runs from ... `apply` (run), so a stored legacy value is still reported" cannot be true as written. The executor should not try to make it true.**
   - `apply(rows, cfg: WindowConfig)` only ever sees the decoded config.
   - The run path re-encodes the typed config (`InProcessPipelineEngine.scala:508`, `c.encodeConfig(step.configValue)`). `LimitStep.scala:80-99` documents this boundary explicitly.
   - No legacy row can carry a raw non-integral `frameSize` anyway: writes persist the typed re-encoding, and before this change the six-field format drops unknown keys.
   - Implement it as a raw-JSON check called from `validateRawConfig` (and therefore analyze), plus the typed 1..1000 range check in `enumProblems` for `apply`.
   - Do **not** change `apply`'s signature or thread raw config through the engine. That is out of scope, and LimitStep's doc says it was ruled out.
   - The spec deltas only require write-time rejection, so they are already correct.
2. **The raw check should treat `"frameSize": null` as absent**, matching `StepCodecUtil.present`. Otherwise an editor save of a stored draft (`frameSize: null`) would 422 on every unrelated edit.
3. **Exact key set versus `undefined`-valued keys.**
   - Today `onWindowChange` builds `{field: undefined, offset: undefined, ...}` (`stepCardFieldHandlers.ts:154-156`).
   - `Object.keys` counts undefined-valued keys, and the JoinConfig-pattern assertion (`JoinConfig.seam.test.tsx:135`) uses `Object.keys`. So the 4.8 seam would fail on a stray `offset` key.
   - The right fix is to omit the keys with a conditional spread. Do not weaken the assertion to compare JSON round-trips.
4. **Frame-size input handler.** If the `offset` handler pattern is copied (`parseInt` with a `> 0` guard), the field cannot be cleared and accepts `1001`. Consider also guarding `<= MaxFrameSize` client-side, so a 422 does not mark the *function* control invalid for a frame-size mistake.
