## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD `6902b57f12a18042daf9b8e4984cc55b2011fc84`. The planning artifacts are untracked in the change dir: ticket.md, proposal.md, design.md, tasks.md and specs/backend-embedded-postgres-isolation/spec.md.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/embedded-postgres-port-race/HEL-1445`.
- **zonky 2.0.7 facts.** I unzipped `~/.cache/coursier/.../embedded-postgres-2.0.7-sources.jar` into scratch `hel1445-zonky` and read `EmbeddedPostgres.java`:
  - Builder.start: lines 577-582 (`builderPort = detectPort()`, `createTempDirectory("epg")`). The builder is mutated.
  - Constructor: `mkdirs(dataDirectory)`, then `initdb()` when `cleanDataDirectory` is set (lines 152-160). A helper-created empty dir is therefore valid.
  - startPostmaster (lines 255-286): `pg_ctl -D <dir> ... -w start` via `ProcessBuilder.start()` with no `waitFor`. It logs `postmaster started as ... on port` at INFO.
  - verifyReady (lines 338-360): a loopback socket connect plus `SELECT 1` only.
  - close (lines 382-412): `pgCtl(dataDirectory, "stop")`, catches Exception, then deletes the dir when clean is set.
  - The D2/D3 premises hold.
- **Round-1 CR1 (unverified classification).** D2 now uses `toAbsolutePath.normalize` on the reported path, never `toRealPath`. It classifies a SHOW or connection failure as unverified, and requires close on every non-return path. The **spec delta, however, has no scenario for this**; see CR2.
- **Round-1 CR2 (concurrency).** `backend/build.sbt:192-200`: the concurrency restriction is replaced only when `HEL924_TEST_GROUP_CONCURRENCY` is set. Lines 210-245 do hash grouping into `HEL924_TEST_GROUP_COUNT` groups (default 8). CI sets 2/4 (`.github/workflows/ci.yml:173-174`). D8 and C5 now mandate 2/4, a single sbt invocation, `nice -n 19` and overlap evidence. The overlap evidence is obtainable: logback's plain pattern is `%d{HH:mm:ss.SSS} ... [%thread]` at INFO (`backend/src/main/resources/logback.xml`), and zonky logs `postmaster started` at INFO. Addressed.
- **Round-1 CR3 (verifier).** D5 now adds a per-file and total completeness check (226 wrapped, 0 unwrapped) and an exact output rule. I checked the rule against `SqlConnectorTlsSpec.scala:37-41`: `.start()` is replaced in place by `)` at the same 10-space indent, then the existing `      )` closes `Some(`. The design's example matches. Addressed.
- **Round-1 CR4 (suite enumeration).** I resolved every D8-named class with grep:
  - `OutputHistoryPayloadsAvailableSpec` is in `com.helio.api`.
  - `OutputHistoryPayloadRoutesSpec` and `JoinStepConfigSeamSpec` are in `com.helio.api.routes.pipelines`.
  - All 10 harness classes exist. They match the 12 `OutputHistoryApiHarness` hits minus the harness itself and `NodePayloadFixtures`.
  - `OutputHistoryPayloadRoutesSpec` reaches the harness through `NodePayloadFixtures extends OutputHistoryApiHarness`.
  - The RLS mutation target is valid: the `CREATE ROLE ... NOLOGIN` is at `OutputHistoryApiHarness.scala:76`, `SET ROLE` is the app-pool init SQL at line 88, and the assertion is at line 120 with callers at `OutputHistoryRoutesSpec:284` and `OutputHistoryPayloadRoutesSpec:106`.
  - Addressed.
- **Census.** `grep -rn "EmbeddedPostgres.builder()" backend/src` gives 226 hits in 221 files. 223 use the exact stringtype form. The other 3 are `SqlConnectorTlsSpec:37`, `PipelineRunCrossInstanceSpec:44` and `LegacyOutputConfigKeysParitySpec:25`. No text follows any `.start()` (225 single-line sites end there).
- **Guard false positives on the current tree.** I found zero existing matches for each of these:
  - `EmbeddedPostgres\s*\.\s*builder` without `()`
  - `EmbeddedPostgres\s*\.\s*start\b`
  - `postgres.embedded._`
  - `EmbeddedPostgres =>`
  - any non-`EmbeddedPostgres` zonky import

  So the D7 rules will not trip on migrated files.
- **Repo checks.**
  - `node scripts/check-spec-structure.mjs` passed (467 specs, 0 issues).
  - `node scripts/check-openspec-hygiene.mjs` printed `openspec/ is clean`.
  - The `## Purpose` heading in a delta has precedent (`2026-10-09-wire-ts-eslint-recommended`).
  - `check:scala-quality` and `check:test-temp-dir-hygiene` exist in package.json. The hygiene script honours `// temp-dir-hygiene: reviewed — <reason>`.

### Verdict: REFUTE

The design is sound and round 1's four items are substantively fixed. Two concrete gaps remain:
- an internal contradiction between D6 and D7 that would put the new guard red on the new regression spec;
- round-1 CR1's explicit "add a spec bullet or scenario" was not done, and the unverified-on-check-failure branch has no test.

The motivating HEL-1470 symptom has exactly the shape of that untested branch.

### Change Requests

1. **D6 step 4 vs D7: the guard flags the regression spec's own exhaustion test.** D6 step 4 calls `startWith(EmbeddedPostgres.builder().setPort(A.getPort), maxAttempts = 2, nextPort = () => A.getPort)`. D7's first offender rule flags any `EmbeddedPostgres.builder` that is "not immediately preceded (whitespace allowed) by `VerifiedEmbeddedPostgres.start(`". `startWith(`, and even `VerifiedEmbeddedPostgres.startWith(`, is not that prefix. The only exemption D7 defines is the per-line marker on the deliberate old-path line (step 2). As designed, `EmbeddedPostgresStartGuardSpec` goes red on `VerifiedEmbeddedPostgresSpec`, and the executor would have to invent an exemption at task 4.3. Possible ad hoc exemptions include a whole-file exemption or accepting any `startWith(`, and either would weaken the guard. Pick one rule in design.md and make D6 and D7 agree. For example, either:
   - (a) D7 also accepts the exact prefix `VerifiedEmbeddedPostgres.startWith(`, which is `private[testkit]` so only testkit code can call it; or
   - (b) the step-4 line carries the same per-line marker, with D7 stating that the marker may appear on exactly the named lines of `VerifiedEmbeddedPostgresSpec` and nowhere else.

   Add the chosen form to the guard's positive/negative pattern cases.
2. **Add the spec scenario for an ownership check that cannot complete, and a test that drives it.** Round-1 CR1 required "Add a spec bullet or scenario covering this". `specs/backend-embedded-postgres-isolation/spec.md` covers only a mismatch ("reaches a different cluster"). It has nothing for a check that throws. Add a scenario: **WHEN** the ownership check cannot complete (the connection or `SHOW data_directory` fails), **THEN** the attempt is treated as unverified, its own instance is closed, it is retried within the bound, and the failure appears in the exhaustion error.

   D6 also only exercises the mismatch path, so D2's check-failure branch (catch, record, close, retry) ships untested. An implementation that lets the `SQLException` propagate would pass every planned test. Extend the `startWith` seam so the spec can force this branch deterministically. For example, add an `observeDataDir: EmbeddedPostgres => String` parameter defaulting to the real `SHOW data_directory`. The spec injects one that throws on attempt 1, then asserts:
   - that attempt's own data dir was deleted (closed);
   - the helper returned a verified instance on attempt 2;
   - with `maxAttempts = 1`, the `IllegalStateException` message carries the recorded failure.

   The real comparison must still run on whatever the observer returns. Add this as a task-2.2 verification line.

### Non-blocking notes

- D4 still says "Attempt 1 uses the builder exactly as the caller configured it". D2 sets a helper-owned data dir on every attempt, so this should read "except its data directory". D4 also says "only failures of the helper's ownership check (D2) are retried, exactly as today", but nothing retries today. Drop "exactly as today".
- When zonky's own `start()` throws (which D4 propagates), the helper-created data dir is not deleted by anyone. Today zonky leaks its own dir in the same case, so this is behaviour-preserving. Consider a best-effort delete in the helper before rethrowing, since the dir is now the helper's.
- Half-bind or early-close race: `close()` can run before the attempt's own postmaster has written `postmaster.pid`, because verifyReady can succeed against the foreign cluster first. `pg_ctl stop` then reports no server and the dir is deleted while our postmaster may still be starting. In the ::1-only half-bind case it could linger briefly. PostgreSQL's periodic lock-file recheck shuts it down once the dir is gone, so this is not a correctness risk for the suite. Mention it in D3 so a stray postmaster line in a loop log is not misread.
- D8 overlap evidence: forked groups are not labelled in the log. "Different forked groups" should be evidenced by distinct zonky `instanceId`/pid values with timestamps overlapping between one instance's `postmaster started` and another's `shut down postmaster`. Say this in D8 so the evidence criterion is checkable.
