## Why

The HEL-1446 final skeptic saw one `sbt testFull` run, started in the HEL-1446 worktree, print the HEL-1451 worktree's
project paths. If a local `testFull` can report results for another tree's sources, every lane's red-first and
full-suite evidence can be a silent false green. The cause is unverified (disk-cache replay vs. server attach vs.
something else), and MISTAKES.md already carries a related, also-unverified "attach to another worktree's server"
entry (HEL-1374).

## What Changes

- Establish, with recorded transcripts, where sbt 2.0.9 keeps its disk/action cache for this build, what its keys
  cover, and whether a `testFull` in tree A can be served results or build-load output from tree B.
- Deterministic two-tree reproduction: a deliberately failing test in tree A must still fail after tree B ran green
  against the same shared cache (and, separately, with B's sbt server live).
- If a cross-tree replay reproduces: a repo-level build change (no user-level config) that prevents it, proven
  red-first. If it does not reproduce: identify what the skeptic actually saw, with evidence, and change no build.
- MISTAKES.md: a new entry with the finding and the exact check a lane runs to confirm a cited run is its own; the
  HEL-1374 attach entry updated to verified/refuted; CLAUDE.md's `testFull` note kept accurate.

## Capabilities

### New Capabilities

### Modified Capabilities
- `sbt-worktree-isolation`: adds the requirement that a local `testFull` runs the invoking worktree's own build and
  sources, never another worktree's cached or served results.

## Impact

- Possibly `backend/build.sbt`, `backend/.sbtopts`, or `backend/project/*.scala` (only if a replay reproduces).
- `MISTAKES.md`, possibly `CLAUDE.md` (the `sbt testFull` note), possibly `CONTRIBUTING.md`.
- No application code, API, schema, or frontend change.

## Non-goals

- Clearing, moving, or reconfiguring `~/.cache/sbt`, `~/.sbt`, or any user-level sbt/JVM config.
- Changing CI's sbt invocation (`ci-sbt-invocation`), which runs on fresh checkouts.
- Fixing HEL-1468's lost-result-events guard or bare `sbt test` caching semantics.
