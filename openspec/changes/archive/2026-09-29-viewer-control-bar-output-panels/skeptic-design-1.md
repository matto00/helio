## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `workflow-state.md`, and all three
  `specs/*/spec.md` deltas in full.
- Ran `openspec validate viewer-control-bar-output-panels --strict` → `Change
  'viewer-control-bar-output-panels' is valid`.
- Read the live backend routes/services the design cites: `backend/src/main/scala/com/helio/api/
  routes/dashboards/PublicDashboardRoutes.scala` (full file), `backend/.../api/routes/pipelines/
  OutputRoutes.scala` (full file), `backend/.../services/pipelines/OutputFilterCapability.scala`
  (full file), `OutputService.scala:355-435` (`rows`/`filterCapabilities`/`distinctValues`),
  `NodeSnapshotRepository.scala:309-339` (`listRowsPaged`), `domain/panels/OutputPanel.scala:1-220`
  (`OutputControlSpec`/`OutputPanelConfig`).
- Read the live frontend files the design cites: `frontend/src/features/panels/ui/PanelContent.tsx`
  (full file), `frontend/src/features/dashboards/ui/PublicDashboardViewerPage.tsx` (full file),
  `frontend/src/features/panels/hooks/useOutputMeta.ts` (full file), `frontend/src/features/
  pipelines/services/outputService.ts:44-47` (`getOutputById`), `frontend/src/features/panels/ui/
  renderers/TableRenderer.tsx:270-660` (canWrite/persist paths), `frontend/src/app/AppRoutes.tsx`
  (route table), `frontend/src/main.tsx` (Redux `Provider` scope).
- Grepped for existing `aria-live`/`role="status"` usage across `frontend/src/features/panels/ui/`.

### Attack 1 — Security on the public/optional-auth tree (D5/D6, C11)

The mechanism itself is sound where it's actually specified: both new routes and the rows route's
gate resolve `dashboardId + panelId -> panel.outputId` server-side via `panelRepo.
findAllByDashboardId` (never a caller-supplied `outputId`), and share `aclDirective.
authorizeResourceWithSharing("dashboard", ...)` with the existing `.../rows` route (confirmed in
`PublicDashboardRoutes.scala:139-223` — this is the SAME directive call the new routes are
described as reusing). No path lets a caller supply or influence which Output is queried.

**But `specs/public-dashboards/spec.md` — the durable OpenSpec artifact, not design.md's prose —
contradicts design.md/tasks.md on whether the gate covers the rows route's `filter=` param at
all.** `design.md` D6 states explicitly: *"Filter values the viewer controls submit are still
constrained to columns the panel's own controls declare (D5's gate applies to the rows route too,
not only capabilities/distinct-values)"*, and `tasks.md` 1.3 requires exactly that ("Gate public
rows `filter=` so any named column must be one of the panel's own `config.controls[].column`
values"). But `specs/public-dashboards/spec.md`'s ADDED Requirement **"Public panel rows accept
sort and filter parameters"** says only:

> `GET /api/dashboards/:dashboardId/panels/:panelId/rows` SHALL accept the same `sort=` and
> `filter=` query parameters, **with the same shape and validation**, as the authenticated
> `GET /api/outputs/:id/rows`... Scenario: ...the returned rows, count, and `hasMore` describe the
> filtered set, **identically in shape to what the authenticated** `GET /api/outputs/:id/rows`
> **would return for the same filter**

— with no SHALL clause or scenario anywhere in that Requirement restricting the filterable column
set to the panel's own controls. The control-column restriction appears ONLY under the sibling
Requirement "Public filter-capability and distinct-values reads are scoped to the panel's own
configured controls." An implementer building strictly from spec.md's Requirements (the artifact
that survives archival, unlike design.md's supporting prose) would reasonably read "same shape and
validation... identically in shape to the authenticated route" as license to allow filtering the
rows route on ANY Output-eligible column — satisfying the literal spec text while violating the
exact C11 security ruling the owner asked this gate to attack specifically.

**Required:** add an explicit SHALL clause + a negative scenario to the "Public panel rows accept
sort and filter parameters" Requirement, stating the filterable-column set on THIS route is also
restricted to the panel's own `output_controls`-declared columns (mirroring the negative scenario
already present under the filter-capabilities/distinct-values Requirement). Design.md/tasks.md are
correct here; spec.md is the artifact that's wrong/incomplete.

### Attack 2 — The reuse claim (D1/D13, C13)

Two concrete, code-verified gaps, both load-bearing for "PanelContent/TableRenderer/ChartRenderer
reused unchanged":

**(a) No public data source exists — or is planned — for the Output metadata `OutputPanelContent`
requires.** `PanelContent.tsx`'s `OutputPanelContent` (the component every `OutputPanel` read
dispatches through, `PanelContent.tsx:123-350`) takes `output: Output` as a prop and — when NOT
supplied (`hasExternalOutput === false`) — calls `useOutputMeta(outputId)` internally
(`PanelContent.tsx:190-191`), which calls `getOutputById` (`outputService.ts:44-47`) →
`GET /api/outputs/:id`, an **authenticated-only** route (`OutputRoutes.topLevelRoutes`, requires
`AuthenticatedUser`). Neither the current public route tree nor anything design.md/tasks.md
proposes returns an Output's `kind`/`config`/`schema`/`ownerId` to an anonymous caller:
- `PanelResponse.config` (the public panel-list route's response shape,
  `PanelProtocol.scala:44-50`) carries only the PANEL's own config — for `OutputPanel` that's
  `OutputPanelConfig(outputId, controls)` (`OutputPanel.scala:104`), never the bound Output's own
  kind/config/schema.
- `PublicDashboardRoutes.resolveDataAsOf` (`PublicDashboardRoutes.scala:62-75`) does fetch the
  Output internally (`outputRepo.findByIdInternal`) but discards everything except `lastRunAt` —
  it never surfaces `kind`/`config`/`schema`/`ownerId` in the response.
- design.md's D1 scopes the new fetch layer (`usePublicPanelData`, task 3.1) to calling only
  `.../panels/:panelId/rows`, which itself returns paginated row data only, never Output metadata
  (`resolveRows`, `PublicDashboardRoutes.scala:116-137`).

Without `output.kind`, `PanelContent` cannot pick a renderer (chart vs. table vs. metric); without
`output.config`/`output.schema`, `ChartRenderer`/`TableRenderer` cannot be configured. This is not
addressed anywhere in design.md's Impact section ("Backend: `PublicDashboardRoutes.scala`,
`OutputService`/`OutputRowsQuery` reuse, new panel-scoped capability/distinct-values resolution" —
no metadata route). **Required:** design.md must add a route (or extend an existing public
response) exposing the bound Output's `kind`/`config`/`schema`/`ownerId` to a panel-scoped,
ACL-gated public caller (the same D5 resolution pattern), and tasks.md must add the corresponding
backend + frontend work.

**(b) `TableRenderer`'s existing owner-write path is not disabled for the public render path, and
nothing in the design addresses it.** `TableRenderer.tsx:295-296`:
```
const currentUserId = useAppSelector((state) => state.auth.currentUser?.id ?? null);
const canWrite = ownerId != null && currentUserId != null && ownerId === currentUserId;
```
— read from Redux, a single SPA-lifetime store (`main.tsx:60`, `<Provider store={store}>` wraps
the whole app including the public route — confirmed via `AppRoutes.tsx`, which mounts
`PublicDashboardViewerPage` outside `ProtectedRoute`/`AppShell` but still inside the same
`<Routes>` tree under that one `Provider`). When `canWrite` is true, sort/filter/pin interactions
PATCH the Output's persisted config (`persistColumnSort`/`persistColumnFilters`/
`persistPinnedColumns`, `TableRenderer.tsx:542-660`). For a genuinely logged-out visitor this is
inert (`currentUserId` is `null`). But a dashboard owner previewing their OWN public share link
while still logged in — an ordinary workflow, reachable via client-side navigation without a full
reload — keeps `currentUserId` resolved to their own id; once gap (a) above is fixed and `ownerId`
starts flowing into `TableRenderer` on the public path (it must, per `OutputPanelContent`'s
existing `ownerId={output.ownerId}` wiring, `PanelContent.tsx:253`), `canWrite` becomes `true` on
the **public** viewer, and the owner's sort/filter/pin clicks there would silently PATCH the live
Output config — directly violating `specs/public-dashboard-panel-content/spec.md`'s own
"Public panel content is read-only" Requirement ("SHALL NOT offer any affordance to edit...
underlying data... a read-only consumer"). **Required:** design.md must state how this write path
is forced off on the public render path (e.g., never pass `ownerId` down that path so `canWrite`
is structurally false, or add an explicit `readOnly` override `TableRenderer` respects) — "reuse
unchanged" as currently stated doesn't do this, and doesn't even acknowledge the dependency exists.

(For completeness, `OutputPanelContent` also reads `useAppSelector(state => state.panels.
crossFilter)` at `PanelContent.tsx:194` — harmless on the public path today since nothing on
`PublicDashboardViewerPage` can set cross-filter and `crossFilter.panelId !== panelId` scopes it
to a different panel, but it's a second instance of the same "not actually purely prop-driven"
inaccuracy in D1's framing. Non-blocking, but design.md's rationale should say "prop-driven with
two known Redux reads, both inert on the public path for reasons X/Y" rather than implying none
exist.)

### Standard design-gate scope

- **AC coverage:** every ticket AC maps to a spec.md requirement; `output-panel-viewer-controls`
  and `public-dashboard-panel-content` cover the folded-in public AC without visibly dropping or
  reducing it, consistent with the owner's ruling. Good.
- **a11y "existing live region" — the ticket's/spec.md's assumption doesn't hold everywhere it's
  needed.** Grepped `frontend/src/features/panels/ui/` for `aria-live`/`role="status"`: only
  `PanelCard.tsx` (~line 245, desktop grid) has one. `grid/MobilePanelStack.tsx`,
  `detailModal/PanelDetailModal.tsx`, and `PanelFullscreenOverlay.tsx` have none — nor does
  `PublicDashboardViewerPage.tsx` (unsurprising, it renders no data today). Spec.md's a11y
  Requirement says announcement goes "via the panel's existing live region (or equivalent), not a
  newly introduced, SEPARATE one" — for 3 of 5 render paths there is no existing one to reuse.
  `tasks.md` 5.5 only claims to verify "at least the desktop grid and mobile stack," but mobile
  stack has none either. **Required:** design.md should state, per render path, where the
  announcement comes from; if a live region must be newly added to paths that never had one, that
  doesn't contradict spec.md's "not a second separate one" wording, but it IS real scope tasks.md
  currently doesn't list and shouldn't be discovered mid-execution.
- **Sequencing (D7/C12):** sound — two-commit plan (public content first, then controls) is
  concretely evaluable red-first at each layer, matches C12.
- **Dependency order:** HEL-1189/HEL-1188/HEL-1027 are all merged on main per `ticket.md`; no stale
  blocking dependency.
- **No DB migration:** confirmed correct — control selection is URL-only, nothing here needs
  persisted state. V113 free for a future ticket, none consumed here.
- **`OutputFilterCapability.eqInEligibleColumn`/`topDistinctValues` citation nit (non-blocking):**
  design.md D5 says routes delegate to "`OutputFilterCapability.eqInEligibleColumn`/
  `topDistinctValues`" — `topDistinctValues` is actually a method on `NodeSnapshotRepository`
  (called from `OutputService.distinctValues`, not from `OutputFilterCapability` itself). Doesn't
  change the plan, just imprecise attribution — worth a one-word fix, not blocking.

### Verdict: REFUTE

### Change Requests

1. **`specs/public-dashboards/spec.md`'s "Public panel rows accept sort and filter parameters"
   Requirement must explicitly state the filterable-column restriction (control-columns-only) that
   design.md D6/tasks.md 1.3 already intend** — currently only the filter-capabilities/
   distinct-values Requirement states it, and this Requirement's own wording ("same shape and
   validation... identically in shape to the authenticated route") reads as license for the
   opposite. Add a SHALL clause + a negative scenario mirroring the existing "non-control column
   rejected" scenario under the sibling Requirement.

2. **Design.md must add a public, panel-scoped, ACL-gated route (or extend an existing public
   response) that exposes the bound Output's `kind`/`config`/`schema`/`ownerId`** — no such route
   exists today and none is proposed; without it, `usePublicPanelData` cannot supply the `output`
   prop `PanelContent`/`OutputPanelContent` require to pick and configure a renderer, and
   `OutputPanelContent`'s own-fetch fallback (`useOutputMeta` → `GET /api/outputs/:id`) will 401
   for an anonymous caller if the prop is ever missing. Update tasks.md with the corresponding
   backend + frontend work (sections 1-3).

3. **Design.md must explicitly force off `TableRenderer`'s existing owner-write path
   (`canWrite`/`persistColumnSort`/`persistColumnFilters`/`persistPinnedColumns`) on the public
   render path** — as currently planned, an authenticated OWNER previewing their own public share
   link while still logged in (ordinary workflow, reachable by client-side nav under the app's one
   Redux store) would have real sort/filter/pin interactions on the PUBLIC view silently PATCH the
   live Output config, violating `specs/public-dashboard-panel-content/spec.md`'s own read-only
   Requirement. State the mechanism (e.g., never pass `ownerId` down the public path, or an
   explicit `readOnly` prop `TableRenderer` respects) in D1/D13.

4. **Design.md must state, per render path, where the a11y result-count announcement actually
   comes from.** Only `PanelCard.tsx` (desktop grid) currently has a live region; mobile stack,
   fullscreen overlay, detail modal, and the (new) public viewer have none. If new live regions
   must be added to some paths, list that as explicit scope in tasks.md rather than leaving it to
   be discovered mid-execution against task 5.5's assumption that mobile stack already has one.

### Non-blocking notes

- D5's attribution of `topDistinctValues` to `OutputFilterCapability` is imprecise — it's a
  `NodeSnapshotRepository` method called from `OutputService.distinctValues`. Fix the citation.
- `OutputPanelContent`'s `useAppSelector(state => state.panels.crossFilter)` read is a second,
  harmless instance of the same "not literally prop-only" inaccuracy in D1's framing as CR3's
  `canWrite` finding — worth acknowledging in the corrected D1 text alongside CR3's fix, even
  though it doesn't need its own mitigation today.
