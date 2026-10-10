## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD 1b765f59d0d09d2d60d5c05f31a2e06083e3a105 (= BASE; change dir untracked). Read-only; no sbt run.

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` → `READY ambient=/home/matt/Development/helio branch=task/split-pipeline-service/hel-1463`.
- **File shape**: `wc -l` = 2571. Class 51-2384, `PipelineCreateValidationFailure` 2386-2393 (incl. doc), companion 2395-2571 (177 lines). Matches design Context.
- **Member inventory completeness**: I enumerated all 62 class-body `def`/`val` declarations by regex. Every one is assigned exactly once, by D1 (keep) or D2 (move). None is missing and none is assigned twice.
- **Dependency graph / cycles**: I built a cross-reference matrix over the class body, with comments and strings stripped and `PipelineService.x` qualified refs excluded. I checked the hits by hand; the `create`/`delete`/`analyze`/`addStep` hits were all in string literals. Result: no cycle. The only collaborator→collaborator edges besides →Support are:
  - CreateWrites→CreateTransaction (`validateStepCrossOwnerRefs`, `createTransactional`).
  - CreateWrites→RootWrites (`createRootSources` calls `resolveOneRootSourceId`). This is the one helper shared by two collaborators; RootWrites owns it.

  D4's declaration order (root and create-transaction before create) already satisfies both edges. No collaborator calls any entry-point member except `requireEditorAccess`, which goes through D2a's function parameter, so no entry-point member needs widening. The entry point itself needs `audit`/`toSummaryResponse` from Support (`updateName`, `delete`, `listSummaries`, `findSummaryById`), which D3/D1 allow as collaborator imports.
- **Companion visibility**: every `PipelineService.x` the class body references (`classifyDbError` [services], `validateLaneReference`, `resolveRootTrunkAnchor`, `ancestorChainOf`, `descendantStepIds`, `rootAddress`/`stepAddress`/`outputAddress` [pipelines]) is accessible from a sibling class in the package. The plain-`private` `classifyPsqlException` is not referenced from the class. `PipelineCreateValidationFailure` is top-level `private`, so it is package-visible.
- **ExistenceNotLeakedRoutesSpec**:
  - `forbiddenProducerCounts` counts code lines containing `ServiceError.Forbidden(` per file name. Base has exactly one, at :2364 inside `requireEditorAccess`, which stays. Pin `"PipelineService.scala" -> 1` holds.
  - `filesCallingAccessHelpers`: PipelineService.scala calls no helper today (grep empty), so no new file will either.
  - Row `sites` are consulted only by the access-helper coverage test, so they are unaffected.
- **Logger claim**:
  - The class `log` is `getLogger(getClass)`, named `...pipelines.PipelineService`. D5's `classOf[PipelineService]` gives the same name, as in the PipelineRun* precedent.
  - The companion has its own `getLogger(getClass)` (`PipelineService$`) and stays put.
  - Log sites :323/:325/:1316/:1789/:2139/:2316 are confirmed.
  - No test captures this logger: every `ListAppender` spec attaches to PipelineRunService, ApiRoutes, TopLevelErrorHandlers or other loggers.
  - No logback config names it.
- **Defaults / javap**:
  - The only defaulted members are the constructor, `listSummaries` (kept) and `audit` (private).
  - No moved public method has a default, so the delegations need none.
  - A stale (2026-09-24) compiled `PipelineService.class` in the main checkout's target shows, under `javap -public`: no `audit$default$N` (private default getters are not public); 350 `$anonfun$` lines; no non-anonfun `$$` lines; and `$lessinit$greater$default$4..9` plus `listSummaries$default$2` surviving the filter.
  - The D6b filter is declared up front. It cannot hide a non-synthetic signature line, and the red run (a trailing defaulted parameter) creates a changed signature line plus a `$default$` line, neither of which the filter drops. Sound.
  - Positional call sites only (`requireEditorAccess(...)` ×7, `audit(...)` ×15), so the Function2 parameter and the imported defaulted `audit` compile unchanged.
- **Initialisation order**: there is no `this`, `lazy val`, `var` or `getClass` use in moved bodies beyond `log`. Constructor params are fields before the body runs, so D4's ordering is sufficient.
- **Name collisions**: none of the nine names exists as a file in the package. `PipelineStepCreate` also exists as `ResolvedAction.PipelineStepCreate` in `patchsets`. It is always used qualified, and there is no wildcard import of either, so it is harmless.
- **No `scalacOptions`** in build.sbt, so the dead private `stepAddress` (unused at base) produces no warning delta.
- **PatchSetApplyResolvers deferral**: sound. The file is in `services/patchsets` (853 lines, 4 Forbidden producers). `patchSetDispatchPairs()` hard-reads that exact file name with `.get`, and the producer pin is keyed by file name. A split would almost surely force edits to `ExistenceNotLeakedRoutesSpec`, which contradicts this ticket's AC5 (test diff empty).
- **Precedent**: HEL-1371/1385 design-gate findings are incorporated: `$$`/anonfun filter, exhaustive reverse check, no widened entry `log`. One exception: HEL-1385 CR3's "make the inventory exact", see CR1.

### Verdict: REFUTE

### Change Requests

1. **D2's line ranges are wrong at about 20 cross-destination boundaries. The stated rule "each member range includes its doc comment" is false for them.**
   - **What the ranges are.** Every D2 range is "this `def` line to the next `def` line minus 1". That attaches each member's doc comment (and preceding `//` block) to the *previous* member. Where the two members go to different files, a literal reading moves the doc to the wrong file. This is exactly the kind of error the byte-move and coverage checkers cannot detect, because the text still moves byte-identically.
   - **Ground-truth doc starts** (def → first doc/comment line), for each one where the previous member has a different destination:
     - `create` 152→128, inside the entry's `findSummaryById`.
     - `listSummaries` 118→116, inside Support's `stepResponseWithRoot`.
     - `validateOutputFieldMapping` 608→594, in CreateTransaction's `buildOutputsAction` range.
     - `updateName` 633→631.
     - `resolveOneRootSourceId` 672→664.
     - `analyze` 854→853.
     - `toCostVerdictResponse` 998→995.
     - `resolveSecondarySourceSchemas` 1022→1013.
     - `analyzeConcise` 1037→1031.
     - `laneTree` 1092→1085.
     - `parseBaselineSchema` 1311→1306.
     - `analyzeProposal` 1356→1330. 26 doc lines sit inside the stated `toDriftResponse (1321-1355)`.
     - `toAnalyzeStepResponse` 1667→1664.
     - `listSteps` 1740→1739.
     - `addStepReporting` 1771→1768.
     - `upsertOwnershipCheckF` 1899→1893.
     - `persistNewStep` 1921→1911.
     - `updateStep` 2088→2087.
     - `requireEditorAccess` 2356→2353, inside StepWrites' "2088-2355".
   - **Other range errors.** `toFieldResponse` is 2382-2383, not "2382-2390"; that range runs past the class's closing brace at 2384 into `PipelineCreateValidationFailure`. The `create`/`createTransactional` boundary (332-345) is the only one the design gets right. The tie-break "where a number is off by a line, the member name wins" does not cover offsets of up to 26 lines.
   - **Required fix**, either way:
     - (a) Restate every D2/D1 range as doc-start..closing line. List the unassigned blank/scaffold lines, as HEL-1385's design-gate CR3 required.
     - (b) Or replace the numbers with a mechanical rule ("a member block = the contiguous comment block immediately above its declaration through its last body line"), drop the false "includes its doc comment" sentence, and add a D6a checker assertion for that rule: each block's first line is a comment or its declaration, and the base line before it is blank or ends a previous block. Then a doc can never be split from its member.

   Fix `toFieldResponse`'s range in either case.
2. **Name the create collaborator consistently.**
   - proposal.md "What Changes" lists a "create preflight" collaborator.
   - D1's delegation example is `createPreflight.create(req, user)`.
   - D2 calls the class `PipelineCreateWrites`, and notes that `PipelineCreatePreflight.scala` (HEL-1469's object) already exists in the package.
   - A field named `createPreflight` that holds a `PipelineCreateWrites`, next to an existing `PipelineCreatePreflight`, will mislead readers.
   - Required fix: align proposal.md and D1's example with D2's name, for example a `createWrites.create(req, user)` receiver.

### Non-blocking notes

- D2 should say explicitly that `PipelineCreateWrites` takes `PipelineRootWrites` (for `resolveOneRootSourceId`) and `PipelineCreateTransaction` as sibling params. D4's order already accommodates this, so it is a documentation gap only.
- `stepAddress` (:329) is dead at base. Moving it to Support as plain `private` keeps it dead. Fine under the no-delete non-goal; consider listing it as a follow-up candidate.
- D6a's coverage counts "members", but the class body also contains the `require(...)` statement (:84) and the `//` block at 88-90 (`costInputGathering`'s comment). The inventory must claim both, and D1 already keeps them.
- D6d does not say what happens if a collaborator has no existing spec that asserts an observable result in its moved bodies. If that occurs, it should be recorded as a coverage gap (and a follow-up), not covered by writing a test, given C1.
- No gate-defect findings: no mtime evidence was relied on.
