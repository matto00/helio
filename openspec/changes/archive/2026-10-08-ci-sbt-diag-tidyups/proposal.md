## Why

HEL-1339 shipped CI sbt hang diagnostics with six known rough edges (HEL-1362): a static guard that a multi-line
pipeline evades, a stale timing comment, a capture message that over-claims, a capture budget that can overrun, a
5.4 MB log directory awaiting a keep/remove decision, and an unused thin-client code path. Tidying them keeps the
diagnostics honest before the next real hang needs them.

## What Changes

- Static guard (`scripts/check-ci-sbt-no-pattern-kill.mjs`) matches over logical shell lines (backslash and trailing-`|`
  continuations joined), with selftest cases for split pipelines.
- `ci.yml` backend timing comment re-stated from this PR's measured shard-0 pre-steps; the archived HEL-1339
  `ci-evidence.md` gets a dated correction note (its original measurement is left intact).
- Deadline failure message distinguishes "jcmd thread dump written" from "SIGQUIT sent only (dump, if any, is in
  sbt.log)".
- Capture budget becomes a hard ceiling: no candidate work (jcmd, SIGQUIT, its wait) starts or runs past it.
- The archived HEL-1339 `ci-logs/` keeps its diagnostics positive control; two unrelated flaky-test logs (~5.3 MB) leave
  the tree (still in history), recorded in a correction note.
- The thin-client lever is removed: `ci-sbt.sh --mode`, `e2e-backend.sh`'s empty `E2E_SBT_SERVER_FLAG` client mode,
  and the `active.json` socket lookup. Mode lines keep printing `mode=server`.

## Capabilities

### New Capabilities

### Modified Capabilities
- `ci-sbt-invocation`: recorded PID sources narrowed to the launch PID/group (no server state files); failure message
  must say which capture kind happened; capture stays within its stated budget; static guard covers continued lines.

## Non-goals

- Any change to cache keys, cache paths, or HEL-1299's restore/save split; any job/step `timeout-minutes` change.
- Rewriting the HEL-1339 archived evidence text beyond an appended correction note.

## Impact

`scripts/ci-sbt.sh`, `scripts/lib/ci-sbt-diag.sh`, `scripts/e2e-backend.sh`, `scripts/check-ci-sbt-no-pattern-kill.mjs`
(+ selftest), `scripts/ci-sbt.selftest.mjs`, one `.github/workflows/ci.yml` comment, one archived evidence note.
CI-only; no product code, no `.husky/**`.
