# HEL-1385 move evidence (design D6a, D6c, D6e)

Base = origin/main ecaa1a53 `PipelineAnalyzeService.scala` (1201 lines), copy kept at scratchpad `base.scala`.
Checkers (scratchpad, not committed): `check_moves.py`, `check_logger.sh`.

## Inventory: base span -> destination

| Base lines | Members | Destination |
|---|---|---|
| 13-37 | `SchemaField` case class + doc (design said 13-36; the closing `}` is line 37) | SchemaField.scala |
| 39-330 | `object` line, `log`, `StepConfigInvalidCode`, `stepConfigProblem`, `schemaFieldJsonFormat`, `PipelineStepInput`, `AnalyzedStep`, `analyze`, `NodeStepInput`, `DefaultRootKey`, `laneDependencyOf`, `sourceDependencyOf`, both `analyzeNodes` | PipelineAnalyzeService.scala (kept) |
| 331-461 | `validateStepConfig` + 8 `validate*` helpers | StepConfigValidation.scala |
| 464-469 | HEL-872 comment | PipelineAnalyzeService.scala (kept, above forwarder) |
| 470-515 | `inferOutputSchema` dispatch | StepSchemaInference.scala |
| 518-649 | select, rename, cast, compute, `canonicalizeLegacyType`, aggregate | ColumnSchemaInference.scala |
| 650-850 | splittext doc, convertformat, analyzewithai, generatetext, splittext, extractheadings, chunkbytokencount | TextSchemaInference.scala |
| 851-996 | datebucket, pivot, window, unpivot, stringops | ReshapeSchemaInference.scala |
| 997-1077 | lookup, union, join | MultiInputSchemaInference.scala |
| 1078-1136 | assert, `AssertFieldRequiredKinds`, `AssertRuleKinds` | ReshapeSchemaInference.scala |
| 1137-1153 | `parseConfig` | StepSchemaInference.scala |
| 1154-1200 | groupby, `aggregateResultType`, `aggResultType` | ColumnSchemaInference.scala |

Unclaimed base lines (allow-listed: header imports 1-12, blank lines, object closing brace 1201): see checker output below. Trailing blank lines before a closing brace (850, 1077, 1136, 1153) are dropped in the new files where they would precede `}` (blank, allow-listed).

## Checker (forward + positional reverse), PASS run
```
SchemaField.scala: base 13-37 -> new 5-29 (SchemaField); listed edits: 0
PipelineAnalyzeService.scala: base 39-330 -> new 12-303 (log..analyzeNodes (kept)); listed edits: 1
PipelineAnalyzeService.scala: base 464-469 -> new 304-309 (HEL-872 comment (kept)); listed edits: 0
StepConfigValidation.scala: base 331-461 -> new 10-140 (validateStepConfig + 8 validators); listed edits: 1
StepSchemaInference.scala: base 470-515 -> new 17-62 (inferOutputSchema dispatch); listed edits: 0
StepSchemaInference.scala: base 1137-1153 -> new 64-79 (parseConfig); listed edits: 1
ColumnSchemaInference.scala: base 518-649 -> new 16-147 (select rename cast compute canonicalizeLegacyType aggregate); listed edits: 5
ColumnSchemaInference.scala: base 1154-1200 -> new 148-194 (groupby aggregateResultType aggResultType); listed edits: 1
TextSchemaInference.scala: base 650-850 -> new 14-213 (splittext-doc convertformat analyzewithai generatetext splittext extractheadings chunkbytokencount); listed edits: 6
ReshapeSchemaInference.scala: base 851-996 -> new 15-160 (datebucket pivot window unpivot stringops); listed edits: 5
ReshapeSchemaInference.scala: base 1078-1136 -> new 161-217 (assert + AssertFieldRequiredKinds/AssertRuleKinds); listed edits: 1
MultiInputSchemaInference.scala: base 997-1077 -> new 12-91 (lookup union join); listed edits: 3
unclaimed base lines (scaffolding/blank/imports/closing brace): [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 38, 462, 463, 516, 517, 850, 1077, 1135, 1136, 1153, 1201]
RESULT: PASS
```

Forward: each span's base text must appear contiguously, in order, byte-identical modulo the listed edits. Reverse: every line of the eight files not owned by a span must match an allow-list (package, import, blank, file-doc comment, `private[engine] object X {`, closing brace, the D4 logger line, the D1 scaffolding comment, the 7 forwarder lines). Base coverage: every base line is claimed exactly once or allow-listed.

### Listed non-move edits inside moved spans (all category visibility, D3)
```
base 344: private -> private[engine] validateStepConfig
base 519: private -> private[engine] inferSelect
base 526: private -> private[engine] inferRename
base 533: private -> private[engine] inferCast
base 550: private -> private[engine] inferCompute
base 597: private -> private[engine] inferAggregate
base 665: private -> private[engine] inferConvertFormat
base 704: private -> private[engine] inferAnalyzeWithAi
base 735: private -> private[engine] inferGenerateText
base 757: private -> private[engine] inferSplitText
base 790: private -> private[engine] inferExtractHeadings
base 827: private -> private[engine] inferChunkByTokenCount
base 861: private -> private[engine] inferDateBucket
base 882: private -> private[engine] inferPivot
base 918: private -> private[engine] inferWindow
base 950: private -> private[engine] inferUnpivot
base 991: private -> private[engine] inferStringOps
base 1009: private -> private[engine] inferLookup
base 1044: private -> private[engine] inferUnion
base 1064: private -> private[engine] inferJoin
base 1091: private -> private[engine] inferAssert
base 1139: private -> private[engine] parseConfig
base 1166: private -> private[engine] inferGroupBy
```
Plus in the kept span: base 52 `stepConfigProblem` body `validateStepConfig(op, rawConfig)` -> `StepConfigValidation.validateStepConfig(op, rawConfig)` (D1 delegation).

Comment-wording edits inside moved code: NONE. FQN-to-import edits: NONE (`scala.util.Try` at base 1071 left byte-identical as D3 permits; `check:scala-quality` is clean).
Comment edits outside moved code (nits, D7), listed individually:
1. `api/protocols/pipelines/PipelineAnalyzeProtocol.scala` base line 237: one over-long line split into two (words unchanged).
2. `services/pipelines/AutoRunTriggerService.scala` base line 122: one over-long line split into two (words unchanged).
New one-line scaffolding comment (D1/D3): `StepSchemaInference.scala` line 16, above the dispatch.
New file-level doc comments (scaffolding): one `/** HEL-1385: ... */` above each new `object`.

## Red runs (scratch copies, repo untouched)
Forward red: one token changed in a moved body (`inferSelect`: `fields.contains` -> `!fields.contains`):
```
FAIL: ColumnSchemaInference.scala: base 518-649 (select rename cast compute canonicalizeLegacyType aggregate) not found byte-identical (modulo listed edits)
RESULT: FAIL (126)
```
Reverse red: two lines inserted at the end of `MultiInputSchemaInference` outside any member (one a copy of an existing base line, `private val StepConfigInvalidCode...`):
```
FAIL: MultiInputSchemaInference.scala:92 unclaimed non-allow-listed line: '  private val StepConfigInvalidCode: String = 1'
FAIL: MultiInputSchemaInference.scala:93 unclaimed non-allow-listed line: '  val x = 1'
RESULT: FAIL (2)
```

## git diff --color-moved=plain summary
moved-added 890, moved-removed 860, plain-added 84, plain-removed 29 (engine dir, intent-to-add for new files). The plain lines are the header/scaffolding/forwarder lines, the 23 widened declarations and the README.

## Logger (D6c / C3 / C6)
The 12 moved log sites by base line: 575 (compute), 646 (aggregate) -> ColumnSchemaInference; 692 (convertformat), 724 (analyzewithai), 753 (generatetext), 776 (splittext), 810 (extractheadings), 847 (chunkbytokencount) -> TextSchemaInference; 903 (pivot), 976 (unpivot), 1125 (assert) -> ReshapeSchemaInference; 1150 (parseConfig) -> StepSchemaInference. Every one of those four objects declares `private val log = LoggerFactory.getLogger(PipelineAnalyzeService.getClass)`. The entry point keeps `private val log = LoggerFactory.getLogger(getClass)` (its own site, base 94) unchanged.
PASS run:
```
ColumnSchemaInference.scala: log call sites=2  canonical-decl=1  any-getLogger=1
StepSchemaInference.scala: log call sites=1  canonical-decl=1  any-getLogger=1
TextSchemaInference.scala: log call sites=6  canonical-decl=1  any-getLogger=1
ReshapeSchemaInference.scala: log call sites=3  canonical-decl=1  any-getLogger=1
MultiInputSchemaInference.scala: log call sites=0  canonical-decl=0  any-getLogger=0
StepConfigValidation.scala: log call sites=0  canonical-decl=0  any-getLogger=0
SchemaField.scala: log call sites=0  canonical-decl=0  any-getLogger=0
total moved log sites: 12 (expected 12)
```
Red run (TextSchemaInference temporarily using its own `getClass`):
```
ColumnSchemaInference.scala: log call sites=2  canonical-decl=1  any-getLogger=1
StepSchemaInference.scala: log call sites=1  canonical-decl=1  any-getLogger=1
TextSchemaInference.scala: log call sites=6  canonical-decl=0  any-getLogger=1
FAIL: TextSchemaInference has log calls without the canonical logger
FAIL: TextSchemaInference has a non-canonical getLogger
ReshapeSchemaInference.scala: log call sites=3  canonical-decl=1  any-getLogger=1
MultiInputSchemaInference.scala: log call sites=0  canonical-decl=0  any-getLogger=0
StepConfigValidation.scala: log call sites=0  canonical-decl=0  any-getLogger=0
SchemaField.scala: log call sites=0  canonical-decl=0  any-getLogger=0
total moved log sites: 12 (expected 12)
```

## Nit checks (D6e)
Word sequences of both reflowed comments (comment-leader asterisks ignored): identical (PipelineAnalyzeProtocol 2393 words, AutoRunTriggerService 1153 words). `AutoRunTriggerServiceSpec.scala`: sorted imported-name multisets equal (31 names), non-import lines identical, selectors on the steps import now lexicographic. Only line 5 changed.
Comments in other files that name moved members (e.g. `PipelineAnalyzeService.inferCompute`) are NOT edited (design D6e).
