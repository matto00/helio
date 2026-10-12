## Why

HEL-1464's review left three small defects: the Output editor's scatter field pickers list "— None —" twice (a
duplicate React key), a unit test's `as unknown as` cast hides an incomplete mock, and the desktop-overflow fix is
guarded only by a test that reads CSS source text, which a descendant selector or a cascade override can fool.

## What Changes

- Scatter "Point size field" / "Color by field" pickers offer the clear option exactly once on the Output editor path.
- `RestApiForm.test.tsx`'s mock form is a fully-typed `UseRestSourceFormReturn` (adds `reset`), with no widening cast.
- New Playwright spec measuring the rendered Output editor at 1100px with an 86-character column name; it replaces
  `TableDisplayFields.css.test.ts` (source-text guard), and is proven red against a reverse-applied HEL-1464 CSS fix.

## Capabilities

### New Capabilities

(none)

### Modified Capabilities

- `pipeline-output-sheet`: adds a requirement that the scatter field pickers list their clear option once.

## Impact

- `frontend/src/features/panels/ui/editors/ChartDisplayFields.tsx` (+ its test), Output editor chart path.
- `frontend/src/features/sources/ui/forms/RestApiForm.test.tsx` (test only).
- `e2e/` new spec; `frontend/src/features/panels/ui/editors/TableDisplayFields.css.test.ts` removed.
- No backend, schema, or API change.

## Non-goals

- Changing `isBound` gating on the Output editor path (it is always true there; see design Planner Notes).
- Any further Output editor layout change; HEL-1464's CSS fix itself is unchanged.
