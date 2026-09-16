## Context

See proposal.md — Why. Constraints verified against the tree at `b590855d`:

- `OP_TYPES` (`stepNarrowing.ts:103-128`) ends at `upsertsource`; `pipelineStepToStep` (`:285`) falls back to
  `unsupportedOpType`, which `StepOpEditor.tsx:112` renders read-only. All three ops are unauthorable today.
- `PipelineStep`/`PipelineStepConfig` unions end at `UpsertSourceConfig`, so the derived
  `PipelineStepKind` (`pipelineStep.ts:351`) does not admit the three op ids.
- Creation is optimistic and immediate: `handleInsertStep` splices a temp step from `makeStep`, then POSTs
  `defaultConfigFor(opType.id)`; on failure it keeps the temp step and toasts.
- Write-path validation is `companion.validateRawConfig` at `PipelineService.scala:1787`. A rejection returns
  **`ServiceError.UnprocessableEntity` (422)**, not 400 (`:1792-1793`) — 400 is reserved for an unknown step
  *type* (`:1789-1791`) and for a decode failure. Both AI ops delegate to an all-fields-required `validate`, so
  any incomplete config is a 422.
- `convertformat`'s validator is `strictDecodeProblem.orElse(pairError)`. `pairError`
  (`ConvertFormatConfig.scala:51-53`) collects `JsString("")` as `Some("")`, and `("","")` is not in
  `SupportedPairs` — so an **absent** `from`/`to` passes but a **present-and-empty** pair is rejected 422.
- `costVerdict` is already on `analyze` and already typed (`pipelineStep.ts:524-544`), zero non-test consumers.
  `estimatedRows` is optional and **pipeline-level**; per-step data exists only in `reasons[].stepId`.
- `helio-mcp`'s `add_pipeline_step` already documents all three shapes accurately; no MCP change is needed.

## Goals / Non-Goals

**Goals:**
- Three editable cards that cannot express a config the backend will reject for a reason the UI already knew.
- A create flow that never issues a known-invalid request.
- An honest pre-run statement of what running an AI step costs.
- Config parity between card-authored and agent-authored steps.

**Non-Goals:**
- Any `OpDropdown` restructuring, grouping/filtering, or frontend step-group mapping (HEL-1136).
- Any backend, migration or `helio-mcp` change. Any monetary/token cost figure.

## Decisions

**D1 — Register the three ops in `OP_TYPES` and nothing more.** Three entries, three `defaultConfigFor` arms,
three narrowing helpers. No group field: HEL-1136 moves grouping to a backend-owned field, so a mapping added
here would be discarded immediately.

**D2 — `convertformat` offers ONE choice of four conversions, not two `from`/`to` dropdowns.** Two dropdowns make
12 of 16 combinations expressible, every one a 422 the UI had the information to prevent. One `Select` of the four
supported conversions makes an invalid pair unrepresentable and writes `from`/`to` as a matched pair.
*Alternative rejected:* two dropdowns with inline validation — lets a user assemble a known-bad state, then scolds
them for it.
**Legacy tolerance:** a persisted step whose `from`/`to` pair is not one of the four (an older or
agent-authored row) SHALL have that pair preserved and displayed as a selected option rather than silently
coerced into one of the four — the `SortConfig.tsx:68-76` "keep the current value as an option" precedent.

**D3 — The two AI cards defer their create until the config is complete; `convertformat` keeps immediate create,
with a seed that OMITS `from`/`to`.** The ticket's central decision. No honest seed exists for either AI op:
`instruction` must be non-empty, so any validation-passing seed contains a sentence the user did not write — and
for an AI step that fabricated instruction is a *spendable* config.

- **The `convertformat` seed is literally `{ field: "" }`, with `from` and `to` deliberately ABSENT.** This is
  load-bearing, not incidental: a seed of `{ field: "", from: "", to: "" }` is rejected 422 by `pairError`, and
  `""` is what every sibling string field in `defaultConfigFor` seeds (`splittext`/`extractheadings`/
  `datebucket`/`stringops` all use `field: ""`), so the natural seed is exactly the rejected one. The model is
  `upsertsource`'s `{ mode: "append" }` (`stepNarrowing.ts:252-255`), which likewise omits the key whose
  absence the backend tolerates. The backend's own tests pin only the absent cases
  (`ConvertFormatStepSpec.scala:459-461`), never `("","")`, so nothing upstream would have caught this.
- **`persist` does NOT currently no-op for a not-yet-real step id** — an earlier draft of this decision claimed
  it did, which is false. `useStepCardState.persist` (`:233-238`) returns early only for
  `isUnsupportedOpType`, and `updatePipelineStep` PATCHes unconditionally; the only temp-id guards in the tree
  are ad-hoc `startsWith("step-")` checks in `usePipelineDetailPage.ts` (`:952`, `:1055`, `:1068`), and
  `handleInsertStep:685`'s own "PATCH calls will be no-ops until ID is real" comment is itself wrong. So a draft
  card edited before it validates would PATCH a nonexistent `step-N` and 404, swallowed for every kind except
  `upsertsource`. This design therefore adds an **explicit not-yet-real-id guard in `persist`**, with its own
  test — chosen over wiring each draft card to withhold `persist`, because the guard fixes the latent defect for
  every op rather than only the two added here.
- **"Config is complete" is defined as the backend's own validator, field-for-field.** The local predicate
  mirrors `AnalyzeWithAiConfig.validate` / `GenerateTextConfig.validate` exactly: non-empty
  `inputField`/`instruction` (and `outputField` for `generatetext`); for `analyzewithai`, 1..50 declared entries
  (`MaxOutputSchemaEntries = 50`, `AnalyzeWithAiConfig.scala:30`, enforced `:68-69`), names non-empty, unique
  and not equal to `inputField`, types within the four allowed. A narrower predicate fires a create that 422s; a
  wider one means the step never saves.

*Alternatives rejected:* (a) a fabricated-but-valid seed — violates the no-synthesized-default precedent
(`UpsertSourceConfig`'s deliberately absent `target`, HEL-386/620) and persists a spendable instruction;
(b) relaxing the backend to accept an AI draft — contradicts contracts HEL-1106/1107 set deliberately.

**D4 — `outputSchema` is edited as an ordered row list and emitted as a JSON array.** Rows carry name + type with
explicit move-up/move-down controls; the emitted value is an array in display order. Order is contractual — the
backend holds a `Vector`, writes a `JsArray`, and analyze appends declared columns in declared order. The row
count is capped at 50 in the editor, matching `MaxOutputSchemaEntries`.
*Alternative rejected:* an object keyed by field name — spray-json sorts `JsObject` keys, silently re-sorting the
user's declared order, which is the exact hazard the backend's array shape exists to avoid.
*Precedent note:* no step card has row-*reorder* controls today (`SortConfig`'s arrows are a direction toggle),
but step-level Move up/down (`PipelineRiverView.tsx:258-272`) sets the icon-button + position-bearing-`aria-label`
idiom, so keeping the move controls in the `__row-remove-btn` row-control vocabulary stays in dialect.

**D5 — The AI cost disclosure is honest and non-monetary.** No per-step monetary or token estimate exists on any
surface. The card states what is true and checkable: one model call per input row, never auto-run, drawing on the
shared daily AI budget. Where `estimatedRows` is present it is described as **the pipeline's estimated row
count**, explicitly not this step's call count — the value is pipeline-level, so for an AI step downstream of a
`filter`/`limit`/`aggregate` a per-step reading would be wrong, undercutting the very honesty this decision rests
on. No dollar or token figure is rendered.
*Alternative rejected:* deriving a dollar estimate from a token guess and a hardcoded price — a fabricated number
carrying the authority of a measurement, going stale silently with model pricing.

**D6 — Match the sibling step cards' vocabulary; do NOT use `FormField`.** Ruled explicitly. DESIGN.md §6 does
direct *new forms* to `FormField`, but no step-config card uses it (its consumers are all connector/token
surfaces), so adopting it here would make these three cards diverge from all 22 siblings — the cohesion outcome
this decision exists to prevent. The cards therefore compose `Select`, `TextField`, `Textarea` (multi-line
instruction), `InlineError` and existing `pipeline-detail-page__*` classes, using the established note classes
(`__aggregate-section-description`, `__upsertsource-radio-note`, `__compute-fields-hint`) for the disclosure
rather than a new callout. The considered trade-off is recorded here so the executor does not invent a third
option. The "unsaved draft" affordance is **`StatusChip intent="neutral" dashed`** — DESIGN.md §6's one pill
recipe, already used with that exact treatment for a not-yet-run pipeline (`PipelineListTable.tsx:37-39`) — not
a new badge, and not `SaveStateIndicator` (which reads `state.panels`/`state.dashboards` directly and is
`CommandBar`-only). No new tokens; focus rings via `--app-focus-ring` only.

**D7 — Field pickers mirror the established content-field pattern.** `convertformat`'s `field` filters the analyze
schema to `string-body`; the AI ops' `inputField` filters to `string` plus `string-body`, each matching exactly
what its backend inference accepts. Follows `SplitTextConfig`/`ChunkByTokenCountConfig`/`ExtractHeadingsConfig`,
including starting with no selection rather than auto-picking the first field.

## Risks / Trade-offs

- **Visual cohesion is judgment, not token compliance** → compare all three cards against the running app in
  both themes before the final gate; this is the batch's largest addition to this editor.
- **Deferred create changes a shared path** → keyed on a declared per-op property derived in one place, never
  op-name checks, so the 22 existing ops keep byte-identical behavior; guarded by a regression test.
- **The `persist` guard touches every op** → a narrowing (skips a PATCH that could only 404), but must be proven
  not to suppress a legitimate PATCH for a real id.
- **A draft never completed** → local-state only, gone on reload; must be visibly unsaved.
- **The re-analyze debounce is keyed on the step list** → a draft must not change the analyze fingerprint.
- **Ordered-list a11y** → move controls need position-bearing accessible names, asserted by computed accessible
  name (DESIGN.md §8), not DOM presence.

## Planner Notes

Self-approved: all seven decisions. D3 and D5 carried the real judgment and were both ruled on at the design gate
(D3 right call, D5 confirmed with no escalation owed — the live Linear AC is only the authorable/identical-configs
criterion, and the ticket's own design spec parks the cost *figure* under Open questions).

**Standing constraints promoted at this gate** (mirrored in tasks.md, binding for the rest of the run):
C1 — every status-code claim must cite the `ServiceError` the code actually returns; C2 — a guard test must be
proven failable in the direction of its stated purpose by mutating its source of truth.

**Ticket correction:** the ticket's op-wiring checklist names `allowedOps`. Zero occurrences in the working tree.
It was once real backend code (HEL-228, carried through HEL-236's `PipelineService` extraction) and has since
been removed; every recent occurrence is openspec documentation inheriting HEL-1102's ticket text. There is
nothing to wire, so it is not in tasks.md. (Stated precisely because an earlier draft claimed it had never been
code, which the history disproves.)

**Evidence path:** `premise-validation.md` lives in the MAIN repo at
`/home/matt/Development/helio/.concertino/runs/HEL-1109/evidence/`, not under `WORKTREE_PATH`. It repeats the CR1
blind spot (absent vs present-and-empty `from`/`to`), corrected in D3 above.

**Gate-chain (CON-132):** not applicable — no `.husky/**` file and no commit-gate-invoked script is touched.
