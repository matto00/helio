## Standing Constraints

- [C1] Never print, cat, source, grep-with-values, `show Test/envVars`, `show Compile/run/envVars`, `printenv`, `env`, or otherwise echo the contents of `backend/.env` or any secret. Inspect `.env` only by KEY NAMES (`sed -E 's/=.*//' backend/.env`). Tests prove absence by key name or hash; never print a value, never print a whole env map.
- [C2] Never edit, move, or delete `backend/.env` (owner's file) and never write under `~`.
- [C3] The D4b wiring guard compares the WHOLE computed `Test / envVars` map to `DevEnv.testEnv` (not just key sets), and on mismatch reports only the KEY NAMES that are missing, unexpected, or differ in value.
- [C4] No evidence, report, commit message or openspec file may contain a `SOME_KEY=<value>` assignment line for any secret-shaped key (the credential-leak check scans `openspec/**`), not even the public CI test value.

## 1. Red-first guard

- [x] 1.1 Add `backend/project/DevEnv.scala` (sbt-free, Scala 2.13/3 common subset, DEFAULT package — no `package` line) with `parseDotEnv`, `testEnv`, `runEnv`, key sets — initially encoding TODAY's semantics (test = parsed `.env`, run = parsed `.env`); wire `Test / unmanagedSources` to include it; verify both the build and `Test/compile` compile.
- [x] 1.2 Add fixture `.env` (dummy values only, all denylisted keys; connector value != CI value; owner email on an allow-listed placeholder domain) and `backend/src/test/scala/DevEnvSpec.scala` (DEFAULT package) asserting D4 by key name / SHA-256 only; run it and record the RED output (key names only) as evidence.

## 2. Implementation

- [x] 2.1 Implement D1 (`testEnv` = fixed CI test-only connector values) and D2 (`runEnv` drops never-forward keys, skips keys present in the process env); `DevEnvSpec` goes green.
- [x] 2.2 Rewire `build.sbt` L140-141: `Test / envVars := DevEnv.testEnv`-equivalent and `Compile / run / envVars` via `Def.uncached(DevEnv.runEnv(...))`; remove `loadDotEnv` from build.sbt (moved). Verify the HEL-924 grouping still receives `Test / envVars`.
- [x] 2.2a Add the D4b wiring guard in `Test / testGrouping` (key-name-only `sys.error`). Record: red against today's wiring BEFORE 2.2 (key names only), green after 2.2, and a mutation red (temporarily restore `.env` loading for Test, confirm failure naming keys, revert).
- [x] 2.3 Add the `envVarKeys` task (D6) wrapped in `Def.uncached`; run it TWICE in one sbt session and confirm output both times output is key names only and that the test set is exactly the two connector keys.
- [x] 2.4 Run the full backend suite locally (`nice -n 19`, `testFull`) and confirm no new failures vs baseline (connector-key specs pass with the fixed value).

## 3. Docs

- [x] 3.1 `MISTAKES.md` Tooling entry: never `show …/envVars` / `printenv` / `env` / `cat` / `source` `.env` in agent sessions; inspect by key names; use `envVarKeys`; note shell precedence + sbt server env capture.
- [x] 3.2 Comment at the build.sbt wiring site and (if present) in `.env.example`/CLAUDE.md noting tests no longer read `backend/.env`; verify `grep` finds the new text.
- [x] 3.3 Concertino lane-brief ticket filed by the orchestrator: CON-247 (verify it exists via Linear; no executor action).
