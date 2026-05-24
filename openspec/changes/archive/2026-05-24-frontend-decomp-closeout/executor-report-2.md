# Executor Report — Cycle 2

**Change**: `frontend-decomp-closeout`
**Cycle**: 2 (creative — `PanelCreationModal` per-subtype + step
decomposition, `StepCard` natural decomposition)
**Ticket**: HEL-236 CS4

## Summary

Closed out the file-size BLOCKER for `PanelCreationModal.tsx` and
proactively decomposed `StepCard.tsx` along the most natural seam. After
cycle 2, **no source file in `frontend/src/` is over the 400L hard cap**;
the only outstanding violator entering cycle 2 (`PanelCreationModal.tsx`
716L) now sits at 383L. Cycle 2 was three atomic commits.

## PanelCreationModal — final line counts

| File | Before cycle 2 | After cycle 2 |
|---|---|---|
| `features/panels/ui/PanelCreationModal.tsx` | 716L | **383L** |
| `features/panels/ui/creators/creatorTypes.ts` | n/a | 33L |
| `features/panels/ui/creators/MetricCreatorFields.tsx` | n/a | 44L |
| `features/panels/ui/creators/ChartCreatorFields.tsx` | n/a | 32L |
| `features/panels/ui/creators/ImageCreatorFields.tsx` | n/a | 27L |
| `features/panels/ui/creators/DividerCreatorFields.tsx` | n/a | 37L |
| `features/panels/ui/creationSteps/TypeSelectStep.tsx` | n/a | 86L |
| `features/panels/ui/creationSteps/TemplateSelectStep.tsx` | n/a | 59L |
| `features/panels/ui/creationSteps/DataTypeSelectStep.tsx` | n/a | 94L |
| `features/panels/ui/creationSteps/NameEntryStep.tsx` | n/a | 116L |

Two folders introduced:

- `creators/` — the four per-subtype config field components called out
  in design D1 (mirrors CS2c-3c `editors/` + `renderers/`). Each creator
  takes a non-null narrowed `{Subtype}TypeConfig` plus an `onChange` and
  forwards back to the shell's `setTypeConfig`. `creatorTypes.ts` carries
  the shared `CreatorFieldsProps<TConfig>` generic and the
  `hasNonEmptyTypeConfig` type guard the shell still owns.
- `creationSteps/` — the four step bodies (drive-by under design D5).
  Each is purely presentational: the shell owns the step machine,
  selected type, typeConfig, title, dataTypeId, isCreating, createError,
  the discard-confirm UI, the focus trap, and the create-panel dispatch;
  each step receives its slice of state plus typed callbacks.

`isDataBound` stayed in the shell — it's about the step machine, not
about a particular creator. `hasNonEmptyTypeConfig` moved into
`creators/creatorTypes.ts` because the predicate is exactly about the
creator-owned `TypeConfig` shape and keeping it next to that shape (and
exporting it for the shell) makes the cohesion explicit.

## StepCard — decision + rationale

**Decision**: natural decomposition adopted, but not the per-kind
sub-component split the design considered. Lifted the per-op editor
state and persistence handlers into `useStepCardState`.

**Why not per-kind sub-components**: the expanded-body dispatch (lines
207–262 of the old file) already routes into eight already-extracted
config components (`SelectFieldsConfig`, `RenameFieldsConfig`,
`CastFieldsConfig`, `FilterConfig`, `ComputeFieldConfig`,
`AggregateConfig`, `LimitConfig`, `SortConfig`). A per-kind wrapper
component would be a 3–10 line shim taking a slice of shell state plus a
handler and forwarding into the existing config component. That's pure
indirection — it would *increase* the surface area (a new component per
arm, plus a prop type) without removing any state, logic, or coupling.
Per CONTRIBUTING.md, this is the kind of "cosmetic" decomposition the
file-size budgets are meant to discourage.

**What worked**: the real density in StepCard.tsx was the eight pieces
of editor state plus their PATCH-on-change handlers (~88 lines combined,
between the `useState` declarations + the during-render `prev*` sync
block + the 8 typed handlers). Lifting those into a colocated hook
removes a real concern from the render component without splitting
tightly-coupled UI.

| File | Before | After |
|---|---|---|
| `features/pipelines/ui/StepCard.tsx` | 323L | **236L** (under 250L soft cap) |
| `features/pipelines/hooks/useStepCardState.ts` | n/a | 167L |

## Drive-by extractions

One — the `creationSteps/` folder is technically a drive-by under design
D5: design D1 specified only the four `creators/` extractions. After
those landed the shell was 577L, still over the 400L hard cap. The four
step-body extractions were the natural and only behavior-preserving path
under cap. Each step is a small, cohesive, presentational unit.

No other drive-bys. No behavior changes anywhere in cycle 2. No
"improvements" or out-of-scope fixes.

## Files >400L confirmation

Source files (`.ts` / `.tsx` outside `*.test.*`) in `frontend/src/` over
400L: **none**. Verified via:

```bash
find frontend/src -type f \( -name '*.ts' -o -name '*.tsx' \) \
  ! -name '*.test.*' -exec wc -l {} + | awk '$1 > 400'
```

Test files (`*.test.tsx`, `*.test.ts`) over 400L do exist — all
pre-existing from prior CS / pre-HEL-236 work and explicitly out of
scope under the cycle-2 instructions and ticket guard rails:

- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx` 1366L
- `frontend/src/features/panels/ui/PanelList.test.tsx` 874L
- `frontend/src/features/panels/ui/PanelCreationModal.test.tsx` 850L
- `frontend/src/features/pipelines/state/pipelinesSlice.test.ts` 802L
- `frontend/src/features/panels/ui/PanelDetailModal.test.tsx` 797L
- `frontend/src/app/App.test.tsx` 567L
- `frontend/src/features/panels/state/panelsSlice.test.ts` 461L
- `frontend/src/features/dashboards/state/dashboardsSlice.test.ts` 442L

The cycle-2 BLOCKER check is satisfied: zero **source** files over 400L.

## Test count + behavior preservation

664 tests / 58 suites both before and after cycle 2 — preserved exactly.
The 42 `PanelCreationModal.test.tsx` assertions all pass against the
decomposed shell + creators + step components (they test through the
modal API, so they don't need updating). StepCard's tests pass through
`PipelineDetailPage.test.tsx` and continue green after the hook
extraction.

## Gates run

| Gate | Result |
|---|---|
| `sbt test` (sanity) | 591 tests / 35 suites pass |
| `npm run lint` | clean (0 warnings) |
| `npm run format:check` | clean |
| `npm test` | 664 tests / 58 suites pass |
| `npm run build` | clean (3.86s) |
| `npm run check:schemas` | 6/6 in sync |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean (18 informational soft warnings, all in pre-existing backend files unchanged this cycle) |
| Pre-commit hook | clean on all three commits |
| `PanelCreationModal.tsx` <400L | 383L, confirmed |
| `StepCard.tsx` <250L (stretch) | 236L, confirmed |
| No new source file >400L | confirmed (largest new file: `useStepCardState.ts` 167L) |

## Commit timeline (cycle 2)

1. `b2d7ac3` Extract per-subtype creators (716L → 577L)
2. `2e89bc8` Extract creationSteps from shell (577L → 383L; under hard cap)
3. `1dad27d` Extract useStepCardState hook from StepCard (323L → 236L)

Each commit is independently green: lint + format + schemas + openspec
+ scala-quality + jest passed on every pre-commit hook run. Backend
sanity (591 tests) confirmed once at end of cycle.

## Nuance for the evaluator

1. **Intermediate shell snapshot**: commit `b2d7ac3` lands a 577L
   PanelCreationModal that is *above* the 400L hard cap. This is the
   atomic-commit cost of separating "creators" from "step bodies" into
   independently reviewable commits. The branch is only ever over cap at
   `b2d7ac3` and is back under cap at `2e89bc8`. If the cap is checked
   only on the merge commit / branch tip, this is fine. If the cap is
   checked per-commit, this is a documented temporary state.

2. **`creationSteps/` as a drive-by**: design D1 explicitly called for
   only the four `creators/` extractions. Design D5 allows drive-by
   extractions when they are behavior-preserving and the only path under
   cap. After the creators landed, the shell was 577L; the only natural
   way to get to <400L without behavior changes was extracting the four
   step bodies. The shell would have stayed over cap otherwise.

3. **`useStepCardState` lives in `hooks/`, not `ui/`**: the existing
   `features/pipelines/hooks/` directory holds `useAnalyzePipeline.ts`
   and `usePipelineRunEvents.ts` — the obvious place for a new hook.
   Cross-checked the import path matches the convention.

4. **`StepCard` decision**: I deviated from the design D3 wording
   ("per-kind sub-components into `features/pipelines/ui/stepCards/`")
   because the per-kind dispatch arms are already 3–10 line shims over
   already-extracted config components. Per-kind wrappers would be pure
   indirection. The hook extraction lifts the real density (state +
   handlers) and lands the file under the soft cap. Documented in
   `tasks.md` updates to items 6.1–6.3.

5. **Old per-subtype field functions removed cleanly**: the old
   `MetricConfigFields` / `ChartTypeField` / `ImageConfigField` /
   `DividerConfigField` helpers are gone from `PanelCreationModal.tsx`,
   along with the `// ── Per-type config field components ──` comment
   block they lived under. No dead code left behind.

## Next

CS4 is complete. After evaluator pass, this PR closes the HEL-236 chain
(CS1 → CS4).
