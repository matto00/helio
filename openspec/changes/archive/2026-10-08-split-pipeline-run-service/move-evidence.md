# Move evidence (HEL-1371, design D6a / D6c)

Base: `4db9730fd` (`PipelineRunService.scala`, 1770 lines). Tools: `move-check/check.py` (checker), `move-check/spec.json`
(the explicit inventory plus the allow-list of every non-move line, with its D3 category and exact text).

## How the checker works
- **Forward:** every inventoried member's base text (`git show 4db9730fd:...`, the listed line range) is compared line by
  line with its text in the new file. The only tolerated difference is a declared `private` -> `private[pipelines]`
  substitution, which the checker itself verifies is exactly that edit.
- **Reverse (positional):** each new file is walked top to bottom. Every non-blank line must be consumed by the NEXT
  expected item: a member block, or one scaffold line from the allow-list (exact text). An extra, missing, reordered or
  altered line fails, even if its text exists elsewhere. Blank lines between items are ignored; blank lines inside a
  member block must match exactly.
- **Coverage:** every non-blank base class-body line (35-1694, 1697-1770) must be claimed by exactly one member block.
- `spec.json` is produced by the same script that wrote the files, so the allow-list is a record rather than an
  independent oracle. The independent part is the byte comparison against the base commit.

## Inventory (every class-body member exactly once)
| Member (base lines at 4db9730fd) | Destination | Base lines | Edit |
|---|---|---|---|
| `logExecutionFailure` | `PipelineRunSupport.scala` | 120-128 | `private` -> `private[pipelines]` (base line 124) |
| `executionFailureError` | `PipelineRunSupport.scala` | 130-138 | `private` -> `private[pipelines]` (base line 133) |
| `truncationFields` | `PipelineRunSupport.scala` | 173-201 | `private` -> `private[pipelines]` (base line 179) |
| `truncatedReadsToJson` | `PipelineRunSupport.scala` | 203-226 | `private` -> `private[pipelines]` (base line 216) |
| `resolvePrimaryDataSourceInternal` | `PipelineRunSupport.scala` | 315-327 | none (verbatim) |
| `resolveAllRootDataSourcesInternal` | `PipelineRunSupport.scala` | 329-341 | `private` -> `private[pipelines]` (base line 336) |
| `publish` | `PipelineRunTerminalWrites.scala` | 990-991 | `private` -> `private[pipelines]` (base line 990) |
| `publishTerminalAfter` | `PipelineRunTerminalWrites.scala` | 993-1003 | `private` -> `private[pipelines]` (base line 997) |
| `executeRunFailure` | `PipelineRunTerminalWrites.scala` | 1120-1168 | `private` -> `private[pipelines]` (base line 1123) |
| `persistAssertions` | `PipelineRunTerminalWrites.scala` | 1230-1243 | `private` -> `private[pipelines]` (base line 1240) |
| `onDryRunSuccess` | `PipelineRunTerminalWrites.scala` | 1245-1276 | `private` -> `private[pipelines]` (base line 1245) |
| `onWriteBackFailure` | `PipelineRunTerminalWrites.scala` | 1348-1376 | `private` -> `private[pipelines]` (base line 1354) |
| `onBlockedRun` | `PipelineRunTerminalWrites.scala` | 1378-1412 | `private` -> `private[pipelines]` (base line 1385) |
| `summarizeBlockingFailures` | `PipelineRunTerminalWrites.scala` | 1645-1656 | none (verbatim) |
| `historyConfigs` | `PipelineRunSucceededWrites.scala` | 1414-1419 | none (verbatim) |
| `onUnblockedRunSuccess` | `PipelineRunSucceededWrites.scala` | 1421-1643 | `private` -> `private[pipelines]` (base line 1423) |
| `extractBinaryRefs` | `PipelineRunSucceededWrites.scala` | 1658-1687 | none (verbatim) |
| `isBinaryRefShape` | `PipelineRunSucceededWrites.scala` | 1689-1693 | none (verbatim) |
| `runPipeline` | `PipelineRunExecutor.scala` | 343-387 | `private` -> `private[pipelines]` (base line 343) |
| `executeRun` | `PipelineRunExecutor.scala` | 1005-1118 | none (verbatim) |
| `executeRunSuccess` | `PipelineRunExecutor.scala` | 1170-1228 | none (verbatim) |
| `onRunSuccess` | `PipelineRunExecutor.scala` | 1278-1329 | none (verbatim) |
| `applyPendingWriteBacks` | `PipelineRunExecutor.scala` | 1331-1346 | none (verbatim) |
| `backfillOutputNode` | `PipelineRunBackfill.scala` | 665-727 | none (verbatim) |
| `evaluateNodeRowsForBackfill` | `PipelineRunBackfill.scala` | 729-789 | none (verbatim) |
| `persistBackfilledRows` | `PipelineRunBackfill.scala` | 791-809 | none (verbatim) |
| `latestRun` | `PipelineRunQueries.scala` | 811-841 | none (verbatim) |
| `runStatus` | `PipelineRunQueries.scala` | 843-863 | none (verbatim) |
| `RunStatusNotFound` | `PipelineRunQueries.scala` | 865-865 | none (verbatim) |
| `history` | `PipelineRunQueries.scala` | 867-903 | none (verbatim) |
| `parseTruncationRecord` | `PipelineRunQueries.scala` | 905-961 | none (verbatim) |
| `summarizeAssertions` | `PipelineRunQueries.scala` | 963-973 | none (verbatim) |
| `<class-header>` | `PipelineRunService.scala` | 35-118 | none (verbatim) |
| `urlFetchSeam` | `PipelineRunService.scala` | 140-161 | none (verbatim) |
| `engine` | `PipelineRunService.scala` | 163-166 | none (verbatim) |
| `backend` | `PipelineRunService.scala` | 168-171 | none (verbatim) |
| `auditSubmit` | `PipelineRunService.scala` | 228-233 | none (verbatim) |
| `submit` | `PipelineRunService.scala` | 235-277 | none (verbatim) |
| `recordUnrunnable` | `PipelineRunService.scala` | 279-313 | none (verbatim) |
| `previewStep` | `PipelineRunService.scala` | 389-397 | none (verbatim) |
| `previewOutputs` | `PipelineRunService.scala` | 399-471 | none (verbatim) |
| `previewAtNode` | `PipelineRunService.scala` | 473-662 | none (verbatim) |
| `eventRegistry` | `PipelineRunService.scala` | 975-977 | none (verbatim) |
| `pipelineExists` | `PipelineRunService.scala` | 979-981 | none (verbatim) |
| `pipelineExistsShared` | `PipelineRunService.scala` | 983-987 | none (verbatim) |
| `<companion-and-siblings>` | `PipelineRunService.scala` | 1697-1770 | none (verbatim) |

Base line 1695 (the class's closing brace) is replaced by the entry point's own closing brace (scaffold). Base lines 1-34
(package and imports) are rebuilt per file (scaffold: imports).

## Allow-listed non-move lines
| File | Category: count | Non-move lines |
|---|---|---|
| `PipelineRunSupport.scala` | class-doc: 2, class-scaffold: 5, imports: 9, logger: 1, package: 1, visibility-subst: 5 | 23 |
| `PipelineRunTerminalWrites.scala` | class-doc: 3, class-scaffold: 7, imports: 9, logger: 1, member-import: 1, package: 1, visibility-subst: 7 | 29 |
| `PipelineRunSucceededWrites.scala` | class-doc: 3, class-scaffold: 16, imports: 16, logger: 1, member-import: 2, package: 1, visibility-subst: 1 | 40 |
| `PipelineRunExecutor.scala` | class-doc: 2, class-scaffold: 13, imports: 16, logger: 1, member-import: 3, package: 1, visibility-subst: 1 | 37 |
| `PipelineRunBackfill.scala` | class-doc: 1, class-scaffold: 11, imports: 8, logger: 1, member-import: 1, package: 1 | 23 |
| `PipelineRunQueries.scala` | class-doc: 2, class-scaffold: 6, imports: 12, logger: 1, package: 1 | 22 |
| `PipelineRunService.scala` | class-scaffold: 1, delegation: 8, delegation-signature: 15, imports: 24, member-import: 2, package: 1, wiring: 7 | 58 |

Category meanings: `package`/`imports` = package line and the pruned import list of that file; `class-doc`,
`class-scaffold` = new class doc comment, header, constructor parameters and closing brace; `logger` = the
`LoggerFactory.getLogger(classOf[PipelineRunService])` line (D5); `member-import` = named member imports of sibling
collaborators (D3); `wiring` = collaborator construction in the entry point (D4); `delegation`,
`delegation-signature` = the four one-line delegations (`backfillOutputNode`, `latestRun`, `runStatus`, `history`) with
their unchanged signatures (D1); `visibility-subst` = `private` -> `private[pipelines]` on the 14 members called across
classes. No positional comment words were edited (see follow-up candidates in files-modified.md). The exact text of every
allow-listed line is in `move-check/spec.json`.

## Green run (committed files)
```
PipelineRunSupport.scala: 124 lines :: moved/kept verbatim=92, scaffold:class-doc=2, scaffold:class-scaffold=5, scaffold:imports=9, scaffold:logger=1, scaffold:package=1, visibility-subst=5
PipelineRunTerminalWrites.scala: 217 lines :: moved/kept verbatim=177, scaffold:class-doc=3, scaffold:class-scaffold=7, scaffold:imports=9, scaffold:logger=1, scaffold:member-import=1, scaffold:package=1, visibility-subst=7
PipelineRunSucceededWrites.scala: 310 lines :: moved/kept verbatim=263, scaffold:class-doc=3, scaffold:class-scaffold=16, scaffold:imports=16, scaffold:logger=1, scaffold:member-import=2, scaffold:package=1, visibility-subst=1
PipelineRunExecutor.scala: 330 lines :: moved/kept verbatim=285, scaffold:class-doc=2, scaffold:class-scaffold=13, scaffold:imports=16, scaffold:logger=1, scaffold:member-import=3, scaffold:package=1, visibility-subst=1
PipelineRunBackfill.scala: 172 lines :: moved/kept verbatim=143, scaffold:class-doc=1, scaffold:class-scaffold=11, scaffold:imports=8, scaffold:logger=1, scaffold:member-import=1, scaffold:package=1
PipelineRunQueries.scala: 189 lines :: moved/kept verbatim=158, scaffold:class-doc=2, scaffold:class-scaffold=6, scaffold:imports=12, scaffold:logger=1, scaffold:package=1
PipelineRunService.scala: 634 lines :: moved/kept verbatim=555, scaffold:class-scaffold=1, scaffold:delegation=8, scaffold:delegation-signature=15, scaffold:imports=24, scaffold:member-import=2, scaffold:package=1, scaffold:wiring=7
base non-blank body lines: 1672; unclaimed 0; multiply-claimed 0
PASS
exit=0
```

## Red run 1: one token changed inside a moved body (`Future.fromTry(outcome)` -> `Future.fromTry(outcome.map(identity))`, scratch copy)
```
base non-blank body lines: 1672; unclaimed 0; multiply-claimed 0
FAIL
 - PipelineRunTerminalWrites.scala:38: member publishTerminalAfter base line 1002 mismatch
    expected: '      Future.fromTry(outcome)'
    actual:   '      Future.fromTry(outcome.map(identity))'
exit=1
```

## Red run 2: a COPY of an existing line (`    Future.successful(())`) inserted between two members of PipelineRunSupport, outside any member (scratch copy)
```
 - PipelineRunSupport.scala:65: member truncationFields base line 196 mismatch
    expected: '      allReads.nonEmpty,'
    actual:   '    val notice = PipelineRunService.composeTruncationNotice(allReads, InProcessPipelineEngine.MaxRunRows)'
 - PipelineRunSupport.scala:66: member truncationFields base line 197 mismatch
    expected: '      primaryStats.availableRowCount,'
    actual:   '    ('
exit=1
```
(Later lines in the same listing are cascade effects of the stray line.)

## Logger grep (D6c): every logger declaration in the seven files
```
PipelineRunSucceededWrites.scala:39:  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
PipelineRunTerminalWrites.scala:23:  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
PipelineRunExecutor.scala:35:  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
PipelineRunSupport.scala:20:  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
PipelineRunService.scala:111:  private val log = LoggerFactory.getLogger(getClass)
PipelineRunQueries.scala:24:  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
PipelineRunBackfill.scala:24:  private val log = LoggerFactory.getLogger(classOf[PipelineRunService])
```
The entry point's own `log` (`getLogger(getClass)`, unchanged from the base and identical in name on a `final` class) is
no longer referenced by any remaining entry-point member; it is kept verbatim per D1 (follow-up candidate).

## Logger red run
`PipelineRunSupport`'s logger was temporarily switched to `LoggerFactory.getLogger(getClass)`, then
`sbt 'testOnly com.helio.api.routes.pipelines.StepConfigInvalidRoutesSpec'` run, then reverted:
```
[info] - should log a config failure as a single WARN with no throwable and no ERROR *** FAILED ***
[info] - should GUARD: keep a datebucket data failure as an unnamed 422 logged at ERROR with its throwable *** FAILED ***
[info] - should GUARD: keep an AI step failure (ai-unavailable) as an unnamed 422 logged at ERROR *** FAILED ***
[info] - should return the named 422 from a dry run, logging a single WARN and no ERROR *** FAILED ***
[info] - should return the named 422 from a real run, persist the unchanged generic message, and log no ERROR *** FAILED ***
[info] Tests: succeeded 7, failed 5, canceled 0, ignored 0, pending 0
[info] *** 5 TESTS FAILED ***
```
The same spec passes (12/12) in the full run on the reverted tree.

## git --color-moved summary (for the PR)
`git diff --cached -M --color-moved=plain 4db9730fd -- backend/src/main`: moved-colored lines (plain mode, either side): 2308 | non-moved added: 201 | non-moved removed: 19.
Git's detector only recognises runs of roughly 20+ characters, so it undercounts; the checker above is the authoritative
statement. Numstat: PipelineRunService.scala +24/-1160; PipelineRunSupport.scala +124; PipelineRunTerminalWrites.scala
+217; PipelineRunSucceededWrites.scala +310; PipelineRunExecutor.scala +330; PipelineRunBackfill.scala +172;
PipelineRunQueries.scala +189; README.md +1/-1.
