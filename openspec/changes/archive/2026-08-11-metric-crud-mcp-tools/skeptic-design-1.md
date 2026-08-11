## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Ticket ACs vs. plan** — read `ticket.md`. All four ACs map 1:1 onto `tasks.md` sections:
  - AC1 (five thin pass-through tools) → tasks 3.1/3.2.
  - AC2 (Zod rejects invalid aggregation before hitting server) → task 3.3, design.md Decision 3.
  - AC3 (descriptions state V41 binding rule + reuse guidance) → task 3.4, design.md Decision 4.
  - AC4 (`npm run build` + tests + no `any`) → tasks 4.1/4.2.
  No AC is left uncovered; no task exceeds ticket scope (change is additive only, confirmed against
  `proposal.md`'s "Impact"/"Out of scope" sections, which correctly exclude 418-E grounding and
  418-C panel binding).

- **Wire-shape fidelity vs. the real HEL-493 backend** — read
  `backend/src/main/scala/com/helio/api/protocols/MetricProtocol.scala`,
  `backend/src/main/scala/com/helio/api/routes/MetricRoutes.scala`, and
  `backend/src/main/scala/com/helio/domain/model.scala:802-846` (`MetricFormat`, `MetricAggregation`,
  `MetricDefinition`). Every field the design proposes for `MetricResponse` / `CreateMetricRequest` /
  `UpdateMetricRequest` / `MetricFormat` matches the real Scala case classes field-for-field, including:
  - `MetricResponse`'s 12 fields (`jsonFormat12`) — design.md Decision 1 lists exactly these.
  - `CreateMetricRequest`'s `format: Option[MetricFormat]` (plain optional, not nullable) — the plan
    correctly types this `format?:` (create), not `.nullable().optional()` (that's reserved for update).
  - `UpdateMetricRequest`'s two field kinds — `Option[X]` for `name`/`measureField`/`aggregation`/
    `allowedDimensions`/`deprecated` vs. `Option[Option[X]]` for `description`/`format` — verified
    directly against the custom `updateMetricRequestFormat.read` decoder (lines 114-155), which
    literally implements the absent/`null`/present-value three-way branch the design describes. The
    plan's Decision 2 body-builder rule ("include a key only when parsed value is not `undefined`")
    is the correct client-side mirror of that decoder.
  - `dataTypeId` correctly identified as NOT patchable — confirmed in `MetricService.applyUpdate`
    (`backend/.../services/MetricService.scala:78-84`), which re-validates `measureField`/
    `allowedDimensions`/`aggregation` against `existing.dataTypeId` (never a request-supplied one).
  - `MetricAggregation.values = Set("sum","avg","min","max","count","countDistinct")`
    (`model.scala:819-825`) — exact match to the Zod enum the design specifies.
  - V41 pipeline-output-binding claim confirmed in `MetricService.scala`'s doc comment (lines 14-21):
    "`dataTypeId` resolves to a caller-owned, pipeline-output DataType (`sourceId == None` — the V41
    rule...)". The tool-description requirement in the spec is not an invented rule.

- **Pattern fidelity vs. existing `helio-mcp` tools** — read `helio-mcp/src/tools/read.ts`,
  `write.ts`, `helioApi.ts`, `types.ts`, `httpClient.ts`. Confirmed:
  - `guarded`/`jsonResult` helper pattern the plan commits to is real and exactly as described.
  - `HelioHttpClient` already exposes `get`/`post`/`patch`/`delete` with the exact signatures the
    planned `helioApi.ts` methods need (patch takes body only, no query param support needed here).
  - The `?:`-for-omitted-Option convention (design.md Decision 1) is the established `types.ts`
    convention, confirmed via `DataSourceResponse.tag?`, `DataTypeResponse.sourceId?`, etc.
  - Delete-tool response convention `{ deleted: true, id }` (spec's `delete_metric` requirement)
    matches every existing delete tool (`deleteDashboard`/`deleteDataSource`/etc., `helioApi.ts:697-740`).
  - No existing tool schema in `read.ts`/`write.ts` currently uses `.nullable().optional()` — grepped
    for `nullable` across `helio-mcp/src/` and found no prior client-side use of the idiom. This is new
    ground, but design.md's Risk section explicitly owns this ("no other tool ... needs the idiom ...
    a shared abstraction would be premature") rather than hiding it — not a design flaw.
  - No existing tool-registration/schema test file exists (`helio-mcp/src/*.test.ts` only has
    `context.test.ts`) — task 4.2's soft "if the existing suite has a pattern" is accurate, not
    hand-waving: there genuinely is no such pattern to follow, and the ticket's AC4 only requires the
    existing suite to keep passing, not new coverage to be added.

- **No placeholders/contradictions/ambiguity** — `proposal.md`, `design.md`, `tasks.md`, and
  `specs/mcp-metric-tools/spec.md` are internally consistent; no `TODO`/`TBD`, no deferred decisions
  that would block an implementer, no capability-name inconsistency (`mcp-metric-tools` used
  uniformly, follows the `mcp-<domain>-tools` convention seen in `mcp-data-source-tools` etc.).

### Verdict: CONFIRM

The design is sound: it is a faithful, field-accurate extension of an already-established pattern,
verified directly against the real backend wire shapes and the real client-side conventions rather
than against another agent's narrative. No revision required before implementation proceeds.

### Non-blocking notes

- Task 4.2's coverage language is soft ("add coverage ... if the existing suite has a pattern").
  Given there is currently no tool-registration test pattern in `helio-mcp`, the executor should not
  interpret this as license to skip verifying the five new tools actually register and validate
  correctly — a quick manual/smoke check (or a minimal new test) that the Zod schema rejects
  `aggregation: "median"` and that `update_metric`'s body-builder omits vs. nulls correctly would be
  worth doing even though it isn't formally mandated by the existing suite.
- Environmental note (not a design defect): this worktree's `scripts/concertino/` directory is
  missing several scripts present in the main checkout at the same commit (`next-report-number.sh`,
  `persist-evidence.sh`, `emit-event.sh`, etc. — likely a `concertino sync` that ran on `main` after
  this worktree was created). I invoked the main checkout's copies of these three scripts, pointed at
  this worktree's change directory by absolute path, to produce this report — no worktree files were
  modified. Flagging this so the orchestrator can re-sync the worktree before the executor/evaluator
  need the same tooling.
