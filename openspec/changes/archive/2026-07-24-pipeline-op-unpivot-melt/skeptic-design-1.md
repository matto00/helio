## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket vs. proposal/design/spec/tasks alignment** — read `ticket.md`, `proposal.md`, `design.md`,
  `specs/pipeline-unpivot-op/spec.md`, `tasks.md` in full. Config field name/order
  (`idVars, valueVars, varName, valueName`), defaults (`"variable"`/`"value"`), row-multiplication
  formula (`N input rows * len(valueVars)`), and the analyze schema shape (`idVars` + `varName`
  (string) + `valueName` (common-or-string)) all match the ticket verbatim, with no unauthorized
  scope drift.

- **Execution semantics against `PivotStep.scala` precedent** (read in full) — design's decisions
  3-5 (nested-loop order, unconditional null-on-missing-field emission, `Map ++` collision with
  later-wins) directly mirror `PivotStep.apply`'s `indexFields.map(name => row.getOrElse(name,
  null))` tolerant lookup and `indexMap ++ valueColumnsMap` collision convention. Traced the
  collision math by hand for the `varName == valueName` case: `Map(varName -> colName, valueName ->
  cellValue)` right-biases on the *later* tuple in the literal when both keys are equal, so
  `valueName`'s cell value wins — matches spec.md's explicit "valueName wins over varName" scenario
  and design.md decision 5's stated ordering.

- **Analyze semantics against `PipelineAnalyzeService.scala`** (read in full, all 12 existing
  `infer*` methods incl. `inferPivot`/`inferDateBucket`/`inferWindow`). Confirmed:
  - The `filterNot(_.name == X) :+ SchemaField(X, ...)` replace-in-place idiom design.md decision 6
    cites is real and used exactly this way by `inferDateBucket`/`inferSplitText`/`inferWindow`.
  - Traced the two-sequential-append order (idFields → +varName → +valueName) by hand for the
    `varName == valueName` collision case: step 2's `filterNot(_.name == valueName)` removes the
    entry step 1 just added (named `varName`, which equals `valueName`), then re-appends with the
    `valueName` (value-column) type — net effect matches execution's "valueName wins," so
    apply/infer parity holds on the collision case, not just the happy path.
  - The existence-validation contract (design decision 8) mirrors `inferPivot`'s exact
    `missing = index.filterNot(schemaByName.contains) ++ ...` / identity-fallback pattern line for
    line (`inferPivot` at `PipelineAnalyzeService.scala:297-320`).
  - The "no sampling" claim is accurate: `inferOutputSchema`'s dispatch never touches row data for
    any op; `inferUnpivot` as designed would be schema-math only, same as its siblings.

- **Common-type / string-fallback mechanism has a real regression guard** — `tasks.md` 7.2 commits
  to three `PipelineAnalyzeServiceSpec.scala` cases: uniform-type happy path, mixed-type→`string`
  fallback, and unknown-field validation errors. This is a test that would fail if the "identical
  declared type, no widening" rule regressed to something else (e.g. someone later adding an
  integer→number widening lattice without updating the test) — satisfies the "mechanism that fails
  if it stops being true" bar. Design decision 7 explicitly rejects a widening hierarchy and
  documents why (no existing precedent for one in the codebase); this is a defensible simplicity
  call, not hand-waving, and is consistent with the ticket's "common type ... if uniform" language.

- **Flyway VNN not hardcoded** — ran `ls backend/.../migration | sort -V | tail`: current max is
  `V66__add_window_op.sql`. Design.md decision 10 and tasks.md 1.1/4.1 both explicitly defer to a
  re-run `ls` immediately before writing and again before delivery, per the ticket's contention
  warning (three v1.6 lanes). No number is hardcoded anywhere in the artifacts.

- **Wiring touch points — enumerated real `pivot`/`Pivot` occurrences in the codebase and
  cross-checked each against `tasks.md`.** `grep -rl "pivot\|Pivot"` across
  `backend/src/main/scala`, `frontend/src`, `helio-mcp/src` returned exactly: `domain/package.scala`,
  `PipelineStep.scala`, `PipelineAnalyzeService.scala`, `steps/PivotStep.scala`,
  `api/protocols/PipelineAnalyzeProtocol.scala`, `infrastructure/PipelineStepRepository.scala`,
  `api/protocols/PipelineStepProtocol.scala`, `api/protocols/PipelineStepConfigCodec.scala`,
  `services/PipelineService.scala`, `frontend/.../StepCard.tsx`,
  `frontend/.../hooks/useStepCardState.ts`, `frontend/.../ui/PivotConfig.tsx` (+ test),
  `frontend/.../types/pipelineStep.ts`, `frontend/.../state/stepNarrowing.ts`,
  `helio-mcp/src/tools/write.ts`. Every one of these has a corresponding task in `tasks.md`
  (sections 1-6). Grepped the `backend/src/test` tree similarly and confirmed all 5 cited test files
  (`PipelineStepSpec.scala`, `PipelineAnalyzeServiceSpec.scala`, `PipelineStepConfigCodecSpec.scala`,
  `InProcessPipelineEngineSpec.scala`, `PipelineStepProtocolSpec.scala`) exist and reference `pivot`,
  matching tasks.md 7.1-7.5.
  - Spot-checked `PipelineStep.scala`'s `Registry`/`PipelineStepKind` object — confirmed it's a real
    registry-derived allow-list (`def All: Set[String] = PipelineStep.Registry.keySet`), so task 1.3's
    "register + add `PipelineStepKind.Unpivot`" is the correct, sufficient touch point (no separate
    enum to maintain).
  - Spot-checked `jsonFormat6` field counts against `PivotStepResponse`
    (`id, pipelineId, position, createdAt, updatedAt, config` — 6 fields) and
    `PivotAnalyzeStepResponse` (`id, position, config, inputSchema, outputSchema, validationError` —
    6 fields) in `PipelineStepProtocol.scala`/`PipelineAnalyzeProtocol.scala` — design.md decision 9's
    claim is accurate.
  - Confirmed `StepCodecUtil.stringOr(obj, key, default)` (read in full) takes an arbitrary default,
    so design decision 2's "default to `\"variable\"`/`\"value\"` instead of empty string" is a
    trivial, correct application of the existing helper, not a new pattern.
  - Confirmed `PivotConfig.tsx`'s props shape (`config`/`analyzeSchema`/`analyzeColumns`/`onChange`)
    cited in design.md's Planner Notes is accurate (read the file in full).
  - Confirmed `stepNarrowing.ts`'s icon import list — `faTableCells` etc. are already claimed by
    `pivot`, so task 5.2's "an icon not already in use" instruction is a real, necessary constraint
    (not filler).

- **No placeholders/hand-waving** — grepped `TODO|TBD|figure out|placeholder|later|to be determined`
  (case-insensitive) across all four artifacts; every hit was a legitimate reference to a real file
  path or the phrase "later-assigned"/"later-wins" describing map/collision semantics, not deferred
  work.

### Verdict: CONFIRM

The design is sound, internally consistent, and thoroughly grounded in real codebase precedent
(`PivotStep`/`DateBucketStep`/`inferPivot`/`inferDateBucket`/`inferWindow`). Row-multiplication,
null-tolerant field lookup, and collision resolution are traced by hand and correctly maintain
apply/infer parity even on the edge case where `varName == valueName`. The analyze contract is
genuinely sampling-free and backed by a real regression test for the common-type/string-fallback
rule. The Flyway VNN is correctly deferred, not hardcoded. All wiring touch points enumerated by
grepping the actual `pivot` precedent are covered by `tasks.md`, including all 5 test files and the
frontend/MCP surfaces.

### Non-blocking notes

- Design doesn't explicitly call out the `valueVars = []` edge case (would yield 0 output rows per
  input row per the stated formula, i.e. an empty result set). This is a mathematically consistent
  and arguably correct consequence of the stated row-multiplication rule, not an ambiguity that
  blocks implementation — but the executor may want a one-line comment in `UnpivotStep.scala`
  confirming this is intentional (mirroring how `PivotStep`/`DateBucketStep` document their own edge
  behaviors) rather than leaving a future reader to wonder if it's a bug.
- `PipelineStepProtocolSpec.scala`'s task 7.5 is hedged ("if the existing suite covers other ops'
  wire formats here") rather than asserted as required — reasonable, since I did not independently
  confirm every existing op has a wire-format round-trip test there; this is an appropriately
  qualified task, not a gap.
