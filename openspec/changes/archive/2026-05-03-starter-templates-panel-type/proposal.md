## Why

Users who open the panel creation modal face a blank configuration form after picking a type, with no starting point or guidance. Starter templates give users 2–3 pre-built configurations per panel type so they can get a useful panel in one click rather than filling every field from scratch.

## What Changes

- A new "Choose a template" step is inserted between type selection (Step 1) and the title/config form (Step 2) in the panel creation modal.
- Each panel type ships with 2–3 hardcoded template definitions (title, type-specific config fields) stored as frontend constants.
- Selecting a template pre-fills the Step 2 form; the user can still edit before creating.
- A "Start blank" option is always available so the user can skip templates entirely.
- No backend changes — templates are purely frontend/static.

## Capabilities

### New Capabilities

- `panel-starter-templates`: Template selection step in the creation modal; hardcoded template definitions per panel type; pre-fill behaviour on selection; "Start blank" skip path.

### Modified Capabilities

- `panel-creation-modal`: The modal now has a 3-step flow (type → template → configure) instead of 2-step (type → configure). The requirement that "the second step collects the panel title" is superseded by the template step inserting before configuration.

## Impact

- `frontend/src/features/panels/` — new `panelTemplates.ts` constants file; `CreatePanelModal` component gains a Step 2 template picker screen.
- `openspec/specs/panel-creation-modal/spec.md` — delta to reflect 3-step flow.
- No API, schema, or backend changes required.

## Non-goals

- Dynamic or user-created templates (post-v1.2).
- Template previews with live data.
- Template persistence across sessions.
