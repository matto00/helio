## Standing Constraints

- [C1] Never run the matrix against ~/.cache/sbt: if no setting verifiably relocates the sbt disk cache for both trees, escalate and stop.
- [C2] Delete tree B and the scratch cache only by the exact absolute paths recorded at creation; never by glob or pattern.
- [C3] Never copy backend/.env into tree B; before running A's step-3 commands, record that B's sbt JVM and its server socket are alive (and whether a batch `sbt run` starts a server at all).
- [C4] Ordinary sbt use writes to the user coursier cache and ~/.sbt/1.0/server/: note it in investigation/README.md, never clean those up. Clear tree A's backend/target and backend/project/target (worktree-local) before task 4.2.

## 1. Investigation (Backend build)

- [x] 1.0 Forensics first: HEL-1446/HEL-1451 events + skeptic report, was HEL-1451 running sbt in the bad window and how; write investigation/forensics.md
- [x] 1.1 Locate sbt 2.0.9's disk/action cache location setting and key inputs; record source refs in investigation/cache.md
- [x] 1.2 Create tree B as a whole-repo `git archive HEAD` export in the scratchpad plus a shared scratch cache; verify both trees use it, ~/.cache/sbt/v2 untouched, and B's own testOnly/testFull baseline is green (record proof)
- [x] 1.3 Matrix step 1 (cache replay): B green, then A with one uncommitted failing test; record transcripts and whether A failed
- [x] 1.4 Matrix step 2 (build-load replay): A cold and warm against the shared cache; record both project-path lines each run
- [x] 1.5 Matrix step 3 (server attach): live B server (detached `sbt run` on port 9934 modelled on step 0, and `sbt --server`, recorded PIDs), A via bare `sbt`, `sbt -batch -Dsbt.server.autostart=false`, and `sbt --client`; record which server A used; stop B's servers only via `sbt --client shutdown` from B's backend/ then the recorded PID if alive
- [x] 1.6 Matrix step 4 (concurrent race): N=5 repeats, A cold testOnly started while B's run is in progress; record per-repeat paths, failing-test outcome, target/out symlink provenance
- [x] 1.7 Combine 1.0 with matrix results into the best explanation of what the skeptic saw, labelled verified vs inference
- [x] 1.8 Write investigation/README.md: matrix outcome, root cause or non-reproduction, verify by re-reading transcripts cited

## 2. Fix (only if 1.3-1.6 reproduced; else mark N/A with reason)

- [x] 2.1 N/A (no replay reproduced, so no build change; no user-level config needed) Repo-level build/.sbtopts change that prevents the reproduced replay; escalate instead if only user-level config would work
- [x] 2.2 N/A (see 2.1; the red-first matrix proof is investigation/README.md rows 1.3 and 1.6) Red-first proof: the reproducing matrix step red before the fix and the failing test reported failed after; transcripts in investigation/

## 3. Documentation

- [x] 3.1 MISTAKES.md: new entry (finding, verified vs inferred, tested matrix incl. concurrent step + N, untested gaps named, exact lane check: both project-path lines + non-zero executed counts)
- [x] 3.2 MISTAKES.md: update the HEL-1374 "attach to another worktree's server" entry with this run's verdict and tested invocation
- [x] 3.3 (CLAUDE.md unchanged: its bare `sbt test` note stays accurate, re-read) CLAUDE.md `sbt testFull` note: update only if the finding makes it inaccurate; verify by re-reading

## 4. Tests / verification

- [x] 4.1 Remove the deliberately failing test from tree A; `git status` shows no test-source change; delete tree B and the scratch cache by exact recorded paths (C2)
- [x] 4.2 Full `nice -n 19 sbt testFull` from this worktree's backend/ green; both project-path lines name this worktree; executed counts non-zero
- [x] 4.3 Pre-commit hooks pass (MISTAKES/CLAUDE formatting, openspec hygiene)
