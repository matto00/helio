# Proposal: per-step-schema-diff

## Why

Every StepCard's expanded body still shows a hardcoded placeholder diff (`+ col_a`, `− col_b`,
`~ col_c`) — fake data shipped as UI scaffolding, and only in the no-editor fallback branch. Authors
should see at a glance what each step actually does to the schema. All the data already exists
client-side: the analyze endpoint returns per-step `inputSchema` and `outputSchema`, and since
HEL-404 (merged, e71968c5) StepCard already receives both as props. HEL-405 is the second
Pipeline Authoring UX (HEL-339) ticket on this plumbing.

## What Changes

- New pure helper `computeSchemaDiff` (under `frontend/src/features/pipelines/state/`, beside
  `stepNarrowing.ts`): diffs a step's `inputSchema` vs `outputSchema` into added / dropped /
  retyped (same name, different type) / renamed columns. Rename pairing is best-effort and
  op-aware: only the `rename` op's `config.renames` map makes a rename determinable; other ops
  fall back to add+drop.
- New small presentational component renders the diff as chips, reusing the existing
  `pipeline-detail-page__step-card-diff-chip` CSS recipe (`--added`/`--removed`/`--changed`, plus
  a new `--renamed` modifier). Rendered on **every** StepCard's expanded body (all op kinds), not
  only the fallback branch; the hardcoded placeholder is deleted.
- Nothing renders when there is no diff or analyze data is unavailable.

## Capabilities

### New Capabilities

- `pipeline-step-schema-diff`: per-step schema-diff computation and StepCard chip display
  (the placeholder chips were never spec-covered).

### Modified Capabilities

(none — `pipeline-step-preview` is untouched; no backend requirement changes)

## Impact

- Frontend only: `StepCard.tsx` (small — new component absorbs the rendering), new
  `state/schemaDiff.ts` + `ui/StepSchemaDiffChips.tsx` + tests, one new CSS modifier. No wire
  change, no backend change, no migration.

## Non-goals

- Backend analyze changes (both schemas already returned).
- Rename inference for ops other than `rename` (heuristic type/position matching).
- Diff display in the collapsed card header or the preview tray.
