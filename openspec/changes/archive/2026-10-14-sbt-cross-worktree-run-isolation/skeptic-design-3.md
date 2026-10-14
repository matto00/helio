## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD `e056f4708a5a52bb82c6d2ad5cd0a70c4d73cd90`. The change dir holds planning artifacts only. I ran no sbt and no test suite, and I signalled no process.

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=bug/sbt-cache-cross-worktree-replay/HEL-1595`.
- **Round-2 CR1 (tree B must be a whole-repo copy) is addressed.** D1 now builds tree B as `git archive HEAD | tar -x` of the whole repo, so `shared-test-fixtures/`, `schemas/` and `docs/` sit at the same relative positions. It names the `../` reads as the reason (`DurationFormatSeamSpec.scala:55-57`). It requires B to be green on its own before step 1, and task 1.2 records that baseline.
- **That copy can actually be green.** Tests do not read `backend/.env`. build.sbt:145 (HEL-1450) uses a fixed committed `Test / envVars`, and DevEnv.scala:60 says "CI has no `.env` and passes". Tests use embedded Postgres (build.sbt:294, zonky). The `.ivy2/` that git archive leaves out is gitignored and is recreated via `.sbtopts` `-Dsbt.ivy.home=.ivy2`. I grepped `backend/src/test` for tests that invoke git or read `.git`: zero hits. So a tree with no `.git` should not break a test that inspects the repo.
- **Round-2 CR2 (model the foreign server as a lane runs it) is addressed.** D2 step 3 and task 1.5 add a detached `sbt run`, launched like `start-servers.sh` does it (`setsid nohup`, start-servers.sh:191-198; `.concertino.env:15` `sbt run`), on this run's own port 9934 (workflow-state `BACKEND_PORT: 9934`), with a recorded PID. `sbt --server` is kept separately. The plan records the choice and grounds it in HEL-1451's `server:backend` gate events (2 hits in its events.jsonl). The stop procedure is `sbt --client shutdown` from B's dir, then only the recorded PID or the group it leads. It never walks PPid and never uses a pattern.
- **Round-1 fixes are still intact:**
  - step 0 forensics runs first, unconditionally
  - step 4 is the concurrent race, with N=5
  - the `--client` carve-out is its own spec scenario
  - standing constraints C1 (escalate if the cache cannot be relocated) and C2 (delete only by exact recorded paths)
  - each foreign path is labelled freshly logged or replayed
- **AC coverage:**
  - AC1 is covered by 1.0–1.6.
  - AC2 (fix plus red-first) is covered by 2.1–2.2 and by spec scenario 1.
  - AC3 (non-reproduction explanation) is covered by 1.0 and 1.7.
  - AC4 is covered by 3.1–3.3: the MISTAKES entry with the lane check, the HEL-1374 reconciliation, and the CLAUDE.md note.
  - Driver constraints are restated, including escalation if the fix would be user-level, and the Non-goals exclude touching `~/.cache/sbt`.
- **No placeholders or contradictions.** No TODO/TBD. The one deferred item is the exact cache-property name, and it is bounded: candidates are named (`localCacheDirectory`, `sbt.global.localcache`; round 1 confirmed both exist in the 2.0.9 jar), there is a verification signal, and C1 escalates if it fails. The spec delta adds a requirement to the existing `sbt-worktree-isolation` capability, which matches the proposal.
- **The HEL-1374 entry the plan reconciles exists** at MISTAKES.md around line 319. It is explicitly "Reported, not reproduced", and its untested condition ("against a live sbt server running in another worktree") is exactly what D2 step 3 tests.

### Verdict: CONFIRM

The design is sound enough to implement. All round-1 and round-2 change requests are fixed in the artifacts, and the fixes hold up against ground truth. The remaining points are execution hygiene. I list them as non-blocking because a competent executor following D2's "with each B server live" and C1/C2 would hit them and handle them, and none of them changes the design.

### Non-blocking notes

1. **Tree B's `sbt run` has no `.env` (git archive exports tracked files only), so its configuration differs from a real lane's.** With no `.env`, application.conf falls back to `jdbc:postgresql://localhost:5432/helio` with an empty user, which is the shared dev DB. `Compile / run / fork := true` (build.sbt:109), so if the app fails at boot the batch `sbt run` ends and its sbt JVM exits. Step 3 would then run A against no live foreign server and look like a vacuous "no attach". Before running A's invocations (a)/(b)/(c), the executor should record that B's sbt JVM is alive: its PID, plus B's `project/target/active.json` or socket where one exists. The executor should also record whether a batch `sbt run` starts an sbt server at all. If it does not, that is itself a finding for HEL-1374. B is at main's commit, so its Flyway migrate against the shared DB should be a no-op. Do not copy `.env` into B to "fix" boot, and never print it.
2. **Dangling `target/out` symlinks after 4.1.** Tree A's `target/out` is symlinked into the disk cache (MISTAKES HEL-1287). If A was built against the scratch cache that 4.1 deletes, those links dangle when 4.2 runs against the default cache. Clear A's own `backend/target` and `backend/project/target` (in-worktree, allowed) before 4.2, so the final proof is a clean build and not a run tripping over dead links.
3. **Ordinary sbt use writes to user-level directories.** Tree B's dependency resolution writes the user coursier cache, and its server socket lands under `~/.sbt/1.0/server/`. That is the same as every lane and is not a config change. Note it in investigation/README.md and do not clean those directories up (owner rule).
