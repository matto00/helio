## Why

HEL-1668 gated the pipeline page's own `:hover` fills behind `@media (hover: hover)`, but shared controls rendered in
the phone step sheet (IconButton, ActionsMenu trigger and items, Select, `.ui-modal-btn`, and the rest of the shared
component library the step editors use) still keep their hover fill after a touch tap. Measured before planning: in
Chromium touch emulation (Playwright `Pixel 7`, `(hover: hover)` false) an ungated `:hover` background is still applied
1.5 s after a tap; the same rule inside `@media (hover: hover)` is not; on desktop the gated rule still applies. The
sheet renders `StepCardFocused` with every step-config editor and the preview `DataGrid`, so "any shared control in the
sheet" reaches most of `frontend/src/shared/`. There is also no written rule.

## What Changes

- Gate every `:hover` rule in every stylesheet under `frontend/src/shared/` (ui, chrome, motion) behind
  `@media (hover: hover)`, in place; split mixed `:hover`/non-hover selector lists so focus/active/selected states stay
  ungated. Desktop hover is unchanged.
- A DESIGN.md rule for `@media (hover: hover)`.
- Widen HEL-1668's jest guard (shared parser) to every `shared/**/*.css` file.
- A touch e2e in the phone step sheet, red before the CSS change, over named in-sheet instances of each shared control
  family; a desktop e2e proving hover values are identical in light and dark.
- Tidy: merge the paired primary-button `@media (hover: hover)` blocks (spine header, mobile pill); fix the stale
  ~1100px comment in `PipelineSpineHeader.css`; assert the 1280 no-reserved-gap e2e; one `useNow` timer per source card.
- Two follow-ups filed (HEL-1735, HEL-1736): feature-level stylesheets outside `shared/` and the pipeline page; `useTopModalDialog` narrowing.

## Non-goals

- Feature stylesheets outside `shared/` and the HEL-1668 pipeline set (app shell, panels, dashboards, …): they are not
  shared controls; follow-up ticket.
- Narrowing `useTopModalDialog`'s observer: modal `<dialog>`s mount in-tree in 12 files, so narrowing needs an open-
  dialog registry and touches Toast's HEL-1668 D2 behaviour. Follow-up (driver rule: tidy items that grow go to a
  follow-up).

## Capabilities

### New Capabilities
- `shared-control-hover-gating`: shared components apply hover effects only on hover-capable pointers.

### Modified Capabilities

## Impact

Frontend CSS only across `frontend/src/shared/` (about 20 stylesheets) and two pipeline stylesheets, one comment,
DESIGN.md, one jest guard plus a shared test parser, one new e2e, one e2e assertion, and a small source-label
hook/component split. No API or schema change.
