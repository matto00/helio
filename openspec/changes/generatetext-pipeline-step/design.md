## Context

See proposal.md — Why. HEL-1106 already built everything this step needs at runtime: the domain trait
`com.helio.domain.ai.AiStepClient` (`complete(AiStepRequest): Future[Either[AiStepFailure, String]]`), carried as
`PipelineExecutionContext.aiClient` defaulting to `AiStepClient.Unavailable`, with the production adapter
`ClaudeAiStepClient` wired once in `ApiRoutes` from `ClaudeConfig.fromEnv()` and threaded
`PipelineRunService` → `InProcessPipelineEngine.makeContext`. Verified against the tree: the seam is
model-agnostic and is reused here unchanged — no new wiring, no second `ClaudeClient`.

Registration follows `convertformat`/`analyzewithai`: `PipelineStep.Registry` + `PipelineStepKind`,
`PipelineStepConfigCodec`, `PipelineStepRepository.rowToDomain` (throws `IllegalStateException` for an unmapped
config), hand-dispatched analyze inference in `PipelineAnalyzeService`, a typed analyze response in
`PipelineService` (~1712) and the two protocol files. `StepExecutionException.from` keeps an
`IllegalArgumentException`'s message verbatim, which is how named reason codes reach a run's error.
V107 already admits the op string and `PipelineCostEstimator.AiOps` already contains `generatetext`.

## Goals / Non-Goals

**Goals:** a registered `generatetext` op; per-row free-text generation through the existing seam; a
`string-body` output column reported by analyze; named failure reasons; no network in tests.

**Non-Goals (beyond proposal.md):** no new AI seam or wiring; no JSON/schema enforcement (this step's response
is free text by definition); no N-to-1 collapse and no toggle for one; no `AiOps` change; no migration; no
`OutputBindingSpec`/`PanelContent` change.

## Decisions

**D1 Output shape: per-row, one call per row (owner ruling).** `rows.foldLeft` over a `Future`, exactly
mirroring `AnalyzeWithAiStep.apply`: sequential, deterministic order, and a failure on row N issues no call for
row N+1. Accepted rationale: (a) consistency — every existing non-aggregate step is a per-row or per-row-flatMap
transform, and only `aggregate`/`groupby` collapse rows, so a collapsing step here would be the sole exception
in the registry; (b) cost legibility — one call per row makes spend scale visibly with row count rather than
hiding a variable-size prompt behind a single call. The N-to-1 "one narrative for the whole frame" variant is
**deferred**, and deliberately not built as a mode toggle: a toggle would double the analyze contract (row count
and output schema both change with the mode) for a shape nobody has asked for yet.

**D2 Config: `{inputField, instruction, outputField}`.** All three required non-empty at write time (400),
sharing one `GenerateTextConfig.validate` between the write path and `requiredConfigProblems` so the two
surfaces cannot diverge — the contract `analyzewithai` established. Read decode is tolerant (every key defaults
to `""`), so `rowToDomain` never throws on a legacy or partially-configured row. `inputField` must be `string`
or `string-body` at analyze time, matching `inferAnalyzeWithAi`.

`outputField` deliberately does **not** default to `inputField`, which is where this departs from
`ConvertFormatConfig` (whose `outputField` defaults to `field`, overwriting in place). A format conversion that
overwrites its source is lossless in intent; a generator that silently replaced the source content it was asked
to summarize would destroy the input. An explicit `outputField` that *happens* to name an existing column still
overwrites it, documented, same as `compute`/`convertformat`.

**D3 No response schema, and why.** `analyzewithai` enforces a declared `outputSchema` against parsed JSON.
`generatetext` has no schema to enforce: the deliverable *is* prose. So there is no Jackson parse, no fence
stripping, and none of the `response-*` JSON reason codes. The single response-level failure is
`response-empty` (empty or whitespace-only), which is the one case where "success" would otherwise write a blank
`string-body` cell that looks like data. HEL-1106's declared-output-schema precedent was considered and
rejected here for that reason — a schema over free text would either be vacuous or would re-introduce the JSON
contract this step exists to avoid.

**D4 Reason codes**, thrown as `IllegalArgumentException` formatted `generatetext <code>: <detail>`:
`field-missing`, `field-not-string`, `ai-unavailable`, `ai-guardrail`, `ai-error`, `response-empty`. The four
`AiStepFailure` variants map exactly as `AnalyzeWithAiStep` maps them (`Unavailable`→`ai-unavailable`,
`Guardrail`→`ai-guardrail`, `Api`/`Transport`→`ai-error`). Nothing is written to the row until the response has
passed the non-blank check, so a partially-written output cell is unreachable by construction.

**D5 Token budget (AC2).** No token accounting in this step. `ClaudeClient.send` already clamps `maxTokens` to
`maxOutputTokens` and rejects an over-budget request with `GuardrailExceeded` *before* any network call; that
surfaces here as `ai-guardrail`. The "over-long input" case is therefore answered by the existing clamp, not by
truncating or chunking in this step — truncation would silently change what the user asked to summarize.
Empty input (zero rows) issues zero calls and yields zero rows.

**D6 Analyze parity.** `inferGenerateText` validates the config, checks `inputField` exists and is
`string`/`string-body`, then returns the input schema with `outputField` set/added as `string-body`, using
`inferConvertFormat`'s exact `filterNot(_.name == outputField) :+ SchemaField(outputField, "string-body")`
collision pattern. It never calls the model. `GenerateTextAnalyzeStepResponse` mirrors ConvertFormat's.
This is what satisfies restated AC1: the generated column is reported as a real `string-body` column at the
node, so the Output layer can offer it as a bindable column.

**D7 The markdown-Output binding defect is pre-existing and out of scope.** `buildOutputConfig.ts:107-117`
persists `{content:"", fieldMapping:{content:<column>}}` when the Output sheet's Content slot is in "field"
mode, but `OutputBindingSpec.Markdown` declares both slot vectors empty, so `OutputService.validateFieldMapping`
400s that config on create (`:141`) and on merged PATCH (`:252`); `PanelContent.tsx:176` renders only literal
`cfg.content`, ignoring `fieldMapping` and rows (HEL-909 retired bound mode). That defect predates this ticket,
is filed separately by the driver, and is **not** touched here. Narrative rendering belongs to HEL-921.

**D8 The unregistered-op 500 probe needs a constraint drop, not just a rename.** `PipelineAnalyzeRoutesSpec`'s
"persisted `generatetext` row 500s at decode" probe must be re-pointed, not deleted — but renaming the op alone
does not work, and this corrects the instruction as received. That probe inserts its row by raw SQL, and V107's
`pipeline_steps_op_check` admits exactly 27 op strings; once this ticket registers `generatetext`, **every**
V107-legal op is registered, so no V107-legal-but-unregistered op name exists for the probe to use. A fake name
would fail the CHECK instead of reaching `rowToDomain`, turning the probe green for the wrong reason. The suite
starts its own `EmbeddedPostgres` in `beforeAll`, so the fix is to drop `pipeline_steps_op_check` inside that
isolated DB before inserting a fake op (`notarealop`) — precedent: `V98PipelineRootsMigrationSpec:388` and
`PipelineStepsOpCheckOwnershipRequiredSpec` both do exactly this. The comment must state why the drop is
required, or a future reader will "simplify" it back to a plain insert.

**D9 Registry-enumerating tests are updated deliberately.** Six pinned surfaces enumerate the registry and go
red on registration: `PipelineStepRequiredConfigSpec` (`Registry should have size 26` → 27, plus the exact
keySet, plus the empty-`{}`-seed exemption list — `generatetext` joins `analyzewithai` as exempt, since D2
requires non-empty fields at write time), `PipelineStepSpec` (`PipelineStepKind.All` set and the subtype list),
`PipelineAnalyzeServiceSpec`'s coverage guard (a fully-valid `probesByKind` entry over a `string-body` schema —
the guard asserts `validationError` is `None`, so a vacuous probe would not pass), `PipelineStepConfigCodecSpec`
(`All` iteration must tolerate `decode("{}")`), and `PipelineCreateTransactionalSpec`'s reject-loop, which is
currently `Seq("generatetext")` and becomes empty — replaced by an "accept a generatetext step" case mirroring
the `upsertsource`/`convertformat`/`analyzewithai` flips. `PipelineCostEstimatorSpec`'s partition test stays
green untouched: it already tolerates `AiOps` naming ops outside the registry, and `generatetext` simply moves
from "named but unregistered" to "named and registered", which the partition still satisfies.

A seventh surface, added from skeptic-design-1.md's non-blocking note: `PipelineStepRepositorySpec:100-110`
also iterates `PipelineStepKind.All`, inserting `config='{}'` per kind and asserting decode does not throw and
that the kind set matches `All`. It needs **no edit** — D2's tolerant `decode` satisfies it automatically, the
same way `PipelineStepConfigCodecSpec`'s loop is satisfied — but it is listed here so a reader who sees it go
red knows tolerant decode is the cause rather than patching the test.

## Risks / Trade-offs

- [Per-row calls are slow/costly on large frames] → already `ai-step`-denied from auto-run; HEL-1108 adds
  quota; batching is a follow-up. D1 makes the cost visible rather than hidden.
- [`response-empty` rejects a legitimately empty generation] → a blank `string-body` cell is indistinguishable
  from missing data downstream; failing loudly with a named code is preferable to writing a blank.
- [Dropping a CHECK constraint in a test] → confined to that suite's own embedded Postgres (never the shared
  dev DB), with a comment stating why; the alternative is a probe that passes for the wrong reason.
- [`outputField` overwrite is allowed] → documented, and analyze reports the post-overwrite schema, so a
  collision is visible before a run.

## Planner Notes

Self-approved: config key names; `outputField` required rather than defaulted (D2); no response schema and the
single `response-empty` code (D3); reason-code names (D4); the analyze collision pattern (D6); the constraint
drop in the re-pointed probe (D8).

Owner-ruled, not self-approved: restated AC1 / markdown render path out of scope; per-row output shape with the
collapse variant deferred and no mode toggle.

Frontend: no change. `unsupportedOpType` renders a persisted `generatetext` step read-only, and no test asserts
`OP_TYPES` covers the backend registry. Step card is HEL-1109.
