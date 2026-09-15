## Context

Every op registers through `PipelineStep.Registry` (`domain/model/PipelineStep.scala`), which feeds the
create/add gate, codec and engine. Analyze inference is dispatched by hand in `PipelineAnalyzeService`,
typed analyze responses are built in `PipelineService` (~1711), and `PipelineStepRepository.rowToDomain` (1286)
throws for an unmapped config. HEL-1105 `convertformat` is the wiring reference. Steps get runtime
dependencies only through `PipelineExecutionContext` (`evaluate(rows, ctx)`), which is built in exactly one
place, `InProcessPipelineEngine.makeContext`. That method is called by `execute` and `executeTree`, and the engine
itself is built in `PipelineRunService` (constructed in `ApiRoutes:315`). `ClaudeClient` is built in three places,
all in `ApiRoutes`, each gated on `ClaudeConfig.fromEnv()` (`Left` when there is no `ANTHROPIC_API_KEY`), each with
a fresh `HttpClaudeTransport`. `ClaudeClient.send` already rejects requests whose estimated input exceeds
`maxInputTokens` (`GuardrailExceeded`, before any network call) and clamps `maxTokens` to `maxOutputTokens`.
`StepExecutionException.from` keeps an `IllegalArgumentException` message verbatim; any other throwable becomes
"step execution failed". V107 admits the op, and `AiOps` already maps it to `ai-step`.

## Goals / Non-Goals

**Goals:** a registered `analyzewithai` op; a reusable, injectable AI seam; config-declared ordered output schema;
strict response enforcement with named reasons; analyze parity; no network in tests.
**Non-Goals:** `generatetext` (HEL-1107), tier gating (HEL-1108), StepCard (HEL-1109), migration, cost changes,
retries/batching/caching, streaming.

## Decisions

**D1 Config.** `{ inputField: string, instruction: string, outputSchema: [{name, type}] }`.
`outputSchema` is an ordered JSON array (not an object), so column order survives spray-json's key sorting.
`type` is one of `string | integer | float | boolean` (a strict subset of `DataFieldType.CanonicalWireValues`;
timestamp/string-body/binary-ref are excluded as not reliably producible by a model). Write validation (400):
non-empty `inputField` and `instruction`; 1..50 entries; names non-empty, unique, and not equal to `inputField`;
types in the subset. Read decode is tolerant, as in HEL-1105 (absent fields default to empty, and `rowToDomain` never
throws). The input field must be `string-body` or `string` at analyze time.

**D2 Client seam: `AiStepClient` on `PipelineExecutionContext`.** A new domain trait
`com.helio.domain.ai.AiStepClient { def complete(req: AiStepRequest): Future[Either[AiStepFailure, String]] }`,
added as a context field `aiClient: AiStepClient = AiStepClient.Unavailable` (default keeps every existing
construction compiling). `Unavailable` returns `Left(Unavailable("ANTHROPIC_API_KEY is not configured"))`.
Production adapter: `ClaudeAiStepClient(client: ClaudeClient)` maps the three `ClaudeError`s to `AiStepFailure`
(`Guardrail`, `Api`, `Transport`; `Unavailable` is produced only by the context default), sends one user message, and returns the response text.
Wiring: `InProcessPipelineEngine` and `PipelineRunService` gain a constructor param
`aiStepClient: AiStepClient = AiStepClient.Unavailable`, which is threaded into `makeContext`. `ApiRoutes` builds it once from
`ClaudeConfig.fromEnv()` using the same Left/Right pattern and log-warn as `assistantServiceOpt`, with a fresh
`ClaudeClient` + `HttpClaudeTransport` following the file's convention. Why the context and not a step constructor param: steps are
rebuilt from rows by the registry/codec with no DI, and the context is the existing runtime-dependency channel
(`loadSource`, sinks). Why a domain trait rather than `ClaudeClient` directly: tests inject a fake `ClaudeTransport`
behind the real `ClaudeClient` (so guardrails are exercised) or a trivial fake `AiStepClient`, and HEL-1107
reuses `complete` unchanged. Rejected: a global/object singleton (untestable, reads env at call time) and
passing `ClaudeConfig` into the domain (drags `com.helio.ai` into every step).

**D3 Degrade path.** With no key the backend boots, create/analyze work, and a run fails at the step with
`analyzewithai ai-unavailable: ...`. It never skips the step and never emits null columns.

**D4 HEL-1108 call point.** Every model call from a pipeline step goes through the one method
`AiStepClient.complete`; `ClaudeAiStepClient.complete` is the single place where HEL-1108 adds the tier/quota check
(it will need the run's owner, so `AiStepRequest` carries an optional `ownerUserId` now, populated when the
engine knows it and otherwise `None`). This ticket does not implement it. A code comment names HEL-1108.

**D5 Prompt and parsing.** One call per input row, run sequentially (bounded cost, deterministic order). The prompt
states the instruction, the exact output keys and types, and "respond with only a JSON object". Response text:
trim, and strip one surrounding markdown code fence if present (documented tolerance). Then parse with Jackson using
`FAIL_ON_TRAILING_TOKENS` enabled plus an explicit end-of-input check (HEL-1105 lesson: `readTree` ignores trailing
content).

**D6 Enforcement (all-or-nothing per row, whole run fails on first bad row).** Reason codes, formatted as
`analyzewithai <code>: <detail>` and thrown as `IllegalArgumentException`:
`field-missing` (absent or null input), `field-not-string`, `ai-unavailable`, `ai-guardrail`, `ai-error`,
`response-malformed-json` (unparseable, or trailing content), `response-not-object`,
`response-missing-field` (a declared key absent; JSON `null` counts as missing, since spray/Jackson null vs absent are not
distinguished downstream), `response-wrong-type` (string must be a JSON string; integer must be an integral number
that fits in a Long, with no fractional part; float any JSON number, stored as Double; boolean a JSON boolean; no string
coercion), `response-extra-field`. **Extra fields fail** rather than being dropped: silently discarding keys would
hide prompt or model drift and conflicts with "enforced", and the declared schema stays the whole truth. Output columns
are added only after the entire response validates, so partial columns are unreachable by construction. An output name
that collides with an existing input column overwrites it (documented, same as `compute`).

**D7 Analyze parity.** `inferAnalyzeWithAi` checks the input field exists and is `string-body`/`string`, and that the
config is valid (shared `AnalyzeWithAiConfig.validate`); output = input schema plus declared columns in declared order.
It never calls the model. `AnalyzeWithAiAnalyzeStepResponse` mirrors ConvertFormat's.

**D8 Cost and tests.** `AiOps` is unchanged, and the partition test stays green because the op was already classified.
`PipelineCreateTransactionalSpec` rejection loops that used `analyzewithai` as an unregistered stand-in are updated
(not deleted), with an accept case added. Response-enforcement tests run through the real `ClaudeClient` over a fake
`ClaudeTransport`. Each failure arm has a recorded mutation showing it red.

## Risks / Trade-offs

- [Per-row sequential calls are slow and costly on large inputs] -> already `ai-step`-denied from auto-run;
  HEL-1108 adds quota; batching is a follow-up.
- [Strict typing rejects "42" for integer] -> named `response-wrong-type`; it is predictable rather than silently coerced.
- [Code-fence stripping is a tolerance] -> limited to exactly one outer fence; anything else is still malformed.
- [Constructor defaults hide a missing wiring] -> an `ApiRoutes` wiring test asserts a non-`Unavailable` client when a key
  is set.

## Planner Notes

- Self-approved: config names, type subset, extra-field-fails policy, code-fence tolerance, reason codes, seam
  name/location, sequential per-row calls.
- Frontend: the unsupported-op fallback renders a persisted step; no change expected.
