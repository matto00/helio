## 1. Backend template registry and data

- [x] 1.1 Author four synthetic CSVs under backend/src/main/resources/templates/ plus a provenance README; verify via the dataset validation test (header schema, min rows, size cap)
- [x] 1.2 Add PersonaTemplates registry (pipeline, outputs with explicit chart types/column order, explicit layout); verify a unit test that each template's plan is valid and layouts do not overlap
- [x] 1.3 Extend FirstRunDashboardService to take a plan so rule and template builds share one apply path; verify the existing HEL-1209 tests still pass

## 2. Endpoint

- [x] 2.1 Add POST /api/first-run/template (auth, not tier-gated, 400 on unknown slug, cleanup of source on failure); verify route tests including free tier and rollback
- [x] 2.2 Ownership tests: user B cannot see user A's instantiated resources, no system-user ownership, edit/delete works; verify tests pass (and show red on main)
- [x] 2.3 Integration test: each template materializes correctly typed outputs with rows

## 3. Telemetry and DemoData

- [x] 3.1 Populate RolledUpTemplateSlugs with the four slugs; verify repository spec buckets each slug and `other`
- [x] 3.2 Extend client-wire-batch.json and track.wireContract.test.ts with the template variant; verify the seam test fails when the variant drifts (mutation)
- [x] 3.3 Retire DemoData (or dev-only fallback per design Decision 7), state the decision; verify full backend suite

## 4. Frontend

- [x] 4.1 Persona chips + useFirstRunTemplate hook + service call + track(); verify Jest tests incl. a11y roles/labels, live region, error alert
- [x] 4.2 CSS per DESIGN.md; verify in the running app, both themes, desktop and phone widths

## 5. Live verification

- [x] 5.1 On a fresh free-tier account, all four personas produce rendered dashboards; verify product_events row with template property and the rollup bucket; record chip-click-to-render time; list/cleanup test users and resources

## Standing Constraints

- [C1] Fixture `client-wire-batch.json` already has a `firstrun_template_chosen` variant with `template: "sales-overview"`; change it to a real slug (e.g. streamer) and have the seam test/spec assert it; mutation-test that drift fails.
- [C2] Phone layout: LayoutBreakpointScaling keeps y and scales x/w, so half-width lg panels sit side by side at phone width. Use full-width lg panels (distinct y rows); verify visually at phone width.
- [C3] Retiring DemoData also updates CLAUDE.md (DemoData reference) and backend/README.md DemoData note, removes dead DashboardRepository.count() if no other caller; note in PR.
- [C4] Tests must cover source cleanup when pipeline apply fails AND when the dashboard phase fails.
