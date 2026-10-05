## Why

`check-node-root-encoding` (the HEL-913 design.md R12 guard against the ambiguous "`node_step_id IS NULL` alone means the root" encoding) exempts its six reviewed-safe sites by `file:lineNumber`. Every edit above those sites shifts them and turns CI red with no real defect — three times so far (HEL-1027, HEL-1188, HEL-1271), and HEL-1276 is about to edit `NodeSnapshotRepository.scala` again. The TypeScript sibling guard (`check-node-root-encoding.ts.mjs`) carries the same line-number keying (`helio-mcp/src/context.ts:222`).

## What Changes

- Replace the `file:line` exemption sets in `scripts/check-node-root-encoding.mjs` with content-keyed exemption entries: file + enclosing declaration name + governing match arm + whitespace-normalised line text + an exact expected occurrence count.
- An exemption entry exempts at most its declared count; any surplus occurrence of the same text in the same scope is reported as a violation, and an entry that matches fewer occurrences than declared is reported as stale (the check fails in both directions).
- Apply the same keying to the TypeScript sibling `scripts/check-node-root-encoding.ts.mjs` (its one `KNOWN_ROOT_QUALIFIED_LINES` entry).
- Rewrite both selftests to prove: a line-shift stays green, a new unexempted hit goes red, a duplicate of an exempt line goes red, removing an exemption turns its site red, and a stale entry goes red.
- No change to the detection regexes, the scanned file set, any Scala/TypeScript source, or any migration.

## Capabilities

### New Capabilities
- `node-root-encoding-guard`: the CI guard that bans the standalone node-root NULL encoding and how its reviewed exemptions are keyed.

### Modified Capabilities

## Impact

- `scripts/check-node-root-encoding.mjs`, `scripts/check-node-root-encoding.selftest.mjs`, `scripts/check-node-root-encoding.ts.mjs`, `scripts/check-node-root-encoding.ts.selftest.mjs`.
- CI's `check:node-root-encoding[:selftest|:ts|:ts:selftest]` steps (`.github/workflows/ci.yml`) — unchanged invocations, stable results across unrelated edits.
- No backend, frontend, helio-mcp, schema or migration change.
