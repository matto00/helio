## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 86732687e401aea0e835890e1e3bfc047568320f (HEL-1459), base c587643384d9ccb3b117dcbb5b9d4c2ca082fc70 (resolved live by resolve-review-base.sh).

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (frontend type matches schema): `patchSet.ts` drops `dataType`, adds `output` through `PATCH_SET_TARGET_KINDS`, and adds `parentId?: string`. PASS.
- AC2 (tool description lists `output`): the description is now built from `PatchSetTargetKinds.AllSlashed`, which reads "panel/dashboard/dataSource/pipeline/pipelineStep/output". PASS.
- AC3 (drift test fails CI): there are guards on three sides (backend, frontend, helio-mcp). Each walks `schemas/patch-sets/`. I reproduced them red independently (see Phase 2). PASS.
- The premise-validation extras (preview-response enum, refinement skeleton) are both fixed, and both are covered by a guard. tasks.md: every item is ticked, and each matches the diff. `openspec validate align-patch-set-target-kinds` reports the change as valid.
- Standing constraints:
  - C1 (red first / mutation evidence): there is a transcript for every new test. I checked that each one fails for the stated reason (detail in Phase 2). HONORED.
  - C2 (no `PatchSetPreviewProjection*.scala` edits): `git diff --name-only` has no match for "projection". HONORED.
  - C3 (no new capability): the decoder set is unchanged at six, the preview schema enum only documents existing behaviour, and the UI change is fixture-only. HONORED.
  - C4 (skeleton change limited to the kind list): the only line changed in the `RefinementEditShape.Skeleton` diff is the `kind` line. No `parentId` line and no pipelineStep-create text. The visibility widened to `private[services]` so the guard can read it. HONORED.

### Phase 2: Code Review — FAIL
Gates I ran myself in WORKTREE_PATH at HEAD 86732687e (CLEAN_WORKTREE unset):
- `npm run lint`: exit 0. `npm run format:check`: all files pass. `npm run typecheck`: exit 0.
- `npm test`: root jest 46/46 suites, 447 tests passed. Frontend jest 525/525 suites, 5669 tests passed.
- `npm --prefix frontend run build`: exit 0.
- `npm --prefix helio-mcp run typecheck`: exit 0. The helio-mcp guard has 4/4 tests passing.
- `node scripts/check-schema-drift.mjs`: in sync, 14 assistant-tool surfaces checked. `node scripts/check-scala-quality.mjs`: exit 0 (but see CR1: the checker has a blind spot here).
- Backend: I ran a targeted `testOnly` (as the orchestrator asked, not the full `testFull`) over `com.helio.api.routes.patchsets.*`, `services.patchsets.*`, `api.protocols.patchsets.*`, `domain.patchsets.*`, `api.protocols.assistant.*`, `services.assistant.*`, `api.routes.assistant.*`, `AssistantSystemPromptSpec` and `AggregateFnDocDriftSpec`. Result: 37 suites, 368 tests, 0 failed.
  - **`PatchSetPreviewRoutesSpec` passes**, which the executor had not run. That includes the HEL-1239 output update/delete preview cases.

Checking the executor's evidence claims (I re-ran these myself rather than trusting the transcripts):
- Throwaway detached worktree at 86732687e, removed afterwards; the executor tree is untouched and `git status` is clean.
  - One backend run with three mutations at once:
    - `${AllSlashed}` replaced by the old five-kind literal.
    - `${AllPiped}` replaced by the old five-kind literal.
    - `output` dropped from the preview-response enum.
  - Result: exactly 4 failures, each naming its surface:
    - The schema-enum test names `patch-set-preview-response.schema.json/$defs/EditPreview`.
    - The description test reports "does not name 'output'".
    - The skeleton test reports "does not name 'output'".
    - `PatchSetPreviewResponseSchemaSpec` fails on the 'output' case with "does not have a value in the enumeration".
  - The other 10 tests stayed green.
  - Adding `dataType` to the `patch-set.schema.json` EditTarget enum (the add direction, which the executor did not test) turned exactly one test red in the MCP guard and one in the frontend guard, each showing `+ "dataType"`.
  - Dropping `output` from the frontend `PATCH_SET_TARGET_KINDS` failed `tsc` at the compile-time pin (`TS2322 '"output"' is not assignable`). The type-level red is real.
- The executor's transcripts (mutation1-4, preview-schema-spec-RED, frontend/mcp mutation1-2, frontend RED-prechange) all fail for the stated reason. The failure messages name the mutated surface and the expected/received diffs match the described mutation. One note on `frontend-guard-RED-prechange`: it is a compile-time red (missing export, plus `output` not assignable, plus an unused `@ts-expect-error`), not an assertion red. That is the right red for the type AC.

The `scripts/check-schema-drift.mjs` edit, which was outside the plan:
- It is necessary. With the base version of the script run against the new tree, the drift check fails with "missing from AssistantProposalToolSchemas.scala: panel, dashboard, dataSource, pipeline, pipelineStep, output". The reason: `enumSchema(PatchSetTargetKinds.All: _*)` has no quoted literals for the script to extract, so D1 cannot ship without this edit.
- It is still able to fail. I dropped `output` from `PatchSetTargetKinds.All` and the edited script reported "missing from AssistantProposalToolSchemas.scala: output".
- It fails loudly (throws) if `All`'s declaration shape ever stops matching its regex.
- It is not a `scripts/concertino/` render target, so editing it here is allowed. It should have been listed in design/tasks, but it is in-scope and justified.

Issues:
1. **CONTRIBUTING.md "Imports & Qualifiers" [mechanical] violation.** At `backend/src/test/scala/com/helio/services/patchsets/PatchSetTargetKindsSchemaGuardSpec.scala:56` there is an inline FQN, `java.util.regex.Pattern.quote(word)`, inside the `s"..."` interpolation. CONTRIBUTING.md:70 says never to inline a fully-qualified name when an import would do. `check:scala-quality` misses it only because it blanks string literals, interpolation bodies included, before matching. That is a checker blind spot, not an exemption.
2. **Dead code.** `PatchSetTargetKinds.AllList` (`backend/src/main/scala/com/helio/domain/patchsets/PatchSetTargetKinds.scala:15`) is introduced with the doc "for error messages", but nothing references it. The one error message that lists the kinds, `PatchSetProtocol.scala:157`, still uses `recognizedKinds.mkString(", ")`, whose HashSet order is unspecified.

No other issues on DRY, readability, type safety, security, error handling, test meaningfulness or over-engineering. All three guards were proven able to fail by mutation, and their failure messages name the diverging surface.

### Phase 3: UI Review — N/A
The triggers do match (`frontend/**`, `schemas/**`), but no UI behaviour changes, so there is nothing observable to exercise:
- The frontend changes are confined to:
  - type-level changes in `patchSet.ts` (`EditTarget.kind`/`parentId`);
  - a new exported `PATCH_SET_TARGET_KINDS` const;
  - the tests.
- `grep` over non-test `frontend/src` shows that `PATCH_SET_TARGET_KINDS`/`PatchSetTargetKind` are referenced only inside `patchSet.ts`, so no runtime module imports the const and it is not in the shipped behaviour.
- `EditPreview.kind` stays `string`, and `PatchSetReview` renders it verbatim.
- The `PatchSetReview.test.tsx` fixture swap (`dataType` to `output`) is test-only.
- The schema edits are an enum addition and description text. They document what the backend already returns: `PatchSetPreviewRoutesSpec`'s HEL-1239 output-preview cases pass, unchanged.
- The frontend production build succeeds.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/services/patchsets/PatchSetTargetKindsSchemaGuardSpec.scala:56`: add `import java.util.regex.Pattern` to the top-of-file imports and change `${java.util.regex.Pattern.quote(word)}` to `${Pattern.quote(word)}`.
2. `backend/src/main/scala/com/helio/domain/patchsets/PatchSetTargetKinds.scala:15`: `AllList` is unused. Either use it at `backend/src/main/scala/com/helio/api/protocols/patchsets/PatchSetProtocol.scala:157` (`s"edit target.kind must be one of ${PatchSetTargetKinds.AllList}, got '${target.kind}'"`, which also gives a deterministic schema-order message), or delete the val. Check that `PatchSetProtocolSpec` still passes afterwards, in case any test asserts on the message text.

### Non-blocking Suggestions
- Add `scripts/check-schema-drift.mjs` to design.md D1 / tasks.md, so the planning artifacts record why it changed. The reason: the drift script cannot read the enum when it is spread from a `Vector`.
- Follow-up candidate, not this ticket: `scripts/check-scala-quality.mjs` blanks whole string literals, including `s"${...}"` interpolation bodies, so an inline FQN inside an interpolation can never be flagged. CR1 is a live example.
- `PatchSetPreviewResponseSchemaSpec` lives in test package `com.helio.domain.patchsets` but mixes in an `api.protocols` writer. It would sit more naturally next to the protocol specs. Cosmetic.
