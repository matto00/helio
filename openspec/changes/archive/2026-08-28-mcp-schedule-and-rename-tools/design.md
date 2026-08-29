# Design — HEL-863 MCP schedule + dashboard rename tools

## Context

Every claim below was checked against `origin/main` at `c0821ef9` by reading the call path, not just a signature
(standing requirement 2). File/line references are given so the design gate can re-derive them.

Backend ground truth (no change to any of this is in scope):

- `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineScheduleRoutes.scala` mounts
  `pipelines / <id> / schedule` with `get`, `put` and `delete` at `pathEndOrSingleSlash`. `get`/`put` go through
  `ServiceResponse.run(...)(PipelineScheduleResponse.fromDomain)`; `delete` goes through
  `ServiceResponse.runNoContent`, so a successful delete has an empty body.
- `PutPipelineScheduleRequest(kind: String, expression: String, enabled: Option[Boolean], timezone: String)` —
  `jsonFormat4`. `timezone` is REQUIRED; only `enabled` is optional.
- `PipelineScheduleResponse` is `jsonFormat10`: `id, pipelineId, kind, expression, enabled, timezone, nextRunAt,
  lastRunAt, createdAt, updatedAt`, with `nextRunAt`/`lastRunAt` as `Option[String]`.
- `PipelineScheduleService.put` is a genuine upsert: it looks up any existing schedule and reuses its
  `id`/`createdAt`/`lastRunAt`, so the `pipeline_id` UNIQUE constraint is never hit. It resets `nextRunAt` to `None`
  when `kind`, trimmed `expression`, or `timezone` changes, and preserves it otherwise (so toggling `enabled` alone
  does not move the next firing).
- Validation, all server-side in `PipelineScheduleService`: `ScheduleKind.fromString` accepts exactly `"cron"` and
  `"interval"` (`backend/src/main/scala/com/helio/domain/model/model.scala:834`); cron must be 5 space-separated fields with per-field bounds
  `(0-59, 0-23, 1-31, 1-12, 0-6)` and tokens of the form `*`, `n`, `lo-hi`, or `base/step`, comma-separable;
  interval must match `^(\d+)(s|m|h|d)$` with `n > 0`; timezone must satisfy `ZoneId.of`.
- Every method ACL-gates on `pipelineRepo.findByIdOwned` first and returns `NotFound("Pipeline not found")`; a missing
  schedule on an owned pipeline returns `NotFound("Pipeline schedule not found")`.
- `UpdateDashboardRequest(name: Option[String], appearance: ..., layout: ...)` at `DashboardProtocol.scala:43`,
  `jsonFormat3` at `:210`, served by the existing `PATCH /api/dashboards/:id`. The `dashboard-rename` capability spec
  already requires 400 on an empty/whitespace name and 404 on an unknown id.

MCP ground truth:

- `helio-mcp/src/httpClient.ts` already has `get` (97), `post` (102), `patch` (111), `put` (117) and
  `delete<T = void>` (124) — no new transport verb is needed.
- `guarded()` in `write.ts:51` catches `HelioApiError` and renders `"<name> (status <n>) for <url>: <message>"` with
  `isError: true`. A backend 404/400 therefore already reaches the agent verbatim with its status; no per-tool error
  handling is needed to satisfy the spec's "surface, not swallow" scenarios.
- `update_pipeline` (`write.ts:967`) and `update_data_source` are the exact precedent for a required-single-field
  rename tool: `inputSchema` of two `z.string().min(1)`s, one-line handler delegating to a thin `helioApi` method.
- `updateDataSource` (`helioApi.ts:890`) and `updatePipeline` (`:904`) build `{ name }` inline; `updateDataType`
  (`:897`) and `updatePanel` (`:744`) take an already-built patch body. Rename-only tools use the former shape.

## Decisions

**D1 — Three schedule tools mapping 1:1 onto the three routes, not one multiplexed tool.**
`get_pipeline_schedule`, `set_pipeline_schedule`, `delete_pipeline_schedule`. A single `manage_pipeline_schedule` with
a mode argument would need conditional required-ness that Zod's flat `inputSchema` expresses badly, and would give one
tool description three contradictory contracts — the exact failure mode of field-report issue #7. Naming follows the
existing verb-first convention (`delete_dashboard`, `update_pipeline`, `run_pipeline`).

**D2 — `set_pipeline_schedule`, not `create_`/`update_` pair.** The backend verb is `PUT` upsert; modelling it as a
create/update pair would invent a distinction the backend does not have and would force the agent to know whether a
schedule already exists before it can act. The tool description states plainly that it creates-or-replaces, and that
replacing keeps the schedule's id.

**D3 — `timezone` is a required tool argument, deliberately not defaulted to `"UTC"` client-side.** The backend field
is a required `String`. Defaulting in the MCP layer would silently pick a firing time the caller never chose — "daily
at midnight" is a different promise in each zone — and would put a second, MCP-only piece of schedule policy outside
the backend. Required is also honest: the agent is asked for the one fact it must actually decide.

**D4 — No client-side re-validation of `expression`; `kind` is a `z.enum(["cron", "interval"])`.** Re-implementing the
cron/interval grammar in Zod would duplicate ~40 lines of `PipelineScheduleService` logic that can drift silently and
would produce a *different* error message than the backend for the same input. The backend already returns a precise,
expression-naming 400, which `guarded()` surfaces intact. `kind` is the one exception: it is a closed two-value set
(`ScheduleKind.fromString`) that has not changed since HEL-414, and enumerating it puts the two legal values into the
tool's machine-readable schema where an agent can see them without reading prose. `expression`/`timezone` are
`z.string().min(1)` only. The full grammar lives in the description (see D6). To be precise about the trade rather
than pretending it is free: enumerating `kind` in Zod DOES reintroduce the "a Zod message differs from the backend
message for the same input" asymmetry that this decision and D7 elsewhere cite as a reason to avoid client-side
checks. It is accepted here on its own merits — a closed two-value set belongs in the machine-readable schema where
an agent can see it without parsing prose — not because it follows the same principle.

**D5 — `enabled` is sent only when the caller supplied it.** `enabled: Option[Boolean]` normalises to `true` when
absent, and spray-json omits `None`. The body builder therefore includes the key only on `!== undefined`, matching
`buildUpdateDataTypeBody`'s established convention in `updateSchemas.ts`. Sending an explicit `enabled: true` for an
omitted argument would be equivalent today but would couple the MCP layer to a server-side default it does not own.

**D6 — Tool descriptions state the accepted grammar and the upsert's `nextRunAt` semantics explicitly.** Standing
requirement 4: the description is the agent-facing contract. `set_pipeline_schedule`'s description must state the two
`kind` values, the 5-field cron shape with field order, the `<n><unit>` interval shape with its unit set, that
`timezone` is an IANA zone id, that omitting `enabled` yields an enabled schedule, and that changing the cadence
resets the next firing while toggling `enabled` alone does not. It must NOT claim client-side validation it does not
perform. `get_pipeline_schedule`'s description must state that a pipeline with no schedule is a 404, not an empty
result, so the agent does not read absence as failure of the tool.

**D7 — `update_dashboard`, name-only, mirroring `update_data_source`/`update_pipeline`.** The name follows the
existing `update_<resource>` family rather than `rename_dashboard`, so the surface stays predictable. It exposes only
`name`. `layout` already has its own dedicated tool (`update_dashboard_layout`, plus `auto_layout_dashboard`), so
accepting `layout` here would create two ways to do the same thing with different merge semantics. Dashboard
`appearance` is a different case and the earlier draft of this decision stated it falsely: an enumeration of all 58 uniquely-named
registered tools across `helio-mcp/src/tools/*.ts` shows there is NO `update_dashboard_appearance` tool, and
`helioApi.ts` has no dashboard-appearance method at all (`/api/dashboards/:id` is PATCHed only with `{ layout }` at
`:1012`). Dashboard appearance is simply unexposed over MCP. It stays out of scope here because this ticket's
acceptance criteria are about rename, not because it is already covered — that genuine gap is handed to the
orchestrator as a spinoff candidate rather than papered over. `name` is
`z.string().min(1)`; the backend independently 400s on whitespace-only, which `guarded()` surfaces — the tool does not
duplicate that check, because a Zod message and the backend message for the same input would then differ.

**D8 — The `&amp;` question is answered by measurement, not by this document.** An enumeration of every
escaping/sanitising site across `helio-mcp/src`, `frontend/src` and `backend/src/main/scala` found zero HTML-entity
encoding on the agent write path — the only `&amp;` occurrences in the repo are literal JSX text in
`MetricBindingFields.tsx:66` and `RefinementChatDrawer.tsx:283`, and every `sanitize*` function is row/column/URL/
layout sanitisation. That is evidence, not proof: it cannot rule out an encoder in the MCP SDK's own JSON transport or
in the calling agent. A probe that merely called `helioApi` directly would be worthless here: it would exercise
only the `helioApi` -> HTTP -> backend segment that the enumeration has already shown clean, so its outcome would be
predetermined and it would close the acceptance criterion blind to the very cause D8 names as unruled-out.

The probe MUST therefore go through the REGISTERED TOOL HANDLER and assert on the serialized `CallToolResult` `text`
that an agent would actually receive, not on a `helioApi` return value. It must exercise the CREATE path as well as
the rename path, because the field report's `&amp;` appeared at `apply_proposal`/create time, not at rename time. And — correcting a false claim an earlier
draft of this decision made — the MCP stdio transport IS reachable from this repo: `helio-mcp/scripts/verify.ts` is a
checked-in harness that spawns the BUILT server over a real `StdioClientTransport` with the real
`@modelcontextprotocol/sdk` `Client` and reads `result.content[].text`, run via the existing `npm run build` +
`npm run verify` scripts against a live backend and a valid `HELIO_PAT`. Since the SDK's own JSON transport is
precisely the segment D8 names as unruled-out, the probe MUST traverse it via a `verify.ts`-style stdio client, not
merely an in-process handler call. The only segment that genuinely remains out of reach is the CALLING AGENT's own
client, and the executor's finding must scope its conclusion to exactly that — so that any statement of the form
"this did not originate in this repo" is bounded by what was actually measured. If a literal `&` survives every
segment the probe can reach, that scoped finding goes to the orchestrator, which files the spinoff (the executor has
no Linear tools). If it does not survive, the escaping site the probe localises is fixed here. Under no circumstances
is this criterion closed by citing the enumeration above.

**D9 — Wire types are hand-written in `types.ts` mirroring the Scala protocol exactly.** `PipelineScheduleResponse`
gets all ten fields with `nextRunAt`/`lastRunAt` optional; the PUT body type carries `enabled` optional and the other
three required. This is the file's existing convention for every other endpoint; no generation step is introduced.

**D10 — The four tool descriptions and handlers are extracted into a zod-free `scheduleTools.ts`; tests import that,
never `write.ts`.** This is forced, not stylistic. Importing `write.ts` from a test makes node die with a heap OOM at
4 GB: its 33-registration, ~1175-line Zod-schema surface is pathologically expensive to type-check under this repo's root
`tsconfig.json`/ts-jest combination, a pre-existing repo issue documented in `write.test.ts`'s own header and worked
around by all six existing helio-mcp test files. The established precedent is `assertSchemas.ts` (which exports
`addPipelineStepHandler`) and `metricSchemas.ts`/`updateSchemas.ts` (which export body builders). So
`helio-mcp/src/tools/scheduleTools.ts` exports the four DESCRIPTIONS as string constants and the thin handlers
(taking a `HelioApi`), `write.ts` imports and registers them, and every test in tasks 6, 7 and 8 imports
`./scheduleTools.js`. Two consequences to state plainly rather than leave as silent holes. First, the Zod
`inputSchema` shapes must stay in `write.ts` at the `registerTool` call and therefore CANNOT be unit-tested by this
route; their correctness is covered by the typecheck and by review. Second, `guarded()` is equally out of reach: it is
module-private to `write.ts` (`:51`), with five further unexported near-identical copies (`read.ts:23`,
`proposal.ts:103`, `pipelineProposal.ts:41`, `refinement.ts:48`, `combinedProposal.ts:38`). So no unit test may assert
on `isError` or on the `"<name> (status <n>) for <url>: <message>"` wrapper. Error-path tests assert at the HANDLER
boundary — a `HelioApiError` rejection carrying `status` and the backend's own message — which is precisely the
precedent `pipelineProposalHandlers.test.ts:16-20` already sets, recording that `guarded`'s wrapping is existing
covered-by-convention logic. End-to-end confirmation of the wrapper comes from the section-8 stdio probe, not a unit
test. No task may imply otherwise.

**D11 — `deletePipelineSchedule` returns `{ deleted: true, pipelineId }`, deliberately diverging from the sibling
`{ deleted: true, id }`.** Six sibling methods (`deleteDashboard` `:952`, `deleteDataSource`, `deleteDataType`,
`deletePanel`, `deletePipeline` `:982`, `deleteMetric`) return `{ deleted: true, id }`, where `id` is the id of the
thing addressed and deleted. Here those are not the same thing: the caller addresses the schedule by its PIPELINE id
and never sees or supplies the schedule's own id. Echoing the supplied `pipelineId` back is truthful; labelling it
`id` would imply it is the deleted schedule's identifier, which it is not. Because this is agent-facing shape, it is
recorded here as a decision rather than left as an unremarked deviation from a six-method convention. The synthesised
payload itself is not optional: the route is `runNoContent`, so the body is empty, and `guarded()`'s
`JSON.stringify(value, null, 2)` yields `undefined` (not a string) for a `void` return, producing a broken tool
result — which is exactly why the siblings synthesise too.

## Risks

- **Grammar drift between description and backend.** D4 deliberately does not duplicate validation, so the description
  is the only MCP-side copy of the grammar. Mitigated by a unit test asserting the description names both `kind`
  values and the interval unit set, so a future backend grammar change that lands without a description update fails a
  test rather than misleading an agent silently. That test is only possible because of D10's extraction: the
  descriptions must be exported constants in `scheduleTools.ts`, since importing `write.ts` from a test OOMs the
  type-checker outright.
- **`nextRunAt` reset semantics are easy to state wrongly.** The reset is on `kind`/`expression`/`timezone` change,
  where `expression` is compared *trimmed*. A description that says "any edit resets the next run" would be false for
  an `enabled`-only toggle. Covered by the description test above and by the spec scenario.
- **Verification environment.** Root jest silently runs zero tests inside a worktree (HEL-880), and a
  dependency-less worktree makes `tsc --noEmit` emit implicit-any noise that has already masked five real TS2532
  regressions. An earlier draft of this section prescribed "helio-mcp's own jest config"; that config DOES NOT EXIST.
  `helio-mcp/package.json` has no `test` script, no jest config file and no jest/ts-jest dependency — helio-mcp's 13
  suites are collected by the ROOT `jest.config.cjs` (`preset: ts-jest`) out of the ROOT `node_modules`, and running
  `npx jest` from inside `helio-mcp/` fails at transform with zero tests run. The mitigation is therefore an override
  of the root config's ignore list, measured green from inside the worktree:
  `npx jest helio-mcp --testPathIgnorePatterns "/node_modules/" "/openspec/" "/frontend/" "/e2e/" "/helio-mcp/dist/"`
  (drops only the `/.claude/worktrees/` entry) — 13 suites / 225 tests. BOTH `helio-mcp/node_modules` (for `tsc`) and
  the worktree-ROOT `node_modules` (which is what actually supplies jest/ts-jest) must be present, and that must be
  confirmed before any exit code is reported.

## Gate-Chain Implications Checklist

Not applicable — this change touches no file under `.husky/**` and no script any hook invokes. It is confined to
`helio-mcp/src/**` and this change's own planning artifacts. Should that stop being true during execution, this
section must be filled in for real before delivery.
