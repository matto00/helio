## Context

The `PATCH /api/dashboards/:id` endpoint currently accepts `appearance` and `layout`; the `PATCH /api/panels/:id` endpoint accepts only `appearance`. Both support updating a stored record via their respective repositories. `DashboardRepository.update()` already overwrites `name` as part of a full record save. `PanelRepository` has `updateAppearance()` but no title update path.

`RequestValidation.normalizeText` silently substitutes a default for empty/whitespace strings — appropriate at creation time, but wrong for rename: an explicit empty rename should be rejected with 400, not silently replaced.

## Goals / Non-Goals

**Goals:**
- Allow users to rename a dashboard and edit a panel title after creation
- Reject empty/whitespace names/titles explicitly with 400 (not silent default substitution)
- Reflect the updated name/title in Redux state and the UI immediately

**Non-Goals:**
- Renaming panels via a standalone endpoint (title edit is part of PATCH, not a separate route)
- Bulk rename
- Name history or undo

## Decisions

### 1. Extend existing PATCH endpoints rather than adding dedicated rename endpoints

The PATCH semantics already mean "partial update". Adding `name`/`title` as optional fields is consistent with the existing `appearance`/`layout` fields. A separate `PUT .../name` endpoint would add surface area for no benefit.

**Alternative considered**: Dedicated `PATCH /api/dashboards/:id/name` sub-resource. Rejected — over-engineered for a single field.

### 2. Add `updateName` / `updateTitle` repository methods rather than reusing `update()`

`DashboardRepository.update()` rewrites appearance, layout, and name in a single query — semantically wrong for a targeted rename (it would silently reset fields if the caller doesn't pass the full record). Dedicated `updateName(id, name)` and `updateTitle(id, title)` methods are safer and make intent clear.

### 3. Validate non-empty in the route handler, not in `RequestValidation.normalizeText`

`normalizeText` is a creation-time helper that substitutes defaults. Reusing it for rename would silently accept empty input. Instead, validate in `validateDashboardUpdateRequest` / the panel PATCH handler: if `name`/`title` is present but blank after trim, return 400.

### 4. Inline click-to-edit on the frontend

Clicking the dashboard name or panel title activates a controlled `<input>`. Confirm on Enter or blur; cancel on Escape. This avoids adding a separate modal or edit button and matches the pattern already used by inline confirmation in the delete flow.

**Alternative considered**: Edit via the appearance editor modal. Rejected — the editor is for visual properties; name/title is content, not appearance.

## Risks / Trade-offs

- **Blur-to-save fires on Escape** → Mitigation: track a `cancelled` ref that blur checks before saving.
- **Validation text clashes visually in the sidebar** → Mitigation: show inline error below the input; keep it brief.
- **`update()` in DashboardRepository is still used by appearance/layout patch** → No change needed there; the two paths are independent.
