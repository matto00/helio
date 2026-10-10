## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD e6c37d541c8e3b1b60a0fdfe02345fa311bcbdc9. The planning artifacts are uncommitted in the change dir.
No `.env` value was read or printed. `backend/.env` was inspected by key name only (`sed -E 's/=.*//'`).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/test-env-secret-allowlist/HEL-1450`.
- **Ground-truth wiring:** in `backend/build.sbt`:
  - `loadDotEnv` is at L6-24.
  - `Compile / run / envVars ++= loadDotEnv(...)` and `Test / envVars ++= loadDotEnv(...)` are at L140-141.
  - `Test / testGrouping := Def.uncached { ... envVars = (Test / envVars).value ... }` is at L200-238.
  - `fork := true` is set for both run and test (L116-117).

  The design's Context section matches the file.
- **Round-1 CR1 (package):** resolved. D3 now picks one arrangement: DevEnv and DevEnvSpec both in the default package, with the reason given. It also corrects the TestShards wording: TestShards is build-only and is not a precedent for compiling into Test.
- **Round-1 CR2 (computed `Test/envVars`):** resolved. D4b adds a guard in `Test / testGrouping` that checks the keySet and fails with key names only. Task 2.2a requires three pieces of evidence: red before the rewire, green after, and a red from a mutation. I checked that the red can be produced. The worktree has its own `backend/.env` (1432 bytes). Its keys are DATABASE_URL, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, GCLOUD_DB_PASSWORD, ANTHROPIC_API_KEY, CONNECTOR_MASTER_KEY, CONNECTOR_MASTER_KEY_ID and HELIO_OWNER_EMAILS. Task 2.1, which fixes `testEnv`, runs before the 2.2a red, so the guard compares the fixed set against the full set and goes red.
- **Round-1 CR3 (`Def.uncached` on envVarKeys):** resolved in D6. Task 2.3 runs the task twice in one session.
- **Round-1 CR4 (CON ticket):** resolved. I checked Linear: CON-247 exists (Backlog). Its title is "Lane briefs and role prompts: never print .env or an env map ...". Its scope matches AC4. Tasks.md 3.3 tracks it.
- **sbt 2 feasibility of `Test / unmanagedSources += <File>`:** I ran `javap` on `sbt/Keys$` from `main_3-2.0.9.jar`. `unmanagedSources` is `TaskKey[Seq[java.io.File]]` and `envVars` is `TaskKey[Map[String,String]]`, so `+=` with a File type-checks. `envVars` is not transient, so it is cached by default. That confirms D5 is needed for the run env.
- **New suite under CI sharding:** `TestShards.lpt` gives an unknown suite the median weight, and `verifyExactlyOnce` partitions the discovered names. A new `DevEnvSpec` therefore needs no `test-suite-weights.tsv` edit and cannot break the shard partition.
- **CI existence proof:** the env for the `.github/workflows/ci.yml` backend job (L167-187) is the shard and group vars plus `CONNECTOR_MASTER_KEY`/`_ID`. I grepped `backend/src/test/scala` for the denylisted keys. The hits are DashboardAuthoringRoutesSpec, RefinementRoutesSpec, ClaudeConfigSpec and BetaAccessServiceSpec. Each one sets its own value, or tests the missing-value path, and passes in CI without `.env`. So D1 does not take away anything the tests depend on.
- **Pre-commit surfaces:**
  - `check-no-credential-in-agent-surface.mjs` scans `backend/src/test/resources/**` with the `bcrypt` and `email` checks. D4 requires the fixture's owner email to use an allow-listed domain, which covers this.
  - The `check-scala-quality.mjs` scan skips `package` lines, and I found no rule against the default package.
- **AC trace (plan level):**
  - AC1 (explain): design Context.
  - AC2 (narrow `Test/envVars`, red-first, key-name assertion on the computed value): D1, D4, D4b; tasks 1.2, 2.1, 2.2, 2.2a.
  - AC3 (MISTAKES.md): task 3.1.
  - AC4 (CON ticket): CON-247, task 3.3.
  - AC5 (prod untouched): Non-Goals.
  - AC6 (HEL-1454 item 3): D2, plus the spec requirement on shell precedence.
  - AC7 (owner action on GCLOUD_DB_PASSWORD): Non-Goals and C2.
- **Placeholders and contradictions:** none found. Tasks follow the design, and the spec scenarios match D1, D2 and D6. One wording issue: 2.2a is numbered after 2.2 but says "BEFORE 2.2". It is explicit enough not to cause confusion.

### Verdict: CONFIRM

### Non-blocking notes

- **D4b compares key sets only.** A regression that forwards only the developer's connector key and value from `.env` would keep the same key set and pass the guard. That is exactly D1's rejected "allowlist" alternative. The fix costs nothing: compare the whole map (`(Test / envVars).value == DevEnv.testEnv`) while still printing only key names, and report "value differs for key K" without the value.
- **Evidence written under `openspec/**` is scanned by the `deliverySecret` check,** which looks for `*_KEY=`/`*_SECRET=` assignments. The executor's red/green evidence and reports must not paste lines like `CONNECTOR_MASTER_KEY=<anything>`, not even the public CI value.
- **The PR body should still raise the owner follow-up** about earlier `Test/envVars` results that may be cached in sbt's CAS under `~/.cache/sbt`.
- **The backend `.env`'s own comment flags its ANTHROPIC key for rotation.** Rotation stays the owner's call, as the ticket says.
