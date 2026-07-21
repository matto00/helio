## Why

`PanelDetailModal` silently converts an untouched `"transparent"` panel background (or
`"inherit"` text color) sentinel into an opaque hex value whenever the appearance form is
saved. Because the appearance PATCH is a full replacement, a user who edits any unrelated
field and saves permanently clobbers a sentinel they never touched — a latent data-loss
correctness bug (surfaced during HEL-317 review).

## What Changes

- Preserve the original appearance sentinel (`"transparent"` background, `"inherit"` text
  color) through the `PanelDetailModal` edit-save path when the user did not edit that
  specific field. The `<input type="color">` still displays the resolved fallback hex, but
  the saved payload restores the untouched sentinel instead of the fallback.
- Explicitly chosen colors continue to persist as their chosen hex.
- Add a regression test asserting the sentinel round-trips through save (untouched stays
  sentinel; edited persists as hex).

## Capabilities

### New Capabilities

<!-- none -->

### Modified Capabilities

- `panel-appearance-settings`: add a requirement that untouched appearance sentinel values
  are preserved through the edit-modal save path (not coerced to their display fallback hex).

## Impact

- `frontend/src/features/panels/ui/PanelDetailModal.tsx` — appearance payload construction.
- Possibly `frontend/src/features/panels/ui/editors/AppearanceEditor.tsx` and/or
  `frontend/src/theme/appearance.ts` if a shared sentinel-preservation helper is introduced.
- Frontend-only. No backend, schema, or API-contract change: the PATCH remains a full
  appearance replacement; the broader partial/merge-PATCH question is noted as a non-goal.

## Non-goals

- Converting the appearance PATCH from full-replace to partial/merge semantics (broader
  change; out of scope — noted for a possible follow-up).
- Changing how sentinels are resolved for rendering, or the `<input type="color">` control.
- Any backend, schema, or persistence change.
