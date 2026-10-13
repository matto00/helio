## Context

See proposal.md (Why) and ticket.md (premise validation, ACs). Ground truth on origin/main f63ab8365:

- `ProposalPanel` (`DashboardProposalProtocol.scala`) decodes and re-encodes `fieldMapping`/`aggregation`/`label`/
  `unit`; the apply path (`ProposalPanelSupport.buildDataConfig`) emits only `{outputId}` for an `output` panel, so they
  are inert. They are advertised on four surfaces: `schemas/dashboards/dashboard-proposal.schema.json` (described as
  "Legacy field, decoded but never applied", no `deprecated`), `AssistantProposalToolSchemas.ProposalPanelSchema` (bare
  types, no description — this is what the in-app assistant reads), `helio-mcp/src/tools/proposal.ts` `panelSchema`
  (zod `^3.25`), and `frontend/src/features/dashboards/types/proposal.ts` (whose doc comment wrongly says chart fields
  and `label`/`unit` apply).
- `scripts/check-schema-drift.mjs` compares property NAME sets (Scala vs JSON schema; MCP zod keys by regex
  `^ {2}(\w+):`). Names do not change here.
- `mcp-panel-composition-tools` requires flat-field-only proposals (incl. `fieldMapping`, `aggregation`) to keep
  applying unchanged.
- `pipeline_run_rate_window.user_id` is `REFERENCES users(id)` (V109, default name
  `pipeline_run_rate_window_user_id_fkey`, NO ACTION), FORCE RLS. `docs/user-reference-inventory.md` is parsed by
  `V119OwnerFkMigrationSpec` against a fully migrated DB, so it must change with the FK. Highest migration on main is
  V130; V131 (#994) and V132 (#1000) are reserved by parked PRs.
- The shared dev DB is at V131 (from #994's lane) and must not receive V133.

## Goals / Non-Goals

Goals: ACs 1-5 in ticket.md. Non-goals: see proposal.md. Also not touched: `helio-mcp/src/types.ts` (parked #986/#990),
and every other file in parked PRs #986 #990 #991 #994 #996 #998 #999 #1000 except the two noted under Risks.

## Decisions

**D1 — Deprecate, do not remove (item 1).** Removing breaks the backward-compat requirement and makes
`additionalProperties: false` reject existing callers (MCP agents, the in-app Proposal Review round-trip). The ticket
allows "mark ignored/deprecated". Because the wire is unchanged this is not a product call. Per surface:
- JSON schema: add `"deprecated": true` to each of the four and reword the description to "Deprecated and ignored:
  ... set it on the Output's `config` instead" (keep existing history).
- Scala `ProposalPanelSchema`: each of the four gets `"deprecated" -> JsTrue` and a `description` with the same
  meaning (one shared string constant, not four copies).
- MCP zod: `.describe(...)` with the same meaning on each of the four. Zod 3 has no `deprecated` meta that the SDK
  emits; the executor confirms what the SDK's emitted JSON schema contains and asserts that in a test, not assumes.
- Frontend type: JSDoc `@deprecated` on the four; correct the stale doc comment (chart fields/label/unit are NOT
  applied by the proposal apply path).
- Proposal Review UIs (`ProposalReview.tsx`, `CombinedProposalReview.tsx`) still show `panel.fieldMapping` as a
  "Mapping" row. DECISION: unchanged in this change (no user-visible UI change here); filed as HEL-1547 (Follow-up,
  relatedTo HEL-1440). Their tests stay as they are. If the `@deprecated` JSDoc makes lint flag those reads, do not
  delete the row: report it and use the narrowest lint-compatible option (or drop the JSDoc, keeping the comment). Check first whether any frontend code reads/writes these props and whether lint
  has a no-deprecated rule (zero-warnings policy); report what was found.
Alternative considered: also deprecating `chartType`/`xAxisLabel`/`yAxisLabel`/`seriesColors`/`sort`/`orientation`.
Rejected: outside the ticket; `chartType` is read by `FirstRunDashboardService.applyChartTypes`.

**D2 — Tests for D1.** Backend: an `AssistantProposalToolSchemasSpec` case asserting the four are `deprecated: true`
with a non-empty description on the Scala tool schema AND on the JSON schema file (read from `schemas/`), and that no
other ProposalPanel property is marked deprecated (target the panel's own `label`, not `ProposalControl.label`). A decode/apply-level test (existing proposal apply spec pattern) proving a
proposal carrying the four is accepted and yields the same panel config as without them, if no existing test already
pins that (cite it if one does). MCP: a test on the registered tool's emitted input schema.

**D3 — V133 migration (item 3).** `V133__pipeline_run_rate_window_user_cascade.sql`: drop the FK by its real name
(read it from `pg_constraint` on a migrated embedded DB first; do not guess) and re-add it as
`FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE`, in the V119 style, with a header comment naming
HEL-1440 and why rate windows cascade (bookkeeping, not content; mirrors `product_events`). Existing rows are all valid
(old FK), so a validating ADD is safe; no NOT VALID. AMENDED after execution: the validating ADD's FK-check scan is
subject to FORCE RLS for the NOSUPERUSER owner (42704), so V133 lifts FORCE around the swap and restores it in the same
migration transaction (V119 bracket); end-state RLS flags/policy unchanged (evaluation-1.md, skeptic-final-1.md). `docs/user-reference-inventory.md`: the table row
becomes CASCADE and the "Blocked, nothing deleted" prose drops "rate-window".

**D4 — Migration verification on VerifiedEmbeddedPostgres only.** New `V133RateWindowCascadeMigrationSpec` following
`V119OwnerFkMigrationSpec`'s per-scenario template-DB pattern: migrate to V130, insert users + rate-window rows,
migrate to V133 (rows survive), then the four spec scenarios (user-reference-integrity delta). Flyway runs as, and
every `DELETE FROM users` is executed by, the NOSUPERUSER NOBYPASSRLS table-owner role `helio_migration_test` (the role
`V119OwnerFkMigrationSpec` creates, to which FORCE RLS applies) with `app.current_user_id` UNSET; every before/after
count is read over the superuser connection. Not optional. `V119OwnerFkMigrationSpec`'s inventory test and
`FlywayNonSuperuserMigrationSpec` must also pass. Never run the backend or Flyway against the shared dev DB from this
branch (it is at V131, which this branch does not contain: the backend would refuse to boot and/or apply V133 there).

**D5 — userCleanupCore.cjs.** Keep `pipeline_run_rate_window` in `BLOCKING_OWNED_TABLES`: the shared dev DB and any
DB below V133 still has NO ACTION, and an explicit delete of zero rows is harmless after V133. Add a one-line comment
saying so. `userCleanup.selftest.mjs` must still pass.

**D6 — e2e cleanup status (item 2).** In the three specs' `finally` blocks, assert each delete's status with
`expect.soft` (records a failure without throwing, so a test-body error is not masked). Expected statuses come from
the actual route code (read them; do not guess 204 vs 200). Keep exact-id deletes and order. Live run: only against a
dedicated scratch database (e.g. `createdb` a `helio_hel1440_scratch` DB, backend pointed at it, dropped afterwards),
never the shared dev DB, and never by printing or sourcing `backend/.env`. If the start scripts cannot be pointed at a
scratch DB without that, do not run live: record that, run `tsc`/lint on e2e and `npx playwright test --list` for the
three files, and say exactly what ran.

**D7 — Chart fixtures (item 4).** Replace `category`/`value` chart mappings with real slots (`xAxis`/`yAxis`,
plus `series`/`annotation` where the test exercises them) in `buildOutputConfig.test.ts` and
`OutputEditorSheet.configPatch.test.tsx`, and in any other chart-kind fixture the executor finds (grep, list each).
Metric/collection `value` mappings are correct and stay. Each changed test must still test the same behavior (e.g. the
stale-annotation drop) — confirm by running them, and by a one-off mutation of the code under test showing the test
still goes red.

**D8 — Item 5b.** Replace `asInstanceOf[JsString].value` at `AssistantProposalToolSchemasSpec.scala:263,324` (and the
`asInstanceOf[JsArray]` at :35, same nit) with `convertTo[...]` or a pattern match that fails with a message. Item 5a dropped (code moved and formatted by HEL-1469 #918).

## Risks / Trade-offs

- [V133 above unmerged V131/V132] → Flyway refuses a lower version after a higher one. PR is PARKED until #994 and
  #1000 merge, then rebased; PR body states the dependency.
- [`docs/user-reference-inventory.md` also edited by #994 (adds `patch_set_applied_proposals` one line above ours)] →
  unavoidable (spec-pinned doc); trivial conflict at rebase; noted in PR body.
- [`AssistantProposalToolSchemas.scala` also edited by #994, distant hunk (~line 428)] → unavoidable for AC1; noted.
- [Agents relying on panel-level fields] → no behavior change; only descriptions/annotations.

## Migration Plan

Deploy after V131/V132. Rollback: a later migration re-adding the NO ACTION FK (no data loss either way).

## Planner Notes

Self-approved: deprecate-not-remove (D1); scope limited to the ticket's four fields; keep the cleanup-core entry (D5);
expect.soft for e2e (D6). Driver brief: no assumed product call expected; PR parks on migration order regardless.
