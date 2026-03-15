## Why

Loading and error states are handled inline in every API-backed component with duplicated `<p>` tags, class names, and CSS. This creates visual inconsistencies and makes each component harder to read and maintain.

## What Changes

- Introduce a `StatusMessage` component for fetch-level loading and error states (replaces the `<p className="...__status">` blocks in `DashboardList` and `PanelList`)
- Introduce an `InlineError` component for form-level error text (replaces the `<p className="...__create-error">` and editor `__error` blocks in all four components)
- Remove the per-component CSS rules that duplicated the same styles
- Wire both components into the four places they're needed: `DashboardList`, `PanelList`, `DashboardAppearanceEditor`, `PanelAppearanceEditor`

## Capabilities

### New Capabilities
- `shared-status-message`: A `StatusMessage` component that renders a styled block for loading or error states based on a `status` prop (`"loading" | "failed"`) and optional `message` string
- `shared-inline-error`: An `InlineError` component that renders a small error string below a form field or button

### Modified Capabilities

## Impact

- `frontend/src/components/DashboardList.tsx` and `.css`
- `frontend/src/components/PanelList.tsx` and `.css`
- `frontend/src/components/DashboardAppearanceEditor.tsx` and `.css`
- `frontend/src/components/PanelAppearanceEditor.tsx` and `.css`
- New files: `frontend/src/components/StatusMessage.tsx`, `StatusMessage.css`, `InlineError.tsx`, `InlineError.css`
- No API or backend changes
