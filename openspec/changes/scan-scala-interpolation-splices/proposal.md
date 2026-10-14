## Why

`check:scala-quality` blanks every `"..."` literal before matching inline FQNs, including interpolated literals, so code
inside a `${...}` splice is never checked. HEL-1247 shipped an inline `java.util.UUID` past the pre-commit hook this way;
the guard's own header documents the blind spot instead of closing it.

## What Changes

- The guard scans the code inside `${...}` splices of interpolated string literals (`s`, `f`, `raw`, or any
  `id"..."` interpolator), with nested braces and nested string literals inside a splice handled.
- Plain string text (non-interpolated literals, and the text portions of interpolated ones) stays exempt; `$$` and
  `$ident` without braces are text-plus-identifier, never an FQN.
- Implemented as two passes (the unchanged base string-blanking guard OR a new splice scan); a line is flagged if either flags it, so no base finding can be lost.
- New selftest cases, shown red against the unmodified guard first.
- Any existing violation the wider scan finds is fixed with a top-of-file import (there is no baseline for this guard).

## Capabilities

### New Capabilities

### Modified Capabilities
- `scala-inline-fqn-guard`: string-literal exemption narrows to plain text; splice code is now checked.

## Non-goals

- Pass 1 is the base guard, unchanged: its `'"'` char-literal false negative and its line-by-line matching of multi-line `"""` text are inherited.
- No change to the prefix list, import/package/comment exemptions, or file-size warnings.
- No change to `ShareTokenGenerationSpec.scala` (its plain-string `scala.util.Random` mentions stay unflagged).

## Impact

`scripts/check-scala-quality.mjs`, `scripts/check-scala-quality.selftest.mjs`, possibly Scala sources with newly found
splice FQNs. No runtime/product behaviour change.
