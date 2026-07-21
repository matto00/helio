# Files Modified — HEL-321 (timeline-proposal-flat-binding)

## Source

- `backend/src/main/scala/com/helio/api/protocols/DashboardProposalProtocol.scala` — added optional flat `sort: Option[String]` to `ProposalPanel` case class with matching read/write in the custom formatter (mirrors the other optional string fields).
- `backend/src/main/scala/com/helio/api/RequestValidation.scala` — added `validateTimelineSort(sort)` backed by `TimelineOptions.ValidSorts` (referenced, not duplicated), mirroring `validateChartType`/`validateDividerOrientation`.
- `backend/src/main/scala/com/helio/services/DashboardProposalService.scala` — validate `sort` in `validatePanel` for `type == "timeline"` (fails `validateStructure` before any creation); in `buildDataConfig`, nest a defined flat `sort` as `timelineOptions -> { sort }` in the derived config (NOT a flat key). `mergeConfig` untouched so explicit `config.timelineOptions` still wins. Added `TimelineKind` constant.
- `schemas/dashboard-proposal.schema.json` — added optional `sort` property (`enum ["asc","desc"]`, description) to `ProposalPanel`; updated the `config` description so it no longer implies `config` is required for timeline sort. Keeps `check:schemas` (case-class ↔ schema parity) green.
- `helio-mcp/src/types.ts` — added `sort?: "asc" | "desc"` to the `ProposalPanel` interface.
- `helio-mcp/src/tools/proposal.ts` — added `sort: z.enum(["asc","desc"]).optional()` to `panelSchema`; updated the `timeline` bullet in the `propose_dashboard` description to present `sort` as a flat field (noting `config.timelineOptions` overrides).

## Tests

- `backend/src/test/scala/com/helio/api/DashboardApplyProposalSpec.scala` — 4 new tests: flat-fields-only timeline (sort defaults to `asc`); flat `sort:"desc"` → `config.timelineOptions.sort == "desc"`; invalid `sort` → 400 with nothing created; explicit `config.timelineOptions.sort` overrides flat `sort`.
- `backend/src/test/scala/com/helio/api/protocols/DashboardProposalProtocolSpec.scala` — added `sort` to the `panel(...)` helper and 5 read/write tests (omit when absent, emit when present, tolerate absent on read, read present, round-trip).

## Gate results (fresh)

- `cd backend && sbt test` → `Tests: succeeded 1470, failed 0` — `[success]`.
- `npm run check:schemas` (repo root) → `schemas in sync with JsonProtocols (10 checked …)` / `panel-type enums in sync (7 surfaces checked)`.
- `cd helio-mcp && npm run build` → exit 0 (after `npm install`; the worktree shipped without `helio-mcp/node_modules`, so `tsc` initially could not resolve `@modelcontextprotocol/sdk` types — installing deps resolved it).
- `npm run lint` (repo root) → exit 0 (eslint `--max-warnings=0`).
- `npm run format:check` (repo root) → `All matched files use Prettier code style!` exit 0.

## Not done by executor

- Task 4.2 (live in-app / MCP round-trip against a running dev server) requires standing up backend+frontend and a PAT (`helio-mcp` `npm run verify` needs `HELIO_PAT`). The apply-proposal HTTP route IS exercised end-to-end by `DashboardApplyProposalSpec` against embedded Postgres, but the live UI/MCP round-trip is left for the evaluator/skeptic per the change's Planner Notes.
