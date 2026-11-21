## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 418e34d528d4084c308842449035dbac3092f49a (branch bug/mcp-analyze-grantee-owner-schema/hel-1799).
Diff base: 2f6d44104ec5060c53c7eca7385ba01e6a0f0875, resolved live with resolve-review-base.sh. Commits: 5fd9d9562 (red spec plus record), 418e34d52 (fix).

### Phase 1: Spec Review — PASS

AC trace:
- AC1 (red first: a grantee's concise analyze of a valid shared pipeline reports no step problem). `Hel1799GranteeConciseAnalyzeSpec` tests 2 and 3 (CSV root and dataset root, `$amount * 2`, editor and viewer). Commit 5fd9d9562 adds the spec and red-run.txt and touches no `src/main` file, so the red run was committed before the fix. I reproduced the red myself: I checked out the base `PipelineAnalyzeReads.scala` in a throwaway detached worktree at HEAD and ran the spec. It failed 5 of 8, and the editor got `Vector(Some("Unknown field: amount"))`. The UUIDs in that run are fresh (they appear in no executor evidence), so the result was not replayed from a cache.
- AC2 (no column names or types beyond today's, no live row count, on `helio_app_test` NOBYPASSRLS). Test 1 pins `current_user = helio_app_test`, `rolbypassrls = false` and `rolsuper = false` on the app pool. Test 5 checks the serialized grantee JSON: the top-level key set is exactly `{nodes}`, each node's keys are a subset of `{path, op, validationError, warnings}` (so there is no row-count field), there is no source name, and none of `amount`/`flag`/`float`/`boolean` appears. Test 6a shows grantee warnings stay caller-view (None) while the owner's name the columns. On main, a grantee got `Unknown field: flag`. After the fix the grantee gets less than before, never more.
- AC3 (stranger gets the same not-found). Test 6 asserts `Left(ServiceError.NotFound("Pipeline not found: <id>"))` exactly. The code path is unchanged: `findByIdShared` returns `None` before any root read.
- Owner rulings: the owner's schema decides validity (`ownerRootSchemas` reads through `findByIdOwnedByInternal`). Grantees get no new schema data (path, op and warnings are still computed from caller-view `projections`). Reasons are neutral (the existing `nonOwnerValidationError`, test 4). Concise has no row count and none was added.
- No silent reinterpretation of an AC. There is no scope creep: the only `src/main` file touched is `PipelineAnalyzeReads.scala`, and the change in `analyze` is a pure extraction.
- No regressions. These all pass unmodified: `Hel1661GranteeAnalyzeVerdictSpec`, `PipelineAnalyzeRoutesSpec`, `PipelineAnalyzeSchemaWarningsSpec`, `PipelineAnalyzeConciseByteBudgetSpec`, `UpsertTargetWritableRoutesSpec` (74/74 in my targeted run), plus the full suite below.
- API contracts: no wire-shape change, so no schema update is needed. The spec delta `specs/pipeline-analyze-api/spec.md` matches the implementation.
- CONSTRAINTS (C1-C5, C12-C14): honored in the diff. C12 (red first, mutations, commit the red before the fix) is met.

Minor deviations (non-blocking, see Suggestions):
- tasks.md 3.1-3.3 are still unchecked. I verified each one independently (3.1 and 3.3 by my own runs). For 3.2, the evidence file `mutations.txt` exists and I re-ran one mutation.
- design.md's test plan labels test 5 and test 7 `[PIN]`, but the spec labels them `[DEFECT]` / mixed `[PIN]...[DEFECT]`. The relabel is correct: my run of the main code shows both tests red there. The planning doc was not updated to match.
- design.md test 5 and 6a said grantee `warnings` would be "asserted literally" against main's value. The spec asserts empty/None. That is the value main produces (my main-code run shows those warnings assertions passing), so the intent is met.

### Phase 2: Code Review — PASS

Gates, run fresh by me in WORKTREE_PATH (the change is backend-only, no `frontend/**` files):
- `sbt testFull`, sharded 6 ways (`HELIO_TEST_SHARD_INDEX=0..5`, `HELIO_TEST_SHARD_COUNT=6`, `nice -n 19`, `-J-Xmx3g`, lane DB env), all exits 0. Per shard: 1137 / 1649 / 2056 / 1703 / 2042 / 1621 succeeded, 10,208 tests total, 0 failed. 5 tests were canceled; these are the opt-in measurement/heap tests that run only under `HELIO_MEASURE`. Shard 3 first ran into my own 285 s `timeout` wrapper (exit 124) and passed on a rerun with a longer cap; this was not a test failure. `Hel1799GranteeConciseAnalyzeSpec` ran inside shard 4.
- `npm run check:scala-quality`: clean (soft file-size warnings only, all of them pre-existing).
- Targeted run of the new spec plus the 5 neighbouring analyze specs: 74/74.

Mutations (my own runs, in a detached throwaway worktree at HEAD, removed afterwards; WORKTREE_PATH code untouched):
- Base `PipelineAnalyzeReads.scala` (m1-equivalent revert): 5 failed (tests 2, 3, 4, 5, 7), matching red-run.txt.
- m3 (concise `warnings` computed from owner projections): test 6a turns red (`available: amount, flag` leaks to the editor), 7/8 otherwise green. This matches the executor's mutations.txt.

Code:
- Canonical compliance: no inline FQNs (the check passes). `PipelineAnalyzeReads.scala` grows from 343 to 367 lines. That is over the ~250 soft budget but under the ~400 split threshold, and the file was already over budget before this change.
- DRY: `ownerRootSchemas` and `nonOwnerValidity` are one shared implementation used by both `analyze` and `analyzeConcise`, so the two modes cannot drift apart.
- Behaviour-preserving extraction in `analyze`: the old code mapped `enabledSteps.flatMap(projections.get)` and then applied the owner-view mapping. The new code maps the whole `projections` map and then takes the enabled steps. The result is identical, and `Hel1661GranteeAnalyzeVerdictSpec` stays green unmodified.
- Type safety, error handling, security: no new escape hatches. The owner-view read uses the existing internal accessor, and its output only feeds `nonOwnerValidationError`, which emits only text the grantee could already derive, or the neutral sentence.
- Tests are meaningful: each tagged DEFECT test is red on main, and each mutation kills a named test.
- No dead code and no TODOs.
- Test harness: the spec copies the two-role `helio_app_test` setup from `Hel1661GranteeAnalyzeVerdictSpec`. About 30 specs follow this existing copy-per-spec pattern; there is no shared fixture to reuse, so this is not a DRY violation introduced here.

Process finding: there is no `files-modified.md` executor handoff in the change dir. The diff was the review surface, so this did not block the review.

### Phase 3: UI Review — N/A

No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` file changed (the spec delta sits under `openspec/changes/`). There is no wire-shape change. No servers were started.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- Tick tasks.md 3.1-3.3 (the evidence exists), and update design.md's test-plan labels for tests 5 and 7 to `[DEFECT]` so they match the spec and red-run.txt.
- Write a `files-modified.md` handoff in future cycles.
- Test 4 could also assert the grantee's error equals `PipelineAnalyzeReads.NeutralStepError` exactly. Today it is covered only indirectly, by test 7's agreement with the full route.
