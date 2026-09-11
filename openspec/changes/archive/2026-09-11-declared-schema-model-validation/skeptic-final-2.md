## Skeptic Report — final gate (round 2, skeptic-final-2.md)

### What I verified (with evidence)

**Gates, re-run fresh in the worktree at HEAD 4f6c83e0:**
- `cd backend && sbt test`: `Total number of tests run: 4105 / Suites: completed 276, aborted 0 / Tests: succeeded 4105, failed 0 / All tests passed.`, EXIT=0. That is +5 over round 1's 4100, matching the new tests.
- `npm run lint`: EXIT=0. `npm run format:check`: "All matched files use Prettier code style!". `npm run typecheck`: EXIT=0.
- `npm test`: `Tests: 248 passed, 248 total` (helio-mcp) + `Tests: 3198 passed, 3198 total` (frontend), EXIT=0. That is +1, the new form test.

**Mutation probes, run in a scratch copy of backend/ + schemas/ + helio-mcp/src (script: scratchpad probe.sh).** Each probe was applied fresh from the pristine worktree files and run against DatasetRowValidatorSpec, DataSourceServiceSpec and RlsOwnerTablesSpec. The unmutated baseline ran before and after: `succeeded 103, failed 0`. The worktree was never modified: `git status --short` is empty.
- (a) `validateValue` short-circuited to `Right(())`: 10 failed. These include the new exact-string non-integral and timestamp tests and the service-level reject tests. RED.
- (b1) `createStatic`'s validate call replaced with `Right(req.rows)`: 5 failed. These include the wrong-type and missing-required service tests, the default-fill read-back test, and the RLS accepted-create test. RED.
- (b2) `applyStaticRefresh`'s validate call replaced with `Right(payload.rows)`: 3 failed (the refresh default-fill read-back, the refresh wrong-type test, and the RLS refresh test). RED.
- (d) Persist the raw rows instead of `validatedRows` on both paths: 4 failed (both new CR3 read-back tests and both new RLS tests). In round 1 this probe was green. RED now.
- (e) New RLS-vacuity probe: I removed `SET ROLE helio_app_test` from the spec's app pool, so the "app" pool runs as superuser. 17 failed, including both new tests: "an accepted createStatic with a default-fill runs as the app role and is RLS-scoped to its owner" and "an accepted refresh ... still RLS-scoped". Their ownerB-sees-empty assertions therefore depend on RLS actually being enforced. RED.

**The 5 change requests, checked against ground truth:**
1. **CR1, one pinned template.** In `DatasetRowValidator.scala` every `validateValue` rejection now goes through `reject` = `s"expected $declaredName, got ${jsonKind(value)}"`. The two bespoke strings are gone: a grep for "non-integral number" / "does not parse as a timestamp" across backend/src, frontend/src, helio-mcp/src and schemas finds only comments. spec.md now pins the kind set as string/number/boolean/object/array/null and adds explicit scenarios for `"expected integer, got number"` and `"expected timestamp, got string"`. Both have exact-string `shouldBe Left(Vector(...))` tests (DatasetRowValidatorSpec l.25-29 and l.43-48), and probe (a) turns them red. design.md l.144's example stays consistent. FIXED.
2. **CR2, real RLS tests.** `DataSourceRepository.insertDatasetSource` and `replaceDatasetRows` both run under `ctx.withUserContext(user.id.value)`, and the spec's `ctx` routes that to the `helio_app_test` pool, so the service writes run as the non-superuser role. The new tests cover:
   - an accepted create with a default-fill: the persisted `dataset_schema` carries `required`/`default`, ownerA sees `[0]` and ownerB sees nothing;
   - an accepted refresh, a `[7]` default-fill, owner-scoped;
   - a rejected refresh after it that leaves `[7]` intact under the app role.

   The old vacuous test is relabeled honestly. Probe (e) proves the new tests observe RLS. FIXED.
3. **CR3, default-fill read-back.** Both the create and refresh tests now assert `readDatasetRows(...).fields("rows") shouldBe [[0]]`. Probe (d) turns them red. FIXED.
4. **CR4, form payload test.** The new test asserts `onSubmit` receives `[["not-a-number"]]` and the columns. I reverted `StaticSourceForm.tsx` to main's version in a scratch copy of frontend/ and the test failed with `Expected "not-a-number"`, `Received NaN`. Restoring the file brought it back to `6 passed`. FIXED.
5. **CR5, "double" to "float" end to end.** The new DataSourceServiceSpec test calls `service.createStatic` with `StaticColumnPayload("amount", "double")` and reads the persisted `columns` back through `readDatasetRows`, asserting `"type" == "float"`. That covers the persisted declaration, not `inferredSchema`. The misleading codec test was renamed to what it actually checks. FIXED.

**Scope and regression checks for this cycle:** the one production-code change is the two reason strings in DatasetRowValidator.scala. Everything else is tests, spec text and bookkeeping (files-modified.md, evaluation-1.md, skeptic-final-1.md). There are no new endpoints, migrations or UI. The full suites are green.

**UI:** the only frontend changes on this branch are a type and a submit-payload parsing fallback, with no visual output. I did not start the app because there's no view to judge. The behavior is now covered by CR4's test.

**ACs, re-traced:** AC1 (wrong type rejected, no coercion) and AC2 (missing required rejected) are met at unit, service and RLS-role level, with exact strings. AC3 (failable probe) is met: probes a, b1 and b2 all reproduce red.

### Verdict: CONFIRM

### Non-blocking notes
- Still open from round 1, for HEL-1077: `validateRow` fills from `default = Some(JsNull)` without re-checking, so a direct Scala caller could persist `null` into a `required` field. The HTTP path is safe. HEL-1077 should normalize `Some(JsNull)` to `None` when it builds declarations.
- The `e.reason == "required"` string sentinel in `renderRowFailures` is still there. A small ADT would be sturdier.
- `helio-mcp/src/helioApi.ts` `StaticColumn` still lacks `required`/`default`. HEL-1077 or a follow-up should own that.
- `jsonKind` can return `"null"`, but the validator never passes it a `JsNull`, because missing values are handled before `validateValue`. spec.md listing `null` in the kind set is harmless.
