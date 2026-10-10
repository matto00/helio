## Why

`frontend/src/utils/README.md` claims `chartAppearance.ts` (and `aggregate.ts`) are imported only by `features/panels`;
that has been false since `adminUsage` and the pipelines Output editor started importing them, so the README's own
"belongs here" rule is applied against wrong facts. Separately, HEL-1179 (#853) removed the doc comment explaining why
ECharts hover motion is gated in JS, so the reason `prefersReducedMotion()` is needed there is no longer written down.

## What Changes

- Rewrite the first paragraph of `frontend/src/utils/README.md` so every importer claim matches a fresh import grep
  (`formatRelativeTime.ts`, `chartAppearance.ts`, `aggregate.ts`, `chartTypeOptions.ts`), and name the grep command.
- Add one sentence to the doc comment of `frontend/src/utils/prefersReducedMotion.ts`: ECharts hover-emphasis motion is
  JS option config, and `theme/motionTokenGuard.css.test.ts` only scans `.css` files, so it must be gated in JS.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None. Docs/comments only; `.openspec.yaml` sets `skip_specs: true`.

## Impact

Two files, comment/markdown only: `frontend/src/utils/README.md`, `frontend/src/utils/prefersReducedMotion.ts`.
No runtime, API, schema or test change.

## Non-goals

- Moving `chartTypeOptions.ts` to `features/panels/utils` (README already notes it as a candidate).
- Documenting `crossFilterRows.ts` / `chartClickSelection.ts` (not mentioned by the README today).
- Changing `prefersReducedMotion()` behaviour or any call site.
