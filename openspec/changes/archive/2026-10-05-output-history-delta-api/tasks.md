## Standing Constraints

- [C1] Do not add or change any history SQL: reuse L1's `listRecent`/`nearestAtOrBefore`/`earliest` only; no migration.
- [C2] Keep `ApiRoutes`/`JsonProtocols` hunks minimal (one service val, two constructor args, one mixin); never touch `Main.scala`.
- [C3] Every proof is red-first, and every guard has a recorded mutation that exercises that exact guard.
- [C4] New route specs mix in `com.helio.testkit.HelioRouteTest`; DB visibility proofs run as a NOSUPERUSER role with `rolbypassrls = false` asserted.
- [C5] Shared dev DB and filesystem: delete by exact id/path only; never pattern-select; scratch files only under the run scratchpad.
- [C7] D6 mutation fixtures place the newest point >=3d before now and use distinct earliest/earliest+w/current+w so now-relative and earliest-relative mutations are killable.
- [C8] Query-count proofs count JDBC executes on BOTH pools via a counting DataSource proxy and assert a stated numeric bound.
- [C6] `nice -n 19 sbt testFull` with a 600000 ms tool timeout, at most 2 test-group workers; `sbt --client shutdown` and `cleanup.sh` as separate calls.

### Backend

## 1. Compare parsing and validation

- [x] 1.1 Add pure `domain/history/OutputCompare` (D1 grammar incl. bare P/PT and overflow → Left, `PreviousRun | Window`, `validateConfig`); verify with `OutputCompareSpec`
- [x] 1.2 Add `OutputService.validateConfig` (fieldMapping then compare) and use it in `create` and `update` (merged config); verify via route specs in 4.x
- [x] 1.3 Switch `PatchSetPreviewProjection.outputUpdateAfter` to `OutputService.validateConfig`; verify preview 400 test
- [x] 1.4 Add the compare check inside `PipelineService.validateOutputFieldMapping` (covers single-call create and proposal grounding); verify both 400 tests

## 2. History service and protocol

- [x] 2.1 Add `services/pipelines/OutputHistoryService` (`read`, `forOutput`) per design D3/D4; verify with service spec
- [x] 2.2 Add `api/protocols/pipelines/OutputHistoryProtocol` with explicit-null writers and `OutputHistoryPointResponse` naming (D5) and mix it into `JsonProtocols`; verify `npm run check:schemas`
- [x] 2.3 Add `api/routes/pipelines/OutputHistoryQueryParsing` (limit 1..100 default 30, `since` ISO instant, 400 otherwise)

## 3. Routes, wiring and schemas

- [x] 3.1 Add `GET /api/outputs/:id/history` to `OutputRoutes` (optional service param); verify route spec
- [x] 3.2 Add `GET /api/dashboards/:d/panels/:p/history` to `PublicDashboardRoutes` via `resolvePanelOutput`; verify public spec
- [x] 3.3 Wire `outputHistoryServiceOpt` in `ApiRoutes` (C2); verify `git diff --stat` shows only that hunk there
- [x] 3.4 Add `schemas/outputs/output-history-response.schema.json` and `public-output-history-response.schema.json` (strict, v1 summary `$defs`, previous_run = previous retained point documented); document `config.compare` in create/update request schemas
- [x] 3.5 Add the history endpoints to CLAUDE.md "Key endpoints" and `openspec/config.yaml` endpoint list

### Tests

## 4. Proofs (each red-first, with mutation recorded in evidence)

- [x] 4.1 `OutputCompareSpec`: every valid token, and each invalid case in the spec scenario list, incl. lowercase/signed/W/M/Y/>365d/non-string
- [x] 4.2 Nearest-before red/green with T ≤ now−3d (C7): baseline is T−8d; mutations: now-relative target (→T−6d), earliest-relative target
- [x] 4.3 No-baseline red/green with distinct earliest / earliest+w / current+w: `availableFrom` = earliest+w (mutations: earliest; current+w); empty history → all null
- [x] 4.4 previous_run = second-newest (mutation: newest); single point → baseline and availableFrom null; zero baseline → pct null
- [x] 4.5 `since`/`limit` filtering and 400s; `limit=1` narrows points+sparkline while baseline is unchanged
- [x] 4.6 New `OutputHistoryRoutesSpec` (D7 fixture, `rolsuper OR rolbypassrls` = false asserted first): owner 200, `resource_permissions` viewer grantee 200, non-grantee 404 byte-identical to unknown id (mutation: `findByIdInternal`)
- [x] 4.7 Compare 400 on create, update, preview, single-call pipeline create and proposal grounding; stored config unchanged (mutation per site)
- [x] 4.8 Seam: at least one real-run response per route validates against its schema, incl. explicit-null fields (mutation: drop a null)
- [x] 4.9 Public: anonymous on public dashboard 200 with no runId/triggerSource/ownerId keys; private dashboard, foreign panel and unbound panel 404
- [x] 4.10 `OutputHistoryQueryCountSpec` (C8, counting proxy on both pools): executes equal at 3 vs 150 points, route-scope after auth (D3): authenticated ≤ 7, anonymous public ≤ 9 (mutation: per-point query)
- [x] 4.11 Full gates: `nice -n 19 sbt testFull` green; frontend lint/typecheck/Jest/format via the commit hook; evidence recorded in `evidence.md`
