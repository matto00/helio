## Skeptic Report — final gate (round 1, skeptic-final-3-deletion-sweep.md)

Dimension 3 of 4 (dimension-split fan-out): **deletion sweep against HEL-910's grep list**.
This report covers ONLY that dimension. Filename carries the dimension suffix rather than
`next-report-number.sh`'s bare `skeptic-final-1.md`, because three sibling skeptics write into
this same directory concurrently and the bare number would collide.

### What I verified (with evidence)

**Scope established from ground truth, not narrative.** `git diff --name-status main...HEAD` =
149 files, 3 deletions, +9587/-6291, across 20 commits (`git log --oneline main..HEAD`). Read
`ticket.md`, `tasks.md`, `files-modified.md`, `execution-progress.md` (cycles 9 and 10 in full).

**1. HEL-910's exact grep set, run against this ticket's own added diff lines.**
`git diff main...HEAD | awk '/^\+\+\+ /{f=$2} /^\+/&&!/^\+\+\+/{print f": "$0}' | grep -E
'com\.helio\..*DataType|DataTypeId|MetricDefinition|MetricId|type_id|dataTypeId|metricId|/registry|/metrics|computed_fields|@deprecated'`
→ 66 added-line hits, all on `dataTypeId`/`outputDataTypeId`/`metricId`, all classified below.
Zero added-line hits for `com\.helio\..*DataType`, `DataTypeId`, `MetricDefinition`, `MetricId`,
`type_id`, `computed_fields`, `@deprecated`.

**2. Same grep set against the full HEAD content of every touched file** (not just added lines),
so a hit the ticket *moved* rather than *added* could not hide. Re-run a second time as a
stability check (both passes identical):
- `@deprecated` — **zero hits** in all 149 touched files. Re-run confirmed (`exit=1`, no output).
- `MetricDefinition`, `MetricId`, `DataTypeId`, `computed_fields` — **zero hits**. Re-run confirmed.
- `type_id` — 2 hits, both **test comments** describing absence:
  `ApiRoutesSpec.scala:2544` ("a panel can no longer carry a `type_id` binding") and
  `WorkspaceTeardownServiceSpec.scala:199` (naming the pre-existing DB column
  `pipelines.output_data_type_id`, created by `V94__outputs_model.sql` on `main`). Neither is a
  live code path.
- `/metrics`, `/registry` — **zero live URL strings**. The only occurrences are (a) a
  `types.ts` comment recording that `POST/PATCH/DELETE /api/metrics` was deleted by HEL-904, and
  (b) `ApiRoutesSpec.scala:3367-3368`, which asserts `GET /api/metrics` **404s** — a negative
  assertion, the opposite of a residue.

**3. Every live `dataTypeId`/`outputDataTypeId`/`metricId` hit traced to `main` — all pre-existing.**
This is the load-bearing check, so I compared against `main` rather than trusting the docstrings:
- Panel wire field `dataTypeId` and legacy `metricId` in `schemas/dashboards/dashboard-proposal.schema.json`:
  `git diff main...HEAD -- schemas/dashboards/dashboard-proposal.schema.json` is **empty** — this
  ticket did not touch that schema at all. Both names, and their "kept for schema stability /
  decoded but never applied" rationale, landed on `main` with HEL-904. Renaming a shipped wire
  field is not this ticket's call.
- `helio-mcp/src/types.ts:487 metricId?: string` — present on `main` at `types.ts:425`. This ticket
  only expanded the docstring explaining why it is inert.
- `CombinedProposalService.resolveOutputRefs` / `flatIsBlessed` (`dataTypeId`, `outputDataTypeId`)
  — present verbatim on `main:158-167`; sentinel-substitution logic, moved not authored.
- `WorkspaceContextComputations.scala`'s `JoinCandidate(dataTypeId, ...)` and the join-hint sort
  — verbatim move from `main:WorkspaceContextService.scala:766/842/864`. This is task 1.7, the
  file-size-only split the ticket explicitly scoped as *no* DataType→Output retarget.
  `WorkspaceContextProtocol.scala:126 outputDataTypeId` sits at the identical line number on `main`.
  `WorkspaceContextService.scala:295`'s assignment is `main:357` unchanged.
- `AssistantProposalToolSchemas.scala` / `AssistantSystemPrompt.scala` — untouched by this diff.

  **Net direction is a removal, not a residue:** `PipelineProposalProtocol.scala` carried a LIVE
  field `outputDataTypeId: String` on `main:117`; at HEAD that name survives only inside a comment
  (line 124) explaining that `outputs` replaced it. `PipelineProposalService.scala`'s three
  `outputDataTypeId` live sites on `main` (318/325/416/446) are gone at HEAD.

**4. `metricSchemas.ts` is genuinely deleted, not emptied.**
`git diff --name-status main...HEAD | grep '^D'` → `helio-mcp/src/tools/metricSchemas.ts` (plus
`scripts/compose.ts`, `scripts/verify-bound-panel.ts`). File absent from `helio-mcp/src/tools/`
listing; no compiled `dist/src/tools/metricSchemas.js` left behind.

**5. Metric MCP tools gone, no dead imports.**
`grep -rn "from \"./tools/metric\|metricSchemas.js\|registerMetric\|MetricTools" src/ scripts/`
→ **empty**. `server.ts` registers exactly 9 tool families, none of them metric.
`server.test.ts` pins an EXACT 60-name set via
`expect([...names].sort()).toEqual([...EXPECTED_TOOL_NAMES].sort())` (line 179) over a real
in-process MCP client/server pair — a genuine equality assertion, not `not.toContain` alone, so a
silently re-added tool fails it. The five metric tool names appear only in `REMOVED_TOOLS`, a
negative-assertion list.

**6. I ran the tests myself** (the brief correctly warns root `npm test` proves nothing here —
`jest.config.cjs` excludes `/.claude/worktrees/`). Using ticket.md's verified scoped command with
`/dist/` excluded: **18/18 suites, 182/182 tests, 3.0s, no OOM**, `server.test.ts` PASS,
`write.test.ts` PASS. (Note the count differs from ticket.md's planning-time "250 tests / 14 suites";
the current cycle-9 ledger figure of 178 is the one that tracks — the ticket's number is stale, not
the run. Suite count went up, test count down, consistent with dead-tool coverage being deleted.)

### Verdict: CONFIRM

For this dimension. Every literal HEL-910 grep-list term is either zero-hit in this ticket's own
new/changed code, or traces to pre-existing `main` code the ticket correctly left alone
(the HEL-904-era `dataTypeId`/`metricId` wire names, and the deliberately non-retargeted
WorkspaceContext port of task 1.7). `metricSchemas.ts` and the five metric tools are genuinely gone
with no dead imports, proven by an exact-set assertion I re-ran myself. No `@deprecated` anywhere.

### Non-blocking notes

1. **Dead `HelioApi.listDataTypes()` still calls the deleted `GET /api/types` route.**
   `helio-mcp/src/helioApi.ts:241-242`. Cycle 9's ledger explicitly kept it
   ("still live: `proposal.ts`'s dashboard-proposal grounding depends on them"), and cycle 10 then
   removed that last caller (grounding swapped to `fetchAllOutputs`) without re-sweeping. I
   confirmed **zero call sites repo-wide** (re-run twice, excluding `node_modules`/`dist`/`openspec`).
   It is unreachable, so there is no runtime risk — but it makes `tasks.md` 3.9's claim ("plus their
   now-dead `HelioApi` methods/`types.ts` interfaces") false as written, and HEL-910's sweeper will
   hit `/api/types` and have to re-litigate it. A four-line deletion (plus `DataTypeResponse`'s
   `Paged` usage). Recommend fixing before merge or naming it in HEL-910.

2. **`CreateSourceResult.dataType` is stale against the backend wire shape.**
   `types.ts:531` declares `dataType: DataTypeResponse | null`; `helioApi.ts:431/465` normalize
   `raw.dataType ?? null`; `write.ts:126` still tells the agent `create_rest_data_source` "creates a
   DataType; on failure it returns dataType: null". But the backend's `CreateSourceResponse`
   (`DataSourceProtocol.scala:184`) is `(source, inferredSchema, fetchError, rowCapNotice)` — no
   `dataType` field at all, and that shape is **already on `main`** (HEL-904). So the field is always
   `null` and the genuinely useful `inferredSchema` is silently discarded.
   `git diff main...HEAD -- helio-mcp/src/helioApi.ts` shows this ticket did **not** touch those
   lines, and source creation is not in its scope — so this is pre-existing staleness, out of scope
   here, and correctly not a REFUTE. But it is a live agent-facing inaccuracy and a real
   DataType-era residue; it belongs in HEL-910's sweep or its own ticket. Worth noting that no test
   caught it: the helio-mcp suite mocks `HelioApi`, exactly the mock-hides-a-wire-bug shape that bit
   `expandPipelineShape` in cycle 14.

3. **Five comments cite the now-deleted `metricSchemas.ts` as a code-organization precedent** —
   `proposalValidation.ts:4`, `restDataSourceSchema.ts:3`, `assertSchemas.ts:14`,
   `pipelineProposalHandlers.ts:14`, `pipelineProposalValidation.ts:4`. All are pre-existing lines
   this ticket left alone, and each cites the file only as a historical precedent for a pattern that
   still exists in its siblings — so they are not wrong, merely dangling. (`write.test.ts`'s
   reference is the one this ticket *added*, and it correctly narrates the deletion.) Cheap to
   re-point at `assertSchemas.ts` next time these files are opened.
