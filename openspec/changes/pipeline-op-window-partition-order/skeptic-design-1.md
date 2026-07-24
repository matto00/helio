## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Ticket/proposal/design/spec/tasks read in full** —
  `openspec/changes/pipeline-op-window-partition-order/{ticket,proposal,design,tasks}.md` and
  `specs/pipeline-window-op/spec.md`. Config shape in design.md decision 1 matches the ticket's
  `WindowConfig(partitionBy, orderBy, function, field, outputColumn, offset)` verbatim (6 fields →
  `jsonFormat6` claim in decision 7 / task 2.1 is arity-correct).

- **Flyway version claim** — `ls backend/src/main/resources/db/migration/ | sort -V | tail -5`
  shows max is `V65__add_pivot_op.sql`; `git log --oneline -1` confirms HEAD is `1bb95832` (HEL-375
  pivot, the exact commit the ticket/design cite as "CONFIRMED at orchestration time"). `V66` is
  correctly the next available slot. Read `V65__add_pivot_op.sql` in full — confirms the
  drop/re-add `pipeline_steps_op_check` pattern design.md decision 8 cites is real and the current
  op list (`'rename','filter','join','compute','groupby','cast','select','limit','sort',
  'aggregate','splittext','extractheadings','chunkbytokencount','datebucket','pivot'`) is what
  `V66` will extend.

- **Cited reference templates read in full** — `SortStep.scala` (comparator: numeric-if-both-
  coerce-else-string, nulls sort last, `sortWith` per key), `AggregateStep.scala` (`groupBy`
  collapse-to-one-group-when-empty, `sum`'s `flatMap(toDouble).sum` drops non-numeric/absent
  values rather than erroring), `PivotStep.scala` (`first`'s raw-uncoerced-value-of-first-row
  precedent design.md decision 4 cites for `lag`/`lead`'s "no numeric coercion" claim; last-write-
  wins `indexMap ++ valueColumnsMap` collision precedent decision 5 cites), `DateBucketStep.scala`
  (`Option[String]` field tolerant-decode + per-row failure→null pattern). Every design claim that
  cites one of these files as precedent checks out against the actual code.

- **Wiring surface claims (decision 7 / tasks 1.3–2.5)** — grepped `Pivot`/`pivot` across
  `domain/PipelineStep.scala` (Registry map + `PipelineStepKind.Pivot`),
  `api/protocols/PipelineStepProtocol.scala` (`PivotStepResponse` + `jsonFormat6` + wire union
  arms + `fromDomain`), `api/protocols/PipelineStepConfigCodec.scala` (`encodeConfig`/
  `extractConfig` arms), `domain/PipelineAnalyzeService.scala` (dispatch case + `inferPivot`),
  `api/protocols/PipelineAnalyzeProtocol.scala` (`PivotAnalyzeStepResponse` + union arms),
  `domain/package.scala` (type aliases), `infrastructure/PipelineStepRepository.scala`
  (`rowToDomain` arm), `services/PipelineService.scala` (`toAnalyzeStepResponse` arm). All nine
  touch points the design lists for `window` are real, present-day integration points with an
  exact structural precedent from the immediately-prior `pivot` op — not invented or stale.

- **`inferWindow`'s field-type-fallback claim (decision 6)** — grepped
  `PipelineAnalyzeService.scala` for the `.find(_.name == field).map(_.type).getOrElse(...)`
  pattern the design says it will reuse; found it at line 345
  (`aggResultType`'s `case "min" | "max" => inputSchema.find(_.name == field).map(_.type)
  .getOrElse("string")`) — the exact fallback-to-`"string"`-on-absent-field precedent the design
  cites for `lag`/`lead`. Confirmed real, not hand-waved.

- **Frontend precedent** — read `PivotConfig.tsx` in full (props-driven editor, `Select` from
  `shared/ui`, `pipeline-detail-page__aggregate-*` BEM classes reused rather than one-off styling)
  and grepped `StepCard.tsx`/`useStepCardState.ts` for the `Pivot` wiring points tasks 3.3/3.4 will
  mirror — both exist and match the described pattern. `types/pipelineStep.ts`'s `PivotConfig`
  interface confirms the "4 additions per op" claim (wire type, `OP_TYPES` entry,
  `defaultConfigFor` case, narrowing helper) is a real, consistently-applied convention, not new
  process invented for this ticket.

- **`PipelineStepSpec.scala` kind-parity precedent (task 5.5)** — grepped the file; confirmed a
  `pivot.kind shouldBe PipelineStepKind.Pivot` assertion and a `case _: PivotStep =>
  PipelineStepKind.Pivot` exhaustiveness arm exist today, so "update kind-parity test" is a
  concrete, well-precedented task rather than vague.

- **`build.sbt`** — no `-Xfatal-warnings`/`Wconf` scalac flag, so a non-exhaustive `match` on
  `function: String` in `inferWindow` would warn, not fail the build (relevant to the gap noted
  below).

### Assessment against the ticket's design-gate ask

The ticket's "Design note for the design gate" explicitly demanded the design pin: (a) partition-
by/order-by/function/output-column-name semantics, (b) null handling for `lag`/`lead` at partition
edges, (c) running-total numeric-coercion parity with `aggregate`. All three are pinned with a
concrete, code-verifiable mechanism:
- (a) decisions 2–5, with scenario-level test cases in spec.md lines 25–60.
- (b) decision 4's `lag`/`lead` paragraph + spec.md's "Lag and lead at partition edges emit null"
  scenario + task 5.1's explicit "partition-edge-null cases".
- (c) decision 4's `running_sum` paragraph verified byte-for-byte against `AggregateStep.sum`'s
  actual `flatMap(toDouble).sum` behavior above.

Row-order preservation (the property that makes `window` schema-additive rather than reshaping,
per the ticket's framing) is pinned unambiguously in decision 3: partition-with-original-index →
compute over a partition-ordered view → re-emit in original input order, keyed by index rather
than by row-content equality (avoids a subtle bug where duplicate rows could be conflated).

### Gaps found (non-blocking)

1. **`inferWindow`'s behavior for an unrecognized `function` string is unspecified.** Decision 6
   enumerates exactly three typed cases (rank family → `integer`, `running_sum` → `number`,
   `lag`/`lead` → field-type-or-`string`) with no stated catch-all for an invalid `function` value
   at *analyze* time (execute-time already has a described error path in decision 4's last bullet).
   `PipelineAnalyzeService.aggResultType` (line 345) has a real precedent for this exact situation
   — a silent `case _ => "string"` fallback with no `validationError` — and since `match` on an
   arbitrary `String` isn't exhaustive-checkable, a competent implementer copying the file's
   established idiom will very likely add the same style of catch-all. Low risk (no
   `-Xfatal-warnings`, so this can't silently fail the build either way), but worth pinning
   explicitly before/during execution so the evaluator has something concrete to check.
2. **The `List.sortWith`-instability claim in decision 4 may be factually wrong** (Scala's
   `sortWith`/`sorted` on `Seq` is documented as a stable sort in the stdlib). This doesn't create
   a correctness risk — the design's chosen mitigation (build an explicit index-tie-broken stable
   ordering rather than delegating to `SortStep.apply`) is a strict superset of safety regardless
   of whether the underlying claim about `sortWith` is accurate — but the prose reasoning is
   questionable and could confuse a future reader.
3. **No task item explicitly names a "ties" test case for `rank`/`dense_rank`** in task 5.1 ("one
   per function... plus unsupported-function and partition-edge-null cases"). spec.md's own
   scenario ("Rank and dense_rank handle ties per standard SQL semantics") makes this a load-
   bearing behavior that can only be meaningfully tested with a tied-values fixture — testing
   `rank`/`dense_rank` with all-distinct order keys would pass trivially without exercising the
   the described tie-break logic at all. Recommend the evaluator specifically check for a tied-
   values fixture in the `InProcessPipelineEngineSpec.scala` additions.

None of these are placeholders, internal contradictions, or scope drift — they're precision gaps
in an otherwise thorough, code-grounded design. All backend/frontend/MCP wiring points cited exist
today and match the described pattern; the Flyway version is correctly computed against the
current worktree HEAD; every "parity with X" claim was checked against X's actual source and holds.

### Verdict: CONFIRM

### Non-blocking notes

- Pin `inferWindow`'s catch-all behavior for an invalid `function` at analyze time (recommend
  mirroring `aggResultType`'s `case _ => "string"`, no `validationError`, consistent with
  execute-time already being the authoritative failure point per the AC's own wording).
- Consider correcting or softening the `sortWith`-stability claim in design.md decision 4/Risks —
  the described implementation is safe either way, but the stated rationale may be inaccurate.
- When adding the round-trip tests in `InProcessPipelineEngineSpec.scala` (task 5.1), make sure the
  `rank`/`dense_rank` fixture includes at least one genuine tie so the "skip vs. no-gap" behavior
  is actually exercised, not merely exercised-in-name.
