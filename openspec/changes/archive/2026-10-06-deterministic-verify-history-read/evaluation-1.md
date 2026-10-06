## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `41f33803a21ade0d601a40d0b1c6a9180329b623` (base `b16bfa1b3`, resolved live via resolve-review-base.sh).

### Phase 1: Spec Review — FAIL

Checked:
- ACs addressed. (1) Determinism: a dedicated, uniquely named DB per run (`helio_verify_<hex>`) is a structural fix. No
  other backend can thin it because the thin DELETE only reaches the database its backend connects to. The run's own
  backend pins interval 1440 / lock-retry 86400 (capped to 1440 by the backend) and waits for the startup pass to
  complete (D2). (2) README section added. Driver requirements: the HEL-1343 interaction is explained (design D1,
  README "Why it holds"), red/green evidence is present, no new deps, and no forbidden files were touched.
- No scope creep. The diff touches only `helio-mcp/{README.md,package.json,scripts/**}` and the change dir. Nothing
  under `backend/`, `frontend/`, `ci.yml`, `playwright.config.ts`, `.gitignore` or any `package-lock.json` changed.
  No npm cache or log files are committed.
- Constraints: C1 holds. Red B "deleted 36" at 09:20:37.899 falls in window 09:19:38–09:21:01. Green B "deleted 18"
  at 09:45:53.728 falls in window 09:45:50–09:45:56. C2 is met per the evidence (stand-ins only); the proof drivers
  are scratchpad-only, so I accept that as a claim. C4 is implemented (`isolatedRun.ts` teardown: "moot" branch).
  C3 is implemented in code (`listenerIsRecordedJvm`, called before register). But C3's second clause ("fix D3's
  'can never receive' wording accordingly") was **not done**. See CR3.
- Spec delta SHALL "stop each started process by its recorded id … reporting any removal it could not confirm". The
  harness process is never confirmed stopped. See CR2.
- The design's D3 javaOptions requirement is not met as stated. See CR1.

Executor-declared deviations, judged:
- **`sbt assembly` jar instead of an exported classpath.** Sound. It is the artifact the Dockerfile ships, the
  recorded PID is the JVM (`nice` execs `java`, so the PID is preserved; my live run's C3 check passed and the PID was
  gone after teardown), and the README documents the build step. Caveat: nothing detects a stale jar (non-blocking,
  below).
- **Lifting `PIPELINE_RUN_RATE_LIMIT_PER_WINDOW` / `RATE_LIMIT_REQUESTS_PER_WINDOW`.** Sound, and it does not weaken
  what the harness proves about the 30-point read. `verify.ts` asserts nothing about rate limiting. Its 429 handling
  (`verify.ts:392-400` backoff loop, `httpClient.ts` retry) is resilience, not an assertion, and `httpClient`'s 429
  path keeps its own unit tests (`src/httpClient.test.ts`).
  - What it does change: the isolated run never exercises those 429 paths live, and it shrinks the harness window
    from about 85 s to about 6 s.
  - The second point could confound the red/green: a fast harness passed 30/30 even on the shared stand-in (the
    evidence's `run2-fastharness-nopurge`). That confound is answered by the pre-lift green run (09:11:37–09:13:03,
    about 86 s window, B deleted 38 on S mid-harness, 30/30). That run varies only isolation.
  - Underneath, the evidence shows a real pre-existing defect: `MAX_BACKOFF_MS = 60_000` (`httpClient.ts:65`) equals
    the MCP request timeout, so a 59 s `Retry-After` kills the tool call (-32001). Plain `npm run verify` and real
    MCP clients are still exposed to it. This needs a follow-up ticket (non-blocking here).
- **CSRF header on token mint.** Correct. `AuthDirectives.scala:195` `CsrfHeaderName = "X-Helio-Requested-With"`, and
  cookie-authenticated writes require it.

### Phase 2: Code Review — FAIL

Gates (fresh, in WORKTREE_PATH; changed files are `helio-mcp/**` only, so neither the frontend nor the backend gate
trigger matches; I ran the helio-mcp-relevant ones):
- `npm run lint`: PASS. `npx eslint helio-mcp/scripts --max-warnings=0`: exit 0.
- `npm run format:check`: PASS. Prettier also passes on `helio-mcp/` and the change dir.
- `npm run check:helio-mcp-types` (tsconfig.typecheck includes `scripts/**`): PASS.
- `npx jest helio-mcp`: 39 suites / 375 tests PASS, including the new `isolatedDb.test.ts` (4 tests).
- `npm ls` in helio-mcp: no dependency or lockfile change (`git diff -- helio-mcp/package-lock.json` is empty). The
  HEL-1204 audit gate is unaffected.
- Live run (once, as permitted): fresh `npm run build` in the worktree, then `nice -n 19 npm run verify:isolated`
  exited 0.
  - DB `helio_verify_a43f26871e8d`, JVM pid 191370 on port 46459.
  - D2: v0=2 → 3 → 4 before register.
  - `points=30 sparkline=30`, `VERIFY OK`, `ISOLATED VERIFY OK (teardown confirmed)`.
  - I confirmed teardown independently: `kill -0 191370` and `kill -0 191543` both report no such process, and
    `dbExists(helio_verify_a43f26871e8d)` is false.
  - Backend log line: `Helio backend listening on /127.0.0.1:46459`.
  - Log: scratchpad `hel1297-eval-isolated.log`.
  - The run's own ledger/log dir `/tmp/helio-verify-isolated-2358dabb/` remains by design (the ledger outlives the run).

Code findings:
- **JVM flags not at parity (spec-divergence).** `helio-mcp/scripts/isolatedBackend.ts:178-191`. `JAVA_OPTIONS` is
  commented "Verbatim copy of `Compile / run / javaOptions`", but it copies only the `Compile / run` addendum
  (`build.sbt:224-235`). It omits the three project-level flags that `Compile / run / javaOptions ++=` builds on
  (`build.sbt:107-121`): `--add-opens=java.base/jdk.internal.ref`, `--add-opens=java.base/jdk.internal.misc` and
  `--add-opens=java.nio.channels.spi/sun.nio.ch`. The prod `Dockerfile` ENTRYPOINT (lines 42-54) also passes all
  three. The isolated backend therefore runs under JVM flags that match neither `sbt run` nor prod. Design D3 says
  the list "builds on the project-level list at :106-120" and must be recorded verbatim.
- **Harness process not confirmed stopped (spec-divergence).** `helio-mcp/scripts/isolatedRun.ts:607`. Teardown does
  `harness.kill("SIGTERM")` fire-and-forget. It never waits for, escalates on, or confirms that the recorded harness
  PID (which is ledgered) has exited, and never reports an unconfirmed stop. The spec delta requires every started
  process to be stopped by recorded id, with unconfirmed removals reported and a non-zero exit. The interrupt
  evidence (3.5) confirmed the harness PID gone only by an external check, not by the script.
- Remaining checklist items are clean:
  - DRY: `parseDotEnv` mirrors `loadDotEnv` semantics.
  - Readability and modularity: split into Db / Backend / Auth / Run modules.
  - Type safety: no `any`.
  - Security: SQL interpolations take only script-generated names or escaped emails. Credentials go to children only
    via `PGPASSWORD` and are never printed.
  - Error handling: bounded waits everywhere, and every failure tears down.
  - No dead code; no over-engineering beyond the design.
- Tests: the pure parsing tests are meaningful guards. Lifecycle behaviour is covered by the forced-path evidence
  (3.4a/3.5/3.5b) rather than by automated tests. That is acceptable for a manual harness.

### Phase 3: UI Review — N/A

No UI-trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**` are all untouched;
the spec delta lives under `openspec/changes/`).

### Overall: FAIL

### Change Requests

1. `helio-mcp/scripts/isolatedBackend.ts:178-191`: make `JAVA_OPTIONS` the effective `Compile / run / javaOptions`.
   That is the project-level list at `backend/build.sbt:107-121` plus the `Compile / run` addendum at :224-235,
   de-duplicated. In practice, add these three flags:
   - `--add-opens=java.base/jdk.internal.ref=ALL-UNNAMED`
   - `--add-opens=java.base/jdk.internal.misc=ALL-UNNAMED`
   - `--add-opens=java.nio.channels.spi/sun.nio.ch=ALL-UNNAMED`

   Then correct the doc comment to say exactly where the list comes from (both build.sbt ranges, matching the
   Dockerfile ENTRYPOINT). Update evidence-probes.md 1.3, which currently says the list was copied from
   `build.sbt:224-235` only.
2. `helio-mcp/scripts/isolatedRun.ts:607`: when the harness is still alive at teardown:
   - SIGTERM that exact recorded PID, then wait bounded (e.g. 10 s).
   - Escalate to SIGKILL on the same PID if it is still alive.
   - If it is still alive after that, push `harness pid <N> still running` into `failures`; otherwise log
     `stopped harness pid <N>`.

   The `stopBackend` loop shape can be reused. This brings teardown in line with the spec delta's "stop each started
   process by its recorded id … reporting any removal it could not confirm".
3. `openspec/changes/deterministic-verify-history-read/design.md:87-91` (D3 "Port and identity"): apply the C3 wording
   fix the design gate required. The psql user-row check runs after `register` (a write), so it cannot by itself
   guarantee that a foreign server "can never receive" anything. State that the C3 listener-identity proof (`ss`
   listener PID == recorded PID, or the recorded JVM's own log showing it listening on that port) runs before any
   write, including register, and that the psql user-row check is a second, post-register confirmation before the
   bootstrap PAT is minted.

### Non-blocking Suggestions

- File a follow-up ticket for the defect the executor surfaced: `helio-mcp/src/httpClient.ts:65`
  `MAX_BACKOFF_MS = 60_000` equals the MCP SDK request timeout, so a near-60 s `Retry-After` turns a 429 into a -32001
  tool timeout. Plain `npm run verify` and real MCP clients are still exposed. The isolated-mode rate-limit lift only
  hides it there.
- `isolatedBackend.ts:280` (C3 fallback): match the port too, e.g.
  ``includes(`listening on /127.0.0.1:${b.port}`)``, so the code mirrors C3's literal "for that port". It is
  semantically equivalent today, because the JVM can only bind its own `PORT`.
- `isolatedRun.ts:581`: warn or refuse when `helio-backend.jar` is older than the newest file under `backend/src/main`.
  Otherwise a stale jar silently verifies old backend code (the same class of trap as a reused dev server).
- `verifyIsolated.ts:4` points at README "Verifying". Naming the subsection "Isolated verify run" would be more exact.
