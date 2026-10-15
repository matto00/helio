# HEL-1603: check-scala-quality pass 2 treats the first `*/` as closing a nested Scala block comment (false positive)

## Description

Origin: HEL-1386 (PR matto00/helio#1029, c5cc7eeee), lane-reported. Not fixed there.

Scala block comments nest, but the splice scan in `scripts/scala-code-only.mjs` (pass 2) ends a comment at the first
`*/`. So `/* a /* b */ s"${java.util.UUID.randomUUID()}" */` is wrongly flagged as an inline FQN in code. This fails
loudly: it blocks a commit and hides nothing. Pass 1, the original guard, is unaffected. There are no nested block
comments in the tree today.

Do: track block-comment nesting depth in pass 2. Add a selftest case that fails first, and keep pass 2 additive only,
per HEL-1386's old-OR-new design.

## Acceptance Criteria

- Pass 2 (`scripts/scala-code-only.mjs`) tracks Scala block-comment nesting depth: a `/*` inside an open block comment
  opens a nested level, and only the matching `*/` returns to code, on one line and across lines.
- `/* a /* b */ s"${java.util.UUID.randomUUID()}" */` is not flagged by `npm run check:scala-quality`.
- A splice FQN in code after a fully closed nested comment (e.g. `/* a /* b */ */ val s = s"${java.util.UUID...}"`)
  is still flagged.
- New selftest case(s) in `scripts/check-scala-quality.selftest.mjs` fail on the unmodified guard first (red-first
  transcript saved as evidence), then pass.
- Pass 1 (base string-blanking detection in `scripts/check-scala-quality.mjs`) is unchanged; the guard as a whole stays
  a superset of the base guard (609e62b6d), proven by re-running HEL-1386's differential (base vs HEAD over the repo's
  backend `.scala` files, as-is and with an FQN appended to each line) plus the probes.
- The whole-repo scan stays clean; `npm run check:scala-quality` exits 0.
- These scripts run from `.husky/pre-commit`: `design.md` carries a completed Gate-Chain Implications Checklist.

## Context

Archive of the origin change: `openspec/changes/archive/2026-10-14-scan-scala-interpolation-splices/`.
