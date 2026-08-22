## 1. Implementation

### Tooling

- [x] 1.1 Merge `origin/main` FIRST (CON-129), then read the merged `.husky/pre-commit` and `package.json`; confirm `typecheck` (HEL-683, line 5) and `check:spec-structure` (HEL-775, line 8) are present and correctly ordered. Do not reorder or remove either.
- [x] 1.2 In `scripts/check-openspec-hygiene.mjs`, accept an optional target root as `process.argv[2]` (mirroring `scripts/check-spec-structure.mjs:44`), defaulting to today's script-relative `repoRoot`. Every path AND the `openspec list --json` cwd derive from it (D11).
- [x] 1.3 Pass `OPENSPEC_TELEMETRY=0` and `DO_NOT_TRACK=1` in the env of every `openspec` invocation, including the existing `openspec list --json` (D14). Spread the parent env — `env: { ...process.env, ... }` — a bare object drops `PATH` and the check degrades to exit 2. Confirm output is byte-identical before and after.
- [x] 1.4 Add a base-ref resolver: `git rev-parse --verify --quiet origin/main`, then `main`; return null if neither resolves. `cwd: targetRoot` (D10).
- [x] 1.5 Add the "escaped" predicate: `git ls-tree --full-tree <baseRef> -- openspec/changes/<name>` returns a non-empty entry, with `cwd: targetRoot`. Both `--full-tree` and the cwd are required — without either it silently returns false from a subdirectory (D10).
- [x] 1.6 Add the "stale" predicate: `git log -1 --format=%at -- openspec/changes/<name>`, with `cwd: targetRoot` (REQUIRED — from a subdirectory this returns empty for a committed change and silently routes it into the untracked fallback, reopening the hole D5 closes). AUTHOR date, not committer date: rebase resets `%ct` (D5).
- [x] 1.7 When `git log` is empty (never committed), fall back to the newest mtime among the change directory AND all of its entries RECURSIVELY (a top-level-only walk misses a nested `specs/<cap>/spec.md` edit; the parent dir mtime does not advance for it). Include the directory's own mtime in the max (D5).
- [x] 1.8 Read the threshold from `OPENSPEC_HYGIENE_STALE_DAYS`, default 14; a non-integer or non-positive value falls back to the default.
- [x] 1.9 Replace rule 1's unconditional `status === "complete"` report with: report only when escaped OR stale. Emit a distinct message per reason — naming the base ref (escaped) or the age in days (stale). When BOTH hold, state the precedence you chose and apply it consistently (or emit both reasons). Leave the `no-tasks` branch unchanged.
- [x] 1.10 Emit a per-change exempt diagnostic naming the change and why it was exempt, e.g. `openspec/changes/<name>: complete but in flight (absent from origin/main, last activity 0d ago)` (D13). This is what makes the negative tests a real control.
- [x] 1.11 Capture child stderr (`stdio: ["ignore","pipe","pipe"]`) on git invocations so git's own `fatal:` lines do not leak to the terminal ahead of the script's own notice at pre-commit. Implement D6 degradation: a predicate that throws or returns unparsable output means "unknown -> REPORT" plus a stderr notice, never a silent false. Base ref unresolvable means staleness-only. Git unavailable or target not a git repo means legacy unconditional reporting plus an explicit stderr notice.
- [x] 1.12 Make a missing `openspec/changes/archive/` mean "no archived changes" instead of an uncaught ENOENT at line 53 (D15) — a crash there exits 1 and is indistinguishable by exit code from a real report.
- [x] 1.13 Update the script's header comment (line 3 still says "complete ... (should be archived)") to describe the overdue rule, and document `OPENSPEC_HYGIENE_STALE_DAYS`.
- [x] 1.14 Confirm rules 2 (stray entries) and 3 (leftover `files-modified.md`) are behaviorally untouched apart from 1.12; do not restructure them.

### Tests

- [x] 2.1 Add `scripts/check-openspec-hygiene.selftest.mjs`, spawning the real script as a subprocess against fixture git repos under `os.tmpdir()` — never inside this repository. Point it at each fixture via the 1.2 target root. Do NOT add a jest test: D12 gives the three measured reasons.
- [x] 2.2 Pin the fixture git environment so the self-test cannot depend on the developer's config: `git init -b main`, and every commit made with `-c user.name=... -c user.email=... -c commit.gpgsign=false`. This repo itself uses a repo-local identity, so a contributor with no global identity (or `commit.gpgsign=true`) would otherwise have EVERY commit in the repo blocked by this gate.
- [x] 2.3 Remove every fixture directory in a `finally`, so a failing case cannot leak ~10 repos into `os.tmpdir()` per commit.
- [x] 2.4 Give every fixture an `openspec/changes/archive/` directory EXCEPT 2.13's deliberate no-archive case, and assert the expected MESSAGE TEXT in every case below — never the exit code alone (D9). A fixture missing that directory crashes with ENOENT and exit 1, which an exit-code-only assertion reads as a pass.
- [x] 2.5 Add `"check:openspec:selftest": "node scripts/check-openspec-hygiene.selftest.mjs"` to `package.json` and wire it into `.husky/pre-commit` AFTER `check:openspec`, leaving every existing line and its order intact.
- [x] 2.6 FIRES - escaped: complete unarchived change committed on the base branch and reachable from it. Assert exit 1 AND the escaped wording naming the base ref.
- [x] 2.7 FIRES - stale (tracked): complete unarchived change whose only commit is backdated beyond the threshold via `GIT_AUTHOR_DATE`/`GIT_COMMITTER_DATE`. Build it on a feature branch ABSENT from base, so escaped is false and the case isolates staleness. Assert exit 1 AND the stale wording including the age.
- [x] 2.8 FIRES - stale (untracked): complete unarchived change never committed, with the directory AND EVERY ENTRY backdated beyond the threshold (under `max()` semantics a single fresh entry keeps it looking new and the case silently fails). Assert exit 1 AND the stale wording. This is the D5 hole that would otherwise hide a change forever.
- [x] 2.9 FIRES - rebase does not reset the clock: backdated author date, then a rebase moving committer date to now. Assert exit 1 AND the stale wording — the `%at`-vs-`%ct` control.
- [x] 2.10 DOES NOT FIRE - in flight: complete unarchived change on a feature branch cut from base, committed now, absent from base. Assert exit 0 AND the 1.10 exempt diagnostic naming the change. This is AC1 and the executor's mid-Execution commit.
- [x] 2.11 DOES NOT FIRE - freshly written, never committed, mtime now. Assert exit 0 AND the exempt diagnostic.
- [x] 2.12 Degradation (D6), all three branches, asserting the stderr TEXT: no `main`/`origin/main` decides on staleness alone; a non-git directory reports unconditionally; and a predicate that fails outright reports (construct by pointing `refs/remotes/origin/main` at an absent object so resolution succeeds and `ls-tree` then fails).
- [x] 2.13 Rules 2 and 3 still fire, asserting their message text: stray file in `openspec/changes/`; `files-modified.md` in an archived change (AC5). Plus 1.12: a repo with no `archive/` directory does not crash. Plus two cheap spec-scenario cases: no fully-checked change present emits NO exempt diagnostic; an invalid `OPENSPEC_HYGIENE_STALE_DAYS` falls back to the default.
- [x] 2.14 Mutation control A: revert rule 1 to unconditional reporting; confirm 2.10 and 2.11 FAIL. Restore. Record the observed output in the commit body.
- [x] 2.15 Mutation control B: force the overdue predicate always-false; confirm 2.6, 2.7, 2.8 and 2.9 ALL FAIL. Restore. This is the mutant matching the ticket's forbidden failure mode — a check that stops false-positiving by never firing. Record the output.
- [x] 2.16 Run `npm run check:openspec:selftest` and record the per-case output. A silent pass with zero cases run is a defect.

## 2. Verification

### Verification

- [x] 3.1 Re-merge `origin/main` if it moved during Execution and re-run every gate. The tree that passes the final gate must be the tree that gets squashed (CON-129).
- [x] 3.2 Run each pre-commit hook INDIVIDUALLY and record each result verbatim: `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run check:schemas`, `npm run check:spec-structure`, `npm run check:openspec`, `npm run check:openspec:selftest`, `npm run check:scala-quality`, `npm test`. Do not assume only the anticipated one fails.
- [x] 3.3 AC3 live proof: with the fix in place, `npm run check:openspec` MUST pass in this worktree while this change sits complete-and-unarchived, and MUST print the 1.10 exempt diagnostic for it. Record that output.
- [x] 3.4 If a bypass is still required for any OTHER gate, enumerate in the commit body exactly which gates it skips, verbatim from 3.2 — never a summary. HEL-774 disclosed one gate and had actually skipped two.
- [x] 3.5 Measure `check:openspec:selftest` wall-clock time and record it against D14's 3s budget. If over, switch the fixture cases to concurrent execution and re-measure; only if still over, stop and escalate.
- [x] 3.6 Confirm the staged file list matches `files-modified.md`; no probe artifacts, no fixture leftovers under the repo or in `os.tmpdir()`, no stray PNGs, no large sandbox copies.
- [x] 3.7 Confirm `scripts/check-spec-structure.mjs` is absent from the diff (AC6), and `git diff origin/main -- .husky/pre-commit jest.config.cjs` shows only the single added selftest line and no jest config change.
