# Files Modified — HEL-863

## Cycle 3 (skeptic-final-1.md CR1 — the drift guard didn't actually detect drift)

- `helio-mcp/src/tools/scheduleTools.test.ts` — the `4a0d4f4c` drift-guard test's name/comment
  claimed to catch a field added or renamed on the Scala side, but its expected set was a frozen
  TS array literal: nothing in the test read the Scala source, so an 11th Scala field or a Scala
  rename would leave the (now-stale) description and the (equally stale) test literal still
  agreeing — GREEN, despite the claim being false. Implemented skeptic-final-1.md's option (a):
  added `extractCaseClassFields(scalaSource, className)`, a small regex-based parser (one
  `readFileSync` + one regex, as suggested), and rewrote the test to derive the expected field set
  by reading `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineScheduleProtocol.scala`
  and parsing `PipelineScheduleResponse`'s actual case-class fields, instead of a hardcoded list.
  Guarded against a silently-empty derived set (a moved/renamed class) with an explicit
  `length > 0` assertion before comparing. Added four unit tests for `extractCaseClassFields`
  itself, including one fabricated "added field" case and one fabricated "renamed field" case, to
  prove the parser's own add/rename sensitivity without ever touching `backend/**` in those cases.

Red-on-revert transcript, BOTH directions, against the real files (not fabricated strings),
exactly as required — each mutation applied to a REAL file (`scheduleTools.ts` or the real Scala
protocol file, never committed), run, and reverted with a clean `git diff` before continuing:

**(i) Dropped `lastRunAt` from the real description** (`scheduleTools.ts`, reverted after):
```
● get_pipeline_schedule's field enumeration names every field the LIVE PipelineScheduleResponse case class carries (parsed from the Scala source, not a hand-maintained snapshot)
  expect(received).toContain(expected)
  Expected substring: "lastRunAt"
  Received string: "...Returns the full schedule record: id, pipelineId, kind ("cron"|"interval"), expression, enabled, timezone, nextRunAt, createdAt, updatedAt."
Tests: 1 failed, 19 skipped, 20 total
```

**(ii) Added an 11th field (`runCount: Int`) to the REAL `PipelineScheduleProtocol.scala`**
(reverted after — `git status --short backend/` empty post-revert):
```
● get_pipeline_schedule's field enumeration names every field the LIVE PipelineScheduleResponse case class carries
  expect(received).toEqual(expected)
  + Received + 1
  ...
  +   "runCount",
Tests: 1 failed, 19 skipped, 20 total
```

Post-revert (both files clean, confirmed by `git diff`/`git status`): the full test file is
20/20 passing again; full suite 14 suites / 250 tests (see gate results below). This closes the
final gate's one change request; no further defects were reported in the other three descriptions,
the probe evidence, or any of the other 19 tests in this file.


## Cycle 2b (evaluation-2.md non-blocking note, closed proactively)

- `helio-mcp/src/tools/scheduleTools.ts` — `GET_PIPELINE_SCHEDULE_DESCRIPTION` claimed to return
  "the full schedule record" but enumerated only 8 of the 10 `PipelineScheduleResponse` fields,
  omitting `id`/`pipelineId`. Re-derived the field list from
  `backend/src/main/scala/com/helio/api/protocols/pipelines/PipelineScheduleProtocol.scala`'s
  `jsonFormat10` directly (not from the plan) and added the two missing fields. Also re-checked
  `SET_PIPELINE_SCHEDULE_DESCRIPTION`/`DELETE_PIPELINE_SCHEDULE_DESCRIPTION`/
  `UPDATE_DASHBOARD_DESCRIPTION` against their actual accept/return shapes the same way — no
  further defects found (`delete_pipeline_schedule`'s `{ deleted: true, pipelineId }` claim and
  `update_dashboard`'s "the updated dashboard" claim are both accurate as written; neither of the
  other two descriptions enumerates fields it could get wrong).
- `helio-mcp/src/tools/scheduleTools.test.ts` — added a drift-guard test asserting
  `GET_PIPELINE_SCHEDULE_DESCRIPTION` names every field `PipelineScheduleResponse` actually
  carries (all ten, hardcoded from the same Scala source, not the plan), so a future backend field
  add/rename that isn't mirrored in the description fails a test instead of shipping a stale "full
  record" claim.

Red-on-revert transcript for the new drift-guard test (temporarily dropped `id`/`pipelineId` from
the description, ran the test, then reverted to the real fix):

```
  ● description contracts (standing requirement 4 — wording is behaviour) › get_pipeline_schedule's field enumeration names every field PipelineScheduleResponse actually carries

    expect(received).toContain(expected) // indexOf

    Expected substring: "pipelineId"
    Received string:    "Read a pipeline's refresh schedule (GET /api/pipelines/:id/schedule). A pipeline with NO schedule configured returns a 404 (surfaced as a tool error), NOT an empty/null result — absence of a schedule is not the same as success with nothing to report. Returns the full schedule record: kind (\"cron\"|\"interval\"), expression, enabled, timezone, nextRunAt, lastRunAt, createdAt, updatedAt."

Test Suites: 1 failed, 1 total
Tests: 1 failed, 15 passed, 16 total
```

Post-revert (the real, field-complete description restored): 16/16 passing in this file; full suite
14 suites / 246 tests (see gate results below).


## Cycle 2 (evaluation-1.md change requests)

- `helio-mcp/src/helioApi.ts` — CR1: `deletePipelineSchedule`'s doc comment claimed
  `JSON.stringify(undefined, null, 2)` "yields the string `"undefined"`". Measurably false — it
  yields the value `undefined`, not a string. Corrected to match `design.md` D11's wording. No
  behaviour change.
- `helio-mcp/src/tools/scheduleTools.test.ts` — CR2: the "update_dashboard does not advertise
  appearance or layout" test's regexes (`/accepts?\s+appearance/i`, `/accepts?\s+layout/i`) could
  never match the description's own backticked style, so the guard was dead against exactly the
  failure it names (field-report issue #7). Replaced with backtick/quote-tolerant, negation-aware
  patterns (`/(?<!not )accepts?\s+[\`'"]?appearance/i`, same for `layout` — the negative lookbehind
  excludes the description's own legitimate "does not accept `appearance`" wording). Proved by
  behavioural mutation: temporarily changed `UPDATE_DASHBOARD_DESCRIPTION` to
  `"...Accepts \`appearance\` too...."`, confirmed the test failed RED (see transcript below), then
  reverted — `git diff` on `scheduleTools.ts` is empty, confirming the revert is exact.

Red-on-revert transcript for CR2 (mutated `UPDATE_DASHBOARD_DESCRIPTION`, test run, then reverted):

```
  ● description contracts (standing requirement 4 — wording is behaviour) › update_dashboard does not advertise appearance or layout as accepted fields

    expect(received).not.toMatch(expected)

    Expected pattern: not /(?<!not )accepts?\s+[`'"]?appearance/i
    Received string:      "Rename an existing dashboard (PATCH /api/dashboards/:id). Accepts `appearance` too. layout has its own dedicated tools (update_dashboard_layout, auto_layout_dashboard). The dashboard's id is unchanged by a rename, so any saved link built from the id keeps resolving. Returns the updated dashboard."

Test Suites: 1 failed, 1 total
Tests:       1 failed, 14 passed, 15 total
```

Post-revert, same file: 15/15 passing again (see full-suite gate results below).

## Cycle 1

- `helio-mcp/src/types.ts` — added `PipelineScheduleResponse` (jsonFormat10 mirror) and
  `PutPipelineScheduleRequest` wire types.
- `helio-mcp/src/helioApi.ts` — added `getPipelineSchedule`, `setPipelineSchedule`,
  `deletePipelineSchedule`, `updateDashboard` client methods.
- `helio-mcp/src/tools/scheduleTools.ts` — new zod-free module: `buildSetPipelineScheduleBody`,
  the four tool description constants, and the four thin handlers. Imported by `write.ts`;
  imported by tests instead of `write.ts` to avoid the OOM.
- `helio-mcp/src/tools/scheduleTools.test.ts` — body-builder, description-contract, and
  handler call-routing/error-propagation tests.
- `helio-mcp/src/tools/write.ts` — registers `get_pipeline_schedule`, `set_pipeline_schedule`,
  `delete_pipeline_schedule`, `update_dashboard` tools.
- `helio-mcp/src/helioApi.test.ts` — added transport-level (path/method/body-shape) tests for
  the four new `HelioApi` methods.
- `openspec/changes/mcp-schedule-and-rename-tools/tasks.md` — all tasks marked complete.

## Verification evidence

Baseline (pre-change) test command (`npx jest helio-mcp --testPathIgnorePatterns
"/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"`): 13 suites / 225 tests
passing, `--listTests` confirmed non-empty.

Post-change, same command: **14 suites / 245 tests passing**, `--listTests` confirmed non-empty
(14 files listed).

`tsc --noEmit` (helio-mcp): clean, exit 0, with `helio-mcp/node_modules` and root `node_modules`
both confirmed present beforehand.

`eslint --max-warnings=0` on every changed/new file: clean. `prettier --check` on every
changed/new file: clean (after one `--write` pass on the two new files).

Red-on-revert (behavioural mutation, not compile-error revert), all recaptured on the final code:

1. `buildSetPipelineScheduleBody` mutated to always include `enabled` — the omit-key test in
   `scheduleTools.test.ts` and the no-`enabled`-key test in `helioApi.test.ts` both failed red;
   reverted, green again.
2. `HelioApi.updateDashboard` mutated to send an extra `layout: null` key — the exact-body-shape
   test in `helioApi.test.ts` failed red; reverted, green again.
3. `SET_PIPELINE_SCHEDULE_DESCRIPTION`'s interval-unit-set wording mutated (`s/m/h/d` to `units`)
   — the description-contract test failed red; reverted, green again.
4. `getPipelineScheduleHandler` mutated to swallow a `HelioApiError` and resolve to `null` instead
   of rejecting — the 404-propagation test failed red; reverted, green again.

## Task 8 — the `&` round-trip probe (live stdio transport)

Ran a stdio-transport probe (`Client` + `StdioClientTransport` against the BUILT server,
`npm run build` first) against a real dev backend started on `BACKEND_PORT=9202`
(`PORT=9202 sbt run`, Postgres already running) with a freshly minted PAT
(`POST /api/tokens` after a real login as `matt@helio.dev`). Full transcript captured
at `/tmp/claude-1000/-home-matt-Development-helio/09baaa55-47c0-49c1-b0f3-c037315c6d3d/scratchpad/hel863-probe-output.txt`
(not part of the repo — scratch evidence).

Exercised, through the registered tool → `guarded()` → real HTTP → real backend → real
stdio JSON-RPC response, and back through the SDK `Client`:

- `get_pipeline_schedule` on a pipeline with no schedule → `isError: true`, 404,
  `"Pipeline schedule not found"` (matches D6's description claim).
- `set_pipeline_schedule` with `enabled` omitted → created, `enabled: true`.
- A second `set_pipeline_schedule` call for the SAME pipeline with only `enabled: false` →
  same schedule `id` (genuine upsert), `enabled: false`.
- A third call changing `expression` → same `id`, new `expression` (both `nextRunAt` values were
  `undefined` throughout this run because HEL-415's scheduler *runtime* — which is what actually
  computes `nextRunAt` — is out of scope here and was never started; the reset-vs-preserve
  *semantics* is covered instead by the description-contract unit test and by reading
  `PipelineScheduleService.put`, not by this probe. Scoped explicitly, not overclaimed).
- `delete_pipeline_schedule` → `{ deleted: true, pipelineId }`; calling it again on the same
  pipeline → `isError: true`, 404 (not a silent success — closes the spec scenario task 7.6 names).
- `create_dashboard` with name `"Sales & Revenue"` → the tool result's `name` field, read back
  through the real stdio JSON-RPC channel, is the literal string `"Sales & Revenue"` (verified via
  both string equality and a raw UTF-8 hex dump of the returned bytes — no `&amp;`, no other escape).
- `update_dashboard` renaming that dashboard to `"Marketing & Ops & Finance"` → literal `&`
  survives, and the dashboard `id` is unchanged (closes acceptance criterion 3 for id/link
  survival, and the `&` half of criterion 4 for the rename path).
- `apply_proposal` with `dashboardName: "Q3 Revenue & Growth"` (the field report's actual
  create-time scenario, not just rename) → literal `&` survives in the returned dashboard's
  `name`.

**Finding (D8, scoped per task 8.3): every segment this repo can reach — the registered tool
handler, `guarded()`'s JSON-text serialization, the real `@modelcontextprotocol/sdk` stdio
`Client`/`StdioClientTransport` JSON-RPC round trip, the real HTTP call, and the real backend —
preserves a literal `&` with zero HTML-entity encoding, at both create time (`create_dashboard`,
`apply_proposal`) and rename time (`update_dashboard`). The only segment not reachable from this
repo is the calling agent's own MCP client (outside this codebase). No spinoff is warranted from
this repo's side; per the ticket's own instruction the executor has no Linear tooling regardless,
so if the field report's actual client-side agent turns out to be the cause, that is a question
for whichever agent/client produced the original `&amp;`, not this MCP server.**

Acceptance criteria 2/3 (task 9) were captured in the same run: `set_pipeline_schedule` and
`get_pipeline_schedule` round-tripped through the exact same `PUT`/`GET
/api/pipelines/:id/schedule` routes the pipeline-schedule-config UI reads (single backend
resource — verified by reading `PipelineScheduleRoutes.scala`/`PipelineScheduleService`, which is
the one and only implementation; the MCP layer holds no cache or second store of its own), and
`update_dashboard`'s rename preserved the dashboard `id` (`id-preserved: true` in the transcript).

Cleanup: all probe-created resources (data source, pipeline, both dashboards) were deleted via
their own MCP delete tools at the end of the run. The dev backend on port 9202 and its login
session/PAT remain running for this worktree's future use; no production system was touched.
