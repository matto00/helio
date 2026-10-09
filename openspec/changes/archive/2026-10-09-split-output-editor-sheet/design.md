## Context

See proposal.md - Why. Ground truth on origin/main 0a528316: `outputEditor/OutputEditorSheet.tsx` is 739 lines. It holds
(a) top-level state (nodeStepId/kind/name/historyPayloads/saveError/saving/placements/confirmingDelete/
neverMaterialized) plus a reseed effect keyed on `[open, output?.id]`; (b) ~90 lines of per-kind `useState` /
`useBoundOrLiteralState` / table-column hooks seeded from `read*Config(config)`; (c) placements + materialization
effects; (d) save/edit-patch/delete/add-tail handlers; (e) ~300 lines of JSX (footer, name/step/kind group, the
Configuration card's kind switch, History card, Preview card + never-materialized banner, placements list). The file
header still claims "~580 lines". `configPatch.ts`'s `openingParams(kind, config, fieldKeys)` returns a
`BuildOutputConfigParams` built from the same `read*Config` seeding, used only for the edit-Save baseline.
The per-kind state is never reseeded by the in-sheet effect; only a remount resets it. `PipelineDetailPage.tsx:334`
renders `{outputSheet && <OutputEditorSheet open ... />}` with no `key`; `usePipelineDetailPage.ts`'s `?outputId=` effect
sets `outputSheet` A -> B directly, so the instance is reused.

## Goals / Non-Goals

**Goals:** sheet ~400 lines or under; one per-kind state hook whose seed values come from `openingParams`; every
other extraction a verbatim move; reseed on Output swap via `key`. **Non-Goals:** see proposal.md Non-goals. No change
to rendered DOM, CSS classes, labels, ids, `htmlFor` (HEL-1432 owns those), or request bodies.

## Decisions

1. **`useOutputKindState(output)` hook (new file `useOutputKindState.ts`).** Seeds via
   `const seed = openingParams(kind, config, [])` computed once (memoized on `config`) and passes `seed.<field>` as each
   `useState`/`useBoundOrLiteralState` initial value (bound states take `seed.xState.mode/fieldValue/literalValue`).
   Returns the state + setters and a `params(kind, tableColumnOrder, tableColumnFormats)`-style accessor (exact shape at
   executor discretion) that the sheet passes to `buildOutputConfig`, `buildAggregateTailConfigs`, and
   `OutputPreviewPane`. Table columns stay on `useOutputTableColumns(capabilityKeys, readTableConfig(config).columnOrder)`
   / `useOutputColumnFormats(...)` because they depend on capabilities that load after mount — `openingParams`' derived
   `tableColumnOrder` is a baseline value, not a seed; the hook may own these two calls if it takes `capabilities`.
   Alternative rejected: six per-kind hooks (ticket asks for one; more indirection, same total lines).
   Equivalence argument: `staticBound` and the sheet both call `defaultBoundOrLiteralMode` with the same predicate
   (annotation `!== undefined && !== null`; label/unit `!== undefined`); `chartOptions ?? {}` vs the sheet's
   `?? EMPTY_CHART_OPTIONS` are structurally equal; metricField reads `fieldMapping.value ?? aggregation.value ?? ""` in
   both. Any divergence must be caught by Decision 4's test, not by this argument.
2. **Verbatim moves for everything else**, e.g. `OutputKindConfigCard.tsx` (Configuration card kind switch),
   `OutputEditorFooter.tsx` (footer buttons), `useOutputSavedStatus.ts` (placements + neverMaterialized effects),
   `OutputSheetPreviewCard.tsx` (Preview card + banner), placements list. Exact cut lines at executor discretion so the
   sheet lands ~400 or under and no new file exceeds ~400. Moved code keeps its comments; only prop plumbing and
   imports may differ. Evidence: `git diff --color-moved=plain --color-moved-ws=allow-indentation-change` plus a list
   of every non-moved changed line with a one-line justification. Rewrite the stale header comment (no line counts).
3. **Keep the in-sheet reseed effect unchanged.** It is redundant at the keyed call site but it is the
   component's own contract (one production caller; no test re-renders it); removing it is not required by the ticket and is not behaviour-preserving in general. Add a
   comment that it reseeds only top-level fields and that per-kind state relies on the `key` remount. The kind-state
   hook returns one object passed whole to the config/preview cards (no ~20-prop fan-out) to keep the sheet ≤ ~400.
4. **Characterization test first (`OutputEditorSheet.openingState.test.tsx`).** Committed in its own commit on the
   unmodified base, green there, then unchanged by the refactor commits. Per kind (chart, table, metric, collection,
   timeline, markdown), edit mode with non-default stored configs (incl. aggregated `{agg}` metric, bound vs literal
   annotation/label/unit, table `columnOrder` + `columnFormats`, collection `format`, timeline mapping, legacy markdown
   `fieldMapping.content`) and create mode (each kind selected after open): assert an exhaustive serialization of every
   form control in the Name/Step/Kind group and the Configuration card (accessible name + value/checked/pressed/
   disabled), and for create mode the exact full `config` a Save sends. Plus TOUCHED edit-mode cases for state with no
   form control that reaches the wire: a chart stored with non-default `fieldMapping` (e.g. xAxis/yAxis/category/value)
   whose annotation binding is changed, asserting the exact `config.fieldMapping` sent carries the stored keys unchanged.
   `tableFieldMapping` has no setter and no control and is never diffed into a patch unless the table's own
   `fieldMapping` key differs from the baseline built from the same seed — it is out of reach by construction (design
   round 2 finding), so no test case is required for it. Also include an edit-mode metric with no stored `format` so the
   default seed is checked in edit mode, not only via the create body. Shown failable twice: (a) on the
   base, one mutated sheet seed turns it red; (b) after extraction, a mutated seed INSIDE `openingParams` (metric format
   default, and the chart `fieldMapping` path) turns it red — record both red outputs and whether the 22 configPatch
   tests stayed green under (b).
5. **Key at the mount site** (the create-mode key changes only when the PAGE's `createTargetStepId` changes — never via the
   in-sheet Step picker, which sets local state; an A->B swap now replays the modal entrance animation): `key={outputSheet.output?.id ?? \`create:${outputSheet.createTargetStepId ?? ""}\`}`.
   Red-first test in a PipelineDetailPage test file: deep-link Output A (chart "bar"), then navigate to Output B
   (chart "pie") while mounted; assert B's chart type shows and an untouched Save sends no `config`. Must be red on base.
6. **Item 2 comment:** run the guard test against the WHOLE pre-fix tree at 6f2351e8^ (Standing Constraint C2 —
   corrected at the final gate: dropping only the pre-fix sheet into the current tree mixes in the already-fixed
   `buildOutputConfig.ts` and wrongly shows the guard passing), record the outcome, reword the comment to match.

## Risks / Trade-offs

- [Seed divergence hidden by tautology: after the refactor both the sheet and the baseline derive from `openingParams`,
  so "untouched Save sends no config" can no longer detect a seeding change] -> Decision 4's DOM/create-body
  characterization is the independent signal, committed green on the base before any refactor.
- [Hook-order change alters `useId`/effect ordering] -> no ids derive from `useId` except `kindHintId`; kindLock test
  asserts the aria-describedby wiring.
- [Visual regression from moved JSX] -> running app compared in light and dark, create + edit of every kind.

## Planner Notes

- Self-approved: hook/file names, Decision 3 (keep effect), create-mode key shape. No external deps, no API change.
- Line references in the ticket drifted (+1..+10) after HEL-1388; premise-validation.md records the true lines.
