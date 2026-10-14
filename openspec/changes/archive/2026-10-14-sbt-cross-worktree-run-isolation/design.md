## Context

See proposal.md - Why. Facts checked at planning time (orchestrator, read-only):

- sbt 2.0.9 (`backend/project/build.properties`). `command -v sbt` is `~/.local/bin/sbt`, the sbt-extras runner; it has
  no client/server logic of its own (it runs `sbt-launch.jar`, passing `--client` through when given).
- The user-level disk cache is `~/.cache/sbt/v2` (`ac/`, `cas/`, `proc/`; ~45 GB). `~/.sbt/1.0/server/` holds two
  stale socket dirs (April, August). MISTAKES.md (HEL-1287) notes `target/out` is symlinked into the disk cache.
- `backend/.sbtopts` holds only `-Dsbt.ivy.home=.ivy2`. `Test / testGrouping` is `Def.uncached` (HEL-1018) and forks
  each group with `workingDirectory = Test / baseDirectory`. HEL-1442 proved the cache key omits `sys.env`.
- The HEL-1446 skeptic report says BOTH runs (the foreign-path one and the good re-run) printed `cache 100%, 644 disk
  cache hits`, and the bad run passed 8079/0. So "cache 100%" is the ordinary compile-cache line, not the tell; the
  tell was the `loading project definition` / `set current project` lines and warning paths naming HEL-1451.
- MISTAKES.md already has an unverified HEL-1374 entry: "sbt can attach to another worktree's server".

## Goals / Non-Goals

**Goals:** a root cause backed by transcripts, a deterministic two-tree reproduction (or a recorded, bounded
non-reproduction plus the best-supported explanation), a repo-level fix only if needed, and a MISTAKES.md check.

**Non-Goals:** see proposal.md. No user-level config change, no shared-cache deletion, no CI change.

## Decisions

**D1. Two trees, both outside the shared home cache.** Tree A = this worktree. Tree B = a WHOLE-repo export of the same
commit (`git archive HEAD | tar -x -C <scratch>/treeB`: tracked files only, no `.git` registration, no `node_modules`
or `target/`) under the session scratchpad, with a different path. Whole repo, not `backend/` alone: backend tests
read sibling dirs by relative path from `Test / baseDirectory` (`../shared-test-fixtures`, `../schemas`, `../docs`,
`../..`; e.g. `DurationFormatSeamSpec.scala:55-57`). Before step 1, tree B must run green on its own (recorded). Both point at ONE shared experiment cache under the scratchpad via sbt's own
disk-cache location setting/property (the executor finds the exact name in sbt 2.0.9 — e.g. a `-Dsbt.*` property or
`Global / localCacheDirectory` passed with `--` / `set` - and records how it verified the property took effect, e.g.
the experiment cache dir filling while `~/.cache/sbt/v2`'s mtime/size is unchanged). Rationale: it reproduces "shared
cache, different paths" without writing to or clearing the user's cache. Alternative rejected: using `~/.cache/sbt`
directly (owner rule; also non-deterministic, 45 GB of foreign entries). The skeptic found both `localCacheDirectory`
and `sbt.global.localcache` in sbt 2.0.9's main jar. If NO setting verifiably relocates the cache for both trees, the
executor escalates and stops rather than running the matrix against `~/.cache/sbt`.

**D2. Reproduction matrix, each a recorded transcript.** Step 0 always runs first; the rest in order:
0. Forensics (read-only, always, first): from `.concertino/runs/HEL-1446/events.jsonl`, `.concertino/runs/HEL-1451/`
   and the HEL-1446 skeptic report, establish the bad run's time window and whether HEL-1451 was running sbt in it,
   with what command and phase. Record the result in investigation/forensics.md and use it to order steps 1-4.
1. Cache replay: B (all green) runs `testOnly <small spec>` then `testFull`; A adds one deliberately failing test in
   a small spec (never committed) and runs the same. Expected per AC: A fails. Also diff A's printed paths.
2. Build-load replay: does A's `loading project definition` ever name B with the shared cache? Run A cold and warm.
3. Server attach: B-side server modelled on what step 0 shows HEL-1451 was running (default, per HEL-1451's
   `server:backend` gate pass in that window: a detached `sbt run`, launched like `start-servers.sh` does, from B's
   `backend/` on this run's own allocated BACKEND_PORT 9934, recorded PID; plus, separately, `sbt --server`). Record
   the choice. Stop B's servers only via `sbt --client shutdown` from B's `backend/` and, if still alive, the
   recorded PID itself (launched under `setsid` so it leads its own group; signal that group only - never walk PPid,
   never a parent, never a pattern: see CLAUDE.md "Stopping dev servers"). With each B server live, run A with each of exactly
   these invocations: (a) bare `sbt testFull` / `sbt "testOnly <spec>"` (CLAUDE.md's), (b) MISTAKES.md's
   `sbt -batch -Dsbt.server.autostart=false "testOnly <spec>"`, (c) `sbt --client "testOnly <spec>"`. An attach under
   (a) or (b) is a defect to fix (D3). An attach under (c) is documented as "never use `--client` for evidence", since
   lanes are told not to use it for test evidence; it is fixed too only if a repo-level change can do it. Record which server A's client connects to (`project/target/active.json`,
   socket path, server log). Shut down only that server with `sbt --client shutdown` from B's dir.
4. Concurrent race: N=5 repeats where A's cold `testOnly <small spec>` (fresh `target/`, `project/target/`) starts
   while B's `testOnly`/compile is in progress against the same shared experiment cache (B started first, A started
   once B's log shows it is compiling or testing). Two JVMs only, both `nice -n 19`, default heap cap. Record, per
   repeat, A's two project-path lines, whether A's failing test failed, and whether any `target/out` symlink in A
   resolves to content built from B's sources.
5. Whatever reproduced or not, combine with step 0 into the best-supported explanation of what the skeptic saw
   (shared tmp/log file, a `cd` in a compound command, transcript of HEL-1451's run, ...), labelled verified vs.
   inference.
For every foreign path seen, record whether the line is freshly logged by A's process or replayed from cache.
Full `testFull` runs are expensive (~3.5 GB, many minutes): use `testOnly` for mechanism probes and run full
`testFull` only for the final red-first/green proof in each tree, serially, `nice -n 19`.

**D3. Fix only what reproduces, at repo level.** If (1)/(2) reproduce: prefer the narrowest build change that makes
the affected task's key cover the tree (or marks it `Def.uncached`), proven red (before) then fixed (after) with the
same matrix step. If (3) reproduces: prefer a repo-level `backend/.sbtopts` / build setting that keeps a run from
attaching to a foreign server, proven the same way. If the only effective fix is user-level (e.g. `~/.sbt`,
`~/.sbtopts`, the global cache path), escalate and stop (driver constraint). If nothing reproduces: no build change.

**D4. MISTAKES.md is the durable output either way.** A new entry: what was seen, what was proven (verified vs.
inferred, explicitly labelled), and the exact lane check: the two project-path lines must name the lane's worktree,
and the ScalaTest summary / `Passed: Total N` counts must be non-zero for a run cited as executing tests. The HEL-1374
attach entry is updated with this run's verdict (verified / refuted / still untested, with the invocation tested).
CLAUDE.md's `sbt testFull` note is changed only if the finding makes it inaccurate. No new script: the check is two
greps, documented in the entry (Planner decision; a script is not useful enough to justify a new gated file).

**D5. Evidence.** Every transcript and the cache-location/key findings go under
`openspec/changes/sbt-cross-worktree-run-isolation/investigation/` (committed; small, redacted of nothing secret -
never print `backend/.env` or env maps, per MISTAKES.md). `investigation/README.md` summarises the matrix outcome.

## Risks / Trade-offs

- [The experiment cache property is silently ignored, so runs hit `~/.cache/sbt`] -> verify the property took effect
  before running the matrix (D1); if it cannot be made to take effect, escalate and stop (never run the matrix against
  the home cache, never delete from it).
- [Non-reproduction is not proof of absence] -> the MISTAKES entry states the tested matrix (including the concurrent
  step 4 and its N) and names any untested condition explicitly, and keeps the lane check.
- [Deleting the wrong directory] -> tree B and the scratch cache are removed only by the exact absolute paths recorded
  in investigation/README.md when they were created; never a glob or pattern.
- [Interfering with HEL-1451's sbt] -> never signal any process not started by this run; record own PIDs.
- [Memory on a shared desktop] -> serial runs, `nice -n 19`, `HELIO_TEST_JVM_XMX` default cap, no parallel trees.

## Planner Notes

- Self-approved: committing investigation transcripts (they are the ticket's main deliverable); no new check script;
  tree B as a scratch copy rather than a second git worktree (avoids registering a worktree that cleanup must find).
- Escalation trigger restated: any fix needing user-level config, or any step needing a home-cache deletion, stops the
  run with an escalation.
