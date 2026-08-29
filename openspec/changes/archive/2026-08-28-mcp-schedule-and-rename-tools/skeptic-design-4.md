## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

Round-3's single blocking item (7.3/7.4/7.6 reached module-private `guarded()`) — FIXED, and the fix is executable:

- `grep -n "^export" helio-mcp/src/tools/write.ts` → only `boundPipelineStepSchema` (:42) and `registerWriteTools` (:63).
  `jsonResult` (:47) and `guarded` (:51) remain module-private — so the constraint the fix routes around is real.
- Tasks 7.3/7.4/7.6 now assert at the handler boundary (a `HelioApiError` rejection carrying `status` + the backend's
  message content, explicitly not a bare `rejects.toThrow()`), and explicitly forbid asserting `isError` or the
  `"<name> (status <n>) for <url>: <message>"` wrapper. New task 5.0c and the rewritten D10 paragraph record the same.
- The assertion is achievable against real code: `httpClient.ts:204` throws
  `new HelioApiError(response.status, url, await this.describeError(response))`, and `describeError` returns
  `"<status> <statusText>: <body.message>"` — so a `HelioApiError` genuinely carries both `status` and the backend's own
  text. `HelioApiError` is exported (`httpClient.ts:31`), unlike `guarded`.
- The cited precedent is verbatim real: `pipelineProposalHandlers.test.ts:16-20` says "`guarded`'s `isError`/
  message-formatting behavior is `proposal.ts`/`write.ts`'s existing, already-covered-by-convention logic and is not
  re-tested here". `assertSchemas.ts:100` `addPipelineStepHandler(api, input)` is the exact thin-handler shape task 5.0
  prescribes (returns the api value, throws on failure).

Round-3's two count nits — FIXED and independently re-derived by enumeration, not by reading the doc:

- Unique registered tool names: `perl -0777 -ne 'while(/registerTool\(\s*"([a-z_0-9]+)"/g){print}' src/tools/*.ts | sort -u`
  → **58**. D7 now says 58. Per-file registrations: read.ts 16, write.ts 33, proposal.ts 2, pipelineProposal.ts 3,
  refinement.ts 3, combinedProposal.ts 1 = 58.
- `wc -l src/tools/write.ts` → **1175**; 33 registrations. D10 now says "33-registration, ~1175-line". Correct.
- The gap D7 rests on is real: the enumerated 58 contains `auto_layout_dashboard, create_dashboard, delete_dashboard,
  get_dashboard, list_dashboards, propose_dashboard, replace_dashboard_contents, update_dashboard_layout` — no
  `update_dashboard`, no `update_dashboard_appearance`, no schedule tool. `grep -n schedule src/helioApi.ts` → one
  unrelated comment (:399), no client method.

Backend ground truth re-derived (design "Context" section, spot-audited against code, not accepted as attested):

- `PipelineScheduleRoutes.scala:27-36`: `get`/`put` via `ServiceResponse.run(...)(PipelineScheduleResponse.fromDomain)`;
  `delete` via `ServiceResponse.runNoContent` — so the empty-body/`JSON.stringify(undefined)` reasoning behind D11 and
  task 3.3's synthesised `{deleted:true,pipelineId}` is sound. Siblings confirmed: `helioApi.ts:952` `deleteDashboard`
  and `:982` `deletePipeline` both return `{deleted:true; id}`.
- `PipelineScheduleService.scala`: ACL 404 `"Pipeline not found"` (:36,:51,:100), absent-schedule 404
  `"Pipeline schedule not found"` (:40,:106) — including on DELETE, which is what makes spec scenario "Deleting an
  absent schedule is not reported as success" / task 7.6 a real, non-vacuous test. `nextRunAt = if (cadenceChanged)
  None else existingOpt.flatMap(_.nextRunAt)` (:73) matches the D6/D10 description contract exactly (enabled-only
  toggle preserves the next firing).
- Other cited line refs sampled and correct: `helioApi.ts:744` `updatePanel(patch)`, `:890` `updateDataSource {name}`,
  `:897` `updateDataType(patch)`, `:904` `updatePipeline {name}`, `:1012` dashboard PATCH `{layout}`.
- `scripts/verify.ts:1-45` is the real `Client` + `StdioClientTransport` harness D8/task 8.1 requires, and
  `package.json` has both `build` and `verify` scripts. Task 8 is executable as written.

Verification-environment claim — MEASURED, not accepted:

- `npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"
  --listTests` from the worktree root lists **13 suites**, non-empty. Matches tasks 1.2 / the design's Risks section.
- Both `node_modules` and `helio-mcp/node_modules` exist in the worktree (task 1.1's precondition already holds).

### Verdict: CONFIRM

Every claim I sampled re-derives from code, the one round-3 blocker is closed with an executable substitute rather than
a wording patch, and I found no remaining hole that would force mid-cycle improvisation. Executing this plan is now the
cheapest way to learn anything further.

### Non-blocking notes

1. Tasks 7.3/7.4/7.6 will, following the `context.test.ts`/`pipelineProposalHandlers.test.ts` fake-`HelioApi` precedent,
   have the test itself construct the `HelioApiError` the mock rejects with. That proves the handler does not SWALLOW or
   convert the error — which is exactly what the tasks claim — but it does not prove `describeError`'s message
   composition. That segment is pre-existing, is covered by `helioApi.test.ts`'s fetch-injection harness, and is
   re-exercised end-to-end by section 8. Worth stating in the test file header so a later reader does not overread it.
2. Task 8.2 exercises the create path via `create_dashboard`, but the field report's `&amp;` was observed at
   `apply_proposal` time. Same stdio transport, so the suspected segment is still traversed; if the probe comes back
   clean, adding one `apply_proposal`-shaped call would make the scoped finding of task 8.3 materially stronger.
3. Tasks 9.1/9.2 still name evidence ("request-level trace plus the UI read") rather than a mechanism. Acceptable given
   all four planned client methods are pure `http.*` pass-throughs with no MCP-side store, but the section-8 stdio run
   is the natural single place to capture 9.1/9.2 too.
4. Section 6 tests three of the many contract claims D6/task 5.5 require in the descriptions (kind values + interval
   units; the 404 case; no appearance/layout advertising). The untested claims — cron field order, the `nextRunAt` reset
   asymmetry — are the ones the design's own Risks section calls "easy to state wrongly". Cheap to add an assertion for
   the reset asymmetry while writing 6.1.
