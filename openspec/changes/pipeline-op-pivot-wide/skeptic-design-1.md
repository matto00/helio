## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket AC traceability**: read `ticket.md` in full. All 8 acceptance criteria are addressed by
  named design decisions and task items (execute semantics → design.md decisions 1-4 + tasks 1.2/7.1;
  analyze schema/no-false-error → decision 5 + tasks 3.1/7.2; apply/infer parity on index columns →
  decision 5's index-name/type carryover; Flyway constraint → decision 7 + tasks 1.1/4.1; frontend
  editor → Planner Notes + tasks 5.1-5.4; MCP doc → tasks 6.1; test list → tasks 7.1-7.6; backward
  compatibility → proposal.md Impact section, additive-only).

- **The core hard problem (data-dependent analyze schema) has a coherent, non-hand-wavy answer.**
  Design.md Decision 5 states: output schema = `index` fields only (types looked up from
  `inputSchema`), zero static value-column entries, `validationError = None` when `index`/`column`/
  `values` all resolve, and a real `validationError` + identity-fallback schema when they don't. I
  cross-checked this against the actual `PipelineAnalyzeService.scala`
  (`backend/src/main/scala/com/helio/domain/PipelineAnalyzeService.scala`): `inferSplitText`,
  `inferExtractHeadings`, `inferChunkByTokenCount` all follow exactly this shape — unknown-field
  lookup → `(inputSchema, Some(errMsg))`, else transform → `(newSchema, None)` — via the shared
  `parseConfig(...) { ... } (inputSchema)` helper (lines 171-262). The design's claim to mirror this
  precedent is accurate, not asserted-and-unverified.

- **`spec.md` requirements/scenarios are internally consistent with `design.md` and with each other.**
  Read `openspec/changes/pipeline-op-pivot-wide/specs/pipeline-pivot-op/spec.md` in full. The five
  scenarios (basic sum, count, first, null-column-doesn't-block-row, unsupported-agg-fails) match
  design.md decisions 1-4 exactly, including the worked "west" grouping example
  (`revenue_widgets: 15` = 10+5, matches `sum` semantics). The two analyze scenarios (index-only
  schema, unknown-field validation) match Decision 5 and the `inferSplitText`-style precedent.

- **Naming convention (`<values>_<v>`) and collision rule (value columns win) are specific, not
  deferred.** Verified against `AggregateStep.scala` (`keyMap ++ aggMap`, line 102) and
  `inferDateBucket` (`inputSchema.filterNot(...) :+ ...`, line 279 of
  `PipelineAnalyzeService.scala`) — the "derived data wins" convention the design cites is real,
  not invented for this ticket.

- **File-path and wiring claims verified against ground truth**, not taken on faith:
  - `PipelineStep.scala` (`backend/src/main/scala/com/helio/domain/PipelineStep.scala`): confirmed
    `Registry` is a flat `Map[String, Companion]` (line 101-115) and `PipelineStepKind.All` is
    `PipelineStep.Registry.keySet` (line 146) — so task 1.3's registry entry is the *only* place a
    new kind needs registering; `All`, `parseKind`, and the two generic tests that iterate
    `PipelineStepKind.All` (`PipelineStepConfigCodecSpec.scala:165`,
    `PipelineStepRepositorySpec.scala:103`) pick pivot up automatically. No missed exhaustive-match
    site.
  - `domain/package.scala`, `PipelineStepProtocol.scala`, `PipelineAnalyzeProtocol.scala`: confirmed
    the `DateBucket*` precedent (type/val aliases, `jsonFormat6`, standard 6-field `AnalyzeStepResponse`
    shape) is real and matches what design.md decisions 6 and Planner Notes claim to mirror.
  - Frontend: confirmed `pipelineStep.ts`, `stepNarrowing.ts` (`OP_TYPES`, `defaultConfigFor`,
    `dateBucketConfigOf`), `StepCard.tsx`, and `useStepCardState.ts` all have the exact `datebucket`
    touch points the tasks claim to mirror. Confirmed `AggregateConfig.tsx`'s `AGG_FNS` constant
    (`sum/avg/min/max/count`, no `first`) — Planner Notes' claim that a new `PIVOT_AGG_FNS` constant
    is needed (rather than reusing `AGG_FNS`) is correct, not an invented justification.
  - MCP: confirmed `helio-mcp/src/tools/write.ts`'s `add_pipeline_step` description is free-text
    (`type` list embedded in a string, `datebucket` already there as the freshest precedent) — task
    6.1 (append `pivot` + config shape to the string) is a trivial, correctly-scoped edit.
  - Flyway: confirmed current max migration is `V64__add_datebucket_op.sql`
    (`ls backend/src/main/resources/db/migration/ | sort`), matching the ticket's "main is at V64"
    claim, and confirmed `V50__add_splittext_op.sql`/`V64__add_datebucket_op.sql`'s drop/re-add
    `CHECK` pattern is what design.md decision 7 and tasks 1.1/4.1 correctly cite (including the
    re-confirm-twice instruction for concurrent-lane safety).
  - Confirmed no `schemas/` (JSON Schema) file enumerates op kinds by name (`grep` for `datebucket`
    only hits `openspec/specs/pipeline-date-bucket-op/spec.md`) — so the proposal's claim of no
    missing schema-contract update is accurate, not an oversight.

- **Scope**: `proposal.md` Non-goals and `ticket.md` Out of scope agree (smart shape HEL-337 and DAG
  branching excluded). No scope drift found — every planned file touch traces to an ticket AC or a
  named exhaustive-match consumer from the orchestrator's checklist.

### Minor observations (non-blocking)

1. Planner Notes describes the frontend `index` field editor as "mirroring `AggregateConfig`'s
   `groupBy` rows," but `AggregateConfig.groupBy` stores `{name, type}` pairs while `PivotConfig.index`
   is bare `Vector[String]` (Planner Notes' own stated rationale). The mirroring is of the row
   add/remove *UI pattern*, not the underlying data shape — this is stated clearly enough elsewhere
   in the same paragraph that an implementer won't misread it, but a one-line explicit callout ("only
   the row UX is mirrored; the stored shape is a bare string, not `{name,type}`") would remove any
   residual doubt.
2. `inferPivot`'s output-schema field order for multi-field `index` isn't explicitly pinned (design
   only says "index fields, types carried through"). The cited precedent (`inferSelect`'s
   `inputSchema.filter(...)`) implies input-schema order rather than user-selected `cfg.index` order,
   which is a real and consistent codebase convention — but making this explicit in design.md would
   preempt an implementer guessing differently for a multi-index-field case (none of the spec.md
   scenarios use more than one index field).

### Verdict: CONFIRM

The design gives a concrete, ground-truth-verified answer to the ticket's flagged hard problem
(schema inference for a data-dependent-arity op) rather than hand-waving it, is internally consistent
across proposal/design/spec/tasks, traces every acceptance criterion to a specific task, and every
file/pattern claim I checked against the actual codebase (steps, protocols, analyze service, Flyway
migrations, frontend wiring, MCP tool) held up. No placeholders, no deferred decisions that block
implementation, no missing contract updates, no scope drift.
