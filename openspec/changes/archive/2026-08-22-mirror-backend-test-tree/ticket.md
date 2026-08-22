# HEL-634: Mirror the backend test tree onto the new main layout

## Description

Blocked by the backend main repackage (HEL-633, merged) — the test tree follows whatever main actually landed on, so start by reading the merged layout rather than this ticket's assumptions.

`backend/src/test/scala/com/helio` has drifted out of correspondence with main. Finding the spec for a given source file currently means guessing.

## Current drift (as filed — VERIFY AGAINST LIVE TREE, ticket enumerations on this epic have been stale every time)

* `test/.../api/` — files at the package root against fewer in `api/routes/`. Route specs sit beside directive specs.
* `test/.../domain/` — files at root, including step specs (`domain/steps` already exists) and shape-engine specs (`domain/shapes` already exists).
* `testsupport/` and `testutil/` are two names for one concept.

## Work

1. Mirror main's post-repackage layout for every spec — a spec lives in the package matching the file under test.
2. Move the step and shape-engine specs into the `domain/steps` and `domain/shapes` packages that already exist.
3. Merge `testutil/` into `testsupport/` (keep `testsupport`, the more conventional name) and delete `testutil/`.
4. Place shared spec base classes (`ApplyProposalSpecBase`) at the root of the package whose specs extend them.

## Constraints

* Moves, `package` declarations, and imports only. No new tests, no changed assertions, no renamed spec classes — a rename would obscure whether coverage survived the move.
* Test file count before and after must be identical. State both numbers in the PR description.

## Acceptance Criteria

* `sbt test` green with the same test count as before the change.
* Every package under `test/.../com/helio` corresponds to a package under `main/.../com/helio` (`testsupport` excepted).
* `rg 'com\.helio\.testutil'` returns nothing.
