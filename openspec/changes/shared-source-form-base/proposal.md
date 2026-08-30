## Why

`TextSourceForm`, `PdfSourceForm`, and `ImageSourceForm` are byte-for-byte identical in structure
(ingestion-method toggle, file input, URL input, error, actions) and differ only in labels,
`accept` filters, id/aria strings, and their mode type name. This triplication makes every future
tweak to the shared upload flow (row 0d unblocks P1.5's inline source creation, HEL-908) a 3x edit
with drift risk. Row 0c (HEL-725) just landed `PageShell`/`PageHeader`/`PageStatus` — this change
is the sibling "de-dup the sources feature" companion at the form-component level.

## What Changes

- Extract a shared, parameterized base form component (e.g. `UnstructuredSourceForm`) that owns
  the ingestion-method toggle, file input, URL input, error display, and submit/cancel actions.
- `TextSourceForm`, `PdfSourceForm`, `ImageSourceForm` become thin wrappers that supply
  per-source-type config (labels, `accept` filter, placeholder, id/aria strings) to the shared
  base and keep their existing exported prop types/names unchanged for call-site compatibility.
- No change to `AddSourceModal.tsx`'s usage of these three components, their public props, or
  their DOM output/behavior.

## Capabilities

Pure internal refactor — no user-facing or contract-level behavior change (acceptance criteria:
"No behavior change for users; validation/error messages stay consistent"). No new or modified
capability; `.openspec.yaml` sets `skip_specs: true`.

### New Capabilities

(none)

### Modified Capabilities

(none)

## Non-goals

- `StaticSourceForm` and `useRestSourceForm` (REST source type) are a structurally different form
  (multi-step, different fields) and are explicitly out of scope for this de-duplication.
- No visual/DESIGN.md-driven redesign of the upload flow — this is extraction, not a UI change.

## Impact

- `frontend/src/features/sources/ui/forms/TextSourceForm.tsx`
- `frontend/src/features/sources/ui/forms/PdfSourceForm.tsx`
- `frontend/src/features/sources/ui/forms/ImageSourceForm.tsx`
- New: a shared base form component/hook under `frontend/src/features/sources/ui/forms/` (or
  `frontend/src/features/sources/hooks/`, per design.md)
- Existing `.test.tsx` files for all three forms must continue to pass unmodified in behavior
  (assertions may be retargeted at the same rendered output).
