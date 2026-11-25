## Standing Constraints

- [C1] Never read, print, copy or source any .env file; no env-dumping commands; servers only via start-servers.sh (exception documented in the lane brief for e2e:prod-build).
- [C2] Quoted heredocs only (<<'EOF').
- [C3] No pkill/pgrep/killall; exact PIDs; stop servers with stop-servers.sh; test residue deleted by exact id.
- [C4] jest 3 workers, Playwright 2 workers total, sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; sbt testFull in shards that finish under it.
- [C12] Red first with mutations, full spec files; commit the red run as .txt before implementation.
- [C13] Scratch in the main checkout's .concertino/scratch/HEL-1587/ only (TMPDIR exception for hooks).
- [C14] Lane DB helio_hel1587 exported as DATABASE_URL in the same command as start-servers.sh, Playwright, e2e cleanup and DB-touching jest/hook runs.

## 1. Red tests first

- [x] 1.1 Backend: panel-list `layout` spec (token viewer gets filtered layout; stale ids dropped; denied = 404 with no layout; exact item keys).
- [x] 1.2 Backend: public form-schema spec (bound fields only, keys exactly name/type/required, declared order, 404 for non-form / other dashboard / unknown / missing dataset / denied / dataset the form owner does not own, proven twice: (b) owner predicate in the ordinary harness with a drop-predicate mutation red, and (a) under `SET ROLE helio_app_test` NOBYPASSRLS with the predicate mutated out still 404 plus a `withSystemContext` mutation red; anonymous submit status asserted by exact value).
- [x] 1.3 Backend: extend `PublicRouteOwnerIdLeakSpec` and `PublicRouteOwnerIdLeakApiSpec` with the form-schema route and a panel list whose `layout` is non-empty.
- [x] 1.4 Frontend: `PublicDashboardViewerPage` tests: grid positions from layout at >= 768 px incl. a vertical-gap layout kept at its stored y (noCompactor), lg placement at a container >= 1440 px, md at 1100-1439, sm at 768-1099, stack below 768; `data-short-card` on min-height cells; form panels never reach `PanelContent`; text/markdown/image/divider content; hostile markdown + hostile image URL inert; no layout PATCH / repair request as owner session; form preview disabled with no submit request.
- [x] 1.5 Run the red set, record output, commit it as .txt evidence.

## 2. Backend

- [x] 2.1 Panel-list response type with `layout` (filtered to response panel ids) via an internal dashboard read inside the existing sharing gate.
- [x] 2.2 Public form-schema resolver + route in `PublicDashboardRoutes`, reading declarations in the form owner's DB context; record which pool/context the anonymous path uses.
- [x] 2.3 Schemas: panel-list response schema with `layout`; `schemas/panels/public-form-schema-response.schema.json`; schema-drift check green.

## 3. Frontend

- [x] 3.1 `publicDashboardService`: `fetchPublicDashboardPanels` returns `{panels, layout}`; add `fetchPublicFormSchema`.
- [x] 3.2 `PublicPanelGrid`: read-only `Responsive` grid per design D3 (`noCompactor`, `useProcessedWidth`, PanelCard token set); stack below 768 px.
- [x] 3.3 Content panels through the shared renderer path (D4).
- [x] 3.4 `FormFieldControl` `disabled` prop threaded to every control incl. `CounterControl`; `PublicFormPreview` (D5).
- [x] 3.5 CSS with DESIGN.md tokens only; both themes.

## 4. E2E and gates

- [x] 4.1 Public-view e2e: output + markdown + image panel two-column at both lg and md (and a form preview), light and dark, 375 px and 1440 px; asserts the resolved breakpoint (md at 1440, stack at 375), positions, rendered content, no submit/layout requests.
- [x] 4.2 Full gates: lint, typecheck, format, jest (full affected files), backend shards, e2e.

## 5. Design-gate round 3 notes (adopted)

- [x] 5.1 In the NOBYPASSRLS (`SET ROLE helio_app_test`) harness, add the owner-positive case: the form owner's own dataset returns `200` with its bound fields.
- [x] 5.2 `PublicPanelGrid` passes `panelMinRows` as `minRowsFor` to `createLayouts`, as `DesktopPanelGrid` does.
