## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

- **Read all planning artifacts**: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/pipeline-dedupe-op/spec.md` in
  `openspec/changes/pipeline-dedupe-op/`.

- **Schema-passthrough template (`LimitStep`) confirmed identical shape to the plan.** Read
  `backend/src/main/scala/com/helio/domain/steps/LimitStep.scala` — tolerant `decode`, `apply`,
  `companion` with `decodeConfig`/`encodeConfig`/`readFromWire`/`writeToWire`. `DedupeStep` as
  planned mirrors this exactly (task 1.2).

- **`SortStep` stable-ordering precedent confirmed** (`SortStep.scala`) — `Row = Map[String, Any]`
  (verified in `PipelineRowJson.scala:16`), null handling via `Option(row.getOrElse(field, null))`.
  Design's null-key-collapses-via-`Any`-equality claim is consistent with how the engine already
  treats nulls elsewhere.

- **`PipelineAnalyzeService.scala:67`** — `case "filter" | "limit" | "sort" => (inputSchema, None)`.
  Confirmed this is the exact passthrough dispatch group the ticket/design/tasks (1.6) say to extend
  with `'dedupe'`. No new dispatch branch needed, as claimed.

- **All exhaustive-match consumer sites confirmed present and enumerated in tasks.md 1.3–1.8**, by
  grepping `Unpivot`/`Limit` in each file named in the ticket's "Consumers to update" list:
  `PipelineStep.scala` (Registry + Kind), `PipelineStepProtocol.scala` (`jsonFormat6` pattern,
  `fromDomain`, union read/write), `PipelineStepConfigCodec.scala` (`encodeConfig`/`extractConfig`
  arms), `PipelineAnalyzeProtocol.scala` (`AnalyzeStepResponse` subtype + `jsonFormat6` + union arms),
  `domain/package.scala` (type/val aliases), `PipelineStepRepository.scala` (`rowToDomain` match),
  `PipelineService.scala` (`toAnalyzeStepResponse` match). Grepped `backend/.../api/` and
  `backend/.../validation/` for any other `Unpivot` touch points beyond these three protocol files —
  none found, confirming the wiring list is exhaustive (no missing contract-update site).

- **Flyway max migration confirmed**: `ls backend/src/main/resources/db/migration/` → highest is
  `V67__add_unpivot_op.sql`, matching the ticket's stated "worktree base already has V67" and the
  design's deferred-VNN approach (task 1.1 re-checks before writing; no VNN is hardcoded anywhere in
  the artifacts).

- **Frontend wiring points confirmed real** via grep of `UnpivotConfig`/`unpivot` sibling wiring:
  `pipelineStep.ts` (type unions), `stepNarrowing.ts` (`OP_TYPES`, `defaultConfigFor`,
  `unpivotConfigOf` pattern), `StepCard.tsx` (`import { UnpivotConfig } ...`, conditional render),
  and `hooks/useStepCardState.ts` (config state + `onUnpivotChange`) — note the actual file lives at
  `frontend/src/features/pipelines/hooks/useStepCardState.ts`, not `ui/`, but tasks.md 3.4 doesn't
  claim a path so this isn't a discrepancy.
  `SortConfig.tsx` confirmed as a real precedent for a toggle-button UI pattern (asc/desc), and
  `SelectFieldsConfig.tsx` confirmed as a real precedent for a field-multi-select-like checklist —
  both support design.md's "reuse existing patterns" claims rather than inventing new widgets.

- **MCP wiring confirmed**: `helio-mcp/src/tools/write.ts:158-180` documents `pivot`/`unpivot` op
  shapes inline in a free-text description string (not an enum), matching the ticket's explicit note
  and task 4.1.

- **Mechanisms exist for every pinned design claim**: `spec.md` has scenario coverage for whole-row
  distinct, key-set + keep=first, key-set + keep=last (with an explicit stable-order assertion),
  null-key collapsing, missing-keep-defaults-to-first, and analyze passthrough. `tasks.md` 5.1–5.4
  map each of these to concrete test additions (`InProcessPipelineEngineSpec`, analyze test, codec
  round-trip test, `PipelineStepSpec` kind-parity), and 5.5 covers the frontend editor. Traced the
  keep=last worked example by hand against the design's "lookahead pass, single emit pass" algorithm
  (`{id:1,v:a},{id:2,v:b},{id:1,v:c}` → lastIndex={1:2, 2:1} → emit index1, index2 in original order →
  `[{id:2,v:b},{id:1,v:c}]`) — it produces exactly the spec's expected output.

- **No placeholders/TBDs found** in any artifact; no internal contradictions between
  proposal/design/tasks/spec; every ticket AC traces to at least one task and one spec scenario.

### Gap found

The ticket (and design.md, twice — in "Planner Notes" and "Risks / Trade-offs") explicitly requires
**two** Flyway max-migration re-checks: "immediately before writing the migration **and again right
before the delivery push**," calling this out as a MERGE HAZARD given concurrent v1.6 lanes
contending for the same V-number. `tasks.md` only encodes the first check (task 1.1, `ls` before
writing). I grepped `tasks.md` for `push`/`delivery`/`re-confirm`/`reconfirm` and found no second
checklist item. Since `tasks.md` is the operational checklist the executor works off of, and the
ticket names this a live collision risk (V67/`unpivot` already landed via a concurrent HEL-380 PR per
the ticket's own text), the second re-check needs its own task line or it's likely to be skipped —
low severity (a collision would fail loudly at migration-apply/CI time, not silently corrupt data),
but concrete, specific, and free to fix now.

### Verdict: REFUTE

### Change Requests

1. `tasks.md` — add an explicit task (e.g. in a new "6. Pre-delivery" section, or appended to section
   2) that re-runs `ls backend/src/main/resources/db/migration/ | sort` immediately before the
   delivery push and renames/renumbers the migration file if a higher `V*` has landed in the interim,
   per the ticket's stated MERGE HAZARD and design.md's own Risks section. This closes the gap between
   what the ticket/design mandate (two checks) and what tasks.md currently operationalizes (one
   check).

### Non-blocking notes

- design.md's "Single left-to-right pass, not two passes" decision heading is a little confusing
  since the `keep=last` case is described as needing two passes (lookahead + emit) immediately below
  it — the point being made is "not a reverse/dedupe/reverse-again pass," which is correct, but the
  heading could be reworded for clarity during implementation. Not a soundness issue.
- `stepNarrowing.ts` `OP_TYPES` icon choice for `dedupe` is left unspecified (reasonable — a normal
  implementation-time pick, not a design gate.
