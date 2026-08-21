# HEL-775: Stray `## ADDED Requirements` heading in 22 canonical specs blocks future openspec archives

## Description

22 canonical spec files under `openspec/specs/` were reported to carry a stray `## ADDED Requirements`
heading left over from an earlier archive, instead of the expected `## Requirements`. Some carry both.

This is a latent archive-blocker, not cosmetic. `specs-apply.js`'s delta parser scopes requirement
lookups to the `## Requirements` section, so every requirement sitting under the stray heading is
invisible to it. A future change emitting a `MODIFIED` or `REMOVED` delta against one of these
capabilities aborts at archive time with `... failed for header "### Requirement: <name>" - not found`
/ `Aborted. No files were changed.` — halting a delivery after its code has already merged.

Hit for real twice: during HEL-528 (PR #407, `shared-status-message`) and during HEL-548
(`frontend-panel-empty-state`). Both were repaired in-flight, one under delivery pressure. Neither run
found this by auditing specs — both found it by delivery breaking.

The ticket proposes normalizing each file by renaming the stray heading to `## Requirements`, merging
where a file has both, changing no requirement text, and then adding a guard so the residue cannot
return (the ticket suggests extending `scripts/check-openspec-hygiene.mjs`).

## Acceptance Criteria

- Every malformed file under `openspec/specs/` is enumerated mechanically, by condition, and the two
  conflicting prior counts (22 from HEL-528's run; 21/19 from HEL-548's run) are reconciled against the
  real files rather than trusted.
- The load-bearing question is settled by test, not reasoning: does renaming the heading alone make a
  raw delta file canonical, or does it leave files that still fail?
- Every enumerated file is repaired so `openspec archive` and the delta parser handle it correctly,
  with every requirement, scenario and ordering preserved verbatim. A silently dropped requirement is
  worse than the bug.
- A guard prevents the malformation from returning, and is proven to fail red against a deliberately
  malformed file before being trusted green.
- `shared-status-message` and `frontend-panel-empty-state` (repaired in-flight by earlier runs) have
  their current state verified rather than assumed.
- Repairs are made against a tree merged up to current `origin/main`, so no merged capability change is
  silently reverted.
