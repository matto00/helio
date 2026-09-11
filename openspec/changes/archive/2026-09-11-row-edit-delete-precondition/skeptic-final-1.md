## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed commit: `b4f90c612a6700192b4fb5862a10addc10cc57b7`. Review base resolved live via
`resolve-review-base.sh` gave `39576df8` (HEL-1077 merge). Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**Ground truth read:** the full diff `39576df8...HEAD` (backend main/test, frontend service/types,
3 new JSON schemas, the change's artifacts), plus `DatasetRowValidator.validate/validateRow`,
`DataSourceRepository.lockSource/appendRows/replaceRows/findByIdOwned`, `DbContext.withUserContext`
(`.transactionally`), V106 `dataset_rows` DDL and RLS policy, and the RLS harness setup in
`RlsOwnerTablesSpec` (app pool `SET ROLE helio_app_test`, NOSUPERUSER and not BYPASSRLS).

**Fresh test run.** I ran this myself in a scratch `git archive HEAD` copy, so the review worktree
was never touched. `sbt testOnly RlsOwnerTablesSpec DataSourceRoutesSpec` gave
`Tests: succeeded 136, failed 0`: the 134 existing tests plus the 2 probes below. Worktree gates:
`npm run typecheck` exit 0, eslint on the 2 changed TS files exit 0 at `--max-warnings=0`,
`check:schemas` in sync.

**AC1: two concurrent appends both land.** The test is `DataSourceRoutesSpec` "both land with
distinct, increasing seq when issued truly concurrently". It starts two `appendRows` futures at once
and gathers them with `Future.sequence`, on a pool with 10 connections. **Mutation-verified:** I
replaced `lockSource(id)` in `appendRows` with `DBIO.successful(())` and the test FAILED (run1:
`both land ... *** FAILED ***`). The test is a real concurrency proof, not a sequential one in
disguise.

**AC2: a stale-precondition edit is rejected, not silently overwritten.**
- The conditional UPDATE/DELETE filters on `id AND data_source_id AND updated_at`. It runs under
  `lockSource`, and 0 affected rows gives `StalePrecondition`, which maps to 409.
- Dedicated tests cover PATCH and DELETE with a stale sentinel. A round-trip test takes the append
  response's `updatedAt`, uses it to PATCH, uses that response's `updatedAt` to PATCH again, and then
  shows the superseded value gets 409 on DELETE. That proves D4's MICROS convention round-trips.
- **Independent probe (my own test):** 5 rounds of 4 truly concurrent PATCHes that all carry the same
  precondition. Every round produced exactly `OK,Conflict,Conflict,Conflict`. A concurrent PATCH
  racing a DELETE on the same precondition gave `patch=OK`, and DELETE got 409 naming the expected
  and current `updatedAt` (as D8 specifies). Nothing was lost to a silent overwrite.

**AC3: reuse of HEL-1077's validator, ACL and limits with no forked logic.** Checked in the diff:
- Validation is the same `DatasetRowValidator.validate` call as append/replace.
- The lock is the same `lockSource`.
- The ACL/kind path is the same `findByIdOwned` followed by the `DatasetSource` match, in the same
  order (404, then 400).
- `inferred_schema` is recomputed with the same `staticColumnRuntimeType` column-wise computation.
- The row-count limit cannot be exceeded by a single-row PATCH or DELETE, so its absence is correct.

**AC4: cross-owner edit/delete fails under real RLS.** The shipped tests run
`DataSourceService.patchRow/deleteRow` as ownerB on the non-BYPASSRLS app role and get 404, with the
row unchanged. However, `findByIdOwned` also filters `ownerId` in application code, so those tests
alone do not show that RLS is doing the work. I therefore added a probe that calls
`repo.patchRow/deleteRow` directly as ownerB, which skips the service's owner filter, using the
row's real `updatedAt`. Both returned `Left(SourceNotFound)` and the row stayed `["orig"]`. So under
the app role, RLS alone blocks the repository layer: `lockSource` and the schema read see nothing.
Defense-in-depth holds.

**D1: cross-source write guard.** **Mutation-verified:** I removed `data_source_id` from `patchRow`'s
existence read and its conditional UPDATE. The PATCH cross-source test FAILED (run1). The guard
matters and the test catches it.

**D5/D6: error precedence.** Verified in code in this order:
1. `parseInstant`, which returns 400 before any DB call.
2. `findByIdOwned`, which returns 404.
3. The kind check, which returns 400.
4. Inside the lock: the schema read (404), then the scoped row read (404), then validation (400),
   then the conditional mutation (409).

The "invalid AND stale" case returning 400 is tested. The DELETE route handles a missing query
parameter with `.optional`, completing 400 instead of Pekko's rejection path.

**The kind check really returns 400, not just some 4xx.** The shipped csv tests only assert
`>=400 <500`, which would also pass on a 404. In my copy I tightened both to
`StatusCodes.BadRequest` and both passed (`PROBE KIND STATUS: 400 Bad Request` ×2).

**D2: full-row replace.** No merge against `currentRow`, and the validator output is persisted as-is.
Null-clear, default-fill and required-null tests pass.

**D4: precision.** Both new service methods use `Instant.now().truncatedTo(ChronoUnit.MICROS)`
(DataSourceService `patchRow`/`deleteRow`). The round-trip test proves it end to end.

**D8: response shape.** `RowResponse{row{id,seq,updatedAt,data},sourceUpdatedAt}` matches
`schemas/sources/row-response*.schema.json`. DELETE returns 204.

**UI (step 4).** Skipped with a reason. The frontend diff is only two typed service functions and two
interfaces with no consumer, so there is no changed view to screenshot.

No mtime-ordering evidence is used anywhere in this report. All claims rest on test output, mutation
results and cited code.

### Verdict: CONFIRM

### Non-blocking notes
- The csv/non-dataset tests (`DataSourceRoutesSpec` "reject a non-dataset (csv) source with a 4xx
  client error", PATCH and DELETE) assert any 4xx, but the spec requires 400. I verified the real
  status is 400. Tightening the assertion to `StatusCodes.BadRequest` would keep a regression to 404
  from passing silently. This follows the HEL-1077 sibling precedent.
- The RLS tests do not isolate RLS from the application-level `ownerId` filter in `findByIdOwned`.
  A repository-level cross-owner case, like my probe, would make RLS itself load-bearing in the
  suite.
- The DELETE cross-source test is not covered by a mutation of its own. I mutated `patchRow` only;
  `deleteRow` has the same scoping, confirmed in code.
- A short `data` array (fewer cells than declared columns) is accepted and padded by the reused
  validator: trailing cells get their default or null. This slightly contradicts D2(c), which says
  "no silent default-filling", but it follows from AC3's no-fork requirement. Worth a sentence in the
  spec.
- tasks.md 4.1 names `patchDatasetRow`/`deleteDatasetRow`, but the code ships
  `patchSourceRow`/`deleteSourceRow`. This is a cosmetic naming drift.
- `evaluation-1.md` is untracked in the worktree. The orchestrator should commit it with the change
  artifacts.
