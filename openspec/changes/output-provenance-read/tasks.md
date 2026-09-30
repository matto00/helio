## Standing Constraints

- [C1] Sonnet on all agents; no model overrides.
- [C2] Red-first: before implementing, show `ownerId` on the public wire and the absence of any provenance route on main.
- [C3] Public provenance is an explicit allowlist; public response type has no id/config/errorLog/observed/ownerId fields.
- [C4] No migration (V113 reserved for HEL-1208). Do not refactor OutputService/OutputRoutes (HEL-1187); put logic in a new ProvenanceService.
- [C5] Do not hand-edit scripts/concertino/**.

## 1. Red-first evidence

- [x] 1.1 Write failing backend tests: public panel list and `output-meta` contain `ownerId`; both provenance routes 404/absent. Record the red output.

## 2. Backend provenance

- [x] 2.1 Add `ProvenanceService` (chain resolution per design D2, row count D3, last run D4, assertions D5, bounded reads D6) and verify with tests for one-root, join with secondary `Lane`, join with secondary `Source`, union, lookup, deleted Source-kind data source omitted, root-bound, no-assertions, never-run. Add batched data-source read.
- [x] 2.2 Add authenticated `GET /api/outputs/:id/provenance` + protocol types; verify 200 shape and 404 for unreadable Output.
- [x] 2.3 Add public `GET .../panels/:panelId/provenance` with exact allowlist key-set assertions field by field, plus attack tests (other dashboard's panel, missing/invalid token, no-output panel).
- [x] 2.4 Add a query-count test using a counting/instrumented repository wrapper: fixture A (1 root, 1 step, 1 assertion) vs fixture B (3 roots incl. join `Lane` and `Source` secondaries, several steps/assertions) - assert equal read counts and <= 8 (authenticated); public = gate reads + 7.

## 3. Public wire cleanup (HEL-1197) and HEL-1177

- [x] 3.1 Drop `ownerId` from `PublicOutputMetaResponse`; make `PanelResponse.ownerId` optional with an explicit `fromDomain` parameter (default keeps it), set only by the public panel-list route when `userOpt.isEmpty`; relax `schemas/panels/panel.schema.json` `required`; verify the red tests from 1.1 go green, authenticated callers (incl. non-owner viewers of a public dashboard) still get `ownerId`, and patchset-undo/authenticated `PanelResponse` serialization is byte-identical (regression test).
- [x] 3.2 Update frontend `PublicOutputMeta` wire type/mapper/tests and JSON schemas; verify `npm run typecheck`, lint and jest; `canWrite` stays false publicly.
- [x] 3.3 Fix both stale `dataAsOf` doc comments (field and `fromDomain`); spec deltas applied (panel-data-freshness).

## 4. MCP and docs

- [x] 4.1 Add `get_output_provenance` to helio-mcp with status codes probed live against a running backend; verify tool tests and README/tool listing.
- [x] 4.2 Schemas for both responses added under `schemas/`; run schema-drift check.

## 5. Gates

- [x] 5.1 Run backend `sbt test`, frontend lint/typecheck/jest, helio-mcp tests, node-root guard if `NodeSnapshotRepository` touched; record any flake name+message verbatim.
