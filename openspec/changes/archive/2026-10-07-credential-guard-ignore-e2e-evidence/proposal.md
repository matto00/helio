## Why

The credential-surface gate (`scripts/check-no-credential-in-agent-surface.mjs`, run by `.husky/pre-commit`) fails
with `COVERAGE DRIFT` for any top-level directory it cannot classify. HEL-1363 added the gitignored, per-worktree
`e2e-evidence/` output directory but not the matching `IGNORED_TOP_LEVEL` entry, so every worktree that has run an
evidence-saving e2e spec can no longer commit. This violates the spec's own "guard is stable across checkouts"
scenario and blocks every e2e lane.

## What Changes

- Add `e2e-evidence` to `IGNORED_TOP_LEVEL`, and refresh the header comment's name/`.gitignore`-line table (its line
  numbers are stale and it does not mention anchored root patterns like `/e2e-evidence/`).
- Self-test: a red/green case proving the real gate passes with `e2e-evidence/` present and a mutated copy without
  the entry fails with `COVERAGE DRIFT` naming it.
- Self-test: a consistency check that every root-level directory pattern in `.gitignore` is excluded by the gate
  (except the self-test's own deliberately-tripping probe directories), so the next forgotten entry fails at the
  commit that adds the `.gitignore` line instead of in some later lane.
- Audit result: report any other gitignored top-level directory with the same gap (fixed in the same change).

## Capabilities

### New Capabilities

### Modified Capabilities

- `agent-surface-credential-gate`: the "Coverage drift fails" requirement gains an explicit scenario that every
  root-level gitignored output directory is excluded, kept in sync with `.gitignore` by a self-test.

## Impact

- `scripts/check-no-credential-in-agent-surface.mjs`, `scripts/check-no-credential-in-agent-surface.selftest.mjs`.
- No runtime, API, schema, or CI workflow change. Gate-chain touching (both scripts are invoked by
  `.husky/pre-commit`).

## Non-goals

- Deriving the ignore set from `.gitignore` / `git check-ignore` at gate runtime (the script's header documents why
  that was rejected; the self-test consistency check gives the same safety without that dependency).
- Fixing main's red `security` CI job (HEL-1367).
