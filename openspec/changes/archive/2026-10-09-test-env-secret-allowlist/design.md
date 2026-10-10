## Context

`backend/build.sbt` defines `loadDotEnv(baseDir)` (every non-comment `KEY=VALUE` line of `backend/.env`) and applies it twice (L140-141): `Compile / run / envVars ++= loadDotEnv(...)` and `Test / envVars ++= loadDotEnv(...)`. `Test / envVars` also feeds the HEL-924 `Test / testGrouping` `ForkOptions(envVars = ...)`. Both tests and the dev server fork (`fork := true`), and a forked JVM's env is the sbt server's own env with `envVars` laid over it — so `.env` beats a shell export (HEL-1454 item 3).

Why the full `.env` reached tests: the loader was written for `sbt run` and copied to `Test` for `CONNECTOR_MASTER_KEY` convenience (HEL-536: "~13-14 backend tests fail with NoKeyConfigured" without it). Why `.env` holds real values: it is the developer's local-run file — Google OAuth and Anthropic are needed for local sign-in and chat; `GCLOUD_DB_PASSWORD` is read by no code in the repo (a manual Cloud SQL convenience; whether it stays is an owner call, escalated, out of this change).

CI's `backend` job runs the full suite with no `.env` and exactly two env values: `CONNECTOR_MASTER_KEY`/`_ID` (public test-only values in `.github/workflows/ci.yml`). That is the existence proof that tests need nothing else from `.env`.

sbt 2 caches task results (HEL-1018, HEL-1442); `envVars` is a task.

## Goals / Non-Goals

**Goals:** tests get no `.env` values; dev server gets what it runs on minus never-forward keys, with shell precedence; a red-first, key-name-only automated guard; a safe key-name inspection task; MISTAKES.md + CON ticket.

**Non-Goals:** editing the owner's `backend/.env`; rotating credentials; changing CI workflow env, Dockerfile, `infra/deploy-backend.sh`, or Secret Manager; making `sbt "show Compile/run/envVars"` safe (the dev server legitimately needs real values — covered by MISTAKES.md, see Risks); scrubbing secrets already written to sbt's on-disk caches under `~` (no writes under `~`; follow-up).

## Decisions

**D1 — Test env is a fixed, committed test-only map; `.env` is not read for tests.** `Test / envVars` = `{CONNECTOR_MASTER_KEY: <CI test value>, CONNECTOR_MASTER_KEY_ID: <CI test id>}`. *Alternative: allowlist `.env` keys for tests* — rejected: the only key tests need from `.env` is the connector key, and forwarding the developer's dev key still puts a real (if dev-only) secret in `show Test/envVars`; a fixed value also makes local tests match CI exactly. *Alternative: denylist* — rejected: a new secret added to `.env` would leak by default.

**D2 — Run env = `.env` minus a never-forward set, never overriding the process env.** Never-forward = `{GCLOUD_DB_PASSWORD}` (named, documented; read by no code). Keys already in the sbt process environment are not set from `.env` (shell wins — HEL-1454 item 3). *Alternative: allowlist for run* — rejected: the backend reads ~30 optional env vars (directly and via `application.conf` `${?…}`), so a developer's legitimate `LOG_LEVEL`/`HELIO_UPLOADS_ROOT`/`CLAUDE_MODEL` in `.env` would silently stop working; that is a regression the ticket did not ask for, whereas tests (the incident vector) are fully closed by D1.

**D3 — Pure, sbt-free `DevEnv` object in `backend/project/DevEnv.scala`, also compiled into the test sources.** It follows `TestShards.scala`'s style (sbt-free, only `java.io`/`scala.io`/collections) — but unlike TestShards, which is compiled only by the build and has no test, `DevEnv` is ALSO compiled into Test sources. Package arrangement (decided): `DevEnv.scala` declares NO package (default package, as TestShards does, so `build.sbt` references it unqualified), and `DevEnvSpec` is ALSO in the default package (`backend/src/test/scala/DevEnvSpec.scala`) — a packaged spec cannot see a default-package object (skeptic-probed with scalac 2.13.15: `not found: value DevEnv`). It is written in syntax valid for both the sbt 2 build (Scala 3) and the project (Scala 2.13). Functions: `parseDotEnv(file): Map`, `testEnv: Map` (D1), `runEnv(dotEnv, processEnv): Map` (D2), plus the public key sets. `build.sbt` adds `Test / unmanagedSources += baseDirectory.value / "project" / "DevEnv.scala"` so a ScalaTest spec exercises the exact code the build runs. *Alternative: sbt `scripted` plugin test* — rejected as heavy for a pure function. *Alternative: a spec inspecting `sys.env` inside the forked JVM* — rejected: it would also see whatever the developer exported in their shell (flaky locally) and in CI there is no `.env`, so it could never be red.

**D4 — Red-first spec on a fixture, asserting key names and value hashes only.** `DevEnvSpec` reads a committed fixture `.env` (dummy values, every denylisted key present). Asserts: `testEnv` key set ∩ denylist = ∅ and `testEnv` keys == the fixed set; `testEnv` connector value's SHA-256 ≠ fixture value's SHA-256; `runEnv` excludes `GCLOUD_DB_PASSWORD`, includes `GOOGLE_CLIENT_ID`; `runEnv` omits a key present in a supplied process-env map. Failure messages name keys only (never `Map` `toString` of envs; no `shouldBe` on whole maps). Fixture rules: every value is an obvious dummy; the fixture's `CONNECTOR_MASTER_KEY` differs from the committed CI test value (else the hash check proves nothing); `HELIO_OWNER_EMAILS` uses a domain the pre-commit credential-leak check allows (e.g. `example.com`). Red evidence: first land `DevEnv` with today's semantics (`testEnv` = parsed `.env`, `runEnv` = parsed `.env`), run the spec, record the red; then implement.

**D4b — The build itself asserts the COMPUTED `Test / envVars` (wiring guard).** `DevEnvSpec` alone stays green if `build.sbt` regresses to `Test / envVars ++= loadDotEnv(...)`. So the existing `Test / testGrouping` task (which already reads `(Test / envVars).value` for every forked group) checks `(Test / envVars).value.keySet == DevEnv.testEnv.keySet` and fails the test run via `sys.error` naming only the unexpected/missing KEY NAMES when it does not hold. Evidence required: (a) red against TODAY's wiring on a machine with a `backend/.env` (the error lists key names only), (b) green after rewiring, (c) a mutation red: temporarily restore `++= DevEnv.parseDotEnv(...)` for Test, confirm the run fails naming keys, revert. In CI (no `.env`) the guard is green either way; that is acceptable because the developer machine is the only place the leak occurs, and `DevEnvSpec` (fixture-based) is the CI-run guard of the logic.

**D5 — Uncached env tasks.** `Compile / run / envVars` is wrapped in `Def.uncached` (it reads a file and `sys.env`; caching would also serialize real values into sbt's on-disk CAS). `Test / envVars` is a constant and may stay cached.

**D6 — Key-name inspection task `envVarKeys`, wrapped in `Def.uncached`** (a cached Unit task can be a silent no-op on a repeat run; verified by running it twice in one sbt session and seeing output both times). Prints `test: K1, K2` and `run: K1, …` (names only) and fails if `Test / envVars` keys ≠ `DevEnv.testEnv` keys. This is the documented safe replacement for `show …/envVars`.

**D7 — Docs.** `MISTAKES.md` Tooling entry ("Never print `.env` or an env map into a transcript"); `build.sbt` comment at the wiring site; CLAUDE.md HELIO_OWNER_EMAILS note only if it already mentions `.env` precedence (no new table rows). CON ticket filed by the orchestrator: CON-247.

## Risks / Trade-offs

- [A local test relied on a `.env` value beyond the connector key] → the full suite must pass locally with D1 (CI already proves it); evaluator compares against baseline failures.
- [Shell-exported real secret still reaches tests by inheritance] → out of build control; MISTAKES.md says never `source .env`.
- [sbt 2 server captures env at server start, so a fresh `export` is not seen] → documented in MISTAKES.md/comment; `sbt shutdown` restarts it.
- [`show Compile/run/envVars` still prints dev secrets] → by necessity; MISTAKES.md + `envVarKeys` alternative.
- [Earlier `Test/envVars` results may already sit in sbt's CAS cache under `~/.cache/sbt`] → no writes under `~`; reported as owner follow-up.
- [The CI connector test value is duplicated in `DevEnv.scala` and `ci.yml` and can drift] → a comment at both sites naming the other; drift only matters if one is changed, and both are public test-only values.
- [Scala 3 / 2.13 cross-compile of one file] → keep to the common subset; both compiles are exercised by every test run.

## Migration Plan

None — local build only. Rollback = revert the commit.
