## Why

During the HEL-323 fleet run, the final-gate skeptic invoked
`scripts/concertino/cleanup.sh` mid-review and destroyed the live worktree's git
metadata (631 MB orphaned, manual recovery). `cleanup.sh` is a destructive Phase-4
(post-merge) teardown, yet nothing scopes it away from the review agents that share
the worktree and have `Bash`. This change makes a stray mid-review invocation
impossible/harmless.

## What Changes

The fix lands in the Concertino source repo (`~/Development/concertino`) and reaches
helio via `concertino sync`. Belt-and-suspenders:

- **Guard (belt):** `core/scripts/cleanup.sh` refuses to run its destructive steps
  unless an explicit `--phase4` flag (or `CONCERTINO_PHASE4=1` sentinel) is present.
  A stray call becomes a loud no-op instead of wiping the worktree.
- **Role prohibition (suspenders):** the rendered evaluator and skeptic agent
  definitions gain an explicit guardrail: never invoke `cleanup.sh` — it is a Phase-4
  orchestrator-only teardown. The orchestrator's Phase-4 invocation passes `--phase4`.
- **Sync propagation fix:** `concertino sync` currently does **not** refresh
  `scripts/concertino/*.sh` (only `init` does), so a script fix could never reach a
  consuming repo via sync — the exact mechanism this ticket mandates. `sync` is fixed
  to refresh the canonical scripts.
- **Version bump** so consuming repos' `upgrade` flags the generated files as stale.

## Capabilities

### New Capabilities
- `concertino-worktree-safety`: guarantees a review agent cannot destroy a live
  worktree via the teardown script, and that script fixes propagate through `sync`.

### Modified Capabilities
<!-- none — concertino tooling is not otherwise specced in helio's openspec -->

## Impact

- Concertino source: `core/scripts/cleanup.sh`, `core/roles/{orchestrator,evaluator,skeptic}.md`,
  `bin/concertino` (sync script propagation), `package.json` (version).
- Helio (regenerated via sync): `scripts/concertino/cleanup.sh`,
  `.claude/agents/concertino-{orchestrator,evaluator,skeptic}.md`,
  `scripts/concertino/.concertino.env`.
- No helio product/runtime code, no API/schema contract, no UI.
