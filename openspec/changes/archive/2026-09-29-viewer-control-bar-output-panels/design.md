## Context

`OutputPanel.config.controls: OutputControlSpec[]` (`id, kind, column, label, defaultValue?`) is
already author-persisted (HEL-1189). `GET /api/outputs/:id/rows?sort=&filter=` and
`filter-capabilities`/`distinct-values` already exist, authenticated only (HEL-1027/HEL-1188,
`OutputRoutes.scala`, `OutputService.rows/filterCapabilities/distinctValues`). The public route
tree (`PublicDashboardRoutes.scala`) exposes `GET /api/dashboards/:id/panels` and
`.../panels/:panelId/rows` (offset/limit/token only) via `outputRepo.findByIdInternal` — no user,
ACL already proven by `authorizeResourceWithSharing` at the dashboard level. Owner ruling folded
in: `PublicDashboardViewerPage.tsx` renders only a title/kind list today (no rows) — see
proposal.md "Why".

`PanelContent.tsx` (the shared per-kind renderer dispatcher) takes `panel`, `data`, `rawRows`,
`headers`, `isLoading`, `error` as PROPS — it does not fetch internally. Fetching is the caller's
job (`usePanelData`, `usePanelSortFilter`), one per top-level render-path component (`PanelCard`,
`MobileStackPanelBody`, fullscreen, detail modal — HEL-579 Decision 1 pattern).

## Goals / Non-Goals

**Goals:** viewer controls on every render path per spec.md; real public panel content reusing
authenticated renderers; public-route filter/distinct-values strictly scoped to a panel's own
configured control columns.

**Non-Goals:** dashboard-wide variables (v0.9, HEL-1192), recompute, cross-filter (HEL-1191 owns
moving `panel-cross-filtering` to server-side `eq` — this change's control filter and that
mechanism are independent server-side filters composed the same way sort/filter already composes
with cross-filter today; no interaction requiring new work here). No DB migration: control
selection is URL-held and ephemeral (confirms proposal.md).

## Decisions

**D1 — Reuse the renderer, add a public-aware fetch layer, not a forked renderer.**
`PanelContent`/`TableRenderer`/`ChartRenderer` are prop-driven for ROW data, not fetch-coupled, so
`PublicDashboardViewerPage` renders them directly, passing rows/headers/metadata it fetches itself.
**Not purely prop-driven (skeptic-design-1.md CR2/CR3), addressed below, not assumed away:**
`OutputPanelContent`'s own-fetch fallback (`useOutputMeta` → authenticated `GET /api/outputs/:id`,
401s anonymously) fires whenever no `output` prop is supplied — D8 adds the public metadata source
that must always be supplied so this is never reached publicly. `TableRenderer`'s `canWrite` and
`OutputPanelContent`'s `state.panels.crossFilter` read are live Redux reads inside the reused
renderers — `crossFilter` is inert publicly (nothing there sets it; scoped to a different
`panelId`); `canWrite` is NOT inert and is force-disabled per D9. With D8/D9 in place, the FETCH
layer is the only new code: `usePublicPanelData(panel, token, dashboardId)`, parallel to
`usePanelData`, calling the public rows + metadata routes with `?token=` instead of the
authenticated `fetchPanelPage` thunk (session-cookie-based). Satisfies C13 — no renderer fork.

**D2 — URL encoding: `?p.<panelId>.<controlId>=<value>`, one query key per control.**
Flat query keys (not a single JSON blob) so a pasted link is human-legible and a single control's
change is a single param diff. `date-range` encodes as `<from>_<to>` (ISO dates, empty side for
open-ended) or a preset token (`last7d`, `last30d`, `thisQuarter`); `numeric-range` as `<min>_<max>`;
`text`/`dropdown` as the raw value. A malformed/unparseable value for a control is treated as
absent (falls back to the author's default) — never a render error.

**D3 — Filter composition: viewer-control filters and in-panel (HEL-1027) filters are ANDed as
separate `OutputRowsQuery.FilterParam.ops[]` entries on the same request**, not merged/deduped
against each other. `usePanelSortFilter`'s existing state stays the source of truth for in-panel
sort/filter; a new sibling hook (`useViewerControls`, URL-backed) owns control state; the request
builder (`PanelCard`/`MobileStackPanelBody`/etc.) combines both into one `filter=` payload. Neither
hook knows about the other's existence — composition happens once, at the request-builder call
site, matching how `usePanelSortFilter` already composes with cross-filter today (`PanelContent`'s
existing `filterRowsByDimension` layering, unaffected/independent per Non-Goals).

**D4 — Chart panels ARE filtered by controls (explicit, per ticket).** Same combined-filter
request as table panels; a chart still plots only its first loaded page, exactly as today's
unfiltered chart read does — controls change WHAT that page contains, not pagination behavior.

**D5 — Public filter-capabilities/distinct-values are panel-scoped, not Output-id-scoped.**
New routes: `GET /api/dashboards/:dashboardId/panels/:panelId/filter-capabilities` and
`.../distinct-values?column=`, mounted in `PublicDashboardRoutes` alongside the existing `.../rows`
route, sharing its `authorizeResourceWithSharing` call and its `panelRepo.findAllByDashboardId` →
match-by-`panelId` resolution (never accepting a raw `outputId` from the caller — resolved
server-side exactly like `resolveRows` already does). **Security enforcement (C11):** after
resolving `panel.outputId → output`, the requested `column` is checked against
`(panel.asInstanceOf[OutputPanel]).config.controls.map(_.column).toSet` — rejected (400) if absent
— BEFORE delegating to the existing `OutputFilterCapability.eqInEligibleColumn`/`buildContract` and
`NodeSnapshotRepository.topDistinctValues` logic (reused unchanged, via `OutputService`'s existing
call shape, for the actual eligibility/values computation once the column passes this new
panel-scoped gate — corrected citation: `topDistinctValues` lives on `NodeSnapshotRepository`, not
`OutputFilterCapability`, per skeptic-design-1.md non-blocking note). This is a strict ADDITIONAL
narrowing on top of the existing eq/in-eligibility check, never a replacement for it.

**D6 — Public rows sort/filter reuses `OutputRowsQuery` unchanged.** `resolveRows` in
`PublicDashboardRoutes` gains `sort`/`filter` query params, parsed with the SAME
`parseSortParam`/`parseFilterParam` logic `OutputRoutes` uses (extracted to a shared location if
not already reachable, per CONTRIBUTING's no-inline-duplication rule) and resolved via
`OutputRowsQuery.resolveSort/resolveFilter` unchanged — the same "contract and rows endpoint can't
drift" guarantee OutputService already relies on. Filter *values* the viewer controls submit are
still constrained to columns the panel's own controls declare (D5's gate applies to the rows route
too, not only capabilities/distinct-values) — an anonymous caller cannot filter a public rows
request on an arbitrary non-control column even though the authenticated rows route permits
filtering any eligible column.

**D7 — PR sequencing (C12):** two ordered commits inside this one change/PR: (1) public panel
content rendering (D1) — evaluable red-first against "public dashboard shows only title/kind"
without any control code; (2) viewer controls + URL state + server-filter composition (D2-D6) on
top, evaluable red-first against "controls exist in config but do nothing for a viewer." The
executor's own commit history should reflect this order; the evaluator verifies each layer
separately before the combined final state.

**D8 — New public Output-metadata resolution (skeptic-design-1.md CR2).** `OutputPanelContent`
needs `output.kind`/`config`/`schema`/`ownerId` to pick/configure a renderer; nothing on the public
tree exposes this (`PanelResponse.config` is only the panel's own config; `.../rows` is row data
only). Add `GET /api/dashboards/:dashboardId/panels/:panelId/output-meta`, mounted alongside
`.../rows`/`.../filter-capabilities`/`.../distinct-values`, sharing the same
`authorizeResourceWithSharing` + `panelRepo.findAllByDashboardId` → match-by-`panelId` resolution
(D5's pattern, never a caller-supplied `outputId`). Response: exactly `kind`/`config`/`schema`/
`ownerId`, never row data. `usePublicPanelData` (D1) calls this alongside `.../rows` and supplies
the result as `OutputPanelContent`'s `output` prop, so `useOutputMeta`'s 401-prone fallback is never
reached publicly.

**D9 — `TableRenderer`'s write path is force-disabled publicly (skeptic-design-1.md CR3).**
`canWrite = ownerId != null && currentUserId != null && ownerId === currentUserId`
(`TableRenderer.tsx:295-296`) is unsafe as-is: an owner previewing their own public link while
still authenticated would get `canWrite = true` publicly once D8 supplies `ownerId`, letting
sort/filter/pin PATCH the live Output config — violating the read-only requirement. Fix:
`PublicDashboardViewerPage`'s call into `OutputPanelContent` never passes a real `ownerId` (pass
`null`) — `canWrite` is then structurally `false` regardless of session identity. A prop-shape
decision at the call site only; no `TableRenderer`/`OutputPanelContent` change, no new prop.
**Nuance (skeptic-design-2.md, non-blocking):** the shared `Output` type declares `ownerId: string`
non-nullable — use D8's own narrower public-metadata response type (omitting/nulling `ownerId`),
not a cast, so the type system itself blocks a future silent widen-back to non-null publicly.

**D10 — a11y live-region availability per render path (skeptic-design-1.md CR4).** Confirmed (grep)
only `PanelCard.tsx` (desktop grid) has one today; `MobilePanelStack.tsx`, `PanelDetailModal.tsx`,
the fullscreen overlay, and `PublicDashboardViewerPage.tsx` have none. spec.md's "existing live
region (or equivalent)" is satisfied by ADDING one where none exists — it forbids a second,
redundant region on a path that already announces, not adding the first to a path with none. Each
of those four paths needs its own live region added as explicit scope (tasks.md 5.5 updated), not
discovered mid-execution.

## Risks / Trade-offs

- [Risk] A public reader could probe `distinct-values` for a non-control Output column, learning
  schema beyond what the author intended → Mitigation: D5's column-membership gate rejects any
  column not in the panel's own `config.controls`, checked before Output data is touched.
- [Risk] Divergent authenticated/public filter-sort parsing → Mitigation: D6 reuses
  `OutputRowsQuery`/`parseSortParam`/`parseFilterParam` verbatim; skeptic diffs the two routes.
- [Risk] `usePublicPanelData` reimplementing `usePanelData`'s request-sequencing guard incorrectly
  → Mitigation: factor the guard logic into a shared helper both hooks call.
- [Risk] An authenticated owner previewing their own public link could write through a reused
  renderer's owner-only affordance → Mitigation: D9 — never pass a real `ownerId` down the public
  render path, making `canWrite` structurally false there regardless of session identity.

## Migration Plan

None required — no schema change (control selection is URL-only, no persisted state). Deploy is a
normal backend+frontend release; no data backfill, no flag.

## Planner Notes

Self-approved: three new panel-scoped public routes (D5, D8) rather than reusing the authenticated
`outputs/:id/*` routes with a token param — reuse would require accepting a caller-supplied
`outputId`, exactly what D5/C11 forbid; a panel-scoped route is the only shape that lets the server
resolve the Output itself rather than trust the caller.
