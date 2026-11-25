## Why

The public share viewer (`PublicDashboardViewerPage`, reached by `/dashboards/:id/panels?token=…`) stacks
every panel full width and ignores the dashboard's stored layout. It also renders text, markdown, image,
divider and form panels as just their title and type name. A shared news board shows its charts but none of
its stories, and every shared dashboard loses its arrangement (HEL-1587, found via HEL-1562). The owner
ruled (2026-11-25 escalation) that the layout is exposed by widening the public panel-list response, and
that form panels get a read-only, non-interactive preview of their fields in this same change.

## What Changes

- **Backend, public panel list:** `GET /api/dashboards/:id/panels` gains one top-level `layout` field,
  `{lg, md, sm, xs: [{panelId, x, y, w, h}]}`, the dashboard's stored layout filtered to the ids of the
  panels in the returned page. Same `authorizeResourceWithSharing` gate, no new authorisation path. No
  owner id, layout version or appearance is added.
- **Backend, new public route:** `GET /api/dashboards/:dashboardId/panels/:panelId/form-schema` (optional
  auth, `?token=`), same gate as the panel list. For a `form` panel on that dashboard it returns
  `{fields: [{name, type, required}]}`: the dataset declarations of ONLY the fields the form binds, in the
  dataset's declared order, without `default`. No row, no source id, no row cap, no `seq`, no owner id. A
  non-form panel, a panel of another dashboard, an unknown id and a denied caller all get the same `404`.
- **Owner-id guard (HEL-1248):** both `PublicRouteOwnerIdLeakSpec` and `PublicRouteOwnerIdLeakApiSpec`
  cover the widened panel list (layout present) and the new form-schema route.
- **Schemas:** a public panel-list response schema with `layout`, and
  `schemas/panels/public-form-schema-response.schema.json`.
- **Frontend, public viewer:**
  - At container width >= 768 px the panels are laid out by a read-only react-grid-layout `Responsive` grid
    built from `panelGridConfig`/`gridMetrics`/`createLayouts`/`resolveDashboardLayout` (the same config the
    signed-in grid uses), with drag and resize disabled. No layout save, no `layout/repair` call, no edit
    affordance. Below 768 px the existing stacked list stays.
  - Text, markdown, image and divider panels render through the app's own `PanelContent` path
    (`TextRenderer`, `MarkdownRenderer`, `ImageRenderer`/`ImagePanel`, `DividerRenderer`), so the
    sanitising (`markdownUrls`, `sanitizeImageUrl`) is the same code, not a copy.
  - Form panels render a read-only preview: each bound field's label and control via the existing
    `FormFieldControl`, every control disabled (new explicit `disabled` prop, the counter included), no
    submit button, no submit request possible.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `public-dashboards`: the panel list carries the stored layout; a new public form-schema read; the owner-id
  guard covers both.
- `public-dashboard-panel-content`: non-output panels render their content; the viewer applies the layout;
  form panels render a read-only preview.

## Impact

- Backend: `PublicDashboardRoutes`, `PublicPanelListResolver`, a new resolver for the public form schema,
  `PanelProtocol`/`FormSubmitProtocol` (response types), `DashboardRepository` (internal layout read),
  `DataSourceRepository.getDeclaredSchema` (read in the form owner's DB context), the two HEL-1248 specs.
- Frontend: `PublicDashboardViewerPage` (+ css), `publicDashboardService`, a new read-only public grid
  component, a new read-only form preview, `FormFieldControl` (`disabled` prop).
- Contract: `schemas/` additions. No migration.
- No overlap with sibling lanes HEL-1160 (helio-mcp) or HEL-1877 (REST connector driver).
