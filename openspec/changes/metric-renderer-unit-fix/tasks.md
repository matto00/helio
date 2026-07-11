## 1. Frontend

- [x] 1.1 In `MetricRenderer.tsx`, render `data?.unit` (when truthy) adjacent to `data?.value`
      inside the value span, using a new `panel-content__metric-unit` class.
- [x] 1.2 In `MetricRenderer.tsx`, key the label/"No data" fallback on value presence
      (`hasValue = !!data?.value`): render `data.label` when present, render nothing when
      `hasValue` is true and label is absent, render "No data" only when `!hasValue`.
- [x] 1.3 Add a code comment above the `label`/`unit` handling clarifying both are column
      references resolved via `usePanelData` (`firstRow[field]`), not literal text — link the
      config-depth ticket for the future literal-`label` path.
- [x] 1.4 Add `.panel-content__metric-unit` styling in `PanelContent.css` (existing tokens only:
      muted color, `--text-sm`/`--weight-medium`, small left margin using a `--space-*` token),
      including the compact/spacious container-query overrides alongside the existing
      `__metric-value`/`__metric-label`/`__metric-trend` rules.

## 2. Tests

- [x] 2.1 Create `frontend/src/features/panels/ui/renderers/MetricRenderer.test.tsx` covering:
      value+unit renders `<value> <unit>`; value with no label renders no "No data" text and no
      label line; no value renders "No data"; value+label+trend still renders three lines
      (regression); trend direction classes unaffected.
- [x] 2.2 Run `npm run lint` and `npm test -- --testPathPattern=MetricRenderer` (plus full
      frontend suite) to confirm no regressions.
