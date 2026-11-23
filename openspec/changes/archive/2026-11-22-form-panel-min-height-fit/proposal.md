## Why

A form panel at the grid minimum (4 rows) clips its fields and Submit at 1280 px, so a user must scroll inside a
small card to submit. The owner also asked for two adjacent fixes in the same file: `FormPanelView.tsx` (481 lines) is
over CONTRIBUTING's ~400-line threshold, and a non-owner's compact counter keeps a stale `aria-invalid` error from an
earlier rejected step because the non-owner path never reaches HEL-1819's reconcile-time clear.

## What Changes

- Split `FormPanelView.tsx` into smaller units with no behaviour change (jest/e2e form-spec counts equal before/after).
- A non-owner's compact counter clears an earlier burst's rejection error when a later burst settles with no
  rejection in it (the form alert still carries any rejection; live regions stay mounted).
- Measure the minimum-height clip live (1280 px, light and dark, 1/2/3-field forms and the compact counter), then
  apply the owner-chosen fix (form minimum height, compact container-query layout, or sticky Submit row). The chosen
  option is added to this change, and re-gated, after the owner rules.

## Capabilities

### New Capabilities

### Modified Capabilities
- `form-panel-submit`: a non-owner's stale counter rejection error is cleared when a later burst settles.
- `form-panel-rendering`: the minimum-height fit rule (delta added once the owner picks an option).

## Impact

Frontend only: `frontend/src/features/panels/ui/form/**`, possibly `panels/ui/grid/panelGridConfig.ts` and
`PanelContent.css`. No API, schema or migration change.

## Non-goals

- Changing the owner's reconcile behaviour (HEL-1819) or HEL-1818's single-error rendering.
- Mobile stack sizing (HEL-1791) beyond confirming it is not regressed.
