## Context

HEL-219 (`splittext`) established the reusable "text op" wiring seam for this ticket to mirror
directly: `backend/src/main/scala/com/helio/domain/steps/SplitTextStep.scala` +
`openspec/changes/archive/2026-07-12-split-text-by-paragraph/design.md`. That design doc's decision
8 (corrected post-cycle-2) enumerates **8 enumeration sites** a new op must update; a grep for
`splittext`/`SplitText` across the tree confirms the exact file set:
`PipelineStep.scala` (Registry), `package.scala` (aliases), `PipelineStepConfigCodec.scala`,
`PipelineStepProtocol.scala`, `PipelineStepRepository.scala`, `PipelineAnalyzeService.scala`,
`PipelineProtocol.scala` (separate `AnalyzeStepResponse` ADT — the site HEL-219 missed in cycle 1),
`PipelineService.toAnalyzeStepResponse`, plus 7 test files and 5 frontend files. This op reuses that
seam but diverges in one respect: it extracts heading *titles* (not full section bodies) and needs
a second metadata field (heading level) alongside the sequence index.

## Goals / Non-Goals

**Goals:**
- Implement `extractheadings`: scan a `string-body` field for Markdown ATX heading lines
  (`^#{1,6}\s+...`, any level 1-6, unlike `splittext`'s single-level heading mode) and emit one
  output row per heading found, in document order.
- Apply/infer parity, matching `splittext`'s established pattern exactly (same 8 enumeration sites).
- Gate the op to `string-body` fields only, surfaced as an analyze-time `validationError` (not a
  hard 400) — identical to `splittext`/`compute`.

**Non-Goals:**
- Chunk-by-token-count (HEL-221).
- Heading hierarchy/nesting (no parent-breadcrumb output) — flat rows only, scope is a literal
  reading of the ticket ("one output row per heading... heading level as a metadata field").
- Section-body extraction — unlike `splittext`'s heading mode (which captures each section's full
  text through the next same-level heading), this op's row payload is just the heading line's own
  text with the leading `#` markers stripped.

## Decisions

**1. Kind string `"extractheadings"`, one word** — matches the no-separator convention
`splittext`/`groupby` set. Registered in `PipelineStepKind` / `PipelineStep.Registry` alongside the
other 11 kinds (12 total after this change).

**2. Config shape:**
```
ExtractHeadingsConfig(field: String, indexField: String = "headingIndex",
                       levelField: String = "headingLevel")
```
Decode follows the same tolerant `StepCodecUtil.asObject` + per-field-default pattern as
`SplitTextConfig.decode`. `indexField` preserves `splittext`'s "3-part row shape" precedent
(passthrough + replaced field + sequence index); `levelField` is the new 4th part this op's
ticket-mandated level metadata requires — not a deviation from the pattern, an additive one.

**3. Row semantics — flatMap, not map, identical drop rule.** For a null/missing `field` value the
row is dropped (zero output rows), matching `splittext`'s null-tolerance. For a non-null value,
scan every line for `^(#{1,6})\s+(.*)$`; each match becomes one output row: all other input fields
pass through unchanged, `field` is replaced by the matched line's trimmed title text (the capture
group, with the `#` markers and their following whitespace stripped — not the raw line), and
`indexField`/`levelField` are written last (same "last write wins" collision rule as `splittext`
decision 5, index/level fields always win the slot over a same-named passthrough field). Zero
heading matches (a row whose content has no ATX heading line at all) yields zero output rows for
that input row — same "no matching heading" behavior as `splittext`'s heading mode.

**4. Extraction function** (pure `String => Seq[(String, Int)]`, `(headingText, level)` pairs,
unit-testable in isolation, mirrors `splitParagraphs`/`splitHeadings`'s pure-function shape):
normalize `\r\n`→`\n`, split into lines, match each line against `^(#{1,6})\s+(.*)$`, level = the
matched `#` run's length, text = the second capture group trimmed. Lines inside fenced code blocks
are NOT specially excluded (same simplicity level `splittext` chose for paragraph/heading
detection — no Markdown-AST parsing anywhere in this ticket family) — a `#`-prefixed line inside a
` ``` ` fence would be (mis)matched as a heading; this is an accepted simplicity trade-off
consistent with `splittext`'s own non-goal ("no NLP-grade paragraph detection").

**5. Schema inference — mirrors `inferSplitText` exactly, with two appended fields instead of
one.** `inferExtractHeadings` looks up `field` in `inputSchema`: absent → `validationError =
Some("Unknown field '<field>'")`, identity fallback. Present but not `string-body` →
`validationError = Some("Field '<field>' is not a content field (string-body); extractheadings
requires a string-body field")`, identity fallback. On success: output schema is the input schema
with `indexField` appended as `"integer"` and `levelField` appended as `"integer"` (each replacing
any existing field of the same name, same collision rule as decision 4 of `splittext`'s design).

**6. Frontend gating — same as `splittext`: field picker, not `OP_TYPES` visibility.**
`ExtractHeadingsConfig` receives `analyzeSchema: SchemaField[]` and filters to
`f.type === "string-body"` for its single field dropdown (no mode toggle needed — unlike
`splittext`, there is only one behavior, not paragraph/heading modes). If none qualify, empty
dropdown with inline hint, no banner — same as `splittext`.

**7. Migration — `V51__add_extractheadings_op.sql`**, next free version after `splittext`'s `V50`
(confirmed via `ls backend/src/main/resources/db/migration/`, no `V51` exists on this branch).
Extends `pipeline_steps_op_check` per the established `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT`
pattern, listing all 12 kinds.

**8. All 8 enumeration sites, confirmed by grep (not re-derived from scratch) against every
`splittext`/`SplitText` reference in the tree:**
`PipelineStep.scala` (Registry + `PipelineStepKind`), `package.scala` (type aliases for the
wildcard-import call sites), `PipelineStepProtocol.scala` (`ExtractHeadingsStepResponse` +
format + `fromDomain` + read/write union), `PipelineStepConfigCodec.scala`
(`extractConfig`/`encodeConfig`), `PipelineStepRepository.rowToDomain`,
`PipelineAnalyzeService.scala` (`inferExtractHeadings` dispatch arm), `PipelineProtocol.scala`'s
separate `AnalyzeStepResponse` ADT (own case class + `jsonFormatN` + both match arms — the site
HEL-219 initially missed), and `PipelineService.toAnalyzeStepResponse`'s dispatch match. Test-side:
`PipelineStepSpec`, `PipelineStepConfigCodecSpec`, `PipelineStepProtocolSpec`,
`InProcessPipelineEngineSpec`, `PipelineAnalyzeServiceSpec`, `PipelineStepRoutesSpec`,
`PipelineAnalyzeRoutesSpec`, plus a new standalone `ExtractHeadingsStepSpec.scala` (two-tier test
precedent from `splittext`'s design decision 10).

**9. No compiler exhaustiveness safety net** — identical situation to `splittext` (`PipelineStep` is
documented as not `sealed`; `backend/build.sbt` sets no `-Xfatal-warnings`). Test coverage is the
only gate; task list must extend every hand-curated list rather than relying on the compiler.

## Risks / Trade-offs

- [`#`-prefixed lines inside fenced code blocks misidentified as headings] → Accepted simplicity
  trade-off, consistent with `splittext`'s own non-goal of no Markdown-AST parsing; documented so a
  future ticket can add fence-awareness without this one needing to re-derive the trade-off.
- [`indexField`/`levelField` name collisions with existing columns] → "Last write wins," identical
  to `splittext`'s decision 5; not a new risk class.
- [Frontend shows the op even when the pipeline has zero string-body fields] → Same acceptable
  behavior as `splittext`: empty dropdown, analyze-time `validationError` still guards the DB config.

## Planner Notes

- Self-approved: kind string `"extractheadings"` (no separator, matches convention) and the
  `indexField`/`levelField` two-metadata-field config shape (additive to, not a deviation from,
  `splittext`'s reusable row-shape pattern) — both narrow, reversible implementation choices.
- Self-approved: heading titles only (not full section bodies) as the row payload — this is the
  literal reading of the ticket's acceptance criteria ("heading text" + "heading level"), distinct
  from `splittext`'s heading *mode* (which intentionally captures full section content).
