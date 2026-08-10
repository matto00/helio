## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and
  `specs/metric-crud-api/spec.md` in full.
- Traced every ticket AC to a design decision / task:
  - AC1 (5 endpoints, RLS-scoped, owner-scoped paginated list, `PaginatedQueryResult`
    envelope) → design.md Decision 1 (`MetricRepository.findAll`), tasks 1.1/4.1.
  - AC2 (422/400 rejects on bad `dataTypeId`/`measureField`/`allowedDimensions`/`aggregation`)
    → design.md Decision 2, tasks 3.3/3.4, `spec.md` scenarios.
  - AC3 (absent-vs-null `PATCH`) → design.md Decision 3, tasks 2.2/3.4.
  - AC4 (route-level tests for happy path + each rejection) → tasks 6.1–6.7.
  - AC5 (schemas + `sbt test` + no inline FQNs) → tasks 5.1–5.3, 6.9.
  No AC is left uncovered by the task list; no task is unmoored from an AC.
- Cross-checked every codebase precedent design.md cites against the actual files, not
  the design doc's paraphrase of them:
  - `backend/src/main/scala/com/helio/infrastructure/MetricRepository.scala` (418-A,
    merged) — confirmed `insert`/`findByIdOwned`/`listByOwner`/`update`/`delete`/
    `findByIdInternal` exist exactly as design.md assumes, and that `aggregation` is
    validated at the repo insert/update boundary (Decision 1's stated rationale for where
    `MetricAggregation.validate` already lives).
  - `backend/src/main/scala/com/helio/domain/model.scala:802-846` — `MetricDefinition`/
    `MetricFormat`/`MetricAggregation` field names/types match every field name used
    throughout ticket/proposal/design/tasks (`name`, `description`, `measureField`,
    `aggregation`, `allowedDimensions`, `format`, `deprecated`); `MetricAggregation.values`
    is exactly `sum|avg|min|max|count|countDistinct`, matching `spec.md`.
  - `DataTypeRepository.findAll` (`backend/src/main/scala/com/helio/infrastructure/
    DataTypeRepository.scala:49-63`) — confirmed the DB-level `count` + `sortBy.drop.take`
    shape design.md Decision 1 says to mirror is real, not an invented precedent.
  - `MetricPanelConfig.Patch`/`Patch.decode` (`backend/src/main/scala/com/helio/domain/
    panels/MetricPanel.scala:58-107`) — confirmed the three-state (`None`/`Some(None)`/
    `Some(Some(v))`) decode-from-raw-`JsObject` pattern design.md Decision 3 cites is real
    and matches the `description`/`format` treatment design.md proposes.
  - `ProposalPanelSupport.preValidateBindings` (`backend/src/main/scala/com/helio/
    services/ProposalPanelSupport.scala:73-96`) — confirmed design.md's correction of the
    ticket's citation (ticket says `DashboardProposalService.preValidateBindings`; the
    method actually lives on `ProposalPanelSupport`, merely *called by*
    `DashboardProposalService`) is accurate, and that the existing check does
    `findByIdOwned` → `None` = not-found, `dt.sourceId.isDefined` = reject — same two
    checks design.md Decision 2 says `MetricService` will reimplement inline.
  - `ServiceError` (`backend/src/main/scala/com/helio/services/ServiceError.scala`) —
    confirmed `UnprocessableEntity` (422, documented as "well-formed but semantically
    invalid") exists and is exactly the case design.md Decision 2 invokes to justify
    diverging from `ProposalPanelSupport`'s use of `BadRequest`/400 for the analogous
    check — a deliberate, justified split, not an unexplained inconsistency.
  - `IdParsing.scala:14-26` and `AlertRuleProtocol.scala` — confirmed the one-line
    `*IdSegment` convention (Decision 4) and the "response + create/update request types
    share one protocol file" convention (Decision 5) are both real, existing patterns,
    not invented ones.
  - `V75__metrics.sql` migration exists (418-A), confirming design.md's "no migration"
    scope claim is correct — the table already exists.
  - `PaginationProtocol.scala` — confirmed the hand-rolled `PagedResult[A]` format
    pattern tasks.md 2.3 asks to extend is real (currently mixes in `DataTypeProtocol`/
    `DashboardProtocol`/etc.; adding `PagedResult[MetricResponse]` will need
    `MetricProtocol` mixed in too — a natural one-line addition, not a gap).
- No `TODO`/`TBD`/placeholder language found anywhere in the four artifacts.
- No scope drift: `proposal.md`'s Impact section and `tasks.md`'s file list stay within
  the ticket's Scope section; Out-of-scope items (418-C/D/F/G) are not touched by any task.

### Verdict: CONFIRM

The design is sound, internally consistent, and each non-obvious decision (422 vs. 400
split, which `PATCH` fields are three-state vs. two-state, where the binding-check pattern
actually lives, `findAll` vs. `listByOwner`) is explicitly reasoned about and grounded in
files I independently verified — not asserted. I could not find a contradiction between
`ticket.md`'s ACs, `proposal.md`, `design.md`'s decisions, or `spec.md`'s scenarios.

### Non-blocking notes

1. **`format` clear-on-`PATCH` semantics need one more sentence.** `MetricDefinition.format`
   is `MetricFormat` (non-`Option`), not `Option[MetricFormat]` — unlike `description`,
   which is genuinely `Option[String]`. Design.md Decision 3 treats `format` as three-state
   (`absent`/`null`-clears/`replace`) exactly like `description`, but "clear" for a
   non-nullable domain field can only mean "reset to `MetricFormat(None, None, None, None)`",
   not "set to `None`" — the domain type has no `None` to set. This is an inferable mapping
   (every `MetricFormat` sub-field is already optional, so an "empty" `MetricFormat` is a
   sensible clear target), but it is worth one explicit sentence in `design.md` or the
   `update-metric-request.schema.json` description (task 5.3 already earmarks this schema
   for the whole-object-replace note — folding the clear-target mapping into the same
   sentence costs nothing and removes any doubt for whoever writes `MetricService.update`).
2. **`CreateMetricRequest.format`'s optionality is unstated.** Since `format` is required
   (non-`Option`) on `MetricDefinition`, `CreateMetricRequest` needs either a required
   `format` field or an `Option[MetricFormat]` that the service defaults to an empty
   `MetricFormat` when absent. Neither `proposal.md` nor `design.md` says which; task 2.1
   ("Add `CreateMetricRequest` case class + formatter") doesn't spell out the field list.
   Low risk (the empty-default reading is the only reasonable one, and `schemas/
   create-metric-request.schema.json` will force the question to be answered anyway), but
   naming it explicitly in `design.md` would remove the last bit of judgment calls left to
   the executor.
3. **Environmental, not a design defect:** this worktree's `scripts/concertino/` is missing
   several scripts present in the main checkout's current generator output
   (`next-report-number.sh`, `persist-evidence.sh`, `emit-event.sh`,
   `check-agent-merge-permission.sh`, `check-merge-readiness.sh`,
   `gather-escalation-context.sh`, `next-ticket-id.sh`, `resolve-speed.sh`,
   `set-ticket-state.sh`, `speeds.json`, `triage-followup.sh`) — apparently a partial sync
   at worktree creation. I worked around it by invoking the main checkout's copies (which
   are location-agnostic by design — they resolve the main checkout via
   `git rev-parse --git-common-dir` rather than their own script directory) against this
   worktree's paths; this did not require modifying anything in the worktree itself. Worth
   fixing the worktree-setup sync gap so a future skeptic/evaluator invocation inside this
   same worktree doesn't hit the same `command not found`.
