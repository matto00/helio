## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD `e8161b17bdb969eae5b844f7cdd0b753ab1023ac` (planning artifacts uncommitted under `openspec/changes/window-rolling-frame/`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/window-rolling-frame/HEL-1316`.
- **Owner rulings:** `.concertino/runs/HEL-1316/events.jsonl` line 6 has `escalation.answered` with `["trailing-only","rows-and-days-as-recommended","emit-partial","avg-sum-min-max-count","as-recommended"]`. tasks.md C1-C5 match the line-4 recommendations faithfully. I checked the design against them; the rulings themselves were not up for review.
- **Hand fixtures (arithmetic re-derived):**
  - Rows, N=7, v=1..10. The averages are 1, 1.5, 2, 2.5, 3, 3.5, 4, then 5 (2..8), 6 (3..9) and 7 (4..10). Correct.
  - Days, N=3:
    - 01-01: frame [12-30, 01-01], value 1.
    - 01-02: frame [12-31, 01-02], value 1+2+3 = 6 for both peers.
    - 01-05: frame [01-03, 01-05], value 4.
    - 01-06: frame [01-04, 01-06], value 4+5 = 9.
  - Correct, and the days fixture exercises both the gap and peer sharing.
- **Algorithm soundness (Decision 4):** in both modes, the start and end of each frame are non-decreasing over the date-sorted view. So the sliding BigDecimal sum/count and the monotonic min/max deques are valid. `PipelineRowJson.toDouble` (`PipelineRowJson.scala:69-78`) maps the strings "NaN" and "Infinity" to `Some(non-finite)`, so the design's finite filter is needed and is correct. `DateBucketStep.parseToUtcDate` is `private` (`DateBucketStep.scala:162`), and widening it to `private[steps]` works because `WindowStep` is in the same package.
- **Validation layering vs live code:**
  - `enumProblems` is shared by `validateRawConfig` (`WindowStep.scala:288-291`), `StepConfigValidation.validateWindow` (`:97-107`) and `apply` (`:130`).
  - Every write surface goes through `PipelineStep.rawConfigProblem`: step create, step update, proposal, preflight, and patch-set resolvers.
  - So `FieldRequired` plus `enumProblems` does reach every write surface. The design's layering claim holds.
- **Touchpoint enumeration:** I grepped the live tree for `running_sum|dense_rank` and for `WindowConfig|WindowStep|"window"`. Every enumerating site is either in the plan or generic:
  - `WindowStep`, `ReshapeSchemaInference`, `StepConfigValidation`, `AnalyzeSchemaWarnings`, `RefinementEditShape:176-179`, `helio-mcp/src/tools/write.ts:392-399`, `pipelineStep.ts:104`, `WindowConfig.tsx`, `stepNarrowing.ts`, and `stepCardFieldHandlers.ts`.
  - The analyze protocol and patch-set preview projection are type-generic over `WindowConfig`.
  - No `schemas/` file enumerates window functions.
  - **Missed:** `stepCardFieldHandlers.ts:144-147` has its own hard-coded field-using list (CR 2).
  - Two catalog labels are cosmetic (note below).
- **Spec delta fidelity:** compared line by line against `openspec/specs/pipeline-window-op/spec.md`. Every existing scenario of the three MODIFIED requirements is carried, with "six" correctly changed to "eleven". One unannounced change is the analyze `running_sum` type, `number` to `float` (note below).
- **Analyze/apply type parity:** `inferWindow` (`ReshapeSchemaInference.scala:84-96`) will map `rolling_count` to `integer` and the others to `float`. Apply emits `Int` and `Double`. A parity test is planned (4.6). Sound.
- **Red-first feasibility:** every test in group 4 targets behaviour that does not exist yet. An unsupported function currently throws, the analyze default is `string`, and the frontend has no frame controls. So every test can be observed red first.
- **Seam precedent:** `shared-test-fixtures/join-step-config.json` and `frontend/src/features/pipelines/ui/stepConfigs/JoinConfig.seam.test.tsx`. This was the test for the seam-design question I was asked.

### Verdict: REFUTE

### Change Requests

1. **The seam's client half does not prove the wire shape (design.md Decision 8, tasks 4.8).**
   - The design says a jest test "drives `WindowConfig` and asserts the emitted config equals the fixture config". But `WindowConfig`'s `onChange` emits a `WindowConfigValue`: the local editor state, with `field: ""`, `offset: 1`, etc. (`WindowConfig.tsx:38-45`).
   - The wire payload is built later by `stepCardFieldHandlers.onWindowChange`'s hand-listed `persist({...})` (`stepCardFieldHandlers.ts:139-160`). A test at the component boundary stays green if that handler drops or misnames `frameSize`/`frameUnit`/`field`, which is the most likely wiring bug here.
   - The in-repo precedent already does this properly. `JoinConfig.seam.test.tsx` (HEL-958) drives `StepOpEditor` plus `useStepCardState`, mocks `updatePipelineStep`, and asserts the PATCH body with an exact key set.
   - Required: revise Decision 8 and task 4.8 so the client half drives the real editor stack and asserts the `updatePipelineStep` body against the fixture with an exact key set. The server half then consumes the same file.

2. **The field-carrying list in the persist handler is not in the plan (task 2.3).**
   - `stepCardFieldHandlers.ts:144-147` decides whether `field` is persisted from its own hard-coded `running_sum|lag|lead` list. That list is separate from `WindowConfig.tsx`'s `FIELD_REQUIRED_FUNCTIONS`.
   - If it is not extended, every rolling config the editor saves loses its `field`. The server accepts that as a draft, and it fails at run.
   - Task 2.3 only says "carry/normalize frameSize/frameUnit".
   - Required: name this list explicitly in task 2.3, and preferably derive it from one shared constant. Add `useStepCardState.characterization.test.ts` cases for a rolling payload, carrying `field`/`frameSize`/`frameUnit`, and for a non-rolling payload omitting the frame keys.

3. **A non-integral or out-of-Int-range `frameSize` is silently dropped at write, which contradicts C5 and the spec delta.**
   - `WindowConfig.decode` will use `StepCodecUtil.intOpt`. For a `JsNumber` that `toIntExact` rejects, such as `7.5` or `5000000000`, it returns `None` (`StepCodecUtil.scala:103-108`).
   - So `enumProblems`, which sees only the decoded config, treats the value as an absent `frameSize`, i.e. a saveable draft.
   - The write then persists the re-encoded typed config (`PipelineStepCreate.scala:44-52`, `persistNewStep(..., typedConfig, ...)`). The caller's `frameSize` vanishes from storage, and the run later says "requires frameSize".
   - That violates C5 ("frameSize 1..1000; invalid rejected at save"). It also violates the spec delta's own "Invalid rolling frame is rejected at write time" scenario, since `frameSize` above 1000 includes 5000000000. And it violates `pipeline-step-config-rejection`'s "never stored as a no-op" requirement.
   - MCP and agent callers can send these values directly; this does not depend on the editor's `parseInt`.
   - The repo already knows about this hazard: see `LimitStep.requiredConfigProblems` (`LimitStep.scala:100-105`), which inspects the raw `JsNumber`.
   - Required: specify a raw-JSON `frameSize` check (non-integral or not representable as `Int`, for rolling functions only) in the write rule. Analyze and run must report it the same way. Add test cases for `7.5` and `5000000000` to 4.4.

4. **What the editor shows for a stored config with no `frameSize` is unspecified (Decision 7, task 2.3).**
   - The design says "`windowConfigOf` normalizes them" without saying normalizes to what.
   - The existing `offset` pattern normalizes absent to `1` (`stepNarrowing.ts:719`). That is harmless for `offset` because the server also defaults it to 1. It is not harmless for `frameSize`, which has no server default: absent means a draft that fails at run.
   - If the executor copies the `offset` pattern, a draft written via MCP or a proposal displays "7" while storage has nothing, and the run fails with a message the UI contradicts.
   - Required: state that `WindowConfigValue.frameSize` is `number | null`, that absent displays as empty, and that the 7/`rows` fill happens only on a function switch, as Decision 7 already says for the switch. Add a `WindowConfig.test.tsx` case for a stored rolling config with no `frameSize`.

### Non-blocking notes

- **Analyze order:** task 1.6 and Decision 3 say `validateWindow` reports problems "in the same order as apply". But `StepConfigValidation` (`:49-52`) short-circuits on `validateRawConfig`, so `validateWindow` is never reached when `enumProblems` fires. Example: a missing `frameSize` plus `frameUnit: "weeks"` makes analyze report only the unit error, while run reports the missing `frameSize` first. This is the same pre-existing HEL-1422 asymmetry the `lag`/no-`field`/`offset: 0` case already has. Reword so no test asserts an unreachable analyze ordering. The spec delta itself only pins the run-time order, which is fine.
- **Second capability:** `openspec/specs/pipeline-step-config-rejection/spec.md:198-216` enumerates the window write-time rejections and the accepted drafts. Neither list gains the rolling cases. That leaves two capabilities describing window write validation, with one stale. Consider a small MODIFIED delta there.
- **Unannounced type change:** the delta changes `running_sum`'s analyze type from `number` to `float`. That matches the code (`ReshapeSchemaInference.scala:89`, HEL-895), but neither the proposal nor the design mentions it. Say so. The living spec's Purpose paragraph also still says six functions.
- **Stale MCP type:** `helio-mcp/src/tools/write.ts:399` says "number for running_sum". Task 3.1 should correct it to `float` while it is editing the string.
- **"Ascending" is undefined:** `rowOrdering` treats any direction that is not case-insensitively `desc` as ascending (`WindowStep.scala:183`). Make explicit whether days mode accepts `""`, `"ASC"` or `"foo"` as ascending, which would be consistent with how the rows are sorted.
- **Where a frame error is shown:** give the frame-size input `max={1000}` (and keep `min={1}`). Per the carried spec text, a frameSize/frameUnit/days-ordering 422 marks the *function* control invalid, so preventing the obvious case client-side avoids pointing the user at the wrong control.
- **Labels:** "Window (rank / running total)" appears in `PipelineStepCatalogService.scala:71` and `stepNarrowing.ts:121`. Consider mentioning rolling.
- The 7-row avg fixture, the days gap fixture, the partition interleave and the legacy round-trip together cover all three ticket ACs once CRs 1 and 2 land.
