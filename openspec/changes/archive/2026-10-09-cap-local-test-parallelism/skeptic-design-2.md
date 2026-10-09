## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD b409172a53ebe6f80db154847cb1b85c286293e1. The change dir is untracked, so I read the artifacts from disk.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/cap-local-test-parallelism/HEL-1442`.
I ran no heavy workloads. I only read the planning artifacts, `backend/build.sbt`, `playwright.config.ts`, `ci.yml`, `scripts/ci-sbt.sh` and `.gitignore`.

### What I verified (with evidence)
- **The round-1 change requests are each addressed in the artifacts:**
  1. Whole pre-commit chain. D7 now measures the whole `.husky/pre-commit` chain per step and names the step that sets the peak. Tasks 1.2 and 5.1 match.
  2. Node heap cap. D5a adds a numeric rule: any process over 1.5 GB peak gets `--max-old-space-size` at about 1.5x its peak, but only through a mechanism CI does not read. If no such mechanism exists, it is reported as a finding. For processes under the threshold, the peak and "no cap needed" are recorded. Task 3.4 applies the rule.
  3. sbt thin client. Constraint C7 requires every sbt probe and measurement to run in a server started with the intended env (`--server`/`--client=false`, or no server running). Tasks 1.3, 2.1 and 5.1 each cite C7. The mechanism matches `scripts/ci-sbt.sh`, which pins `--server`.
  4. sbt server heap. Task 2.2 now reads "cap only if > 3g, else record the no-op", and the cap must use a CI-neutral mechanism. D4 still reads "only cap it if it is unbounded", but task 2.2 states the rule without ambiguity (see notes).
  5. CON tickets. Task 4.3 hands each Concertino-side need to the orchestrator, which files it, and the filed IDs are recorded. Planner Notes says the same.
  - Round-1 non-blocking notes are also in: D7 includes resident sbt servers in the budget, D5 picks "reject invalid", and the spec says `cacheDirectory` is not exempt under CI.
- **The grounding is still accurate.**
  - `build.sbt:101` sets `Test / fork := true` and `:100` sets `Compile / run / fork := true`.
  - `:198` builds the forked groups' `runJVMOptions` from `(Test / javaOptions)`, so an `-Xmx` appended under D4 reaches every forked group JVM.
  - `:172-180` lifts group concurrency only when `HEL924_TEST_GROUP_CONCURRENCY` is set.
  - `playwright.config.ts:131` is `workers: process.env.CI ? 2 : undefined`.
  - `ci.yml:238-254` documents the sbtn/`--server` handling and CI's `-Xmx3g`.
  - `node_modules/` is gitignored at root (`.gitignore:6-7`) and in frontend (`frontend/.gitignore:48`), so D2's `node_modules/.cache/jest` choice is safe.
- **Every AC is covered by a task:**
  - Caps on jest, Playwright, sbt heap and sbt concurrency: tasks 2.1, 3.1, 3.2, plus D4.
  - `workerIdleMemoryLimit`: task 3.1.
  - Node heap cap: task 3.4 / D5a.
  - CI unchanged: C4, tasks 2.1, 3.1, 3.2.
  - Prod untouched: task 5.3.
  - Pre-commit path capped: D1 gates inside the config files, and the hook calls `npm test`.
  - Measured before/after and 3-lane figure: tasks 1.x, 5.1, 5.2.
  - Wall-clock: task 5.1.
  - Docs: tasks 4.1 and 4.2.
  - CON tickets: task 4.3.
- **No placeholders block implementation.** The numbers left open (jest 2 or 3, the `-Xmx` value) are bounded by an upper limit and are to be set from stated measurements, which is appropriate for a measurement-driven ticket. The scope stays LOCAL ONLY. Nothing touches prod or `scripts/concertino/*`.

### Verdict: CONFIRM

### Non-blocking notes
- **D4 text is out of sync with task 2.2.** D4 still says "only cap it if it is unbounded", while task 2.2 says "> 3g". The executor should follow task 2.2. Fix the D4 wording if the artifacts are touched again.
- **Jest has no config key for worker `execArgv`.** jest-worker inherits the parent's `process.execArgv`. If D5a finds a jest worker over 1.5 GB, there is probably no CI-neutral heap mechanism. In that case D5a's "report as a finding" path applies, so this is not a gap.
- **`HEL924_TEST_GROUP_CONCURRENCY` should be documented in task 4.1** as the one-off override for the forked-group cap. Today it silently ignores non-integer values (`toIntOption`), which is inconsistent with D5's reject-invalid rule. Either tighten it under D5, or say in the docs that it is pre-existing and out of D5's scope.
- **A stale comment in `playwright.config.ts`.** Lines 125-130 say "A bare local run is unchanged: default workers". Update that comment when task 3.2 lands.
