## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 2fe4a479b31841c0be928d1005f0f668f0ab01bc. Diff base: ea04f2aa24db7fcdcac9e832f730eec234232fb9 (resolved live with `resolve-review-base.sh`; it is the merge-base with origin/main 38ee89f34). main has moved by HEL-1534, which touches no file in this diff. `git merge-tree` against 38ee89f34 is clean, and no constructor signatures changed on main.

### Phase 1: Spec Review — PASS
- AC1 (red-first route spec, 200 with a correct `after`, apply confirmed): met. `PatchSetPreviewStepKindRoutesSpec` sends requests through `PatchSetRoutes(...).routes`, using `POST /patch-sets/preview` and `POST /patch-sets/apply` with real services and an embedded Postgres migrated to V129. For each kind it tests a position-only update and a config update. It asserts `after.type`, `after.position` and `after.config`. It then applies the same patch set, checks that `status == applied` and that `resultingState` equals the preview's `after`, and reads the persisted position or config back from `pipelineStepRepo`.
- AC2 (missing arms plus a structural guard): met. Three arms were added to each of `withPosition` and `withDecodedConfig`. The guard is driven by `PipelineStep.Registry`, includes a non-vacuity test (`>= 27` kinds, plus the three named kinds), and its factory throws on an unknown kind.
- Driver addition "every missing kind": met. In my red run the guard iterated all 27 registered kinds and named exactly analyzewithai, convertformat and generatetext. No fourth kind is missing.
- No migration, no panel-row lock or trigger code touched (HEL-1534).
- Constraints:
  - C1 holds. The step sits at position 1 among siblings under a `limit` trunk, which is asserted through the repository before the edit. The target index 0 is in range.
  - C2 holds. Each kind's failure is caught with `Try` and every gap is collected; I observed 6 problems reported in one run.
  - C3 holds. `PipelineStep.scala:368` adds the spec to the `PipelineStepKind.All` scaladoc list.
- Tasks 1.1–4.1 are ticked. The spec delta (`specs/patch-set-preview/spec.md`) matches what was implemented.

### Phase 2: Code Review — FAIL

Gates I re-ran myself (backend only; no `frontend/**` changes, so the npm gates do not apply):
- Targeted specs on the fixed HEAD, in the foreground: `testOnly PatchSetPreviewStepKindRoutesSpec PatchSetPreviewProjectionStepsRegistryGuardSpec` passed 8 of 8, and the hel1468 guard reported failed=0 aborted=0.
- Packages `com.helio.services.patchsets.*`, `com.helio.api.routes.patchsets.*` and `com.helio.domain.model.*`: 499 of 499 tests passed across 53 suites, exit 0, hel1468 guard failed=0.
- `npm run check:scala-quality`: clean (soft warnings only). `check:openspec` and `check:test-temp-dir-hygiene`: clean.

Red evidence, reproduced by me: I made a throwaway detached worktree at 2fe4a479b, put the production file back to its ea04f2aa2 version, and ran both new specs. 7 tests failed and 1 passed:
- position-only, all three kinds: 500 Internal Server Error, with a `scala.MatchError` naming ConvertFormatStep, AnalyzeWithAiStep and GenerateTextStep
- config update, all three kinds: 400 Bad Request
- guard: failed, listing all 6 gaps (withPosition MatchError and withDecodedConfig Left for each of analyzewithai, convertformat and generatetext); its non-vacuity test passed

This matches `red-evidence.md` exactly, so the claimed reds are real and reproducible.

Mutation, done independently of the executor's own: on the fixed file I deleted the `ConvertFormatStep` arm from `withPosition` and the `AnalyzeWithAiStep` arm from `withDecodedConfig`. The guard failed and named both gaps in one run (`convertformat: withPosition threw MatchError`, `analyzewithai: withDecodedConfig returned Left(...)`). The guard can go red, on both functions. I removed the scratch worktree afterwards; `git worktree list` shows nothing left behind.

Full suite: I did not re-run `sbt testFull`. The executor's own run was moved to the background, and there is no evidence it finished green, so the "full suite green" claim in task 4.1 is **not evidenced**. My view on whether that is adequate: the production change only adds match arms to `private[services] object PipelineStepProjectionSupport`. That object has exactly two callers, both in `PatchSetPreviewStepProjection`, and every test package that reaches them passed in my run above. No other code changed apart from one scaladoc line. The remaining risk is low, and CI's `ci-complete` runs the full suite before merge. It does not block this verdict, but the task 4.1 tick overstates what the executor showed.

Issues:
1. **Dead code and unused imports in the new route spec**, which breaks the "no dead code / unused imports" standard. It looks like boilerplate copied from `PatchSetPreviewRoutesSpec`. In `backend/src/test/scala/com/helio/api/routes/patchsets/PatchSetPreviewStepKindRoutesSpec.scala`:
   - Unused imports: `UpdateDashboardRequest` (:7), `CreatePanelRequest` and `UpdatePanelRequest` (:8), `UpdatePipelineStepRequest` (:9), `JsonSchemaValidation` (:11, used only by the dead `staleSchema`), `java.time.Instant` (:13), `java.nio.file.Files` (:43).
   - Unused members: `userB` (:82), `staleSchema` (:146, which also compiles a JSON schema for nothing), `seedPanel` (:150), `seedOutput` (:158), `seedPipelineWithStep` (:167), `fingerprintsOf` (:190).
   - The file is 281 lines, over the ~250 soft budget, and the dead code is the reason.
2. **Inline FQNs in the guard spec**, against the CONTRIBUTING.md:70 rule "never inline a fully-qualified name when an `import` would do". `check-scala-quality.mjs` misses this only because `scala.util.` is not in its prefix list. Locations: `PatchSetPreviewProjectionStepsRegistryGuardSpec.scala:59, :63, :69` (`scala.util.Try(...)`).
3. **Inaccurate scaladoc**: `PatchSetPreviewProjectionStepsRegistryGuardSpec.scala:56` says "Empty string when `kind` is fully covered", but `problemsFor` returns a `Vector[String]`, which is empty when the kind is covered.

### Phase 3: UI Review — N/A
No trigger paths changed: there are no `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes. The spec delta lives under `openspec/changes/`, and there is no API shape change.

### Overall: FAIL

### Change Requests
1. `PatchSetPreviewStepKindRoutesSpec.scala`: delete the unused imports on lines 7, 8 (`CreatePanelRequest`, `UpdatePanelRequest`), 9 (`UpdatePipelineStepRequest`), 11, 13 and 43. Delete the unused members `userB` (:82), `staleSchema` (:146), `seedPanel` (:150-156), `seedOutput` (:158-165), `seedPipelineWithStep` (:167-178) and `fingerprintsOf` (:190-195). Then re-run the spec to confirm it compiles and passes 6 of 6. This should also bring the file under the 250-line soft budget.
2. `PatchSetPreviewProjectionStepsRegistryGuardSpec.scala`: add `import scala.util.Try` at the top of the file and replace the three `scala.util.Try(` calls (:59, :63, :69) with `Try(`.
3. `PatchSetPreviewProjectionStepsRegistryGuardSpec.scala:56`: change the scaladoc to "Empty when `kind` is fully covered, else one line per problem naming it."

### Non-blocking Suggestions
- After the cleanup, either run `sbt testFull` to completion in the foreground and record the result, or reword task 4.1 to say it was verified at package level plus CI. Right now the tick claims a green full suite that nobody has shown.
- `PatchSetPreviewProjectionSteps.scala:11`: the reflowed scaladoc line is about 130 columns, much wider than the surrounding lines. Rewrap it to match.
- `seedPipeline`'s scaladoc (`PatchSetPreviewStepKindRoutesSpec.scala`, around :218) says "[X at position 0, <kind> at position 1]", but the kind step is added before X. The position assertion in the test is what actually guarantees C1, so state the ordering the way it is observed.
