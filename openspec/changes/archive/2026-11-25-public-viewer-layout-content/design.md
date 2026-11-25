## Context

`PublicDashboardViewerPage` (frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx) fetches
`GET /api/dashboards/:id/panels?token=` once and renders a `<ul>` stack. Only `isOutputPanel` panels get
`PanelContent` (HEL-1190 D1). Every other kind shows `title` + the literal `type`.

Ground truth checked on main 95cec30cf (see `.concertino/runs/HEL-1587/evidence/premise-validation.md`):

- The panel list already returns every panel's full `config` to a token viewer (`PublicPanelListResolver` →
  `PanelResponse.fromDomain`): markdown/text `content`, image `imageUrl`/`imageFit`/`caption`, divider
  `orientation`, and the form's `fields` (sourceField, control, label, placeholder, helpText, required,
  initialValue, step, options) and `submit`. **It also already returns a form's `config.dataSourceId`** to
  anonymous viewers. That is pre-existing and not widened here (see Non-Goals and Risks).
- The stored layout is on the dashboard row only (`DashboardResponse.layout`). No token-authorized route
  returns it, so the owner ruled (escalation answered 2026-11-25, Q1 = `widen-panel-list`) that it is added
  to the panel-list response.
- Uploaded images (`/api/uploads/image/:id`) are served without auth (`PublicUploadRoutes`), so an image
  panel loads for a token viewer with no new route.
- Insight Output panels already render publicly through `PanelContent` + `fetchPublicPanelInsight` (HEL-1744).
- The signed-in `FormRenderer` needs the dataset's declared `required`/`type` per bound field: required is
  tighten-only (`isFieldRequired(field, declared)`), and `number` uses `declared.type === "integer"`. That
  declaration is served only by `GET /api/panels/:id/form-schema` (owner/editor). The owner ruled (Q2 =
  `fold-in-read-only-form`) that the public viewer shows a read-only preview of the form's fields in this
  change, which needs a public read of those declarations.

## Goals / Non-Goals

**Goals:**
- Public viewer lays panels out from the stored layout at lg/md/sm/xs, with the same grid config as the
  signed-in grid; below 768 px the existing stack stays.
- Text, markdown, image and divider panels render through the same renderers as the signed-in app.
- Form panels render a disabled, non-submittable preview of their bound fields.
- The public API widens by exactly the shapes below, behind the existing share gate, inside the HEL-1248
  owner-id guard.

**Non-Goals:**
- Removing the pre-existing `config.dataSourceId` from the public form config (follow-up candidate, raised
  through follow-up triage at Delivery, not decided here).
- Any change to `POST /api/panels/:id/submit` or its auth.
- Changing the signed-in viewer-grantee form rendering ("Only editors can submit this form").
- Dashboard appearance (background) on the public viewer, panel paging beyond the first page, embed chrome.

## Decisions

### D1. Exact exposed shape: panel-list `layout`

`GET /api/dashboards/:id/panels` (all callers; it is the one panel-read route) returns:

```json
{ "items": [...], "total": 3, "offset": 0, "limit": 50,
  "layout": { "lg": [{"panelId":"p1","x":0,"y":0,"w":6,"h":5}], "md": [...], "sm": [...], "xs": [...] } }
```

- `layout` is the dashboard's stored layout, each breakpoint filtered to items whose `panelId` is one of
  the `items` ids in this response (stale ids of deleted panels and panels outside the page are dropped).
- Item keys are exactly `panelId, x, y, w, h` (the `dashboard-layout-item` schema). No `layoutVersion`,
  no owner id, no appearance, no dashboard name.
- Read with `DashboardRepository.findByIdInternal` (privileged, `withSystemContext`) INSIDE the existing
  `authorizeResourceWithSharing` block, which has already admitted the caller for exactly this dashboard id.
  The call site carries the inline justification DbContext requires (caller already admitted by the sharing
  gate; only `layout` is projected, filtered to the response's panel ids), and the method's documented-callers
  list is extended with this resolver. A dashboard row that cannot be read degrades to all-empty
  breakpoints, never a failed page.
- Rejected alternative: a separate `GET /dashboards/:id/layout` route (owner chose the panel list).

### D2. Exact exposed shape: public form schema

New route `GET /api/dashboards/:dashboardId/panels/:panelId/form-schema[?token=]`, mounted in
`PublicDashboardRoutes` next to `/insight`, wrapped by the SAME `aclDirective.authorizeResourceWithSharing(
"dashboard", dashboardId, userOpt, "Dashboard not found", token)` call the other per-panel public routes
use. Response `200`:

```json
{ "fields": [ { "name": "status", "type": "string", "required": true } ] }
```

- Only fields named by the panel's `config.fields[].sourceField`, in the dataset's declared order (same
  filter as `PanelService.formSchema`).
- Each item has exactly `name`, `type`, `required`. `default` is NOT emitted (it is a stored value, not
  needed to render the preview; the preview prefill comes from the form's own `initialValue`, already
  public in config).
- **Read path, pinned (skeptic design-1 CR3):**
  - Panel lookup: `panelRepo.findAllByDashboardId(DashboardId(dashboardId), userOpt, Page(0, Page.MaxLimit),
    accessAlreadyGranted = true)` then `.find(_.id.value == panelId)`, the same pattern as
    `PublicPanelOutputResolver.resolvePanelOutput`. NOT `PanelRepository.findByIdInternal`.
  - Declaration read: `dataSourceRepo.getDeclaredSchema(panel.config.dataSourceId, AuthenticatedUser(panel.ownerId))`,
    which runs on the app pool via `withUserContext(panel.ownerId)` with RLS on. Never `withSystemContext` and
    never a `*Internal` read. The form owner's RLS context therefore admits only a dataset the form owner can
    read; a form whose `dataSourceId` names a dataset the form owner does NOT own returns the same `404`.
  - **Both mechanisms, each proven separately (skeptic design-2 CR1):** `getDeclaredSchema` itself has no
    owner predicate and the default test harness is BYPASSRLS, so RLS alone is not observable there.
    (b) The public resolver reads through an explicit owner-scoped call (a new
    `getDeclaredSchemaOwnedBy(dataSourceId, ownerId)` or an `owner_id = panel.ownerId` predicate on the same
    app-pool read), defence in depth that holds under any role; proven in the ordinary harness by a mutation
    that drops the predicate (the foreign-dataset case must go red). (a) The same foreign-dataset case also
    runs under a NOBYPASSRLS app pool (`SET ROLE helio_app_test`, the `UpsertTargetWritableRlsSpec`
    convention) with the predicate removed by mutation, proving RLS alone still yields `404`; plus a mutation
    reading via `withSystemContext` that goes red. Both mutation runs are recorded as evidence.
  - Filter to `config.fields[].sourceField`, project to `name`/`type`/`required`.
- `404` (one body, `Panel not found`) for: a panel not on this dashboard, an unknown panel id, a non-form
  panel, a deleted/missing dataset. A denied dashboard gets the directive's existing `404`.
- What a stranger newly learns: for each field name ALREADY public in the form's config, its declared type
  and whether the dataset requires it. Nothing about undeclared/unbound fields, no rows, no row count or
  cap, no source id. This is judged not a material widening; the design-gate skeptic should challenge it.
- Label, control, options, placeholder, helpText, step come from the panel config already in the panel list.
- Rate limiting: like every other public panel route, a request with no credential (an anonymous token
  viewer) is NOT rate-limited by the general `/api` directive (HEL-495/HEL-837 tracked gap). This route adds no
  limiter of its own and is no less limited than the panel list it sits next to.

### D3. Read-only public grid

A new `PublicPanelGrid` component (frontend/src/features/dashboards/ui/) renders, at container width
>= `panelGridConfig.breakpoints.sm` (768), a react-grid-layout `Responsive` grid with
`rglBreakpoints`, `panelGridConfig.cols`, `gridMetrics(useDensity())`, `containerPadding`, and
`createLayouts(resolveDashboardLayout(panels, layout))`, `dragConfig={{enabled:false}}`,
`resizeConfig={{enabled:false}}`, and **`compactor={noCompactor}` imported from `react-grid-layout/core`
exactly as `DesktopPanelGrid.tsx` does** (skeptic design-1 CR1): react-grid-layout's default
`verticalCompactor` would pull panels up and erase the vertical gaps `resolveDashboardLayout` keeps on
purpose, so the skeptic-skeleton defaults are NOT copied. A test pins a stored layout with a vertical gap and
asserts the lower panel renders at its stored `y`. The grid root also uses `useProcessedWidth` (HEL-1413) so
the `--panel-grid-processed-width` wait works in the public e2e. Keyed by
`dashboardId` only (executor note: the breakpoint-keyed remount of HEL-1835 is for a layout arriving after the width and, here, would strand `useProcessedWidth` at the previous width, as RGL reports `onWidthChange` only for a width change). It does NOT reuse `PanelGrid`/`DesktopPanelGrid`: those
carry the layout-save, staged-edit and `useStoredLayoutRepair` machinery, which must never run on a public
path even when the session is the owner (public-dashboard-panel-content "owner previewing their own link").
Below 768 px the existing `<ul>` stack renders unchanged. The container width is measured on the viewer's
own wrapper; the 1200 px `max-width` is lifted for the grid so lg (>= 1440) is reachable at desktop widths.
Each cell is a card with the panel title and the panel body, reusing the signed-in `PanelCard` token set
(surface, border, radius, title typography) and its body overflow/flex behaviour so output panels fit
fixed-height cells; no drag handle, resize handle, menu, title editing or detail modal.

Cells at min height carry `data-short-card` exactly as `DesktopPanelGrid` sets it, so chart canvas floors
hold. Density comes from `useDensity()`; the executor confirms the density/theme providers are mounted on the
public route (they wrap the whole app in `main.tsx`/`App`) and records it.

**Breakpoint is a container width, not a viewport width (skeptic design-1 CR2).** The viewer keeps its
`var(--space-4)` side padding, so a 1440 px viewport gives a container of about 1408 px, which resolves to
**md**. "Matching the signed-in grid" means: at the active breakpoint resolved from the container width, the
panels sit at that breakpoint's stored items. The e2e fixture is two-column at BOTH lg and md, and the e2e
asserts the resolved breakpoint at each viewport it uses (md at 1440 px; xs/stack at 375 px), never assumes
lg from the viewport width. The page padding is not removed.

### D4. Content panels through the shared renderer path

Text, markdown, image and divider panels render through the same entry the signed-in card body uses
(`PanelContent` → `TextRenderer` / `MarkdownRenderer` / `ImageRenderer` / `DividerRenderer`), not new
copies. Sanitising is therefore the existing `markdownUrls` / react-markdown configuration and
`ImagePanel`'s `sanitizeImageUrl`. Tests pin that a hostile markdown (`<script>`, `javascript:` link,
raw `<img onerror>`) and a hostile image URL (`javascript:`, `data:`) render inert on the public page.

### D5. Read-only form preview

A new `PublicFormPreview` renders each bound field through the existing `FormFieldControl`, with:
- a new explicit `disabled?: boolean` prop on `FormFieldControl`, threaded to every control branch
  (native `disabled` on inputs/selects/textarea/checkbox/file, `disabled` on `CounterControl`, whose
  spinbutton is a non-native element a `<fieldset disabled>` would NOT disable);
- values seeded from `initialValue` only, `onChange`/`onBlur` no-ops;
- declarations from D2's public route (`fetchPublicFormSchema`), a loading and a "Form preview
  unavailable" state on failure;
- no `<form>` element at all (a plain container), no submit button, no `useCompactCounterSubmit`, no import
  of `panelService.submitForm`; a short "Read-only preview" caption;
- a bound field absent from the public declaration (orphaned) is passed `issue` with the same text the
  signed-in form uses for an orphaned field, deliberately, so it renders as the existing disabled issue shape.
A test asserts no network request to `/submit` is issued after interacting with every control.
- **Dispatch order:** `PanelContent` routes `form` panels to the signed-in `FormRenderer` (submit path +
  authenticated `/api/panels/:id/form-schema`), so the public viewer branches on `panel.type === "form"` to
  `PublicFormPreview` BEFORE `PanelContent`, with a code comment saying why. Form panels never reach
  `PanelContent` on the public page.
- **Types:** the public declaration type (`PublicFormFieldDeclaration {name, type, required}`) is mapped
  explicitly to what `FormFieldControl.declared` takes (confirm `default` is optional on
  `DatasetFieldResponse`); no cast.

### D6. Service and types

`fetchPublicDashboardPanels` returns `{panels, layout}`; `fetchPublicFormSchema(dashboardId, panelId,
token)` added. The authenticated `panelService.fetchPanels` ignores the new `layout` key.

## Risks / Trade-offs

- **Pre-existing `dataSourceId` exposure** in the public form config: unchanged here. It is raised as a real
  follow-up through follow-up triage at Delivery (not only a Risks bullet). The new route does not add it.
- **RLS:** dev/CI run as a superuser (BYPASSRLS), so a local pass does not prove the owner-context read
  works under RLS in prod (MISTAKES.md / HEL RLS parity gap). Mitigation: reuse the exact owner-context call
  `PanelService.formSchema` already ships in prod; executor documents which context the anonymous path uses.
- **Paging:** the panel list is paged; a dashboard with more panels than the page limit already shows only
  the first page publicly today. Layout is filtered to the page, so nothing new breaks.
- **Owner previewing own link:** the public grid never mounts the signed-in grid hooks, so no layout write
  or repair can fire; a test asserts zero `PATCH /api/dashboards` and zero `layout/repair` requests.

## Gate-Chain Implications Checklist

Not applicable: no `.husky/**` file or script invoked by `.husky/pre-commit` is changed.
