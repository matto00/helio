## Why

`HEL-15` established the visual and layout foundation for Helio, but users still cannot tailor the dashboard canvas or panel surfaces to match the workspace they want. `HEL-16` adds real resource-level appearance customization on top of that foundation so dashboard background and panel presentation become configurable product behavior rather than fixed styling.

## What Changes

- Add a nested `appearance` object to both dashboard and panel resources.
- Extend backend domain models, API responses, and request/update flows to persist appearance settings in memory.
- Add frontend types and service/state support for resource appearance settings.
- Add user-facing editing controls for dashboard background plus panel background, panel color, and panel transparency.
- Apply saved appearance settings to the themed dashboard shell and panel grid without replacing the `HEL-15` token system.
- Keep the appearance model modular so future settings can extend the same object instead of adding many top-level fields.

## Capabilities

### New Capabilities
- `dashboard-appearance-settings`: Store and return dashboard appearance settings through a nested appearance object.
- `panel-appearance-settings`: Store and return panel appearance settings through a nested appearance object.
- `frontend-resource-appearance-editing`: Allow users to edit and preview dashboard and panel appearance settings from the frontend.

### Modified Capabilities
- `frontend-dashboard-polish`: Apply saved resource appearance settings on top of the existing polished theme and layout foundation.

## Impact

- `backend/src/main/scala/com/helio/domain/**`
- `backend/src/main/scala/com/helio/api/**`
- `backend/src/test/scala/com/helio/api/**`
- `frontend/src/app/**`
- `frontend/src/components/**`
- `frontend/src/features/**`
- `frontend/src/services/**`
- `frontend/src/types/**`
- `schemas/*.json`
