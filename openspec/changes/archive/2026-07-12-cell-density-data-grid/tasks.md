## 1. Frontend: Verify DataGrid density primitive

- [x] 1.1 Re-read `DataGrid.tsx`/`DataGrid.css` density implementation against `design.md`'s
      decisions; confirm padding/font-size for `condensed`/`normal`/`spacious` use `--space-*` and
      `--text-*` tokens (no hardcoded pixel values) per `DESIGN.md`'s spacing/type scales.
- [x] 1.2 Add/complete JSDoc on the `density` prop in `DataGridProps` describing the three modes,
      the variant-based defaults, and that consumers should rely on the default rather than pass an
      explicit value unless there's a documented reason to diverge.

## 2. Frontend: Verify consumers

- [x] 2.1 Confirm `TypeDetailPanel.tsx` renders `<DataGrid variant="preview">` with no explicit
      `density` override (condensed by default).
- [x] 2.2 Confirm `SourceDetailPanel.tsx` renders `<DataGrid variant="preview">` with no explicit
      `density` override (condensed by default).
- [x] 2.3 Confirm `PipelinePreviewModal.tsx` renders `<DataGrid variant="preview">` with no explicit
      `density` override (condensed by default).
- [x] 2.4 Confirm `StepCard.tsx` renders `<DataGrid variant="preview">` with no explicit `density`
      override (condensed by default).
- [x] 2.5 Confirm `SqlTab.tsx` renders `<DataGrid variant="preview">` with no explicit `density`
      override (condensed by default).
- [x] 2.6 Confirm `TableRenderer.tsx` renders `<DataGrid variant="full">` (both the pagination-rows
      and raw-rows branches) with no explicit `density` override (normal by default).
- [x] 2.7 For any consumer found diverging from the expected default, fix it to rely on the variant
      default (or document why it needs an explicit override) — keep the fix minimal and scoped.

## 3. Documentation

- [x] 3.1 Add a short "Cell density" note to `DESIGN.md` (or expand the existing DataGrid section
      if present) describing the three modes, their token mapping, and the variant defaults, so
      HEL-253/HEL-255 have a single reference.

## 4. Tests

- [x] 4.1 Review `DataGrid.test.tsx`'s existing density describe block against the spec's scenarios;
      confirm coverage exists for: all three modes render their respective class, both variant
      defaults, and explicit-override behavior. Add any missing assertions.
- [x] 4.2 Add a lightweight per-consumer smoke assertion (in each consumer's existing test file, if
      one exists) that its rendered `DataGrid` carries the expected density class — guards against a
      future accidental explicit-density regression at the consumer call site.
- [x] 4.3 Run full frontend suite (`npm test`), lint (`npm run lint`), and format check
      (`npm run format:check`) — all must pass before handoff.
