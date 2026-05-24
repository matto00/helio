# Executor report — CS2c-3a (cycle 3)

## Status

**Complete.** PR #151 was APPROVED at the end of cycle 2; cycle 3 folds in
the polymorphic-method-per-step-file refactor the user requested before
merge. All 577 sbt tests + 664 jest tests stay green; wire shape, DB
columns, frontend, and cross-type PATCH semantics are unchanged.

## What changed (high level)

The cycle-1/2 shape was:

- `domain/Pipeline.scala` — pure data ADT (10 subtypes + 10 config case
  classes co-located)
- `domain/PipelineStepHandlers.scala` — separate central object with all 10
  `applyX` functions, plus shared row<->JsValue helpers
- `domain/InProcessPipelineEngine.scala` — pattern-matches the step → calls
  the matching handler
- `api/protocols/PipelineStepConfigCodec.scala` — single 264L file with
  `decode<Kind>` per kind for read-path tolerance + per-kind encoders
- `api/protocols/PipelineStepProtocol.scala` — single discriminated-union
  `RootJsonFormat[PipelineStep]` dispatching on `type` + re-declared
  per-config formats

Cycle 3 collapses that into self-contained per-kind modules:

- `domain/PipelineStep.scala` (new, 150L) — trait + `Companion` + `Registry`
  + `PipelineExecutionContext` + `PipelineStepKind` (now registry-derived)
- `domain/steps/<Kind>Step.scala` × 10 (60–121L each) — each owns its
  `*Config` case class, JSON format, tolerant `decode(raw)`, `*Step`
  implementation with `evaluate(rows, ctx)`, and the `companion` registry
  entry
- `domain/steps/StepCodecUtil.scala` (30L) — shared `asObject(raw)` +
  `stringOr` helpers used by per-step decoders
- `domain/PipelineRowJson.scala` (new, 77L) — cross-cutting row<->JsValue
  helpers extracted from the deleted handlers object
- `domain/InProcessPipelineEngine.scala` (124L, was 145L) — dispatch
  collapsed to `step.evaluate(rows, ctx)`; engine assembles the
  `PipelineExecutionContext`
- `domain/package.scala` (61L) — re-exports steps.* so `import
  com.helio.domain._` keeps resolving every step / config type
- `api/protocols/PipelineStepConfigCodec.scala` (115L, was 264L) — reduced
  to a thin facade over `PipelineStep.Registry`; the four public methods
  (`decode` / `encode` / `encodeConfig` / `encodeJsObject`) preserve their
  cycle-2 signatures
- `api/protocols/PipelineStepProtocol.scala` (178L, was 176L) — per-config
  formats now sourced from `*Config.format` on each step module's
  companion; wire shape unchanged
- `services/PipelineRunService.scala` — three call sites switched from
  `PipelineStepHandlers.anyToJsValue` to `PipelineRowJson.anyToJsValue`

Files deleted:

- `domain/Pipeline.scala` — superseded
- `domain/PipelineStepHandlers.scala` — logic distributed to step files

## Decisions log

### `sealed` dropped on the trait

Scala 2's `sealed` keyword constrains subclasses to the same compilation
unit. The whole point of the cycle-3 refactor is to put each step's case
class in its own file under `domain/steps/`, which is incompatible with
`sealed`. The compiler rejected the first attempt:

```
[error] illegal inheritance from sealed trait PipelineStep
[error] ) extends PipelineStep {
```

Resolution: declare `trait PipelineStep` (non-sealed). The safety
properties cycle 1's `sealed` provided are preserved by:

1. **`PipelineStep.Registry`** is the single source of truth — only
   registered kinds round-trip through the codec / protocol / engine.
2. **`PipelineStepKind.All` is now `def All = Registry.keySet`** rather
   than a hard-coded `Set(...)`. The kind-set parity test in
   `PipelineStepSpec` (`PipelineStepKind.All shouldBe Set("rename",
   "filter", ...)`) catches drift on the test side.
3. **Documented in the trait's scaladoc** so future contributors
   understand the trade-off.

The match sites that previously relied on sealed exhaustiveness warnings
(`PipelineStepResponse.fromDomain`, `PipelineStepConfigCodec.extractConfig`,
the protocol writer, the `PipelineStepSpec` exhaustiveness test) still
enumerate the 10 subtypes; the exhaustiveness assertions in
`PipelineStepSpec` provide a test-driven safety net.

### `PipelineStepConfigCodec` kept as a thin facade (not deleted)

The cycle-3 prompt offered two paths: delete the codec entirely (each step
file owns its codec) or keep it as a thin dispatcher. I kept it.

Why: the service + repository call sites consume
`PipelineStepConfigCodec.{decode, encode, encodeConfig, encodeJsObject}`
extensively. Deleting the codec would require touching every call site
in `PipelineService.scala`, `PipelineStepRepository.scala`, the analyze
flow, and ~30 test assertions in `PipelineStepConfigCodecSpec`. The
behaviour-preserving rule from `feedback-refactor-discipline.md`
("structural change is not the place to also fix bugs or
'improve' defaults") argued for the minimal-surface-disruption path.
The codec is now 115L of pure dispatch over `PipelineStep.Registry` —
it's the thinnest version that preserves the public surface.

The per-kind tolerance defaults that used to live inside the codec now
live in each step module's `*Config.decode(raw)` — co-located with the
data definition they protect. That's the structural win the user
asked for.

### Per-step companion shape — `decodeConfig`, `encodeConfig`, `readFromWire`, `writeToWire`

The `Companion` trait exposes four methods. The decode/encode pair is
used by the codec facade (persistence boundary); the readFromWire /
writeToWire pair is the natural extension point for the protocol
union (currently the union still enumerates the 10 subtypes inline,
but the registry-aware path is now wired so a future cycle can swap the
union to dispatch via `companion.readFromWire(json)` without changing
the codec or the engine).

I chose `Any` for the config-typed methods rather than threading a
sealed `PipelineStepConfig` trait. Rationale: the cycle-2 evaluation
flagged "sealed `PipelineStepConfig` trait" as a forward marker
(spinoff #2) precisely because it changes the `Try[Any]` return shape
the repository / service depend on. That's a separate cycle's work —
threading the typed config trait through every caller is a
compile-error-driven migration that doesn't belong in the per-file
refactor.

### Analyze-layer typed inference — deferred

Per the prompt's explicit instruction: the analyze-layer stringly-typed
carve-out (`validationError: "Unknown op: 'join'"` on the analyze
response, cycle-2 forward marker #4) was tempting to fold in alongside
`evaluate`. Folding `inferOutputSchema` into the trait would collapse
the carve-out — but doubling the surface this cycle risks the cycle.
Deferred. Captured as a forward marker below.

## Verification gates (cycle 3)

| Gate | Result |
|---|---|
| `sbt test` | **577 / 577 PASS** (no regressions; no new tests this cycle — the existing tests exercise every per-step path via the registry-derived codec) |
| `npm test` | **664 / 664 PASS** (frontend untouched) |
| `npm run lint` | clean (zero warnings) |
| `npm run format:check` | clean |
| `npm run check:schemas` | clean (6 schemas checked across 13 protocol files) |
| `npm run check:openspec` | clean |
| `npm run check:scala-quality` | clean — **19 soft warnings** (was 21; cycle 2's codec at 264L and handlers at 311L are both gone) |
| AuthService diff vs main | empty (`git diff main -- backend/src/main/scala/com/helio/services/AuthService.scala` → 0 lines) |
| Husky pre-commit hook | passes on every commit; no `--no-verify` used |

### File-size targets met

| File | Cycle 2 | Cycle 3 | Target | Result |
|---|---:|---:|---:|---|
| `domain/Pipeline.scala` | 189 | (deleted) | — | n/a |
| `domain/PipelineStep.scala` | — | 150 | ≤ 250 | PASS |
| `domain/PipelineRowJson.scala` | — | 77 | ≤ 100 | PASS |
| `domain/steps/<Kind>Step.scala` × 10 | — | 60–121 | ≤ 200 | PASS |
| `domain/steps/StepCodecUtil.scala` | — | 30 | ≤ 80 | PASS |
| `domain/package.scala` | 4 | 61 | ≤ 80 | PASS |
| `domain/PipelineStepHandlers.scala` | 311 | (deleted) | — | n/a |
| `domain/InProcessPipelineEngine.scala` | 145 | 124 | ≤ 250 | PASS |
| `api/protocols/PipelineStepConfigCodec.scala` | 264 | 115 | ≤ 250 | PASS (was over) |
| `api/protocols/PipelineStepProtocol.scala` | 176 | 178 | ≤ 250 | PASS |

Both cycle-2 soft overages close as a side effect.

## Files modified (cycle 3)

See `files-modified.md` for the running per-file map.

## Commit sequence

1. **`HEL-236 CS2c-3a (cycle 3) Per-step modules: trait + companion + execution context`** —
   creates `domain/PipelineStep.scala`, `domain/PipelineRowJson.scala`,
   `domain/steps/*` (11 files), and updates `domain/package.scala`.
2. **`HEL-236 CS2c-3a (cycle 3) Collapse handlers, codec, and engine over the registry`** —
   deletes `domain/Pipeline.scala` + `domain/PipelineStepHandlers.scala`;
   simplifies engine, codec, protocol; migrates PipelineRunService to
   PipelineRowJson.

A third commit will land the OpenSpec + report updates (this file).

## Spinoffs surfaced in cycle 3

(Carrying forward from cycle 1+2 unchanged; adding cycle 3 specifics.)

1. **Analyze-layer typed inference** — `PipelineAnalyzeService` still
   consumes a stringly-typed `PipelineStepInput`. With the per-step
   `evaluate` method now on the trait, the natural next step is adding
   `inferOutputSchema(inputSchema): Vector[SchemaField]` to the trait
   and dispatching the analyze path the same way. This collapses the
   `validationError: "Unknown op: 'join'"` carve-out completely.
   Deferred from this cycle per the prompt's explicit instruction.
   Tracked as cycle-2 forward marker #4.
2. **`Companion.readFromWire` / `writeToWire` not yet wired through the
   protocol union** — these methods exist on the companion trait and
   delegate correctly, but `PipelineStepProtocol.scala`'s
   `pipelineStepResponseFormat` still enumerates the 10 subtypes inline
   in its `write` / `read` arms. A future cycle could swap that to
   registry-aware dispatch (`companion.writeToWire(...)`), removing the
   last hard-coded enumeration outside the registry itself. Small
   structural win; not load-bearing today.
3. **Sealed `PipelineStepConfig` trait** (cycle-2 forward marker #2) —
   the `Companion` methods today return `Any` rather than a sealed
   config trait. A typed return shape would let the codec dispatcher
   surface compile-time guarantees instead of pattern-matching `Any` in
   the encode path. Compile-error-driven migration through ~10 call
   sites; better as its own cycle.
4. **DemoData pipeline seeding** (cycle-2 forward marker #1) —
   unchanged. Still not seeded by `DemoData.scala`; the dev-DB
   `ProfitAgg` row is interactive state. A future improvement.
5. **Codec file split** (cycle-2 forward marker #3) — naturally resolved
   by cycle 3. The codec is now 115L and per-kind decode/encode logic
   lives in each step file. The forward marker can be retired.
