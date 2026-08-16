# Tasks: per-step-schema-diff

## 1. Frontend — diff helper

- [x] 1.1 Create `frontend/src/features/pipelines/state/schemaDiff.ts`: `computeSchemaDiff(input: SchemaField[], output: SchemaField[], renames?: Record<string, string>)` returning `{added, dropped, renamed, retyped}` per design Decision 1 (pure, stable source-order emission)

## 2. Frontend — StepCard chips

- [x] 2.1 Create `frontend/src/features/pipelines/ui/StepSchemaDiffChips.tsx`: computes the diff via the helper and renders chips with existing `pipeline-detail-page__step-card-diff-chip` classes (`--added`/`--removed`/`--changed` + new `--renamed`); returns `null` when all buckets are empty
- [x] 2.2 Add the `--renamed` modifier rule in `PipelineDetailPage.css`, token-only, mirroring the three sibling modifiers (reuse the existing `-diff-chip` base; do not add new literals)
- [x] 2.3 In `StepCard.tsx`: render `<StepSchemaDiffChips>` once in the expanded body above the op-editor branch (pass `analyzeSchema`, `analyzeOutputSchema`, and `renamesOf(step)` only when `step.opType.id === "rename"`); delete the hardcoded placeholder chips from the fallback branch (keep its desc text); net growth ≤ ~10 lines

## 3. Tests

- [x] 3.1 `state/schemaDiff.test.ts`: added / dropped / retyped / rename-paired (not add+drop) / unpaired rename entry stays add+drop / rename with type change still pairs / identical schemas empty / empty arrays
- [x] 3.2 `StepCard.test.tsx` additions: all four chip kinds render for a step with analyze data; chips render for an op WITH a dedicated editor (select); no chips when schemas identical or analyze unavailable; `col_a` placeholder absent
- [x] 3.3 Record file growth + any budget notes in `files-modified.md` (StepCard.tsx is 440 lines pre-change; HEL-682 owns the split — do not bundle it)
- [x] 3.4 Run gates: `npm run lint`, `npm run format:check`, `npm test` (frontend) — all clean
