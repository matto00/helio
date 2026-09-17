# Mutation evidence — HEL-1083 form panel kind registration

Per C2 ("every new guard must be mutation-proven to go red") and tasks 4.7/4.8/4.10. Each mutation
below was applied directly in the delivery worktree, the named gate re-run fresh, the result
recorded, then the mutation was reverted and the gate re-run green again before continuing. (Round-1
evaluation independently re-derived all three in a separate throwaway worktree and confirmed the
same reds/greens — see `evaluation-1.md`, Phase 2 "Mutation evidence".)

## Task 4.7 — delete the `form` arm from `PanelRowMapper.rowToDomain`

**Mutation:** remove the `case FormPanel.Kind => FormPanel(...)` arm from
`backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala`'s
`rowToDomain`, leaving the `case _ => OutputPanel(...)` fallthrough to catch a `kind = "form"` row.

**Command:**
```
sbt -batch "testOnly com.helio.infrastructure.persistence.panels.PanelRowMapperSpec com.helio.api.routes.panels.FormPanelRoundTripSpec"
```

**Result:** 0 compile errors (the fallthrough still type-checks). 19 tests run, **12 passed / 7
FAILED**. (Re-verified live in cycle 2 after CR3 added two more form-kind tests to these same two
spec files — the earlier cycle-1 count, before CR3, was 17 tests / 11 passed / 6 failed; the extra
red in this run is CR3's own new tolerant-read test, itself traversing `rowToDomain`.)

Red:
- `PanelRowMapperSpec`: "should round-trip a Form panel's dataSourceId/fields/submit through
  domainToRow/rowToDomain" — decoded as `OutputPanel`, not `FormPanel`
- `PanelRowMapperSpec`: "should never decode a form row as an OutputPanel" — decoded AS `OutputPanel`
- `PanelRowMapperSpec`: "should decode an unrecognized stored form_config attribute as Empty, never
  throwing" — `ClassCastException: OutputPanel cannot be cast to FormPanel`
- `PanelRowMapperSpec`: "should decode an unrecognized stored form_config TOP-LEVEL attribute as
  Empty, never throwing" (CR3's own new test — same `ClassCastException` shape)
- `FormPanelRoundTripSpec`: "should decode as a FormPanel (never OutputPanel) on a re-read that
  traverses rowToDomain" (task 4.3b)
- `FormPanelRoundTripSpec`: "should persist a config PATCH's new fields — not just echo them in the
  response" (task 1.8's PATCH test, since the PATCH response also traverses `rowToDomain`)
- `FormPanelRoundTripSpec`: "should preserve dataSourceId, ordered fields, and submit through export
  then import" (task 4.4) — the export step reads via `rowToDomain`, decodes the row as `output` with
  an empty `outputId`, and the re-import's `decodeCreateConfig("output", {})` then 400s on the
  required-`outputId` check, so the whole import fails with 400 instead of 201

Green and unaffected (the C7 point — a mutation must exercise a path the test actually traverses):
- `FormPanelRoundTripSpec`: "should round-trip dataSourceId, every field attribute, and field order
  on create" (task 4.3a) — `PanelRepository.insert` returns the in-memory panel it was given and
  `PanelRoutes` exposes no authenticated GET, so this assertion never reaches `rowToDomain` at all
- "should require no Output binding — layout is null/absent for a form panel"
- "should reject a cross-owner dataSourceId with 404, never 403 or 500"
- "should reject an unrecognized top-level config attribute with 400, never silently dropping it"
- "should reject an empty dataSourceId with 400 naming dataSourceId"
- all three apply-proposal specs (never re-read via `rowToDomain` in this test)

**Restored** (arm re-added); re-ran the same command: 19/19 passed, 0 failed.

## Task 4.8 — drop `form_config` from both `configColumnsOf` and `configColumnValuesOf`

**Mutation:** in `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala`,
remove `r.formConfig` / `row.formConfig` from BOTH tuple-returning functions (removing it from only
one is a compile error — arity must match between the two — so the honest C4 mutation drops it from
both, exactly reproducing the HEL-296/HEL-909 failure shape: the UPDATE statement no longer touches
`form_config` at all, so a stale value is silently kept).

**Command:**
```
sbt -batch "testOnly com.helio.api.routes.panels.FormPanelRoundTripSpec"
```

**Result:** 0 compile errors. 11 tests run, **10 passed / exactly 1 FAILED**:
- "should persist a config PATCH's new fields — not just echo them in the response" — the PATCH
  response body showed the NEW fields (the in-memory echo), but the follow-up re-read (a second PATCH,
  title-only) showed the OLD fields (`quantity`/`note`), proving the column write was silently
  skipped while the response lied

Every other test in the suite (including the export/import test, the re-read test, and the
cross-owner/empty-dataSourceId/unknown-top-level-key rejections) stayed green — this mutation is
precisely and only task 1.8's PATCH-persistence guard.

**Restored** (both tuples re-include `formConfig`/`form_config`); re-ran: 11/11 passed, 0 failed.

## Task 4.10 — delete the `isFormPanel` branch from `PanelContent.tsx`

**Mutation:** remove the
```tsx
if (isFormPanel(panel)) {
  return (...) // neutral placeholder
}
```
branch from `frontend/src/features/panels/ui/PanelContent.tsx`'s if-chain dispatcher, leaving a
`form` panel to fall through to the `MetricRenderer` fallback beneath the (now genuinely true again)
"union is closed" comment.

**Command** (run from `frontend/`, the frontend jest config directly — the root `npm test` script
runs both the `helio-mcp` and frontend suites and does not forward `--testPathPatterns` to the
nested `npm --prefix frontend test` invocation):
```
npx jest --config jest.config.cjs --testPathPatterns=PanelContent.test
```

**Result:** baseline 27/27 green → mutated: **1 failed / 26 passed**.
- "renders the unconfigured placeholder, never MetricRenderer, for a form panel" (task 4.10) failed
  with `TestingLibraryElementError: Unable to find an accessible element with the role "status"` —
  the component instead rendered `MetricRenderer`'s own markup (`panel-content panel-content--metric`
  / `panel-content__metric-value: --` / `panel-content__metric-label: No data`).

This is exactly what C10 predicts: `tsc` cannot catch this (`PanelContent.tsx` dispatches via an
`if`-chain of type guards, not an exhaustive `switch`), so only a rendered-output test catches a
`form` panel silently rendering as a metric.

**Restored** (branch re-added); re-ran: 27/27 passed, 0 failed.

## Summary

All three guards are genuinely failable — none is a guard-shaped assertion that would pass whether
or not the code under test does its job. Round-1 evaluation (`evaluation-1.md`) independently
re-derived the identical reds/greens (including the C7 nuance on 4.3a staying green) in a separate
throwaway worktree before this transcript existed, which is why this file did not previously exist
in the repo — CR4 closes that gap by making the evidence reviewable from the change dir itself
rather than only from the evaluator's own report.
