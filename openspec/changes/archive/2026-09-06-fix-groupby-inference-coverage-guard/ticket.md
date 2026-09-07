# HEL-872: analyze_pipeline reports a spurious "Unknown op" validationError for every valid groupby step

## Description

`PipelineAnalyzeService.inferOutputSchema` dispatches 22 of the 23 kinds registered in
`PipelineStep.Registry`. The one missing kind is `groupby`, which falls through to
`case unknown => (inputSchema, Some(s"Unknown op: '$unknown'"))`.

A valid `groupby` step therefore reports `validationError: "Unknown op: 'groupby'"` on
every analyze call, and its output schema falls back to identity passthrough — wrong,
since the step actually emits group keys plus an aggregate column. `analyze_pipeline` is
the agent-facing surface for checking a pipeline before running it, so wrong metadata
about capability steers agent behaviour: an agent that trusts `validationError` will
avoid a working op or "fix" a step that was already correct.

Confirmed at runtime before any fix was written (probe, with negative controls):

- `select` -> `validationError=None` (control: the instrument can report green)
- `join`   -> `validationError=None` (control: HEL-911's fix is live)
- `groupby` -> `Some("Unknown op: 'groupby'")`, outputSchema = identity passthrough
- `PipelineStep.Registry` = 23 kinds

### Premise correction (scope restated 2026-09-06)

The ticket as filed claimed BOTH `groupby` and `join` were missing (21 of 23). That is
stale. `join` was fixed by HEL-911, which added `case "join" => inferJoin(...)`, the
`secondarySchema` parameter, and the `laneDependencyOf` topological pass — the very
mechanism the ticket says does not exist — with a regression test at
`PipelineAnalyzeServiceSpec.scala:1043`.

The original AC5 is PARTLY live, not void — an earlier claim that its "unassertable"
comments were "already gone" was wrong (it generalized from a single-file grep). A full-tree
sweep finds one survivor at `PipelineAnalyzeRoutesSpec.scala:492-497`, which this change
must delete, since it will otherwise misinform the next reader about the exact invariant
this change establishes. See AC5 below.

The ticket's own AC3 wording is also inaccurate. `GroupByConfig` has no alias field
(`GroupByConfig(groupBy, aggColumn, aggFunction)`); `GroupByStep.apply` names its output
column `<aggFunction>_<aggColumn>`, e.g. `sum_amount`.

Scope restated by coordinator escalation, answered `proceed-with-restated-scope`.

## Acceptance criteria

- [ ] AC1. A valid `groupby` step produces no `validationError` from analyze.
- [ ] AC2. `groupby`'s inferred output schema is the group-key fields plus the aggregate
      column, with correct TYPES, matching what `GroupByStep.apply` actually emits at run
      time. `count` -> `integer`, `sum` -> `float`, regardless of the input column's type.
      Group-key types resolve from the input schema by name. Any genuinely best-effort
      case documented in-source the way HEL-911 documented `join`.
- [ ] AC3 (PRIMARY DELIVERABLE). A guard test asserts every kind in
      `PipelineStep.Registry` has an `inferOutputSchema` branch. Expected set derived from
      `PipelineStep.Registry`; actual coverage probed by CALLING `inferOutputSchema`
      DIRECTLY per kind (never via `analyze`, which short-circuits on validation) with a
      fully valid config, asserting `validationError` is `None` — never merely "no
      `Unknown op`", and never by reading a second constant. Failure
      message names the specific uncovered kind. Any legitimately excluded kind is
      excluded by name with a stated reason, never by a pattern that could swallow a
      future kind.
- [ ] AC5. The one surviving HEL-860 "unassertable" comment
      (`PipelineAnalyzeRoutesSpec.scala:492-497`) is removed, and the positive path it says
      is unassertable — a valid `groupby` producing no `validationError` through the real
      route — is asserted there instead.
- [ ] AC4. The guard's red arm is proven: with the `groupby` arm removed, the guard fails
      naming `groupby` specifically. Evidence recorded in the delivery report.
