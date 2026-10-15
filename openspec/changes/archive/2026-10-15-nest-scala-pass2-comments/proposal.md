## Why

Scala block comments nest, but the inline-FQN guard's splice scan (pass 2, HEL-1386) closes a block comment at the
first `*/`. Text after an inner `*/` that is still inside the outer comment is scanned as code, so a `${...}` splice
there is falsely reported and blocks a commit. Pass 1 is unaffected.

## What Changes

- Pass 2 tracks block-comment nesting depth: `/*` inside a comment deepens it, `*/` closes one level, and only depth 0
  returns to code. This holds on one line and across lines.
- New red-first selftest cases: a splice inside a nested comment (one line and multi-line) is not flagged; a splice in
  code after a fully closed nested comment is still flagged.
- Pass 1 is untouched; the guard stays a superset of the base guard (old-OR-new).

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `scala-inline-fqn-guard`: the splice scan treats nested block comments as comments until the outermost `*/`.

## Non-goals

- Changing pass 1 or its inherited limits (it is the base guard, byte-identical in behaviour).
- Fixing the other documented pass-2 limits (backtick identifiers with `"`, exotic char literals, `"""` after a
  `//`-truncated line).
- Any prefix-list, exemption or report-format change.

## Impact

`scripts/scala-code-only.mjs`, `scripts/check-scala-quality.selftest.mjs`. Runs in `.husky/pre-commit` and CI via
`npm run check:scala-quality`. No product code, API or dependency change.
