# Tasks — HEL-863

## 1. Verification environment (do this FIRST — two gate corruptions this epic traced to skipping it)

- [x] 1.1 Confirm BOTH dependency trees exist on disk before reporting any typecheck or test exit code:
      `helio-mcp/node_modules` (what `tsc --noEmit` needs — a dependency-less worktree emits implicit-any noise that
      masked five real TS2532 regressions for a whole cycle) AND the worktree-ROOT `node_modules`, which is what
      actually supplies jest and ts-jest. The orchestrator installed both; verify, do not assume.
- [x] 1.2 Use this exact test command — there is NO `helio-mcp/jest.config.*`, no `test` script and no jest
      dependency in `helio-mcp/package.json`; helio-mcp's suites are collected by the ROOT `jest.config.cjs`
      (`preset: ts-jest`), and `npx jest` run from inside `helio-mcp/` fails at transform with zero tests run:

          npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"

      That drops only the `/.claude/worktrees/` entry. Measured green on the unmodified branch: 13 suites, 225 tests.
      Prove collection is non-empty (`--listTests` showing a non-empty list) EVERY time before trusting a green line:
      plain `npx jest` from inside a worktree prints nothing and exits 0, because the root config's unanchored
      `"/.claude/worktrees/"` matches every test's absolute path. Do NOT fix that defect here (HEL-880). Beware
      argument order: a bare positional path placed AFTER `--testPathIgnorePatterns` is swallowed as a further ignore
      pattern.

- [x] 1.3 Provision the live-backend dependency the section-8 probe needs, since nothing else in this plan requires
      one: the dev backend running on this worktree's assigned backend port, plus a valid `HELIO_PAT` and
      `HELIO_API_BASE_URL` for the stdio harness. If a PAT cannot be obtained, stop and escalate rather than
      substituting an in-process call — task 8 is the only thing that closes acceptance criterion 4.

## 2. Wire types

- [x] 2.1 Add `PipelineScheduleResponse` to `helio-mcp/src/types.ts` mirroring the Scala `jsonFormat10` exactly:
      `id, pipelineId, kind, expression, enabled, timezone` required; `nextRunAt, lastRunAt` optional;
      `createdAt, updatedAt` required.
- [x] 2.2 Add the `PUT` body type with `kind`, `expression`, `timezone` required and `enabled` optional.

## 3. `helioApi` client methods

- [x] 3.1 `getPipelineSchedule(pipelineId)` → `GET /api/pipelines/:id/schedule`.
- [x] 3.2 `setPipelineSchedule(pipelineId, body)` → `PUT /api/pipelines/:id/schedule`, taking an already-built body
      (the `updateDataType`/`updatePanel` convention), returning `PipelineScheduleResponse`.
- [x] 3.3 `deletePipelineSchedule(pipelineId)` → `DELETE /api/pipelines/:id/schedule`, returning
      `{ deleted: true, pipelineId }`. The route uses `ServiceResponse.runNoContent`, so the success body is empty,
      and `guarded()` does `JSON.stringify(value, null, 2)` — which on `undefined` yields `undefined` rather than a
      string, producing a broken tool result. A synthesised payload is therefore REQUIRED here, not avoided: this
      matches the sibling convention `deleteDashboard` (`helioApi.ts:952`) and `deletePipeline` (`:982`), both of
      which await the empty 204 and return `{ deleted: true, id }` for exactly this reason.
- [x] 3.4 `updateDashboard(dashboardId, name)` → `PATCH /api/dashboards/:id` with `{ name }` inline, mirroring
      `updateDataSource` (`helioApi.ts:890`) and `updatePipeline` (`:904`).
- [x] 3.5 Each method gets a doc comment naming the route and, for `setPipelineSchedule`, the upsert semantics.

## 4. Body builder + its unit tests

- [x] 4.1 Add a `buildSetPipelineScheduleBody` helper alongside the existing builders (`updateSchemas.ts` convention)
      that includes `enabled` in the body ONLY when the argument is `!== undefined` (design D5), and always includes
      `kind`, `expression`, `timezone`.
- [x] 4.2 Test: omitting `enabled` produces a body with NO `enabled` key — assert key absence via `"enabled" in body`
      / `Object.keys`, not `toBeUndefined()`, which cannot discriminate an absent key from an explicit `undefined`.
- [x] 4.3 Test: `enabled: false` IS included and is `false` — the arm that a naive truthiness check would drop.
- [x] 4.4 Test: `enabled: true` is included as `true`.

## 5. Extraction module + MCP tool registration

- [x] 5.0 Create `helio-mcp/src/tools/scheduleTools.ts` (zod-free) exporting: the four tool DESCRIPTIONS as string
      constants, and the thin handlers (`getPipelineScheduleHandler`, `setPipelineScheduleHandler`,
      `deletePipelineScheduleHandler`, `updateDashboardHandler`), each taking a `HelioApi`. `write.ts` imports and
      registers them. This is FORCED, not stylistic: importing `write.ts` from a test kills node with a heap OOM at
      4 GB (design D10), which is why all six existing helio-mcp test files import narrow modules like
      `assertSchemas.ts`/`metricSchemas.ts` instead. EVERY test in sections 6, 7 and 8 imports `./scheduleTools.js`
      and NEVER `./write.js`.
- [x] 5.0b Note and accept the first consequence: the Zod `inputSchema` shapes stay at the `registerTool` call in
      `write.ts` and therefore cannot be unit-tested by this route. Their correctness rests on the typecheck and on
      review. Do not write a task or a claim implying they are test-covered.
- [x] 5.0c Note and accept the second consequence: `guarded()` is likewise out of unit-test reach. It is
      module-private to `write.ts` (`write.ts:51`), and five further near-identical private copies exist
      (`read.ts:23`, `proposal.ts:103`, `pipelineProposal.ts:41`, `refinement.ts:48`, `combinedProposal.ts:38`) —
      none exported. So NO unit test may assert on `isError` or on the
      `"<name> (status <n>) for <url>: <message>"` wrapper string. Error tests assert at the HANDLER boundary
      instead (a `HelioApiError` rejection carrying `status` and the backend's message), exactly as
      `pipelineProposalHandlers.test.ts:16-20` already documents: `guarded`'s wrapping is existing,
      covered-by-convention logic, re-verified end-to-end only by the section-8 stdio probe.

### Registration in `write.ts`

- [x] 5.1 Register `get_pipeline_schedule` — `{ pipelineId: z.string().min(1) }`, delegating through `guarded`.
- [x] 5.2 Register `set_pipeline_schedule` — `pipelineId`, `kind: z.enum(["cron","interval"])`,
      `expression: z.string().min(1)`, `timezone: z.string().min(1)`, `enabled: z.boolean().optional()`.
      No client-side expression grammar re-validation (design D4).
- [x] 5.3 Register `delete_pipeline_schedule` — `{ pipelineId: z.string().min(1) }`.
- [x] 5.4 Register `update_dashboard` — `{ dashboardId: z.string().min(1), name: z.string().min(1) }`, name-only
      (design D7).
- [x] 5.5 Write the four descriptions to the contract in design D6/D7: the two `kind` values; the 5-field cron shape
      with field order (minute hour day-of-month month day-of-week); the `<n><unit>` interval shape with unit set
      `s/m/h/d` and `n > 0`; `timezone` as an IANA zone id; that omitting `enabled` yields an enabled schedule; that
      `set_pipeline_schedule` creates-or-replaces keeping the schedule id; that changing kind/expression/timezone
      resets the next firing while toggling `enabled` alone preserves it; that a pipeline with no schedule is a 404
      rather than an empty result; that `update_dashboard` is name-only and preserves the dashboard id. No
      description may claim validation the tool does not perform.

## 6. Description-contract tests (standing requirement 4 — wording is behaviour)

These import the exported description constants from `./scheduleTools.js` (task 5.0). Importing `./write.js` OOMs.

- [x] 6.1 Assert `set_pipeline_schedule`'s description names both `kind` values and all four interval units, so a
      future backend grammar change landing without a description update fails a test instead of misleading an agent.
- [x] 6.2 Assert `get_pipeline_schedule`'s description states the no-schedule case is a 404.
- [x] 6.3 Assert `update_dashboard`'s description does not advertise `appearance` or `layout` (field-report issue #7
      was caused by a tool advertising a field it did not accept).
- [x] 6.4 Assert `set_pipeline_schedule`'s description states the `nextRunAt` reset ASYMMETRY — that changing
      kind/expression/timezone resets the next firing while toggling `enabled` alone preserves it. The design's own
      Risks section names this as the claim easiest to state wrongly, and it is untested by 6.1-6.3.

## 7. Tool-behaviour tests

- [x] 7.1 `set_pipeline_schedule` with no `enabled` issues a `PUT` to the right path whose body has no `enabled` key.
- [x] 7.2 `set_pipeline_schedule` twice against the same pipeline issues two `PUT`s to the SAME path (upsert, not a
      create/update fork) — assert the request path and method, not merely that a call happened.
- [x] 7.3 A backend 400 from `set_pipeline_schedule` propagates out of the handler: assert the handler REJECTS with a
      `HelioApiError` whose `status` is 400 and whose `message` contains the backend's own text. Assert the status and
      the message CONTENT — never a bare `rejects.toThrow()`. Do NOT assert on `isError` or on the
      `"<name> (status <n>) for <url>: <message>"` string: those are produced by `guarded()`, which is module-private
      to `write.ts` and unimportable (task 5.0c).
- [x] 7.4 A backend 404 from `get_pipeline_schedule` propagates out of the handler rather than being converted into a
      success value: assert a `HelioApiError` rejection with `status` 404 and the backend's message content.
- [x] 7.5 `delete_pipeline_schedule` issues a `DELETE` to the right path and returns `{ deleted: true, pipelineId }`
      — assert the returned payload, not just the request.
- [x] 7.6 A backend 404 from `delete_pipeline_schedule` propagates out of the handler rather than resolving to a
      success value (mirroring 7.4): assert a `HelioApiError` rejection with `status` 404 and the backend's message
      content. This covers the spec scenario "Deleting an absent schedule is not reported as success", which no other
      task covers.
- [x] 7.8 State in the test file header what 7.3/7.4/7.6 do and do NOT prove: constructing the `HelioApiError` in the
      test (the `context.test.ts`/`pipelineProposalHandlers.test.ts` fake-`HelioApi` precedent) proves the handler
      does not SWALLOW or convert the error; it does not prove `describeError`'s message composition, which is
      pre-existing, covered by `helioApi.test.ts`'s fetch-injection harness, and re-exercised end to end by section 8.
      Write this down so a later reader cannot overread the tests.
- [x] 7.7 `update_dashboard` issues a `PATCH` to `/api/dashboards/:id` with a body of exactly `{ name }` — assert the
      full body shape, so an accidental extra key fails.

## 8. The `&` round-trip probe (design D8 — measurement, not attestation)

- [x] 8.1 The probe MUST traverse the real MCP stdio transport, not merely an in-process handler call. Use the
      existing checked-in harness pattern: `helio-mcp/scripts/verify.ts` spawns the BUILT server over a real
      `StdioClientTransport` with the real `@modelcontextprotocol/sdk` `Client` and reads `result.content[].text`
      (`npm run build` then a `verify.ts`-style script, with `HELIO_API_BASE_URL` + `HELIO_PAT` set). This matters
      because the SDK's own JSON transport is the one segment the enumeration could not rule out — a probe that
      stopped at `helioApi`, or even at the registered handler in-process, would have a predetermined outcome and
      would close acceptance criterion 4 blind to the suspected cause.
- [x] 8.2 Exercise the CREATE path as well as the rename path: the field report's `&amp;` appeared at
      `apply_proposal`/create time, not at rename time. Against the running dev backend, create a dashboard whose name
      contains `&`, then rename it to a different `&`-containing name, then read the name back — asserting the exact
      transport-delivered string at each step. If the probe comes back clean, ALSO make one `apply_proposal`-shaped
      call with an `&` in `dashboardName`: that is the exact call the field report observed the `&amp;` on, and
      including it materially strengthens task 8.3's scoped finding at negligible cost.
- [x] 8.3 State explicitly in the finding WHICH segments were exercised and which were NOT. Having gone through the
      stdio transport, the ONLY segment genuinely out of reach is the calling agent's own client; scope the conclusion
      to exactly that and do not claim the transport was unreachable.
- [x] 8.4 Record the transcript as evidence. If a literal `&` survives every reachable segment, hand that scoped
      finding to the orchestrator for a spinoff — the executor has NO Linear tools and MUST NOT attempt to file it. If
      it does not survive, localise the escaping site and fix it here.
- [x] 8.5 Do not close acceptance criterion 4 by citing the design's enumeration of escaping sites; only the probe
      closes it.

## 9. Acceptance criteria 2 and 3 — no divergent source of truth

- [x] 9.0 Capture 9.1 and 9.2 in the SAME stdio run as section 8 where practical — it is the natural single place to
      produce all three pieces of live evidence.
- [x] 9.1 Demonstrate that a schedule set via the MCP path is the same resource the pipeline schedule UI reads
      (single backend resource, no MCP-side store). Evidence may be a request-level trace plus the UI read.
- [x] 9.2 Demonstrate that a rename preserves the dashboard id, so links built from the id still resolve.

## 10. Red-on-revert evidence

- [x] 10.1 For each behavioural test group above, capture red-on-revert by **behavioural mutation** (e.g. make the
      body builder always include `enabled`; make `update_dashboard` send an extra key; make the description drop
      `interval`), NOT by a compile-error revert — a compile error proves only that the tests reference the new API.
- [x] 10.2 Recapture this evidence if the tests change afterwards. Do NOT recapture when only names or comments
      changed.

## 11. Gates and hygiene

- [x] 11.1 `tsc --noEmit` clean, with `helio-mcp/node_modules` confirmed present at the time the exit code is read.
- [x] 11.2 Lint and format clean.
- [x] 11.3 The task-1.2 jest command green, quoting the suite/test counts AND the evidence that collection was
      non-empty. A green line without that collection proof is not evidence.
- [x] 11.4 Confirm no file under `backend/`, `frontend/` or any migration was modified. If a backend change proves
      genuinely necessary, stop and escalate rather than absorbing it silently (acceptance criterion 5).
- [x] 11.5 Write `files-modified.md` with exactly one full backtick-quoted path per `^-` bullet — `squash-branch.sh`
      parses only the first backtick-quoted path per bullet.
