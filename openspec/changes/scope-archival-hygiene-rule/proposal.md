## Why

`check-openspec-hygiene.mjs`'s "complete but not archived" rule fires purely on `completedTasks === totalTasks`
for the working-tree `tasks.md`. It is phase-blind and git-blind, so it cannot tell an executor's mid-Execution
implementation commit (archival is a later, deliberate Phase 3 step) from a change that is genuinely finished and
never archived. Measured: ~29% of recently archived changes carry a `git commit -n` driven by this, and each such
bypass skips the whole pre-commit chain, not just this check — already the direct cause of one disclosed-bypass
near-miss (HEL-774).

## What Changes

- Replace the unconditional completeness trigger with an **overdue** test. A complete, unarchived change is
  reported only when at least one of two locally-computable, offline conditions holds:
  - **Escaped**: the change directory is reachable from the base branch (`origin/main`, falling back to `main`) —
    it reached the mainline unarchived, which is where the harm actually materialises.
  - **Stale**: the change's most recent commit is older than a threshold (default 14 days) — it has been sitting
    complete and untouched, i.e. abandoned.
  A change that is new on the current branch and recently touched is treated as in-flight and exempt.
- Use git commit timestamps, not filesystem mtime (`openspec list --json`'s `lastModified` resets on fresh
  checkout/worktree creation, so it cannot measure abandonment).
- Degrade safely and explicitly when git context is unavailable, rather than silently exempting everything.
- Add a self-test that proves both directions against constructed real git states.

## Non-goals

- Merging into or modifying `scripts/check-spec-structure.mjs` (HEL-775 deliberately kept it separate).
- Moving the rule to CI. Evidence: no hygiene check is wired into any workflow today, and `ci.yml` sets
  `paths-ignore: "**.md"`, so a markdown-only drift PR would skip CI entirely — the rule would effectively
  never fire.
- Changing the stray-file or leftover-handoff rules, or the `typecheck` gate (HEL-683).

## Capabilities

### New Capabilities

- `openspec-archival-hygiene`: when an unarchived OpenSpec change with a fully-checked `tasks.md` is reported as
  overdue for archival, and when it is exempt as in-flight.

### Modified Capabilities

(none)

## Impact

`scripts/check-openspec-hygiene.mjs` (behavior), plus its new test. `.husky/pre-commit` and `package.json` are read
but not restructured. Affects every local commit in the repo and every concertino delivery cycle.
