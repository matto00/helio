# Move evidence (HEL-1463, D6a/D6c)

BASE = 1b765f59d. Scripts in `move-check/`: `gen.py` (builds the ten files from BASE member blocks and emits `spec.json`),
`check.py` (forward + reverse + coverage + block rule), `red-runs.txt`, `check-green.txt`.

## Result

`check.py 1b765f59d move-check/spec.json backend/src/main/scala/com/helio/services/pipelines`: PASS (see `move-check/check-green.txt`):
75 member blocks, 2434 non-blank BASE lines (35..2571 less the class-closing brace 2384), 0 unclaimed, 0 multiply-claimed.
Every non-blank line of the ten files is consumed positionally by a member block or a tagged scaffold line. Non-move line
categories per file are in check-green.txt (imports, class header/doc, collaborator imports, logger, delegation, wiring);
the only in-member substitution is `private` -> `private[pipelines]` on 13 declaration lines (column below).

Red runs (`move-check/red-runs.txt`): (1) one token changed inside a moved body (`NotFound(` -> `Conflict(` in `addRoot`, in a scratch copy): forward check FAILS with the exact line; (2) a copy of an existing line (a duplicated `}`) inserted outside any member (scratch copy of PipelineStepWrites): reverse check FAILS ("UNACCOUNTED line").

## Inventory (every BASE member block -> exactly one destination)

| Member block | BASE span | Destination | private -> private[pipelines] |
|---|---|---|---|
| class-header | 35-82 | PipelineService |  |
| require | 84-84 | PipelineService |  |
| log | 86-86 | PipelineService |  |
| costInputGathering | 88-91 | PipelineService |  |
| audit | 93-101 | PipelineServiceSupport | yes |
| stepResponseWithRoot | 103-113 | PipelineServiceSupport | yes |
| listSummaries | 116-119 | PipelineService |  |
| findSummaryById | 121-126 | PipelineService |  |
| create | 128-165 | PipelineCreateWrites |  |
| checkedCreate | 167-190 | PipelineCreateWrites |  |
| checkRootsReadOnly | 192-212 | PipelineCreateWrites |  |
| rootShapeProblem | 214-238 | PipelineCreateWrites |  |
| createWithInlineRoots | 240-271 | PipelineCreateWrites |  |
| createRootSources | 273-289 | PipelineCreateWrites |  |
| lookupOwnedRoots | 291-301 | PipelineCreateWrites |  |
| compensatingInlineSources | 303-317 | PipelineCreateWrites |  |
| deleteInlineSources | 319-327 | PipelineCreateWrites |  |
| stepAddress | 329-329 | PipelineServiceSupport |  |
| outputAddress | 330-330 | PipelineServiceSupport | yes |
| createTransactional | 332-394 | PipelineCreateTransaction | yes |
| validateStepCrossOwnerRefs | 396-443 | PipelineCreateTransaction | yes |
| upsertTargetProblems | 445-450 | PipelineAnalyzeReads |  |
| checkOwnedSource | 452-456 | PipelineCreateTransaction |  |
| rewriteLaneClientId | 458-484 | PipelineCreateTransaction |  |
| buildStepsAction | 486-540 | PipelineCreateTransaction |  |
| buildOutputsAction | 542-592 | PipelineCreateTransaction |  |
| validateOutputFieldMapping | 594-629 | PipelineServiceSupport | yes |
| updateName | 631-647 | PipelineService |  |
| delete | 649-662 | PipelineService |  |
| resolveOneRootSourceId | 664-686 | PipelineRootWrites | yes |
| resolveInlineRootSourceId | 688-737 | PipelineRootWrites |  |
| addRoot | 739-772 | PipelineRootWrites |  |
| removeRoot | 774-851 | PipelineRootWrites |  |
| analyze | 853-986 | PipelineAnalyzeReads |  |
| standalone-hasSourceUrl-comment | 988-990 | PipelineAnalyzeReads |  |
| toWarningResponse | 992-993 | PipelineServiceSupport | yes |
| toCostVerdictResponse | 995-1011 | PipelineAnalyzeReads |  |
| resolveSecondarySourceSchemas | 1013-1029 | PipelineServiceSupport | yes |
| analyzeConcise | 1031-1083 | PipelineAnalyzeReads |  |
| laneTree | 1085-1100 | PipelineNodeReads |  |
| laneTreeGiven | 1102-1131 | PipelineNodeReads |  |
| listRootDataSourceIdsInternalBatch | 1133-1154 | PipelineNodeReads |  |
| rootIdsOfBatch | 1156-1161 | PipelineNodeReads |  |
| listByPipelineInternalBatch | 1163-1169 | PipelineNodeReads |  |
| laneTreeFromRoots | 1171-1192 | PipelineNodeReads |  |
| capabilitiesAtNode | 1194-1214 | PipelineNodeReads |  |
| validateExpression | 1216-1242 | PipelineNodeReads |  |
| projectedSchemaAtNode | 1244-1288 | PipelineNodeReads |  |
| buildNodeCapabilities | 1290-1304 | PipelineNodeReads |  |
| parseBaselineSchema | 1306-1319 | PipelineAnalyzeReads |  |
| toDriftResponse | 1321-1328 | PipelineAnalyzeReads |  |
| analyzeProposal | 1330-1407 | PipelineProposalAnalyze |  |
| resolveProposalOutputAnalyses | 1409-1431 | PipelineProposalAnalyze |  |
| resolveOneProposalOutputAnalysis | 1433-1461 | PipelineProposalAnalyze |  |
| resolveProposalOutputNodeSchema | 1463-1499 | PipelineProposalAnalyze |  |
| resolveAllProposalRootSchemas | 1501-1517 | PipelineProposalAnalyze |  |
| resolveOneProposalRootSchema | 1519-1538 | PipelineProposalAnalyze |  |
| validateStepKinds | 1540-1551 | PipelineProposalAnalyze |  |
| resolveInlineSourceSchema | 1553-1659 | PipelineProposalAnalyze |  |
| toSchemaFields | 1661-1662 | PipelineProposalAnalyze |  |
| toAnalyzeStepResponse | 1664-1736 | PipelineServiceSupport | yes |
| listSteps | 1739-1762 | PipelineService |  |
| addStep | 1764-1766 | PipelineService |  |
| addStepReporting | 1768-1891 | PipelineStepCreate |  |
| upsertOwnershipCheckF | 1893-1909 | PipelineServiceSupport | yes |
| persistNewStep | 1911-2085 | PipelineStepCreate |  |
| updateStep | 2087-2201 | PipelineStepWrites |  |
| deleteStep | 2203-2233 | PipelineStepWrites |  |
| reorderSteps | 2235-2285 | PipelineStepWrites |  |
| duplicateStep | 2287-2350 | PipelineStepWrites |  |
| requireEditorAccess | 2353-2365 | PipelineService |  |
| toSummaryResponse | 2367-2380 | PipelineServiceSupport | yes |
| toFieldResponse | 2382-2383 | PipelineServiceSupport | yes |
| PipelineCreateValidationFailure | 2386-2393 | PipelineService |  |
| companion-object | 2395-2571 | PipelineService |  |

Class-closing brace (BASE 2384) is scaffold in the entry point (the entry class is closed after the last kept member, before PipelineCreateValidationFailure).

Destinations moved only as inventoried in design D2; no member was moved to a different destination than D2 lists.
The class header + constructor (35-82) is the "class-header" block of the entry point; the companion (2395-2571) stays.

## Guards (D6c, grep output recorded 2026-10-10)

- Loggers: only PipelineCreateWrites, PipelineAnalyzeReads, PipelineStepCreate, PipelineStepWrites log, each with exactly
  `private val log = LoggerFactory.getLogger(classOf[PipelineService])`; no other file mentions `getLogger`.
- `ServiceError.Forbidden(` counts: PipelineService.scala 1 (requireEditorAccess), each of the nine new files 0.
- Access-helper calls (`requireOwnerOnly(`, `requireAccess(`, `authorizeResourceWithSharing(`, `authorizeResource(`): 0 hits in all ten files.
- Inline FQN scan (`com.helio.`, `spray.json.`, `java.`, `scala.`, `org.` + identifier, outside import/package lines): 0 hits in the ten files; string interpolations contain none.
- `git diff 1b765f59d -- backend/src/test`: empty.
- `npm run check:scala-quality`: clean (no new warnings for these files other than the soft-budget notes below).

## Follow-up candidates (none fixed here)

- Stale positional comment words ("above", "below", "this file") and `[[...]]` doc links inside moved/kept comments (C6: left as-is).
- Stale `PipelineService.scala` line citations: test comments in `PipelineCreateTransactionalSpec`; main comments in `PatchSetApplyResolvers.scala:178`, `PatchSetPreviewProjection.scala:286`, `PipelineStepRepository.scala:1092`.
- `stepAddress` (BASE :329) is dead (no caller); moved verbatim to PipelineServiceSupport.
- The entry point's `log` (BASE :86) is unused after the move (kept verbatim; its LoggerFactory import stays).
- Collaborators over the ~250-line soft budget: PipelineProposalAnalyze (359), PipelineStepCreate (327), PipelineStepWrites (291), PipelineCreateTransaction (283), PipelineAnalyzeReads (272); PipelineService entry 446 (companion + kept members); PipelineCreateWrites 232, NodeReads 247, Support 220, RootWrites 216 are within budget.
- Coverage gaps found by D6d mutation runs: see `mutation-evidence.md`.
- `PatchSetApplyResolvers.scala` (853 lines) split: its own ticket (design Planner Notes).
