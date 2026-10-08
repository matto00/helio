# HEL-1187 move evidence (design D5b(a))

Base: `24f6de4cf`. Result tree: HEAD `0010efb84`. Tools: `move-check/check_moves.py` (checker), `move-check/gen.py` (the generator that produced the files from `git show 24f6de4cf:<path>` line ranges; the checker is written separately and declares each resulting file as an ordered layout of base-line spans plus an explicit allow-list).

## Method

1. **Inventory (partition).** Every line of the three original files is assigned to exactly one destination span (OutputService 503, NodeSnapshotRepository 458, OutputConfigValidation 157). The checker fails if any base line is covered zero or two times, or if an inventoried span is not claimed by its destination file's layout.
2. **Forward + positional reverse in one pass.** Each of the six resulting files is declared as an ordered list of `S(file,a,b,subs)` (base lines a..b, with exact once-only text substitutions) and `L(category, lines)` (allow-listed D5 literal lines). The expected text is expanded and compared to the actual file line by line. A moved body that is not byte-identical (forward) and any line no member span or allow-list entry claims (reverse/positional) both surface as a diff hunk. The permitted non-move lines are only what D5 lists; the checker prints them by category.
3. **Red runs** (below) prove it fails on a one-token body change and on an extra, duplicated existing line outside any member.

## Checker output on the committed tree (full)

```
inventory OutputService.scala: 503 base lines, spans cover each exactly once: OK
inventory NodeSnapshotRepository.scala: 458 base lines, spans cover each exactly once: OK
inventory OutputConfigValidation.scala: 157 base lines, spans cover each exactly once: OK
OutputService.scala: 330 lines, 24 allow-listed non-move lines, 306 base-claimed lines -> OK
OutputRowReads.scala: 134 lines, 20 allow-listed non-move lines, 114 base-claimed lines -> OK
OutputRootResolution.scala: 61 lines, 14 allow-listed non-move lines, 47 base-claimed lines -> OK
OutputConfigValidation.scala: 209 lines, 6 allow-listed non-move lines, 203 base-claimed lines -> OK
NodeSnapshotRepository.scala: 352 lines, 2 allow-listed non-move lines, 350 base-claimed lines -> OK
NodeSnapshotFilterSql.scala: 119 lines, 12 allow-listed non-move lines, 107 base-claimed lines -> OK

Allow-listed non-move lines and substitutions by category:
  OutputService.scala [positional/visibility sub]: 'import spray.json.{JsObject, JsString, JsValue}' -> 'import spray.json.{JsObject, JsValue}'
  OutputService.scala [positional/visibility sub]: 'PipelineId, PipelineRootId, PipelineRunId' -> 'PipelineId, PipelineRunId'
  OutputService.scala [unused import removed]: import com.helio.domain.history.{OutputCompare, PayloadOptIn}
  OutputService.scala [unused import removed]: import com.helio.domain.panels.OutputBindingSpec
  OutputService.scala [D5a wiring + D2 member import]: 4 line(s)
  OutputService.scala [D1 delegation doc]: 1 line(s)
  OutputService.scala [D1 delegation body]: 3 line(s)
  OutputService.scala [D1 delegation body]: 3 line(s)
  OutputService.scala [D1 delegation body]: 1 line(s)
  OutputService.scala [D3 forwarder doc+sig]: 6 line(s)
  OutputService.scala [D3 forwarder body]: 6 line(s)
  OutputRowReads.scala [new-file scaffolding (package/imports/class doc/ctor)]: 19 line(s)
  OutputRowReads.scala [positional/visibility sub]: "   *  /api/outputs/:id` above) -- an Output's rows" -> "   *  /api/outputs/:id`) -- an Output's rows"
  OutputRowReads.scala [positional/visibility sub]: 'mirroring every other nullable dependency in this\n   *  service.' -> 'mirroring every other nullable dependency in\n   *  `OutputService`.'
  OutputRowReads.scala [positional/visibility sub]: 'mirroring every other such fixture in this file)\n   *  degrades' -> 'mirroring every other such fixture in `OutputService.scala`)\n   *  degrades'
  OutputRowReads.scala [new-file scaffolding]: 1 line(s)
  OutputRootResolution.scala [new-file scaffolding (package/imports/class doc/ctor)]: 13 line(s)
  OutputRootResolution.scala [positional/visibility sub]: '  private def requireUnambiguousRootWhenNeither(' -> '  private[pipelines] def requireUnambiguousRootWhenNeither('
  OutputRootResolution.scala [positional/visibility sub]: '  private def resolveExplicitRootId(' -> '  private[pipelines] def resolveExplicitRootId('
  OutputRootResolution.scala [positional/visibility sub]: 'no caller of THIS class exercises' -> 'no caller of `OutputService` exercises'
  OutputRootResolution.scala [positional/visibility sub]: 'three-caller enumeration this class is one of' -> 'three-caller enumeration `OutputService` is one of'
  OutputRootResolution.scala [new-file scaffolding]: 1 line(s)
  OutputConfigValidation.scala [imports (D3 receiving file)]: 1 line(s)
  OutputConfigValidation.scala [imports (D3 receiving file)]: 2 line(s)
  OutputConfigValidation.scala [D3 header amendment (2 added lines after base line 7; no base line edited)]: 2 line(s)
  OutputConfigValidation.scala [separator before moved members]: 1 line(s)
  NodeSnapshotRepository.scala [D4 member import]: 2 line(s)
  NodeSnapshotFilterSql.scala [new-file scaffolding (package/imports/object doc)]: 11 line(s)
  NodeSnapshotFilterSql.scala [positional/visibility sub]: '  private def filterWhereFragment(' -> '  private[pipelines] def filterWhereFragment('
  NodeSnapshotFilterSql.scala [positional/visibility sub]: '  private def orderByFragment(' -> '  private[pipelines] def orderByFragment('
  NodeSnapshotFilterSql.scala [new-file scaffolding]: 1 line(s)
RESULT: PASS
```

## Exact amendment lines the reverse checker claims as allow-listed (skeptic-design-3 non-blocking note)

- `OutputConfigValidation.scala`: D3 header amendment = two ADDED lines (file lines 11-12) after base line 7; no base line is edited. Imports added at file lines 3, 5, 6 (history, OutputBindingSpec, ServiceError). One separator blank line before the moved members. These are the only non-"kept" lines in the file (6 allow-listed lines total); every other line is claimed as kept base text of the same file or as a moved span from OutputService.scala.
- Positional / visibility substitutions (each applied exactly once, listed above under "positional/visibility sub"): 3 in OutputRowReads (`above`, `this service`, `this file`), 4 in OutputRootResolution (2 visibility widenings, `THIS class`, `this class`), 2 visibility widenings in NodeSnapshotFilterSql.
- Unused imports removed from OutputService (all made unused by the move): the `OutputCompare, PayloadOptIn` import line, the `OutputBindingSpec` import line, `JsString` from the spray.json import, `PipelineRootId` from the domain.model import. (`NodeRef` was already unused at base and is left alone.)

## Red runs (checker run against a scratch copy with one deliberate defect; reverted after each)

### Red 1 -- one token changed in a moved body (`!t.isBefore` -> `t.isBefore` in OutputRowReads.materializedFor)
```
inventory OutputService.scala: 503 base lines, spans cover each exactly once: OK
inventory NodeSnapshotRepository.scala: 458 base lines, spans cover each exactly once: OK
inventory OutputConfigValidation.scala: 157 base lines, spans cover each exactly once: OK
OutputService.scala: 330 lines, 24 allow-listed non-move lines, 306 base-claimed lines -> OK
OutputRowReads.scala: 134 lines, 20 allow-listed non-move lines, 114 base-claimed lines -> FAIL
   replace: expected[129:130] (base OutputService.scala:429-449) vs actual[130:130]
     -         lastSuccess.exists(t => !t.isBefore(output.createdAt))
     +         lastSuccess.exists(t => t.isBefore(output.createdAt))
OutputRootResolution.scala: 61 lines, 14 allow-listed non-move lines, 47 base-claimed lines -> OK
OutputConfigValidation.scala: 209 lines, 6 allow-listed non-move lines, 203 base-claimed lines -> OK
NodeSnapshotRepository.scala: 352 lines, 2 allow-listed non-move lines, 350 base-claimed lines -> OK
NodeSnapshotFilterSql.scala: 119 lines, 12 allow-listed non-move lines, 107 base-claimed lines -> OK
RESULT: FAIL
checker exit=1
```

### Red 1b -- one token changed in NodeSnapshotFilterSql (`>=` -> `>`)
```
inventory OutputService.scala: 503 base lines, spans cover each exactly once: OK
inventory NodeSnapshotRepository.scala: 458 base lines, spans cover each exactly once: OK
inventory OutputConfigValidation.scala: 157 base lines, spans cover each exactly once: OK
OutputService.scala: 330 lines, 24 allow-listed non-move lines, 306 base-claimed lines -> OK
OutputRowReads.scala: 134 lines, 20 allow-listed non-move lines, 114 base-claimed lines -> OK
OutputRootResolution.scala: 61 lines, 14 allow-listed non-move lines, 47 base-claimed lines -> OK
OutputConfigValidation.scala: 209 lines, 6 allow-listed non-move lines, 203 base-claimed lines -> OK
NodeSnapshotRepository.scala: 352 lines, 2 allow-listed non-move lines, 350 base-claimed lines -> OK
NodeSnapshotFilterSql.scala: 119 lines, 12 allow-listed non-move lines, 107 base-claimed lines -> FAIL
   replace: expected[65:66] (base NodeSnapshotRepository.scala:205-311) vs actual[66:66]
     -       sortCastExpr(column, cast).concat(sql" >= ").concat(opValueCastExpr(value, cast))
     +       sortCastExpr(column, cast).concat(sql" > ").concat(opValueCastExpr(value, cast))
RESULT: FAIL
checker exit=1
```

### Red 2 -- an existing line duplicated outside any member (OutputConfigValidation: `private val Shared` inserted twice) -- reverse/positional check
```
inventory OutputService.scala: 503 base lines, spans cover each exactly once: OK
inventory NodeSnapshotRepository.scala: 458 base lines, spans cover each exactly once: OK
inventory OutputConfigValidation.scala: 157 base lines, spans cover each exactly once: OK
OutputService.scala: 330 lines, 24 allow-listed non-move lines, 306 base-claimed lines -> OK
OutputRowReads.scala: 134 lines, 20 allow-listed non-move lines, 114 base-claimed lines -> OK
OutputRootResolution.scala: 61 lines, 14 allow-listed non-move lines, 47 base-claimed lines -> OK
OutputConfigValidation.scala: 210 lines, 6 allow-listed non-move lines, 203 base-claimed lines -> FAIL
   insert: expected[18:18] (base OutputConfigValidation.scala:8-147) vs actual[19:19]
     +   private val Shared = Set("fieldMapping", "compare", "historyPayloads")
NodeSnapshotRepository.scala: 352 lines, 2 allow-listed non-move lines, 350 base-claimed lines -> OK
NodeSnapshotFilterSql.scala: 119 lines, 12 allow-listed non-move lines, 107 base-claimed lines -> OK
RESULT: FAIL
checker exit=1
```

### Green again after reverting the scratch copy
```
RESULT: PASS
```

## git diff --color-moved=plain summary (backend/src/main, base..HEAD)

```
 .../pipelines/NodeSnapshotFilterSql.scala          | 119 ++++++++++++
 .../pipelines/NodeSnapshotRepository.scala         | 110 +----------
 .../infrastructure/persistence/pipelines/README.md |   2 +-
 .../pipelines/OutputConfigValidation.scala         |  52 +++++
 .../services/pipelines/OutputRootResolution.scala  |  61 ++++++
 .../helio/services/pipelines/OutputRowReads.scala  | 134 +++++++++++++
 .../helio/services/pipelines/OutputService.scala   | 215 ++-------------------
 .../scala/com/helio/services/pipelines/README.md   |   2 +
 scripts/check-node-root-encoding.mjs               |   1 +
 9 files changed, 393 insertions(+), 303 deletions(-)
--color-moved=plain: removed lines 311, of which 290 coloured as moved; added lines 400, of which 307 coloured as moved.
(Git only recognises moved blocks of >= 3 lines with unchanged text; the remainder are the new-file scaffolding, delegations/forwarders and the listed D5 substitutions -- all claimed by the checker above.)
```

## check:node-root-encoding (design D5b(e))

`TARGET_FILES` gained exactly one line (`NodeSnapshotFilterSql.scala`); no `KNOWN_EXEMPTIONS` change (`git diff 24f6de4cf HEAD -- scripts/check-node-root-encoding.mjs` is +1 line). The three exempt scopes (`overwriteRowsAction`, `listRows`, `nodeFilterFragment`) did not move. Scanned files: 3 -> 4. The moved SQL builders contain no `node_step_id` text, so no exemption is needed or stale.

```
=== green

check-node-root-encoding: clean (4 file(s) scanned; SQL+Scala only -- see this script's header for what it does NOT cover)
=== RED: inserted line
 1 file changed, 1 insertion(+)
27a28
>   private val probe = sql" AND node_step_id IS NULL"
> helio@0.7.4 check:node-root-encoding
> node scripts/check-node-root-encoding.mjs

check-node-root-encoding: 1 violation(s) of design.md R12's "node_step_id IS NULL is not a standalone predicate" rule:

  backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotFilterSql.scala:28: standalone node-root-NULL encoding ("private val probe = sql" AND node_step_id IS NULL"") -- see design.md R12

Each root-bound row must be scoped to a real root id (root_id), never a bare NULL check. If this is a genuine known gap, add a content-keyed KNOWN_EXEMPTIONS entry with the proof that owns it.
exit=1
reverted
=== green after revert

check-node-root-encoding: clean (4 file(s) scanned; SQL+Scala only -- see this script's header for what it does NOT cover)
```

## C4 -- Forbidden producer and guard counts

```
ServiceError.Forbidden( in OutputService.scala: base 1 -> HEAD 1
ServiceError.Forbidden( in the 5 other touched/new files at HEAD: backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotFilterSql.scala:0 backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/NodeSnapshotRepository.scala:0 backend/src/main/scala/com/helio/services/pipelines/OutputRowReads.scala:0 backend/src/main/scala/com/helio/services/pipelines/OutputRootResolution.scala:0 backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala:0 
git diff 24f6de4cf...HEAD --name-only -- backend/src/test | wc -l -> 0
```

## Re-run after final-gate CR1 (OutputRootResolution.scala:11 class-doc line corrected; allow-list line updated in check_moves.py)
```
inventory OutputService.scala: 503 base lines, spans cover each exactly once: OK
inventory NodeSnapshotRepository.scala: 458 base lines, spans cover each exactly once: OK
inventory OutputConfigValidation.scala: 157 base lines, spans cover each exactly once: OK
OutputService.scala: 330 lines, 24 allow-listed non-move lines, 306 base-claimed lines -> OK
OutputRowReads.scala: 134 lines, 20 allow-listed non-move lines, 114 base-claimed lines -> OK
OutputRootResolution.scala: 61 lines, 14 allow-listed non-move lines, 47 base-claimed lines -> OK
OutputConfigValidation.scala: 209 lines, 6 allow-listed non-move lines, 203 base-claimed lines -> OK
NodeSnapshotRepository.scala: 352 lines, 2 allow-listed non-move lines, 350 base-claimed lines -> OK
NodeSnapshotFilterSql.scala: 119 lines, 12 allow-listed non-move lines, 107 base-claimed lines -> OK
RESULT: PASS
```
