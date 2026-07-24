## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-fillnull-op/spec.md` in `openspec/changes/fillnull-pipeline-op/`. No code exists
  yet (`find . -iname "*fillnull*" -not -path "./openspec/*"` → empty; `git status --short` shows
  only the untracked change dir) — appropriate for a design-gate review.

- **`CastStep.scala` template confirmed** (`backend/src/main/scala/com/helio/domain/steps/CastStep.scala`)
  — per-field transform via `casts.foldLeft(row) { ... r + (field -> castValue(...)) }`, tolerant
  `decode`, `companion` shape. `FillNullConfig`'s planned `decode`/`apply`/`companion` (tasks.md 2.1)
  mirrors this exactly.

- **`DedupeStep.scala` (HEL-382) confirmed** as the immediately-prior sibling in this same epic —
  same file layout, same `companion` object shape, same tolerant-decode pattern design.md cites.

- **`WindowStep.scala` (HEL-376) confirmed** as the order-dependent, single-pass precedent design.md
  cites for forward-fill: `zipWithIndex` to retain original order, `PipelineRowJson.toDouble` for
  numeric coercion (`computeRunningSum`), explicit `IllegalArgumentException` for unsupported
  function/missing field. `FillNullStep`'s planned forward-fill (single left-to-right pass, "last
  seen" tracker seeded to null, leading-null stays null) is mechanically the same shape, correctly
  scaled down (no partitioning needed since fillnull has no `partitionBy`).

- **`AggregateStep.scala`'s `avg` case confirmed** (`case "avg" => if (nums.isEmpty) null else
  nums.sum / nums.size`, with `nums = ... flatMap(toDouble)`) — this is exactly the precedent
  design.md Decision 5 cites for (a) numeric coercion via `PipelineRowJson.toDouble` excluding
  non-numeric values from `mean`/`median`, and (b) the all-null-column-stays-null (never a hard
  failure) behavior. `PipelineRowJson.toDouble` confirmed to exist with the claimed signature
  (`PipelineRowJson.scala:64-71`).

- **`PipelineAnalyzeService.scala:67` confirmed**: `case "filter" | "limit" | "sort" | "dedupe" =>
  (inputSchema, None)` — this is the literal identity-passthrough dispatch group tasks.md 3.4 says to
  extend with `"fillnull"`. Note: `"cast"` is dispatched separately via `inferCast` (line 70), which
  *can* change field types per `casts` map — it is not literally part of the same case arm as
  filter/limit/sort/dedupe, even though design.md/proposal.md's prose lists it alongside them as an
  "identity group" member. This is a minor factual imprecision in the illustrative language (flagged
  as a non-blocking note below); it does not change the concrete, correct implementation instruction
  in tasks.md 3.4 ("output schema == input schema"), and a competent implementer reading the actual
  `case` statement would not merge `fillnull` into `cast`'s dispatch branch.

- **All exhaustive-match consumer files confirmed to exist and match the ticket's/tasks.md's list**:
  `backend/src/main/scala/com/helio/domain/package.scala`,
  `backend/src/main/scala/com/helio/infrastructure/PipelineStepRepository.scala`,
  `backend/src/main/scala/com/helio/services/PipelineService.scala`,
  `backend/src/main/scala/com/helio/domain/PipelineStep.scala`,
  `backend/src/main/scala/com/helio/api/protocols/PipelineStepProtocol.scala`,
  `backend/src/main/scala/com/helio/api/protocols/PipelineStepConfigCodec.scala`,
  `backend/src/main/scala/com/helio/api/protocols/PipelineAnalyzeProtocol.scala` — grepped `dedupe`
  across `backend/src/main/scala/com/helio` to confirm this is the exhaustive list (no additional
  hits outside these files plus `DedupeStep.scala` itself).

- **`jsonFormat6` shape confirmed**: `DedupeStepResponse`/`UnpivotStepResponse` both use
  `jsonFormat6` (id, pipelineId, position, createdAt, updatedAt, config) — matches tasks.md 3.2's
  plan for `FillNullStepResponse`.

- **Flyway max migration confirmed**: `ls backend/src/main/resources/db/migration/ | sort` → highest
  is `V68__add_dedupe_op.sql`. Matches the ticket's own re-derivation ("main is now at V68 after
  HEL-382/PR #283, so next free is likely V69"). Neither design.md nor tasks.md hardcodes a VNN
  anywhere — confirmed by grep for `V69`/`V6\d` patterns, none found outside the ticket's own
  reasoning text.

- **Both required migration re-checks are present as distinct, explicit tasks** — this was the
  specific gap that got HEL-382 (DedupeStep) REFUTEd on round 1 (read
  `openspec/changes/archive/2026-07-24-pipeline-dedupe-op/skeptic-design-1.md` for the precedent).
  Task 1.1 ("immediately before writing the migration — do not trust the ticket/design's stated VNN")
  and task 7.1 ("immediately before the delivery push ... do not reuse the check from task 1.1") are
  both present, both non-hardcoded, both named as explicit checklist items in tasks.md sections 1 and
  7 respectively. This closes exactly the gap that recurred on the prior leaf.

- **MCP wiring confirmed**: `helio-mcp/src/tools/write.ts:190-192` — `type: z.string().min(1)` is
  free-text, not a `z.enum`, confirming design's/tasks.md 5.1's claim that no schema change is needed,
  only a description-string documentation update (matches the accepted `dedupe` precedent at
  `write.ts:183-189`).

- **Frontend wiring points confirmed real**, via grep of the `dedupe` sibling implementation:
  `frontend/src/features/pipelines/types/pipelineStep.ts` (interface + step union + config union +
  analyze-step interface + analyze union — multiple touch points, all present for `Dedupe`),
  `frontend/src/features/pipelines/state/stepNarrowing.ts` (`OP_TYPES`, `defaultConfigFor`,
  `dedupeConfigOf`), `frontend/src/features/pipelines/ui/StepCard.tsx` (conditional render + import),
  and `frontend/src/features/pipelines/hooks/useStepCardState.ts` (config state + `onDedupeChange`) —
  note the real path is `hooks/useStepCardState.ts`, not `state/useStepCardState.ts` as the ticket's
  prose loosely implies; tasks.md 4.4 itself doesn't hardcode an incorrect path, so this is not a
  discrepancy in the operative artifact.

- **Every design claim the ticket asked me to pin has a corresponding spec.md scenario and a
  tasks.md test task**: strategy/column-type behavior (mean/median numeric-coercion-only via
  `toDouble`, mode/constant/forwardFill any type) — spec.md "Column-statistic strategies" requirement
  + scenarios; forward-fill semantics (carry last non-null, leading-null stays null) — spec.md
  "Forward-fill strategy" requirement + two scenarios, tasks.md 2.3/6.1; column-stat computation
  (single pass, non-null values only, median/mode-tie handling) — design.md Decision 5 + spec.md
  scenarios (mean/median/mode/all-null-stays-null), tasks.md 2.4/2.5; null definition (`JsNull` and/or
  missing key) — design.md Decision 2 (traced to `PipelineRowJson.jsValueToAny` and the universal
  `row.getOrElse(field, null)` pattern) + spec.md "Missing key is treated as null" scenario;
  per-field strategy config — resolved deliberately as Decision 1 (one strategy per step instance,
  chaining for per-column mixing), matching the ticket's literal `FillNullConfig` signature; analyze
  passthrough — spec.md "Schema pass-through on analyze" scenario + tasks.md 3.4/6.2, and verified
  against the live `PipelineAnalyzeService.scala` dispatch as above.

- **No placeholders/TBDs found** (`grep -rniE "TODO|TBD|figure out|placeholder|to be decided"` across
  all artifacts — zero hits). No internal contradictions between proposal/design/tasks/spec. Every
  ticket AC traces to at least one task and one spec.md scenario.

### Verdict: CONFIRM

### Non-blocking notes

- design.md's Goals section and proposal-adjacent prose describe `fillnull` as joining "the
  cast/filter/limit/sort/dedupe identity group in `PipelineAnalyzeService`" — ground truth shows
  `cast` is dispatched via its own `inferCast` function (line 70), not the literal
  `case "filter" | "limit" | "sort" | "dedupe"` arm (line 67) that `fillnull` should actually join.
  Worth a one-word tweak during implementation (drop "cast" from that parenthetical, or clarify it
  means "conceptually schema-preserving like cast" rather than "same case arm") so a future reader
  isn't tempted to literally merge `fillnull` into `cast`'s dispatch branch. Does not block — tasks.md
  3.4's actual instruction ("output schema == input schema") is correct and unambiguous regardless.
- tasks.md 7.1 re-confirms the VNN is still current before the delivery push but doesn't spell out
  the corrective action (rename/renumber the migration file) if a collision is found, the way the
  accepted `dedupe` precedent's task 2.2 did explicitly. The re-check itself is present and
  non-hardcoded, satisfying the substantive requirement; making the corrective action explicit would
  be a small clarity improvement for the executor but isn't required to pass this gate.
