## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

Backend Context claims in design.md — all re-derived from the worktree tree at `c0821ef9`, by reading call paths:

- `PipelineScheduleRoutes.scala`: `pathPrefix("pipelines" / PipelineIdSegment / "schedule")`, `pathEndOrSingleSlash`, `get`/`put` via `ServiceResponse.run(...)(PipelineScheduleResponse.fromDomain)`, `delete` via `runNoContent`. CONFIRMED.
- `PipelineScheduleProtocol.scala:25` `PutPipelineScheduleRequest(kind, expression, enabled: Option[Boolean], timezone)`, `jsonFormat4` (:50); `PipelineScheduleResponse` 10 fields with `nextRunAt`/`lastRunAt` `Option[String]`, `jsonFormat10` (:49). CONFIRMED.
- `PipelineScheduleService.put` reuses existing `id`/`createdAt`/`lastRunAt`; `cadenceChanged` compares `kind`, TRIMMED `expression`, `timezone` and resets `nextRunAt` to `None`, preserving otherwise; `enabled` = `req.enabled.getOrElse(true)`. CONFIRMED.
- Validation: `ScheduleKind.fromString` accepts exactly `"cron"`/`"interval"` (`domain/model/model.scala:834` — note design cites `model.scala:834`, the real path is `domain/model/model.scala`); cron 5 fields, bounds `(0-59,0-23,1-31,1-12,0-6)`, tokens `*`/`n`/`lo-hi`/`base/step`, comma-separable; interval `^(\d+)(s|m|h|d)$` with `n > 0`; `ZoneId.of` for timezone. CONFIRMED.
- ACL: every method gates on `pipelineRepo.findByIdOwned` → `NotFound("Pipeline not found")`; absent schedule → `NotFound("Pipeline schedule not found")` on both `find` and `delete`. CONFIRMED.
- `UpdateDashboardRequest(name: Option[String], appearance, layout)` at `api/protocols/dashboards/DashboardProtocol.scala:43`, `jsonFormat3` at `:210`; `DashboardServiceValidation.validateDashboardUpdateRequest` trims the name and 400s `"name must not be blank"`. CONFIRMED.
- Zero HTML-entity encoding on the backend write path (`grep escapeHtml|htmlEscape|&amp;` over `backend/src/main/scala` → no hits). CONFIRMED. D8's frontend enumeration is exact: the only `&amp;` in `frontend/src` + `helio-mcp/src` are `MetricBindingFields.tsx:66` and `RefinementChatDrawer.tsx:283`, both literal JSX text. CONFIRMED.

MCP Context claims:

- `httpClient.ts` `get` 97, `post` 102, `patch` 111, `put` 117, `delete<T = void>` 124. CONFIRMED.
- `guarded()` at `write.ts:51` renders `"<name> (status <n>) for <url>: <message>"` with `isError: true`. CONFIRMED — the "surface, not swallow" scenarios need no per-tool handling.
- `update_pipeline` registered at `write.ts:966` (name literal on 967), two `z.string().min(1)`s, one-line delegation. `updateDataSource` `helioApi.ts:890`, `updatePipeline` `:904`, `updateDataType` `:897`, `updatePanel` `:744`. CONFIRMED.
- Full enumeration of registered tool names (derived by enumerating every `server.registerTool(` across `helio-mcp/src/tools/*.ts`, 57 tools): there is no dashboard-rename tool and no pipeline-schedule tool of any kind. The gap the ticket asserts is real. CONFIRMED.

Verification-environment claims — measured, and each reproduced:

- From inside the worktree, `npx jest --listTests` prints NOTHING and exits 0 (reproduced twice). Confirms the HEL-880 corruption.
- `npx jest --listTests` with `--testPathIgnorePatterns` overridden to drop `/.claude/worktrees/` collects 13 helio-mcp suites; the full run is `13 passed, 225 tests passed`.
- `helio-mcp/node_modules` and root `node_modules` both already exist in this worktree.
- **`helio-mcp` has NO jest config and no jest/ts-jest dependency** (`ls helio-mcp/jest.config*` → none; `helio-mcp/package.json` has no `test` script and no jest devDependency). Running `npx jest src/httpClient.test.ts` from `helio-mcp/` FAILS at transform (babel, no ts-jest preset): `Test Suites: 1 failed, Tests: 0 total`. Reproduced.

### Verdict: REFUTE

### Change Requests

1. **tasks.md 1.2 and 11.3 (and design.md "Risks" third bullet) prescribe a test command that does not exist.** They require "helio-mcp's **own** jest config". There is no `helio-mcp/jest.config.*`, no `test` script and no jest dependency in `helio-mcp/package.json`; helio-mcp's tests are collected by the ROOT jest config (`preset: ts-jest`) from the root `node_modules`. Measured: `cd helio-mcp && npx jest src/httpClient.test.ts` fails at transform with 0 tests run. So the plan's sole mitigation for the epic's known gate corruption is unexecutable, and an executor following it will improvise — which is exactly how this corruption recurred twice. Replace with the command I measured green from inside the worktree:
   `npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"` (drops only the `/.claude/worktrees/` entry) — 13 suites / 225 tests pass. Keep the `--listTests`-non-empty proof requirement, and add that **root** `node_modules` must be present (task 1.1 currently requires only `helio-mcp/node_modules`, which is necessary for `tsc` but does not supply jest/ts-jest at all).

2. **design.md D7 and `specs/mcp-edit-in-place-tools/spec.md` assert a tool that does not exist.** D7: "`appearance` has `update_dashboard_appearance`"; the spec text: "The tool SHALL NOT accept `appearance` or `layout` — those already have their own dedicated tools"; proposal.md repeats it. Enumeration of all 57 registered tools shows `update_dashboard_layout` and `auto_layout_dashboard` exist, but there is **no** `update_dashboard_appearance`, and `helioApi.ts` has no dashboard-appearance method (`/api/dashboards/:id` is PATCHed only with `{ layout }` at `:1012`). Dashboard appearance is entirely unexposed over MCP. The name-only decision is still right (it is what the ticket's AC asks for), but its stated justification is false and would be archived into a durable capability spec. Rewrite D7's justification and the spec sentence to be true (layout has its own tool; appearance is deliberately out of scope for this ticket, not already covered), and hand the appearance gap to the orchestrator as a spinoff candidate rather than papering over it.

3. **tasks.md 3.3 contradicts itself and, read literally, yields a broken tool result.** It says to "match `deleteDashboard`'s existing return shape rather than inventing a synthesised payload" — but `deleteDashboard` (`helioApi.ts:952`) *is* a synthesised payload: it `await`s the empty 204 and returns `{ deleted: true, id }` (same for `deletePipeline` `:982`), precisely because `guarded()` does `JSON.stringify(value, null, 2)`, which on `undefined` produces `undefined` (not a string) for the tool's `text`. The two halves of the sentence point at opposite implementations. Resolve explicitly: `deletePipelineSchedule` returns `{ deleted: true, pipelineId }`, matching the sibling convention.

4. **D8's probe as specified cannot falsify the hypothesis D8 itself names, so AC4 can still be closed by assertion.** D8 concedes the enumeration "cannot rule out an encoder in the MCP SDK's own JSON transport or in the calling agent", but task 8.1's probe ("create a dashboard whose name contains `&`, rename it via the `update_dashboard` path, read the name back") does not traverse the MCP SDK transport either — it exercises `helioApi` → HTTP → backend, the exact segment already shown clean by enumeration. Its outcome is therefore predetermined ("a literal `&` survives"), and it would close AC4 with a measurement blind to the suspected cause. Tighten task 8: (a) state unambiguously that the probe must go through the **registered tool handler** and assert on the serialized `CallToolResult` `text`, not through a direct `helioApi` call; (b) exercise the create path as well as the rename path, since the field report's `&amp;` appeared at `apply_proposal`/create time; (c) require the executor's finding to name explicitly which segments were exercised and which (agent client ↔ MCP stdio transport) were NOT, so "did not originate in this repo" is scoped to what was actually measured before the orchestrator files a spinoff on it.

5. **A spec scenario has no covering task.** `specs/mcp-pipeline-schedule-tools/spec.md`, "Deleting an absent schedule is not reported as success" — task 7.5 only asserts that `delete_pipeline_schedule` issues a `DELETE` to the right path. Add a test that a backend 404 from delete surfaces as an error result carrying the backend message (mirroring 7.4), asserting message content, not `isError` alone.

### Non-blocking notes

- D4's decision not to re-validate the cron/interval grammar client-side leaves **no real gap**: I read the whole validation chain, and every rejection (`kind`, expression per kind, timezone) is a `ServiceError.BadRequest` whose message names the offending value, and `guarded()` surfaces it verbatim with its status. The only cost is one round trip. One inconsistency worth noting rather than fixing: `kind` as `z.enum` reintroduces exactly the "Zod message differs from the backend message" asymmetry D4 and D7 elsewhere cite as the reason to avoid client-side checks. The machine-readable-enum benefit is a fine reason to accept it; the document should just not present the two as following the same principle.
- design.md cites `model.scala:834` for `ScheduleKind.fromString`; the file is `backend/src/main/scala/com/helio/domain/model/model.scala`. Line and content are right, path is abbreviated.
- Task 9.1's "request-level trace plus the UI read" is adequate evidence for AC2 given there is provably no MCP-side store (all four planned methods are pure `http.*` pass-throughs).
