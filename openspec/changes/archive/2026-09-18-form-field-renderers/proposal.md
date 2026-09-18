## Why

HEL-1083 registered the `form` panel kind and HEL-1084 built its author-time field builder, but
`PanelContent.tsx:318` still renders a "Form not configured" placeholder for every form panel — an authored
form is invisible on the dashboard it was built for. This change renders the six non-file controls so the
panel is usable on the grid and HEL-1087 (submit) has fields to submit.

## What Changes

- A form renderer, dispatched from `PanelContent`'s existing `form` branch, renders `text`, `textarea`,
  `number`, `date`, `select` and `checkbox` fields in authored order from the panel config plus the bound
  dataset's declared schema, sized for a grid cell (a vertically scrolling body with compact density in
  short cards). An empty field list keeps today's "Form not configured" state.
- Every field has a programmatic label (config `label`, else `sourceField`), its `helpText` as an accessible
  description, required-ness derived from config `required` OR the dataset declaration (tighten-only), a
  prefill from `initialValue`, and field-level errors (required-empty, numeric typing) associated with the
  control by computed ARIA state (`aria-invalid` + `aria-describedby`), shown only after the field is left.
- A field the renderer cannot honour — an orphaned `sourceField`, an unfit control, malformed `options`, or a
  `file` control (HEL-1086) — is rendered with its label and a visible reason, never silently dropped.
- Shared primitives gain the minimum needed: `TextField` accepts `type="date"`; `FormField` gains `hintId`;
  `Select` and `Toggle` gain `ariaRequired` (and `Toggle` gains `ariaInvalid`/`ariaDescribedBy`, matching
  what HEL-1084 gave `Select`).
- `PanelPacker.Bounds` gains a `form` entry so an `/auto-layout` re-flow cannot clamp a form to one column —
  deferred to this ticket explicitly by HEL-1083's design.
- No submit button or submit wiring (HEL-1087), no file upload (HEL-1086), no counter chrome (HEL-1088).
- **Fold-in (Phase 4 follow-up, owner ruling):** two `MISTAKES.md` trap entries — the Husky pre-commit timeout
  (a `git commit` without a ~600000 ms tool timeout is backgrounded mid-hook) and the `pgrep -f` self-match poll
  deadlock — docs-only, no spec delta; see design.md D11 and ticket.md "Fold-in scope".

## Capabilities

### New Capabilities
- `form-panel-rendering`: how a configured `form` panel renders its non-file fields on the dashboard — the
  control each field presents, the label/description/error exposure to assistive technology, keyboard
  completability, grid-cell sizing (including auto-layout bounds), the declared-schema loading states, and
  how inconsistent or not-yet-supported fields are surfaced.

### Modified Capabilities
- None. `dashboard-auto-layout`'s clamping requirement is kind-generic ("a kind with no configured bounds
  SHALL use a default"), so the new `form` bound is an added scenario in the new capability, not a change
  to that requirement. `panel-type-rendering`'s scenarios predate HEL-909 (metric/chart/table as panel
  types) and are not extended; form rendering is specified in the new capability instead.

## Non-goals

- Submit button, submit path, server-side validation, success/failure states (HEL-1087).
- File upload field (HEL-1086); counter chrome and `step` increment affordances (HEL-1088/1089).
- Changes to the config shape, the fitness matrix, the builder, or any migration.
- Cross-panel value sharing or Redux-held form drafts; agent prompt copy; `RefinementEditShape` examples.

## Impact

- Frontend: `features/panels/ui/PanelContent.tsx` (form branch), new `ui/renderers/FormRenderer.tsx` and
  `ui/form/*` (view, field control, values hook, CSS), new `state/formFieldValidation.ts`;
  `shared/ui/{TextField,FormField,Select,Toggle}.tsx`; `PanelContent.css`.
- Backend: `services/panels/PanelPacker.scala` (`Bounds` entry) + `PanelPackerSpec`. No route, schema,
  migration, or wire change.
- Tests: Jest computed-name/description tests; a Playwright keyboard-completion spec under `e2e/`
  (picked up by CI's e2e glob).
