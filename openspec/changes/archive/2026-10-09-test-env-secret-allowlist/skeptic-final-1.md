## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: f0fb3e5e402f9d1e8189d9401373bf79cbd14416. Base resolved live by resolve-review-base.sh: e6c37d541c8e3b1b60a0fdfe02345fa311bcbdc9. There is one commit on the branch.
C1 was honored throughout. Every `.env` inspection below went by key name, by SHA-256, or by a substring-presence check that prints only key names. No value was printed.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/test-env-secret-allowlist/HEL-1450`.
- **Diff read in full** (`git diff e6c37d541...HEAD`). It touches:
  - `backend/build.sbt`: removes `loadDotEnv`, sets `Test / envVars := DevEnv.testEnv`, makes `Compile / run / envVars` an uncached `DevEnv.runEnv(...)`, adds the wiring guard in `Test / testGrouping` (L222-224), the `envVarKeys` task, and `Test / unmanagedSources += project/DevEnv.scala`.
  - New files: `backend/project/DevEnv.scala`, `backend/src/test/scala/DevEnvSpec.scala` and the fixture.
  - `MISTAKES.md:289-300` and a 2-line header in `.env.example`.
- **No runtime `.env` loader bypasses the build.** I grepped `backend/src` and `project` for dotenv-style readers and found none; the app reads only `sys.env`. So once `envVars` is narrowed, tests really do get nothing from `.env`. I also checked that no test source reads `DATABASE_URL`, `GOOGLE_*`, `ANTHROPIC*`, `HELIO_OWNER*`, `*DB_PASSWORD`, `GCLOUD*` or `CONNECTOR*` from env (zero hits), so no test was silently relying on a `.env` value.
- **AC2, the test env is narrowed and its guard holds.** I ran `sbt -J-Xmx3g envVarKeys envVarKeys "testOnly DevEnvSpec"` (nice 19), exit 0:
  - Both `envVarKeys` runs printed `test: CONNECTOR_MASTER_KEY, CONNECTOR_MASTER_KEY_ID`. Both printed `run:` with 8 keys, and `GCLOUD_DB_PASSWORD` was absent. Output appeared on both runs, so D6's uncached behavior holds.
  - DevEnvSpec: `Tests: succeeded 7, failed 0`.
  - I did not repeat the red/mutation runs myself. The evaluator's pasted mutation output (the guard naming unexpected keys, and DevEnvSpec at 6/7 failing under a semantics mutation) is specific and unambiguous, and it matches the executor's recorded red.
- **AC6 (HEL-1454 item 3), shell precedence, checked end to end (beyond the unit spec):** `HELIO_OWNER_EMAILS=probe@example.com sbt envVarKeys` dropped `HELIO_OWNER_EMAILS` from the `run:` key list (7 keys instead of 8). A shell export now beats `.env` for the forked dev server.
- **CI parity:** I compared the `CONNECTOR_MASTER_KEY`/`_ID` values in `DevEnv.scala` and `ci.yml` by SHA-256 prefix: `31e631975f3f`/`31e631975f3f` and `fa844ddebe56`/`fa844ddebe56`. The values are equal.
- **No secret entered the repo or the reports:**
  - None of the fixture's value hashes matches any `backend/.env` value hash (0 collisions).
  - No `.env` value of length 8 or more appears as a substring anywhere in the branch diff, `evaluation-1.md` or the commit message. The script reported `[]`.
  - `backend/.env` is gitignored (`.gitignore:28`) and is not tracked.
  - `npm run check:no-credential-leak`: `OK (10005 files scanned ... 0 violations)`, exit 0.
  - `check:openspec`: clean.
- **AC3:** the MISTAKES.md entry names `cat`, `source`, `grep`-with-values, `printenv`, `env`, `show Test/envVars` and `show Compile/run/envVars`, and gives the key-name-only alternatives (`sed -E 's/=.*//'`, `sbt envVarKeys`).
- **AC4:** CON-247 exists in Linear (Backlog) and its title and description match the rule.
- **AC1:** the explanation is in design.md Context and in the proposal: why the whole `.env` reached tests, and why `.env` holds real values.
- **AC5:** the diff does not touch `infra/`, `.github/`, the Dockerfile or Secret Manager.
- **AC7:** the owner's `.env` is untouched, and its key set is intact (checked by key name). The GCLOUD question is a raise-only owner escalation recorded in workflow-state.
- **C3:** `testEnvMismatch` compares the whole map: unexpected keys, missing keys, and keys whose value differs. It reports key names only.
- **C4:** no `KEY=value` lines for secret-shaped keys in openspec. The CI test value appears only in Scala `->` form in `DevEnv.scala`, and it is already public in `ci.yml`.
- **Full suite:** I relied on the evaluator's pasted `testFull` summary: 6507 succeeded, 0 failed, 4 canceled (the perf-median cancels), exit 0. It is specific and unambiguous. No other test reads the changed env, and CI already runs with exactly this env, so I did not re-run 6.5k tests on a shared machine.
- **No lingering sbt processes from this review:** `ps` filtered on the worktree path shows none.
- **UI:** no `frontend/**` changes, so step 4 does not apply.

### Verdict: CONFIRM

### Non-blocking notes
- `DevEnv.testEnvFor(dotEnv)` (DevEnv.scala:60) ignores its argument, so the spec test "test env is identical whether or not a .env exists" is tautological. The real guarantee is the build-side wiring guard plus `Test / envVars := DevEnv.testEnv`. Consider dropping the parameter.
- design.md Risks promises "a comment at both sites", but `ci.yml` has no pointer back to `DevEnv.scala`. The drift risk is functionally moot: `envVars` overlays the inherited env, so even in CI the forked tests use DevEnv's value rather than `ci.yml`'s. Either amend the design text or add the comment.
- The commit subject says "allowlist dev-server env", but the dev server uses a never-forward denylist. Reword it at squash time.
- `Test / envVars` stays a disk-cached task (it showed as a cache hit). That is harmless now that it is a public constant. Earlier cached results from the old `.env`-loading definition may still sit in sbt's CAS under `~/.cache/sbt`, which is an owner follow-up already noted in design.md.
