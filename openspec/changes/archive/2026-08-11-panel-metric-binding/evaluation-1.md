## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS

- [x] All ticket acceptance criteria addressed explicitly (not partial)
  - AC1 (create/update with metricId, effective binding resolved at read time): `PanelServiceMetricBindingSpec`
    (create/update accept path) + `PanelMetricBindingRoutesSpec` (route-level materialization test).
  - AC2 (deleting the referenced metric sets `metric_id` NULL, panel reads back unbound): `V76__panel_metric_id.sql`
    FK `ON DELETE SET NULL` + `PanelMetricBindingRoutesSpec` "clear metricId on read after the referenced metric
    is deleted" test (deletes via `DELETE /api/metrics/:id`, panel survives, `metricId` absent on next read).
  - AC3 (foreign/nonexistent metricId rejected at create/update; cross-user resolves to cleared binding on read):
    `PanelService.rejectUnresolvableMetric` wired into `buildForCreate`/`update`; `PanelServiceMetricBindingSpec`
    covers both create and update reject paths; `PanelMetricBindingRoutesSpec` covers the read-time cross-user
    clear (no 500).
  - AC4 (metricId authoritative, raw fields as overrides, precedence tested): `PanelServiceHelpers.withMaterializedMetric`
    implements the override formula exactly per design.md D4; both the "both set" create test and the route-level
    "explicit raw field overrides its metric-derived counterpart" test cover this.
  - AC5 (migration + schema updated, existing panels behave byte-for-byte as before): `V76` migration present;
    `schemas/panel.schema.json` updated for all three bound-trio `$defs`; full `sbt test` suite (2434 tests) green,
    including all pre-existing panel/dashboard specs untouched in behavior.
  - AC6 (`sbt test` passes; no FQNs inlined): verified independently (see Phase 2).
- [x] No AC silently reinterpreted — D4's Chart/Table materialization scope-narrowing was explicitly self-approved
  in design.md (skeptic-confirmed at the design gate, round 2) and is a scope *reduction* relative to a literal
  reading of the ticket's "Resolution" bullet, not a reinterpretation of any AC. The ticket's own scope bullet says
  "extend `ChartPanelConfig`/`TablePanelConfig` where the epic warrants" — D4 exercises that discretion and
  documents why (no unambiguous single-field target for axis/column-keyed mappings).
- [x] All task items marked done and matching what was implemented — spot-checked 1.1–1.3 (migration + row/repo
  plumbing), 2.1–2.3 (domain config wiring), 3.1–3.2 (row mapper), 4.1–4.3 (validation, all ~10 `new PanelService(...)`
  call sites updated — confirmed 9 non-test + test call sites, compiles clean), 5.1–5.4 (read-path resolution +
  materialization, including the `/query` route gap task 5.3 explicitly flagged and fixed), 6.1–6.3 (schema), and
  all six T.1–T.6 test tasks — all match the diff.
- [x] No unnecessary changes outside ticket scope (scope creep) — every touched file matches the ticket's
  "Impact" list plus its own test files; the `PanelRoutes.scala` `/query`-route resolution fix was explicitly
  called out in tasks.md 5.3/design.md as required by the ticket's own read-path requirement, not a drive-by.
- [x] No regressions to existing behavior covered by other specs — full `sbt test` (2434 tests, 143 suites) green;
  `resolveOne`/`resolveSingleBinding`'s existing `dataTypeId`-clears-whole-binding behavior is preserved unchanged
  (metricId clearing is additive and independent, per D3).
- [x] API contracts / schemas updated — `schemas/panel.schema.json`'s `MetricConfig`/`ChartConfig`/`TableConfig`
  `$defs` all gained `metricId`; `npm run check:schemas` (schema ↔ `JsonProtocols` parity) passes clean.
- [x] Planning artifacts reflect the final implemented behavior — proposal/design/tasks/spec-delta all read
  consistent with the diff; no drift found between the documented D1–D5 decisions and the actual code.

### Phase 2: Code Review — PASS

**Gates re-run independently (not trusting the executor's report), in `WORKTREE_PATH` (no `CLEAN_WORKTREE` flag
was passed for this run):**

- `cd backend && sbt test` → **2434 tests, 0 failed, 143 suites, all green** (matches the executor's claim).
- `npm run check:scala-quality` → **clean** (84 soft/informational file-size warnings only, none new-blocking;
  no inline-FQN violations found — independently grepped the diff's added lines for `com.helio.`/`spray.json.`/
  `java.util.UUID.`/`org.apache.pekko.` outside import statements: none found, only legitimate top-of-file imports).
- `npm run format:check` → clean.
- `npm run check:schemas` → clean (35 protocols checked, 29 files; panel-type enums in sync).
- `npm run check:openspec` → **fails as expected** ("change 'panel-metric-binding' is complete (24/24) but not
  archived") — this is the one hook the executor's commit legitimately bypassed with `git commit -n`, and matches
  their commit-message explanation (archiving is the orchestrator's Phase 3 job). Confirmed this is the *only*
  hook failing standalone.
- No `frontend/**` files changed by this diff, so `npm run lint`/`npm test`/`npm --prefix frontend run build` were
  not required per the gate-selection rule; ran `format:check` regardless (root-level, passed).

**Canonical standard compliance (`CONTRIBUTING.md`, binding for all code — this is backend-only, `DESIGN.md` N/A):**

- Imports & Qualifiers: no inline FQNs (verified via `check:scala-quality` + manual diff grep, see above).
- ACL triad: `rejectUnresolvableMetric` uses `metricRepo.findByIdOwned` (mutation path) correctly; the read path's
  `findByIdsOwned`/`findByIdOwned` mirror `DataTypeRepository`'s owner-scoped shape exactly, consistent with the
  "ACL triad" rule.
- File-size soft budgets: `PanelService.scala` grew from 443→538 lines (already over the 250 soft budget
  pre-existing this ticket); `PanelServiceHelpers.scala` grew 270→348. Both are informational-only per
  `CONTRIBUTING.md` ("File-size warnings … are informational only") — not a gate failure, flagged as a
  non-blocking suggestion below since the growth is meaningful.

**Design review (diff + targeted full-file reads of `MetricPanel.scala`/`ChartPanel.scala`/`TablePanel.scala`/
`package.scala`/`PanelService.scala`/`PanelServiceHelpers.scala`/`PanelRepository.scala`/`PanelRowMapper.scala`/
`MetricRepository.scala`/`PanelRoutes.scala`/`ApiRoutes.scala`/migration/schema):**

- DRY: `metricIdFromCreateConfig`/`metricIdFromConfigPatch` mirror the existing `dataTypeIdFrom*` helpers exactly
  (same absent/null/present handling); `MetricRepository.findByIdsOwned` mirrors `DataTypeRepository`'s shape;
  no duplicated logic introduced.
- Readable: helper/field naming is clear (`withMetricCleared`, `withMaterializedMetric`, `resolveOne`); no magic
  values — the materialization formula (`{"value": measureField}` / `{"value": measureField, "agg": aggregation}`)
  matches the pre-existing `panel-viz-aggregation` wire convention documented in the spec delta.
- Modular: `rejectUnresolvableMetric`, `resolveOne`, and the three new `PanelServiceHelpers` functions are each
  small, single-purpose units; the D4 materialization logic is isolated to `withMaterializedMetric` and applied
  identically from both the batch (`resolveBindingsForRead`) and single-panel (`resolveSingleBinding`) paths.
- Type safety: `MetricId` value class used throughout (never a raw `String`) except at repository/JSON boundaries,
  consistent with `CONTRIBUTING.md`'s "Wrap path-extracted IDs" rule; no `any`/untyped escape hatches (Scala side
  has none applicable).
- Security: `metricRepo.findByIdOwned`/`findByIdsOwned` are owner-scoped (RLS + explicit `owner_id` filter);
  cross-user access is defense-in-depth-cleared on read (D3) even though create/update already rejects it.
- Error handling: `rejectUnresolvableMetric` returns 400 `BadRequest` with a specific message per failure mode;
  cross-user/deleted metric never 500s on read (verified by the route-level tests, and reproduced live in Phase 3).
- Tests meaningful: `PanelServiceMetricBindingSpec` (mocked-repo unit tests, mirrors the existing
  `PanelServiceCompanionBindingGuardSpec` style) and `PanelMetricBindingRoutesSpec` (embedded-Postgres
  route-level integration, mirrors `BoundPanelRoutesSpec`) both exercise real negative paths (foreign/nonexistent/
  non-pipeline-output metricId, cross-user metric via a direct-repo-inserted panel simulating ownership drift, an
  actual `DELETE /api/metrics/:id` FK-cascade). These would catch a real regression in any of the reject/clear/
  materialize paths.
- No dead code: no unused imports or leftover TODO/FIXME found in the diff.
- No over-engineering: the D4 scope-narrowing (Chart/Table get the field but not materialization) is the opposite
  of over-engineering — a deliberately narrower, well-justified scope rather than guessing an axis-mapping shape.
- Behavior-preserving where expected: `resolveOne`'s pre-existing `dataTypeId`-clears-whole-binding branch is
  unchanged in shape; the `/query` route fix (task 5.3) is a genuine, ticket-required behavior *addition*
  (closing a previously-unresolved read path), not a silent behavior change to something out of scope.
- All ~9 non-test + 4 test `new PanelService(...)` call sites are updated (mechanical `metricRepo` constructor
  param); compiles clean, confirming completeness.

### Phase 3: UI Review — PASS

Trigger: this change touches `schemas/panel.schema.json` (`schemas/**` trigger). There is no dedicated frontend
surface for this ticket (authoring UI is explicitly out of scope, 418-F; no `frontend/**` files were touched), so
this was a regression + wire-contract smoke check via the live dev servers rather than a feature-specific
walkthrough.

**Environmental note (resolved mid-review):** the first attempt failed — `scripts/concertino/start-servers.sh`
(canonical, untouched by this ticket's diff) errored with `nohup: failed to run command 'PORT=8839': No such file
or directory` (a bash `nohup`-vs-env-var-prefix incompatibility, independently reproduced outside the worktree).
The orchestrator applied an upstream fix (`main` commit `b81222cc`, `nohup $cmd` → `nohup env $cmd`) and this
worktree's copy of the script was updated to match — independently verified both `main`'s `HEAD` and this
worktree's `scripts/concertino/start-servers.sh:82` read `eval "nohup env $cmd ..."` before retrying. Retried
`start-servers.sh` → both servers came up healthy (`READY backend=http://localhost:8839/health`,
`READY frontend=http://localhost:5932`); `scripts/concertino/assert-phase.sh servers` → `PASS servers`.

**Checks performed (via Playwright against the live dev servers):**

- Happy path (dashboard/panel loading): navigated to `http://localhost:5932`, dashboard list + panel grid render
  with 0 console errors/warnings across the whole session.
- **New-capability end-to-end smoke test** (beyond the mandatory regression scope, since the ticket's own wire
  contract changed): created a `MetricDefinition` via `POST /api/metrics` (dataTypeId bound to an existing
  pipeline-output type, `measureField: "profit"`, `aggregation: "sum"`, `format.unit: "$"`), then a `MetricPanel`
  via `POST /api/panels` with only `config.metricId` set. `GET /api/dashboards/:id/panels` returned the panel
  with `config.dataTypeId`/`fieldMapping: {"value":"profit"}`/`aggregation: {"value":"profit","agg":"sum"}`/
  `unit: "$"` all materialized from the metric — exactly matching D4's formula and the spec delta's scenario.
  Reloaded the dashboard in the browser: the panel rendered live with the correct materialized value
  (`3020100 $`), confirming the existing `panel-viz-aggregation` frontend renderer consumes the new wire shape
  with **zero frontend changes**, exactly as proposal.md's Impact section predicted. No console errors during
  create, read, or render. Cleaned up both the test panel and metric afterward (`DELETE` → 204 for both) so no
  test data was left in the shared dev DB.
- Unhappy/error paths: already covered exhaustively by `PanelMetricBindingRoutesSpec`'s cross-user/deleted-metric
  tests (Phase 2); not independently re-driven through the UI since there is no UI surface that would trigger
  them (metricId is only set via direct API today).
- Loading/empty/error states: unaffected — no new UI states introduced by this backend-only change.
- No console errors at any point (0 errors, 0 warnings across the full session, including the metric-panel
  create/read/render smoke test).
- Feature works from its only entry point (the API) — no other entry points exist per the ticket's own scope.
- Breakpoints (1440 / 1100 / 768) all render without layout breakage — screenshotted at each; the metric panel
  and pre-existing chart panels all render correctly, no overflow/collision. (0px/mobile breakpoint not
  separately screenshotted — this is a schema/backend-only change with no layout-affecting frontend edits, so
  mobile-specific regression risk is nil; 768 already confirms the mobile nav breakpoint switch renders cleanly.)
- Interactive elements / accessible names / keyboard support: unaffected — no new interactive elements introduced.

No stray dev-server processes or log files were left behind beyond the servers themselves (left running per
convention — `start-servers.sh` is idempotent and may be reused by a later review pass); no stray screenshot
artifacts were left at the repo root (removed after use).

### Overall: PASS

All three phases are clean. Implementation matches the ticket/plan precisely (including a well-justified,
skeptic-confirmed scope narrowing in D4), code quality is sound with meaningful test coverage across positive and
negative paths, and the live dev-server smoke test confirms the wire contract materializes correctly end-to-end
with zero required frontend changes, exactly as designed.

### Non-blocking Suggestions

- `PanelService.scala` (538 lines) and `PanelServiceHelpers.scala` (348 lines) are both meaningfully over
  `CONTRIBUTING.md`'s ~250-line soft budget after this ticket's additions (informational only, not a gate
  failure). Both were already over budget before this ticket; consider a follow-up split (e.g. extracting the
  metric-binding validation/resolution helpers introduced here into their own file) rather than letting them grow
  further on the next bound-panel ticket.
- `scripts/concertino/start-servers.sh`'s `nohup`-vs-env-var-prefix bug has already been fixed upstream
  (`main@b81222cc`) during this review; worth confirming the fix survives the next `concertino sync` regeneration
  (an equivalent fix was reportedly reverted by a prior sync per repo history — see the commit message's own
  "re-apply 391c987b/c25abf40" note) so it doesn't need re-discovering a third time.
- This worktree's `scripts/concertino/` was also missing `emit-event.sh`/`next-report-number.sh`/
  `persist-evidence.sh` at the start of this review (gitignored, untracked files not copied at worktree setup
  time); I copied them from the main checkout to complete this report's mandated output procedure. Worth checking
  whether `setup-worktree.sh` should be copying the full `scripts/concertino/` script set into every new worktree
  rather than the partial subset this one received.
