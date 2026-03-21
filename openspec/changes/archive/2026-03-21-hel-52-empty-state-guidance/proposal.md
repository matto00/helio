## Why

When a dashboard has no panels, the panel area shows only a bare "No panels yet." text with no clear call to action. This leaves new users with no guidance on how to proceed, making the first-panel creation flow unnecessarily obscure.

## What Changes

- Replace the bare "No panels yet." paragraph in `PanelList` with a structured empty state block
- The empty state includes an icon, heading, descriptive subtext, and a prominent "Add panel" button
- The "Add panel" button in the empty state triggers the same create form as the `+` header button
- Empty state is only shown when panels have loaded successfully and the count is zero (not during loading)

## Capabilities

### New Capabilities
- `frontend-panel-empty-state`: Empty state guidance component shown when a dashboard has zero panels, with a CTA to create the first panel

### Modified Capabilities

## Impact

- `frontend/src/components/PanelList.tsx` — replace empty-state `<p>` with structured markup
- `frontend/src/components/PanelList.css` — add empty state block styles
- `frontend/src/components/PanelList.test.tsx` — update existing empty-state test; add test for CTA button
