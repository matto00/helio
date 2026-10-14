# HEL-1595: sbt 2 shared disk cache can replay another worktree's test output under `testFull` ("cache 100%" with foreign project paths); local test evidence may be a cache replay

## Description

Found on 2026-10-14 by the HEL-1446 final-gate skeptic (PR matto00/helio#1022). Not yet root-caused.

Observation: an `sbt testFull` run started in worktree `.../task/scala-fqn-guard-widen/HEL-1446` printed project
paths from a different, concurrent worktree (`.../task/stale-pipeline-comments-readme/HEL-1451`), marked
"cache 100%". The skeptic threw that run away and re-ran it, and the second run showed its own worktree's paths.
Full detail is in `/home/matt/Development/helio/.concertino/runs/HEL-1446/evidence/` (skeptic-final-1.md, actually at
`evidence/openspec/changes/widen-scala-fqn-guard/skeptic-final-1.md`).

Why it matters: every lane's red-first proof and full-suite evidence is a local `testFull` run. CLAUDE.md already
warns that bare `sbt test` is cached and may run zero tests. If `testFull` can also be served from a cache keyed
across worktrees, a lane could cite a green run that never executed its own code. That is a silent false green,
MISTAKES.md's worst kind.

## Acceptance Criteria

- Reproduce with two worktrees (or tree copies) at different code, then establish whether the action cache is shared
  (location, key inputs) and whether a cached `testFull` result can come from another tree's sources.
- If it can, fix the build so `testFull` never consults the cache for that, or so the cache key includes the
  worktree's sources. Prove it red-first: a deliberately failing test in worktree A must fail even after worktree B
  ran green.
- If it does not reproduce, investigate what the skeptic actually saw (shared sbt server/BSP connection, shared
  target dir, log interleaving, ...) and report the finding; the ticket may resolve as a MISTAKES.md entry with no
  build change.
- Add a MISTAKES.md entry (and, if useful, a check lanes can run that a cited test run really executed in their own
  worktree: own paths, executed counts). Keep CLAUDE.md's existing note on bare `sbt test` caching accurate, and
  reconcile MISTAKES.md's existing unverified "sbt can attach to another worktree's server" entry (HEL-1374) with
  whatever is found.

## Driver constraints (binding)

- Never delete, clear, or reconfigure any shared cache or config under `~` or any system path (owner rule: nothing
  in home/system paths created/changed/removed without the owner's literal "Approved"). Experiments use a cache
  directory scoped to the worktree or the session scratchpad, via sbt/JVM properties or env vars.
- If the only fix requires changing user-level config: escalate and stop.
- HEL-1451 runs sbt concurrently in its own worktree: never touch its server or files. Shut down only an sbt server
  this run started, with `sbt --client shutdown` from that server's own directory. Never use pkill/pgrep/killall.
- Local caps: `nice -n 19`, at most 3-4 parallel workers, foreground `sbt testFull`; Bash `timeout: 600000`.
- Don't touch HEL-1451's or HEL-1574's (PR #1016) files. Never edit rendered Concertino files.

## Interim rule (until fixed)

Lanes must confirm that the paths printed in any cited test run are their own and that the counts show tests
executed, not cache hits.
