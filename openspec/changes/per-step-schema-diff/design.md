# Design: per-step-schema-diff

## Context

`StepCard.tsx` (440 lines post-HEL-404) receives `analyzeSchema: SchemaField[]` (the step's
`inputSchema`) and `analyzeOutputSchema: SchemaField[]` (its `outputSchema`) as props — threaded
from `PipelineDetailPage`'s `getAnalyzeSchema`/`getAnalyzeOutputSchema` helpers through
`PipelineRiverView`. The hardcoded placeholder chips live at `StepCard.tsx:374-383`, inside the
no-editor fallback branch only, using CSS classes `pipeline-detail-page__step-card-diff` /
`-diff-chip` / `--added` / `--removed` / `--changed` (`PipelineDetailPage.css:413-445`). The
analyze response's `AnalyzeStepResult` carries `type` + typed `config` per step
(`types/pipelineStep.ts`), so the `rename` op's `config.renames` (old→new map) is available where
StepCard renders. `PipelineAnalyzeService` (backend) falls back to `outputSchema == inputSchema`
when a step has a `validationError` — an identity diff, which correctly renders nothing.

## Goals / Non-Goals

Goals: real added/dropped/retyped/renamed chips on every StepCard's expanded body; pure, unit-tested
diff helper; placeholder deleted; zero new plumbing (both schemas are already props).
Non-goals: backend changes; rename heuristics beyond the `rename` op; collapsed-header display;
touching the preview tray (HEL-404 surface).

## Decisions

1. **Pure helper `computeSchemaDiff(input, output, renames?)` in
   `frontend/src/features/pipelines/state/schemaDiff.ts`** (beside `stepNarrowing.ts`, matching the
   ticket's placement hint). Signature takes the two `SchemaField[]` arrays plus an optional
   `renames: Record<string, string>` (the caller passes `step.config.renames` only when
   `step.opType.id === "rename"`, via the existing `renamesOf` narrowing helper). Returns
   `{ added: SchemaField[]; dropped: SchemaField[]; renamed: Array<{from; to; type}>;
   retyped: Array<{name; fromType; toType}> }`.
   Algorithm: name→type maps both sides; `retyped` = names present in both with differing types
   (input order); raw added = output-only names (output order); raw dropped = input-only names
   (input order); then for each `from→to` rename entry where `from` is in raw dropped AND `to` is
   in raw added, emit `renamed` and remove both from added/dropped. Anything unpaired stays
   add/drop — the ticket's "where the op makes that determinable" bound. Pure function, no React.
2. **Presentational component `ui/StepSchemaDiffChips.tsx`**, not inline in StepCard: StepCard is
   already past the 400-line budget (HEL-682 exists for the split — do not grow it by ~40 lines
   here). StepCard renders `<StepSchemaDiffChips input={analyzeSchema} output={analyzeOutputSchema}
   renames={...} />` once, in the expanded body **above the op-kind editor branch** (so it appears
   for every op kind), and the fallback branch's placeholder block is deleted. The component
   returns `null` when every diff bucket is empty (covers identical schemas, analyze-unavailable
   → one or both arrays empty, and the validationError identity fallback).
3. **Chip vocabulary** (existing recipe reused; text content per `DESIGN.md` muted/compact chips):
   added → `--added` chip, `+ name`; dropped → `--removed` chip, `− name` (U+2212, matching the
   placeholder); retyped → `--changed` chip, `~ name: fromType→toType`; renamed → new `--renamed`
   modifier chip, `name → newName`, styled with the same token-only pattern as its three siblings
   (accent/border/text tokens; no literals beyond what the existing recipe already uses — do not
   propagate the `2px 7px` literal to a *new* recipe, reuse the existing `-diff-chip` base class
   which already carries it; HEL-680 owns tokenizing that base).
4. **No cap/truncation on chip count**: the container already flex-wraps; a pivot/select emitting
   many chips wraps to more rows. Accepted for editor-scale schemas (≤ tens of columns) — a
   "+k more" affordance is deferred until someone hits it for real.
5. **Tests**: `state/schemaDiff.test.ts` — pure-function cases: added; dropped; retyped; rename
   paired (not add+drop); rename entry not matching schemas stays add/drop; rename with type
   change still pairs (type taken from output side); identical schemas → all empty; empty
   input/output arrays. `StepCard.test.tsx` additions: real chips render for a step with analyze
   data (all four kinds); placeholder text `col_a` gone from the codebase; no diff strip when
   schemas identical or analyze unavailable; strip renders for an op-kind WITH an editor (proves
   it left the fallback branch).

## Planner Notes (self-approved)

- Rename pairing keyed off `renamesOf(step)` for the `rename` op only — matches AC "where the op
  makes that determinable"; all other ops show add+drop, by design.
- Diff strip lives in the expanded body (not the collapsed header): "at a glance" is satisfied on
  expand; the header is already crowded (label + row-count chip + chevron) and collapsed-state
  chips would need their own truncation design — out of scope.
- `StepCard.tsx` net growth budgeted ≤ ~10 lines (import + one render site + one `renamesOf`
  call); the component/helper carry the logic. Record actual numbers in `files-modified.md`.

## Risks

- Ops whose output reorders columns produce order-sensitive-looking chips; mitigated by stable
  source-order emission (input order for dropped/retyped, output order for added).
- `−` (minus sign) vs `-` in tests: assert on the exact placeholder glyph used in the chip text to
  avoid copy-drift false passes.
