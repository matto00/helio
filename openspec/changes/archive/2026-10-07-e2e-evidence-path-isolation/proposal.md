## Why

Committed e2e specs hard-code openspec change directories (or cwd-relative paths) as their screenshot targets.
Once the owning change is archived, any lane that runs those specs recreates a ghost `openspec/changes/<name>/`
directory of gitignored PNGs, and pre-commit `check:openspec` blocks that lane with "change has no tasks"
(HEL-1330, 2026-10-07). Four specs in three days used this shape, so it recurs unless guarded.

## What Changes

- Add one e2e helper that resolves every evidence screenshot path from its own file location (never cwd) to a
  single gitignored per-worktree directory outside `openspec/` (`e2e-evidence/<TICKET>/`).
- Migrate the ten specs that write screenshots (`hel588`, `hel1085`, `hel1087`, `hel1088`, `hel1095`, `hel1169`,
  `hel1275`, `hel1277`, `hel1350`, `hel1351`) to the helper.
- Add `check:e2e-evidence-paths` (+ selftest), run pre-commit and in CI, that fails when an e2e file writes a
  screenshot anywhere but through the helper or references the `openspec/` tree outside a comment.
- `check:openspec`: a change directory holding only gitignored files is reported as a stderr notice, not an error.

## Capabilities

### New Capabilities

- `e2e-evidence-path-guard`: where e2e evidence screenshots land, and the guard that keeps them there.

### Modified Capabilities

- `openspec-archival-hygiene`: the "no tasks" rule exempts (with a notice) a change directory whose contents are
  entirely gitignored.

## Impact

`e2e/**` (helper + 10 specs), `scripts/check-e2e-evidence-paths{,.selftest}.mjs`,
`scripts/check-openspec-hygiene{,.selftest}.mjs`, `package.json`, `.husky/pre-commit`, `.github/workflows/ci.yml`,
`.gitignore`. No product code, no backend/frontend runtime change.

## Non-goals

- Concertino upstream changes (nothing upstream is involved — see ticket.md premise validation).
- The Playwright MCP shared-browser hazard (MISTAKES.md) — a separate, unrelated mechanism.
- Deleting the unreferenced `backend/scripts/check-openspec-hygiene.mjs` duplicate.
