## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed `git diff cd6e9a2d~1..HEAD` (commits `cd6e9a2d` CR1-6, `4b950542`
verification evidence) on top of the cycle-1 review in `evaluation-1.md`.

### Gates — re-run independently by me

| Gate | Result |
| --- | --- |
| helio-mcp jest (corrected scoped command) | **18/18 suites, 182/182 tests** — clean, no `dist/` noise |
| Backend `sbt -batch 'set Test/parallelExecution := false' test` | **3519/3519, 235 suites, 0 failures** |
| Frontend `cd frontend && npm test` | **275 suites / 2969 tests pass** |
| `npm run lint` / `format:check` / `typecheck` | pass |
| `helio-mcp` `tsc -p tsconfig.typecheck.json` | pass |
| `node scripts/check-schema-drift.mjs` | pass (73 schemas / 48 protocol files) |
| `npm --prefix frontend run build` | pass |

`ticket.md:72`'s canonical command now carries
`"testPathIgnorePatterns":["/node_modules/","/dist/"]` — non-blocking #1 from
evaluation-1 is closed, and P1.5–P1.7 inherit the corrected command.

### Phase 1: Spec Review — PASS

All six change requests verified as landed, against the code and the live
database rather than the executor's account:

- **CR1 (stale tool guidance) — closed.** Re-ran my own class sweep over
  `helio-mcp/src/**`, `scripts/**`, `README.md`, `e2e/**`, `docs/agent-native.md`.
  Every surviving mention of a removed tool is now either the `REMOVED_TOOLS`
  fixture in `server.test.ts` or "replaces the retired X" phrasing
  (`placements.ts:40`, `pipelines.ts:95`, `outputs.ts:149`, `verify.ts:97,152`),
  which is correct and actively useful to an agent with stale memory. Zero
  remaining instructions to *call* a removed tool.
- **CR2 (scripts) — closed.** `compose.ts` and `verify-bound-panel.ts` deleted
  outright with their `package.json` scripts; `verify.ts` retargeted onto
  `list_outputs`/`get_output_rows`/`add_outputs_from_shape`; `README.md` and
  `docs/agent-native.md` updated. No orphaned deferral left unowned.
- **CR3 (dashboard leak) — closed at the root cause, and verified live by me.**
  Independent `psql` check of the shared dev DB:
  - the 8 orphaned dashboards I found in cycle 1 are **gone** (`0 rows` for all
    four Sleeper names);
  - `select count(*) filter (where tag is not null) from dashboards` → **0
    tagged rows** across all 533 dashboards, i.e. no residue from the
    re-verification runs either;
  - `flyway_schema_history` shows **V95 `dashboard tag` applied, success = t**;
  - no `api_tokens` row newer than 2026-08-29 — the re-verification PAT was
    revoked too.
  The executor's own before/mid/after evidence table is corroborated, not just
  restated.
- **CR4 (exact tool set) — closed.** `server.test.ts:55` now defines
  `EXPECTED_TOOL_NAMES` (60 tools) and `:179` asserts
  `expect([...names].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort())`. The AC's
  "test asserts the exact tool-name set" is now literally true, and the header
  comment no longer overstates the code.
- **CR5 (`docs/agent-native.md` staleness) — closed.** The "End-to-end proof"
  section now describes the run that actually happened, retains the honest
  static-source caveat, and documents the script deletions/retargeting.
- **CR6 (`types.ts` ProposalPanel doc) — closed.** The block now says
  metric/chart/table/collection/timeline kinds are retired, that
  `metricId`/`aggregation`/viz fields are "decoded but never applied" legacy,
  and that a text/markdown `config.dataTypeId` is "silently inert, NOT a real
  binding attempt" — matching `dashboard-proposal.schema.json` instead of
  contradicting it.

Scope check on the V95 expansion: adding `dashboards.tag` is a migration this
ticket did not plan, but it is the correct root-cause fix for CR3 (rather than
papering over it with a `delete_dashboard`-per-id `finally` block), it is
strictly additive, and it completes HEL-366's tagging convention rather than
inventing a new one. I checked for the shared-dev-DB Flyway collision hazard:
`V95` exists in **no** other live worktree and not on `main`, so there is no
version collision to resolve before merge.

### Phase 2: Code Review — FAIL (one issue)

The V95 stack is well-built: `domainToRow`/`rowToDomain` both thread `tag`, so
existing update paths round-trip it rather than silently nulling it; the Slick
`Tag` shadowing was correctly resolved by renaming the parameter to `slickTag`;
every new case-class field is appended-last-and-defaulted with the reason
stated; `WorkspaceTeardownRepository`'s comment explains *why* dashboards need
no out-of-batch conflict check (nothing FK-references a dashboard the way a
Pipeline references its source; panels cascade via V2's own FK) rather than
just asserting it; and the new `WorkspaceTeardownServiceSpec` case carries a
negative control (an untagged dashboard that must survive).

Issue — see CR1 below.

### Phase 3: UI Review — N/A

**Stated explicitly, not skipped.** Unchanged from cycle 1: the ticket declares
the UI gate N/A (backend/MCP only). This cycle touched no frontend source at
all (the only frontend-adjacent effect is `DashboardProtocol`, covered by
schema-drift + 2969 green frontend tests + a clean production build). No dev
servers were started.

### Overall: FAIL

One issue, one line to fix. Everything from cycle 1 is genuinely closed.

### Change Requests

1. **`POST /api/dashboards` skips the canonical tag validation, so an
   over-length tag becomes a 500 instead of a curated 400.**
   `backend/src/main/scala/com/helio/api/http/RequestValidation.scala:105-115`
   defines `validateTag`, and its own doc comment states its purpose: it
   "mirrors the DB `CHECK (length(tag) <= 200)` (V73) so an over-length tag
   surfaces as a curated 400 **before it ever reaches the DB constraint**."
   Every other taggable resource calls it —
   `DataSourceService.scala:103,164,228,305,396,476` and
   `PipelineService.scala:114`. `DashboardService.createDashboard`
   (`backend/src/main/scala/com/helio/services/dashboards/DashboardService.scala:83-110`)
   already imports `RequestValidation` and uses it for `normalizeDashboardName`,
   but passes `request.tag` straight through to `insertNew` unvalidated. V95's
   `CHECK (length(tag) <= 200)` then rejects it at the DB — a 500 on an input
   class the repo has a purpose-built 400 for.
   The MCP path happens to be safe (`write.ts:351` caps at
   `z.string().min(1).max(200)`), which is exactly why no test caught this: the
   raw REST boundary is the unguarded one.
   Fix: gate on `RequestValidation.validateTag(request.tag)` in
   `createDashboard`, in the same `Either` style the sibling services use, and
   add a route-level test asserting a 201-char tag returns 400 (not 500) —
   mirroring whatever `DataSourceService`'s existing over-length-tag test does.

### Non-blocking Suggestions

- `create_dashboard` with `ifExists:"return"` silently ignores a supplied `tag`
  when it returns a pre-existing dashboard (tag is create-time-only). The tool
  description at `helio-mcp/src/tools/write.ts:345-347` says "set only at create
  time," which covers it, but
  `schemas/dashboards/create-dashboard-request.schema.json:16-21`'s `tag`
  description does not mention the `ifExists` interaction. One clause there
  would close the gap for a non-MCP caller.
- `TeardownOutcome.dashboardsDeleted: Int = 0`
  (`WorkspaceTeardownRepository.scala:162`) is a *computed* field carrying a
  default purely for positional source-compatibility. Harmless today (the one
  construction site does set it), but a defaulted computed field is the kind of
  thing that later silently reports 0 if a new construction path forgets it.
  Consider dropping the default once the fixtures are updated.
- Carry-over from evaluation-1, still worth recording in `ticket.md` for
  P1.5–P1.7: root `jest.config.cjs` excludes `/frontend/` outright, so
  `cd frontend && npm test` is the only real frontend evidence — root
  `npm test` is vacuous for both helio-mcp (inside a worktree) and the frontend
  (always).
