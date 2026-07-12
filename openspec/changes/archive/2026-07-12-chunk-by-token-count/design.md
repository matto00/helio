## Context

HEL-219 (`splittext`)/HEL-220 (`extractheadings`) established the "text op" wiring seam this ticket
mirrors: `backend/src/main/scala/com/helio/domain/steps/{SplitTextStep,ExtractHeadingsStep}.scala`,
plus the archived designs at `openspec/changes/archive/2026-07-12-{split-text-by-paragraph,
extract-markdown-headings}/design.md`. Their decision 8 enumerates 8 backend enumeration sites a new
op must update; grep confirms the same file set applies here.

**Tokenization decision (escalated, resolved by the human):** unlike the first two ops, "chunk by
token count" needs real token counts to be useful for LLM context-window prep, so this ticket adds
`com.knuddels:jtokkit:1.1.0` (pure-JVM, MIT-licensed, no native deps, current stable per Maven
Central) rather than a whitespace/char heuristic. The op exposes a per-step `encoding` selector —
`o200k_base` (default, GPT-4o family) or `cl100k_base` (GPT-3.5/4 family) — keeping Helio
model-family-flexible instead of hardcoding one tokenizer.

**Proactive file split:** a prior review flagged `PipelineProtocol.scala` (257 lines pre-change,
already over the 250-line soft budget in `CONTRIBUTING.md`/`check-scala-quality.mjs`) as approaching
threshold; this change's new `AnalyzeStepResponse` subtype pushes it further over, so its analyze-API
types/formats move to a new `PipelineAnalyzeProtocol.scala` (see decision 8).

## Goals / Non-Goals

**Goals:**
- Implement `chunkbytokencount`: split a `string-body` field into one row per chunk of real BPE
  tokens (via `jtokkit`), each row carrying the chunk text, a 0-based chunk index, and the chunk's
  exact token count.
- Apply/infer parity across all 8 enumeration sites, matching `splittext`/`extractheadings`.
- Gate the op to `string-body` fields only via an analyze-time `validationError`.
- Keep `PipelineProtocol.scala` and its new sibling under the 250-line soft budget.

**Non-Goals:**
- Sentence/semantic-boundary-aware chunking — pure token-count cutoffs only.
- Encodings beyond `o200k_base`/`cl100k_base` (e.g. legacy `p50k_base`/`r50k_base`).
- Streaming/incremental tokenization for very large documents — the whole field value is tokenized
  in memory per row, consistent with every other step's in-process row transform.

## Decisions

**1. Kind string `"chunkbytokencount"`, one word** — matches the no-separator convention
(`splittext`, `extractheadings`, `groupby`); registered in `PipelineStepKind` / `PipelineStep.Registry`
alongside the other 12 kinds (13 total after this change).

**2. Config shape:**
```
ChunkByTokenCountConfig(field: String, targetTokenCount: Int = 500,
                        encoding: String = "o200k_base",
                        indexField: String = "chunkIndex",
                        tokenCountField: String = "tokenCount")
```
Decode follows the tolerant `StepCodecUtil.asObject` + per-field-default pattern every step uses.
`encoding` decode falls back to `"o200k_base"` for any value other than the two known strings — same
tolerant-decode philosophy as every other config (never throw on a bad/legacy value). `500` is a
reasonable default chunk size for LLM context prep (self-approved, narrow/reversible).

**3. Row semantics — flatMap, same null-drop rule as `splittext`/`extractheadings`.** For a null or
missing `field`, the row is dropped (zero output rows). For a non-null value: encode the string with
the selected `jtokkit` `Encoding`, split the resulting token-id sequence into consecutive chunks of
at most `targetTokenCount` tokens (final chunk holds the remainder; `targetTokenCount < 1` is clamped
to `1` to avoid a degenerate/infinite split), decode each chunk's tokens back to text, and emit one
row per chunk: passthrough fields unchanged, `field` replaced by the decoded chunk text, `indexField`
set to the chunk's 0-based position, `tokenCountField` set to that chunk's exact token count (equal
to `targetTokenCount` for every chunk but the last). Same "last write wins" collision rule as the
other two ops. An empty-string field value naturally yields zero tokens → zero chunks → zero output
rows, with no special-casing needed beyond the null/missing check.

**4. `jtokkit` integration is isolated to `ChunkByTokenCountStep.scala`.** `Encodings.
newDefaultEncodingRegistry()` resolves an `Encoding` from the config's `encoding` string
(`EncodingType.O200K_BASE` / `EncodingType.CL100K_BASE`); `encoding.encode(text)` produces the
token-id sequence, sliced into `targetTokenCount`-sized groups, each group decoded back via
`encoding.decode(...)`. The exact `jtokkit` API surface for constructing a token-id sub-list from a
slice (its `IntArrayList` type) should be confirmed against the resolved dependency's actual jar
during implementation and covered by a round-trip unit test (encode → chunk → decode → re-encode
yields the same token count) rather than assumed here.

**5. Schema inference mirrors `inferExtractHeadings`'s two-field-append shape.**
`inferChunkByTokenCount` looks up `field` in `inputSchema`: absent → `validationError =
Some("Unknown field '<field>'")`, identity fallback. Present but not `string-body` → `validationError
= Some("Field '<field>' is not a content field (string-body); chunkbytokencount requires a
string-body field")`, identity fallback. On success: output schema is the input schema with
`indexField` appended as `"integer"` and `tokenCountField` appended as `"integer"` (each replacing
any existing field of the same name). `targetTokenCount`/`encoding` are step parameters, not
data-shape fields, so they don't appear in the schema — same as `mode`/`headingLevel` today.

**6. Frontend gating — field picker, not `OP_TYPES` visibility**, same as the other two text ops.
`ChunkByTokenCountConfig` receives `analyzeSchema: SchemaField[]`, filters to `f.type ===
"string-body"` for its field dropdown, plus a `targetTokenCount` number input and an `encoding`
dropdown with two labeled options (`"o200k_base (GPT-4o family)"` default /
`"cl100k_base (GPT-3.5/4 family)"`). Empty dropdown + inline hint when no string-body field exists,
no banner — same as `splittext`/`extractheadings`.

**7. Migration `V52__add_chunkbytokencount_op.sql`**, next free version after `extractheadings`'s
`V51` (confirmed via `ls backend/src/main/resources/db/migration/` — no `V52` exists on this branch).
Extends `pipeline_steps_op_check` per the established `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT`
pattern, listing all 13 kinds.

**8. `PipelineProtocol.scala` split (proactive, in-scope per prior review flag):** extract the
`AnalyzeStepResponse` sealed trait, its 13 per-kind case classes (12 existing + `ChunkByTokenCount`),
`PipelineAnalyzeResponse`, and the `analyzeStepResponseFormat`/`pipelineAnalyzeResponseFormat`
implicits into a new `PipelineAnalyzeProtocol.scala` (same package, `com.helio.api.protocols`,
so no import-site changes are needed — `com.helio.api.package.scala`'s aliases already reference
types by `protocols.<Name>`, not by file). `PipelineProtocol` becomes `extends SprayJsonSupport with
DefaultJsonProtocol with DataTypeProtocol with PipelineStepProtocol with PipelineAnalyzeProtocol`,
keeping only CRUD + run types/formats. `PipelineAnalyzeProtocol` itself `extends SprayJsonSupport
with DefaultJsonProtocol with DataTypeProtocol with PipelineStepProtocol` (same deps the analyze
types already needed). This is behavior-preserving — pure file/trait reorganization, zero wire-shape
change — and keeps both files under the 250-line soft budget.

**9. All 8 enumeration sites (backend) + 7 test files, mirroring `extractheadings`'s confirmed list:**
`PipelineStep.scala` (Registry + `PipelineStepKind`), `package.scala` (aliases),
`PipelineStepProtocol.scala` (`ChunkByTokenCountStepResponse` + format + `fromDomain` + read/write
union), `PipelineStepConfigCodec.scala` (`extractConfig`/`encodeConfig`),
`PipelineStepRepository.rowToDomain`, `PipelineAnalyzeService.scala` (`inferChunkByTokenCount`
dispatch arm), the new `PipelineAnalyzeProtocol.scala` (own case class + `jsonFormatN` + both
match arms — decision 8's relocated site), and `PipelineService.toAnalyzeStepResponse`'s dispatch
match. Test-side: `PipelineStepSpec`, `PipelineStepConfigCodecSpec`, `PipelineStepProtocolSpec`,
`InProcessPipelineEngineSpec`, `PipelineAnalyzeServiceSpec`, `PipelineStepRoutesSpec`,
`PipelineAnalyzeRoutesSpec`, plus a new standalone `ChunkByTokenCountStepSpec.scala`.

**10. No compiler exhaustiveness safety net** — identical situation to the first two ops
(`PipelineStep` not `sealed`; no `-Xfatal-warnings`). Test coverage across the 7 hand-curated lists
plus the new `PipelineAnalyzeRoutesSpec` scenario is the only gate against a missed arm 500'ing
`GET /api/pipelines/:id/analyze`, exactly as happened in HEL-219's first cycle.

## Risks / Trade-offs

- [`jtokkit`'s exact `IntArrayList` slicing/construction API is unconfirmed at design time] →
  Mitigated by decision 4's round-trip unit test requirement; not expected to change the config
  shape or row semantics regardless of the exact API.
- [Real BPE tokenization is CPU-heavier per row than the heuristic alternative] → Accepted; content
  fields/rows are processed in-process like every other step, and `jtokkit` is designed for
  low-overhead repeated encode calls (no network/model-load cost).
- [`indexField`/`tokenCountField` name collisions with existing columns] → "Last write wins," same
  as the other two text ops.
- [Frontend shows the op even when the pipeline has zero string-body fields] → Same accepted
  behavior as `splittext`/`extractheadings`.

## Planner Notes

- Self-approved: kind string `"chunkbytokencount"`, `500`-token default, and the
  `indexField`/`tokenCountField` naming (additive to, not a deviation from, the established
  row-shape pattern) — narrow, reversible implementation choices.
- Tokenization approach (jtokkit vs. heuristic) and the `o200k_base`/`cl100k_base` encoding-selector
  design were escalated to and decided by the human before this document was written (see proposal's
  "Why"/"What Changes"); not self-approved.
- Self-approved: the proactive `PipelineProtocol.scala`/`PipelineAnalyzeProtocol.scala` split —
  behavior-preserving, explicitly pre-authorized as in-scope if this change tips the file further
  over its already-exceeded soft budget.
