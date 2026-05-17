# Executor Report — CS3 cycle 2

## Scope completed

Tasks 9.1–9.8, 10.1–10.4, 11.1–11.2, 12.1–12.4 from `tasks.md`. Two atomic
commits, one per BLOCKER. All gates green.

## BLOCKER 1 — `features/pipelines/ui/PipelineDetailPage.tsx`

Commit: `37c24ce` — "Decompose PipelineDetailPage (1200L → 389L)".

### Planned extractions (per design D4)

| Sibling                                           | Lines |
| ------------------------------------------------- | ----: |
| `features/pipelines/types/step.ts`                |    26 |
| `features/pipelines/state/stepNarrowing.ts`       |   159 |
| `features/pipelines/ui/RibbonSegment.tsx`         |    50 |
| `features/pipelines/ui/OpDropdown.tsx`            |    48 |
| `features/pipelines/ui/SourceChip.tsx`            |    80 |
| `features/pipelines/ui/StepCard.tsx`              |   323 |

### Drive-by extractions (per design D5 — needed to reach <400L)

The six planned extractions alone left the page at 565L. Three additional
behavior-preserving extractions were performed to bring the parent under
the 400L hard cap:

| Drive-by                                          | Lines | Rationale |
| ------------------------------------------------- | ----: | --------- |
| `features/pipelines/ui/PipelineDetailFooter.tsx`  |   221 | The footer is a self-contained JSX block (~140 lines inlined) with a tight prop interface; extracting it bought ~130 lines off the parent. |
| `features/pipelines/ui/PipelineRiverView.tsx`     |    89 | Central river canvas — a single visual section with all step-card render + add-step logic. |
| `features/pipelines/ui/SourceSelectorBar.tsx`     |    30 | Top "DATA SOURCES" strip — small but the cleanest seam to also shave a few lines. |

All three are JSX-only renderings with no internal state — pure cut-paste
into props/component form. Confirmed by line-by-line review of the rewritten
parent and per-file diffs in the commit.

### Final line counts (BLOCKER 1 group)

| File                                                                      | Lines | Status |
| ------------------------------------------------------------------------- | ----: | :----- |
| `features/pipelines/ui/PipelineDetailPage.tsx`                            |   389 | UNDER 400 |
| `features/pipelines/ui/StepCard.tsx`                                      |   323 | over 250 soft, UNDER 400 |
| `features/pipelines/ui/PipelineDetailFooter.tsx`                          |   221 | UNDER 250 soft |
| `features/pipelines/state/stepNarrowing.ts`                               |   159 | UNDER 250 soft |
| `features/pipelines/ui/PipelineRiverView.tsx`                             |    89 | UNDER 250 soft |
| `features/pipelines/ui/SourceChip.tsx`                                    |    80 | UNDER 250 soft |
| `features/pipelines/ui/RibbonSegment.tsx`                                 |    50 | UNDER 250 soft |
| `features/pipelines/ui/OpDropdown.tsx`                                    |    48 | UNDER 250 soft |
| `features/pipelines/ui/SourceSelectorBar.tsx`                             |    30 | UNDER 250 soft |
| `features/pipelines/types/step.ts`                                        |    26 | UNDER 250 soft |

`StepCard.tsx` at 323L is over the 250L soft cap but well under the 400L hard
cap. Per CONTRIBUTING the soft cap is informational only. A further split
would need to be per-kind (mirroring the CS2c-3c editors+renderers pattern)
and is out of scope for CS3 — flagged as a future spinoff candidate.

## BLOCKER 2 — `features/sources/ui/AddSourceModal.tsx`

Commit: `a4cc9ca` — "Decompose AddSourceModal (471L → 303L)".

### Planned extractions (per design D4)

| Sibling                                           | Lines |
| ------------------------------------------------- | ----: |
| `features/sources/ui/RestApiForm.tsx`             |    45 |
| `features/sources/ui/CsvForm.tsx`                 |    27 |

(SqlTab and StaticSourceForm already lived as separate sibling files prior
to this cycle; no SqlForm.tsx needed.)

### Drive-by extractions (per design D5)

| Drive-by                                          | Lines | Rationale |
| ------------------------------------------------- | ----: | --------- |
| `features/sources/ui/SourceTypeToggle.tsx`        |    67 | The 4-button toggle was duplicated in two branches of the original (static-source branch + configure branch). Unifying via a shared component cleanly removed the duplication and brought the parent down by ~50L without behavior change. |
| `features/sources/ui/InferredFieldsTable.tsx`     |    74 | Preview-step table for editing inferred fields — a self-contained JSX block with its own type (EditableField, exported by the table so the parent can hold the state). |

Planned-only extractions would have left the parent at ~395L — technically
under the 400L cap, but borderline. The drive-bys gave a healthy margin
(303L) and surfaced a small piece of duplication.

### `SourceTypeToggle` unification — verified behavior-preserving

The original modal had two slightly different copies of the type toggle:

- In the `step === "configure" && sourceType === "static"` branch the
  toggle hardcoded only the "Manual" button as `--active` (other buttons
  carried no active class because the branch only runs when sourceType is
  "static").
- In the `step === "configure"` (non-static) branch each button got
  `--active` conditionally based on `sourceType === <id>`.

`SourceTypeToggle` renders the same conditional markup as the second
branch. When invoked with `active="static"`, only the Manual button gets
the `--active` class — which is exactly what the original hardcoded
branch produced. The unification is behavior-preserving.

### Non-behavioral cleanups invoked in the same edit

- Removed the unused `useEffect` import from AddSourceModal (pre-existing
  dead import the linter didn't flag because nothing else in the file
  referenced it).
- Inlined the trivial `handleFileChange` wrapper (one line: forward
  `event.target.files?.[0] ?? null` to `setCsvFile`) into the `CsvForm`
  prop callsite. No functional change.

These are flagged here so the evaluator can confirm they're not regressing
anything.

### Final line counts (BLOCKER 2 group)

| File                                                | Lines | Status |
| --------------------------------------------------- | ----: | :----- |
| `features/sources/ui/AddSourceModal.tsx`            |   303 | UNDER 400 |
| `features/sources/ui/InferredFieldsTable.tsx`       |    74 | UNDER 250 soft |
| `features/sources/ui/SourceTypeToggle.tsx`          |    67 | UNDER 250 soft |
| `features/sources/ui/RestApiForm.tsx`               |    45 | UNDER 250 soft |
| `features/sources/ui/CsvForm.tsx`                   |    27 | UNDER 250 soft |

## `PanelCreationModal.tsx` — left untouched (CS4)

| File                                                | Lines | Status |
| --------------------------------------------------- | ----: | :----- |
| `features/panels/ui/PanelCreationModal.tsx`         |   716 | OVER 400 (deliberate, CS4-tagged) |

Verified the file is at `features/panels/ui/PanelCreationModal.tsx`
post-cycle-1 (Reality 2 in executor-report-1.md). Per-subtype decomposition
mirrors the CS2c-3c editors+renderers pattern and belongs to CS4.

## Source files over 400L hard cap (post-cycle-2)

| LOC | Path                                            | Status |
| --: | ----------------------------------------------- | :----- |
| 716 | `features/panels/ui/PanelCreationModal.tsx`     | CS4-tagged |

`*.test.tsx` and `*.test.ts` files are exempt from the hard cap (coverage
files are allowed to be longer). The eight test files currently over 400L
were all over 400L on `main` pre-CS3 and are unchanged by cycle 2 (the
PipelineDetailPage test file was renamed only).

## Gates run

All gates run from `/home/matt/Development/helio/.worktrees/HEL-236-cs3`:

| Gate                                          | Result | Notes                                  |
| --------------------------------------------- | ------ | -------------------------------------- |
| `sbt test` (backend sanity)                   | PASS   | 591 tests, 35 suites — backend untouched |
| `npm run lint` (zero-warnings)                | PASS   |                                        |
| `npm run format:check`                        | PASS   |                                        |
| `npm test` (frontend Jest)                    | PASS   | 664 tests, 58 suites                   |
| `npm --prefix frontend run build`             | PASS   | TypeScript + Vite                      |
| `npm run check:schemas`                       | PASS   | 6/6 schemas in sync                    |
| `npm run check:openspec`                      | PASS   | openspec/ clean                        |
| `npm run check:scala-quality`                 | PASS   | 18 pre-existing soft warnings (backend, unchanged) |
| Pre-commit hook (Husky)                       | PASS   | Both cycle-2 commits ran the full chain |
| File-size BLOCKER check                       | PASS   | Only `PanelCreationModal.tsx` (716L) remains over the 400L hard cap — deliberate, CS4 |

## Nuance for evaluator sanity-check

1. **`StepCard.tsx` over the 250L soft cap (323L)**: the file dispatches
   to nine kind-specific editors and tracks nine pieces of local editor
   state with parallel `useState`/sync-on-prop-change logic. Splitting it
   further would require introducing per-kind StepCard variants (mirroring
   CS2c-3c editors+renderers). Out of scope for CS3; under the 400L hard
   cap; flagged as a spinoff candidate.

2. **`PipelineDetailPage` still passes its full `PipelineDetailPage.test.tsx`
   suite unchanged (1366L test file, 32 test cases)**. The page's public
   API (the default export `PipelineDetailPage`) is identical pre/post; the
   extracted siblings are private to the file's module graph and not
   directly tested.

3. **`SourceTypeToggle` unification (BLOCKER 2)**: the only edit that
   merges two original code paths. Sketched in detail above — the rendered
   DOM in either invocation matches the original branch exactly.

4. **`handleFileChange` inlining and `useEffect` import removal**: tiny
   non-behavioral cleanups within the BLOCKER-2 commit. Flagged so the
   evaluator can confirm they're not surprising.

5. **`ComputedFieldPicker.test.tsx`** (cycle 1 flag — pre-existing): still
   misnamed, exercises `PanelDetailModal`. Not touched in cycle 2; rename
   remains a spinoff candidate (would require renaming + git-mv across one
   file).

6. **`runSourceRowCount`** is destructured from the Redux state in
   `PipelineDetailPage` but never used. Pre-existing dead destructure; not
   flagged by the linter under current config. Left untouched
   (out-of-scope cleanup — could be a tiny spinoff but no point bundling).

## Commit log (cycle 2)

```
a4cc9ca HEL-236 CS3 cycle 2: Decompose AddSourceModal (471L → 303L)
37c24ce HEL-236 CS3 cycle 2: Decompose PipelineDetailPage (1200L → 389L)
```

Each commit passes the full pre-commit hook chain. The branch now totals
**12 commits** (10 from cycle 1 + 2 from cycle 2). `git bisect` between
any two commits is safe.
