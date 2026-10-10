## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD e6c37d541c8e3b1b60a0fdfe02345fa311bcbdc9 (planning artifacts are uncommitted in the change dir).
No `.env` value was read or printed; `.env` was inspected by key name only (`sed -E 's/=.*//'`).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/test-env-secret-allowlist/HEL-1450`.
- **Wiring claim (build.sbt L140-141)**: confirmed. `Compile / run / envVars ++= loadDotEnv(baseDirectory.value)` and
  `Test / envVars ++= loadDotEnv(baseDirectory.value)`; `loadDotEnv` is defined at L6-24. `Test / envVars` feeds the
  HEL-924 `ForkOptions(envVars = (Test / envVars).value)` at L216. Both `fork := true` (L116-117).
- **`.env` key names**: DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GCLOUD_DB_PASSWORD,
  ANTHROPIC_API_KEY, CONNECTOR_MASTER_KEY, CONNECTOR_MASTER_KEY_ID, HELIO_OWNER_EMAILS. The spec's denylist covers all of
  them except the two connector keys, which D1 replaces with fixed values.
- **Question 4 (does any test need a `.env` key other than the connector keys?)**: no. The CI `backend` job env
  (ci.yml ~L166-187) is exactly HELIO_TEST_SHARD_INDEX/COUNT, HEL924_TEST_GROUP_CONCURRENCY/COUNT and
  CONNECTOR_MASTER_KEY/_ID, and the four shards together run every suite (TestShards verifies the partition is exact).
  A grep of `backend/src/test` for env reads finds only specs that set or unset their own variables by reflection
  (ClaudeConfigSpec, LocalFileSystemSpec) or that test the "missing ANTHROPIC_API_KEY" path (DashboardAuthoringRoutesSpec),
  so dropping the real key makes local runs behave like CI. The CI existence proof holds.
- **Question 2 (D5, `envVars` is a cached task)**: it matters, and D5 is right. MISTAKES.md L281-284 records that sbt 2
  serves an env-dependent task body from its disk cache because the cache key does not include `sys.env`. The same applies
  to file contents read inside the body: the key is `baseDirectory`, not the file. So the current
  `loadDotEnv(baseDirectory.value)` both goes stale and writes real values into the CAS. `Def.uncached` for the run env is
  required. A constant `Test / envVars` can stay cached.
- **Question 3 (D2 denylist for run)**: I agree with the trade-off. The ticket only asks to narrow `Test / envVars`, and
  D1 fully closes that path. The backend reads about 40 optional env vars (grep: about 29 `sys.env.get` names plus 11
  `${?..}` in application.conf), so an allowlist for `run` would silently break a developer's `LOG_LEVEL` /
  `HELIO_UPLOADS_ROOT` / `CLAUDE_MODEL`. Making shell values win over `.env` correctly covers HEL-1454 item 3.
- **Question 1 (one file compiled by the sbt 2 build and into Test sources)**: there is no duplicate-class conflict.
  The build classpath (meta-build, Scala 3) and the Test classpath (2.13.15) are separate compilations. **But the
  "TestShards precedent" does not hold.** TestShards is compiled only by the meta-build. Nothing adds it to
  `Test / unmanagedSources` and no spec exercises it (grep finds `TestShards` only in build.sbt L222-232). The
  cross-compile is new, and it has a concrete pitfall the design leaves open: **the package.** TestShards.scala has no
  `package` clause. If DevEnv.scala copies it and the spec lives in a `com.helio.*` package like every other suite, Test
  compilation fails. Reproduced with the cached scalac 2.13.15
  (`java -cp scala-compiler/library/reflect-2.13.15 scala.tools.nsc.Main`): an empty-package `object DevEnv` plus
  `package com.helio.build; object Spec { DevEnv.testEnv }` gives `error: not found: value DevEnv`, both when compiled
  together and when compiled separately. Scratch:
  `/tmp/claude-1000/-home-matt-Development-helio/9b21e65f-3fe7-47b2-9c41-c08a39656cd5/scratchpad/HEL-1450-pkg/`.
  Task 1.1 would hit this, and the design does not say which way to resolve it.
- **AC trace**:
  - AC1 (explain why): covered in design Context.
  - AC2 (narrow `Test/envVars`, red-first key-name test of the *computed* `Test/envVars`): partially covered. See CR2.
  - AC3 (MISTAKES.md): task 3.1.
  - AC4 (CON ticket): D7 assigns it to the orchestrator, but no task tracks it. See CR4.
  - AC5 (prod untouched): Non-Goals.
  - AC6 (HEL-1454 item 3): D2.
  - AC7 (GCLOUD_DB_PASSWORD removal is an owner call): Non-Goals and C2.
- **Fixture surface**: `scripts/check-no-credential-in-agent-surface.mjs` scans `backend/src/test/resources/**` with the
  `bcrypt` and `email` checks (L227). A fixture `.env` that includes `HELIO_OWNER_EMAILS` must use an allow-listed
  placeholder domain or the pre-commit gate fails. `.gitignore` ignores only `backend/.env` exactly, so a fixture under
  `src/test/resources` is committable.

### Verdict: REFUTE

### Change Requests

1. **Specify the package arrangement for the shared file (D3 / task 1.1).** As shown above, an empty-package `DevEnv`
   cannot be referenced from a spec in a named package under Scala 2.13. Pick one option and write it down:
   - (a) `DevEnvSpec` lives in the empty package (no `package` clause), with a one-line comment explaining why; or
   - (b) `DevEnv.scala` declares a package (e.g. `package helio.build`) and build.sbt imports it. Confirm that sbt 2's
     meta-build accepts this.

   Also correct D3's "Like `TestShards.scala`" wording. TestShards is meta-build-only and is not a precedent for
   compiling into Test sources.

2. **Guard the build wiring, not only the pure function (AC2: "a test asserting the computed `Test/envVars`").**
   DevEnvSpec as designed tests `DevEnv.testEnv`. If build.sbt went back to `Test / envVars ++= loadDotEnv(...)`, or
   gained any other `++=` source, DevEnvSpec would stay green. That is the incident path, and nothing automated covers
   it: `envVarKeys` (D6) runs only when someone remembers to invoke it. Add an automatic check of the computed value.
   One concrete option: inside the existing `Test / testGrouping` body, which already reads `(Test / envVars).value` on
   every local and CI test run, fail with a key-names-only message if `(Test / envVars).value.keySet !=
   DevEnv.testEnv.keySet`. Then add task steps to show it is failable:
   - red against today's wiring, recording key names only;
   - green after the rewire;
   - optionally, a mutation that re-adds `++= Map("GCLOUD_DB_PASSWORD" -> "dummy")` and goes red.
   Whatever mechanism is chosen, the spec/tasks must say how the *computed* `Test / envVars` is proven, and the red must
   be shown at that level.

3. **Make `envVarKeys` uncached (D6).** It is a side-effecting reporter (it logs key names) and a guard (it fails on
   mismatch). Under sbt 2 caching (MISTAKES.md L281-301), a cached `Unit` task can be a silent no-op on a repeat run:
   no output and no re-check. Say explicitly that its body is wrapped in `Def.uncached`, and that it depends on the
   uncached run env. Add a task-2.3 step that runs it twice in the same sbt server and confirms output both times.

4. **Add a tracked task for the CON ticket (AC4).** D7 says "CON ticket filed by the orchestrator", but tasks.md has no
   line for it, so there is nothing to show it is done. Add e.g. 3.3: "Orchestrator files the CON ticket (lane-brief
   rule: never print `.env`/env maps; key names only); record the CON id in workflow-state.md / PR body".

### Non-blocking notes

- The CI test connector value will then live in two places (ci.yml L186-187 and DevEnv.scala). Consider a comment at
  each site naming the other, or a DevEnvSpec assertion that reads ci.yml and compares by hash, so they cannot drift
  without notice.
- Task 2.4's baseline comparison must not use `show` on any env key. Make sure the executor's verification commands
  follow C1, e.g. `envVarKeys`, never `show Test/envVars`.
- The sbt 2 CAS under `~/.cache/sbt` probably already holds earlier `Test/envVars` results with real values, because
  the old cached body read the file. This is correctly scoped as an owner follow-up, since there are to be no writes
  under `~`. Make sure the PR body raises it.
- The fixture's dummy CONNECTOR_MASTER_KEY value should differ from the fixed CI test value. Otherwise the D4 hash
  inequality is vacuous.
