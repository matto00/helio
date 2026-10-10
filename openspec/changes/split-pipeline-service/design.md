## Context

See proposal.md. File: `backend/src/main/scala/com/helio/services/pipelines/PipelineService.scala`, 2571 lines at base
1b765f59d (`BASE` below): imports and class doc (1-50), one `final class PipelineService(...)(implicit ec)` (51-2384),
top-level `private final case class PipelineCreateValidationFailure` (2386-2393 incl. doc), companion
`object PipelineService` (2395-2571). Line numbers below are at `BASE` and give each member's DECLARATION line only
(`def`/`val` line, plus `toFieldResponse` 2382-2383 and the class's closing brace at 2384); they are locators, not
spans. Spans are defined mechanically by D6a's member-block rule, never by "this def to the next def minus 1" (which
attaches each doc comment to the previous member — about 20 cross-destination boundaries at BASE, e.g. `create`'s doc
starts at 128 and `analyzeProposal`'s at 1330).

Hard constraints found while planning (each is a live test or a pinned guard, so each must hold with zero test edits):
- `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` pins `"PipelineService.scala" -> 1` and no other file for
  this code: the single producer is `requireEditorAccess` (:2364). No new file may contain `ServiceError.Forbidden(`.
- The same spec's `filesCallingAccessHelpers()` requires every file calling `requireOwnerOnly(`/`requireAccess(`/
  `authorizeResourceWithSharing(`/`authorizeResource(` to be named by a route row. `PipelineService.scala` calls none
  today; no new file may call one either (grep guard, D6c).
- Logger name: the class logs via `LoggerFactory.getLogger(getClass)` = `com.helio.services.pipelines.PipelineService`.
  No test captures it, but production log queries do; moved log sites (:323, :325, :1316, :1789, :2139, :2316) must
  keep that name.
- `audit` has a defaulted parameter (`metadata: JsValue = JsObject.empty`), so it cannot be passed as a function value
  without changing call text; `requireEditorAccess` has none.
- Public API used by ~every route/patch-set/assistant caller and many specs: `listSummaries` (defaulted `tag`),
  `findSummaryById`, `create`, `updateName`, `delete`, `addRoot`, `removeRoot`, `analyze`, `analyzeConcise`,
  `laneTree`, `capabilitiesAtNode`, `validateExpression`, `analyzeProposal`, `listSteps`, `addStep`,
  `addStepReporting`, `updateStep`, `deleteStep`, `reorderSteps`, `duplicateStep`, plus the companion's
  `private[pipelines]`/`private[services]` helpers (`classifyDbError`, `validateLaneReference`, `resolveRootTrunkAnchor`,
  `ancestorChainOf`, `descendantStepIds`, address helpers) referenced as `PipelineService.x` from other files.

## Goals / Non-Goals

Goals: concern-focused files; identical behaviour; zero test-source diff; reviewers can see moves vs edits.
Non-goals: see proposal.md.

## Decisions

**D1 — Entry point keeps name, package, constructor, public API.** `PipelineService.scala` keeps verbatim: the imports
it still needs, the class doc, the full constructor (every parameter, order, default, comment), `require(...)`, `log`,
`costInputGathering`, `listSummaries`, `findSummaryById`, `updateName`, `delete`, `listSteps`, `addStep` (already a
one-line delegation to `addStepReporting`), `requireEditorAccess` (C2), `PipelineCreateValidationFailure`, and the whole
companion object. Every other public method's body moves, and so do the five `private[services]` members (see `PipelineNodeReads`;
`WorkspaceContextService` calls four of them on a `PipelineService` instance at :147/:151/:162/:324, and all five compile
to public bytecode methods, so they are part of C5's surface); for each, the entry point keeps a one-line delegation
with an unchanged signature and unchanged modifier (`def` for public ones, `private[services] def` for the five) (doc comment moves WITH the body; the delegation carries none), receiver-qualified
(`createWrites.create(req, user)`), never via an import that would clash with the entry point's own public defs.
Expected entry size ~490 lines (the 177-line companion stays: its members compile to public `PipelineService$`
methods referenced from other files, so moving them would change C5's javap and many callers).

**D2 — Destinations** (same package, each a `private[pipelines] final class X(...)(implicit ec: ExecutionContext)`,
one file each, members in their original relative order):
- `PipelineServiceSupport` — shared helpers: `audit` (:93), `stepResponseWithRoot` (:110), `stepAddress` and
  `outputAddress` (:329-330; the doc block at 332-345 belongs to `createTransactional`), `resolveSecondarySourceSchemas`
  (:1022), `validateOutputFieldMapping` (:608), `upsertOwnershipCheckF` (:1899), `toWarningResponse` (:992),
  `toAnalyzeStepResponse` (:1667), `toSummaryResponse` (:2367), `toFieldResponse` (:2382-2383).
- The create path, split in two:
  - `PipelineCreateWrites` — `create` (:152), `checkedCreate`, `checkRootsReadOnly`, `rootShapeProblem`,
    `createWithInlineRoots`, `createRootSources`, `lookupOwnedRoots`, `compensatingInlineSources`,
    `deleteInlineSources` (:173-:319). Sibling params: `PipelineRootWrites` (`createRootSources` calls
    `resolveOneRootSourceId`) and `PipelineCreateTransaction` (`checkedCreate`/`createWithInlineRoots` call
    `validateStepCrossOwnerRefs`/`createTransactional`).
  - `PipelineCreateTransaction` — `createTransactional` (:346, doc from 332), `validateStepCrossOwnerRefs`,
    `checkOwnedSource`, `rewriteLaneClientId`, `buildStepsAction`, `buildOutputsAction` (:410-:545; `upsertTargetProblems`
    :445 goes to `PipelineAnalyzeReads`).
- `PipelineRootWrites` — `resolveOneRootSourceId`, `resolveInlineRootSourceId`, `addRoot`, `removeRoot` (:672-:787).
- `PipelineAnalyzeReads` — `analyze` (:854), the standalone `// HEL-1093 ... hasSourceUrl moved ...` comment block
  (988-990, kept directly after `analyze`), `toCostVerdictResponse` (:998), `analyzeConcise` (:1037),
  `upsertTargetProblems` (:445), `parseBaselineSchema` (:1311), `toDriftResponse` (:1321).
- `PipelineNodeReads` — `laneTree` (:1092), the five `private[services]` members `laneTreeGiven` (:1118),
  `listRootDataSourceIdsInternalBatch` (:1151), `rootIdsOfBatch` (:1158), `listByPipelineInternalBatch` (:1166),
  `laneTreeFromRoots` (:1171), then `capabilitiesAtNode`, `validateExpression`, `projectedSchemaAtNode`,
  `buildNodeCapabilities` (:1200-:1290). The five keep their `private[services]` modifier verbatim in the moved text
  (the class itself is `private[pipelines]`, so they are reachable only through the entry point). Call chain
  `laneTree` -> `laneTreeGiven` -> `laneTreeFromRoots` stays inside this one class; none of the three calls any other
  collaborator except Support, so no cycle.
- `PipelineProposalAnalyze` — `analyzeProposal` through `toSchemaFields` (:1356-:1661).
- `PipelineStepCreate` — `addStepReporting` (:1771), `persistNewStep` (:1921).
- `PipelineStepWrites` — `updateStep`, `deleteStep`, `reorderSteps`, `duplicateStep` (:2088-:2294).
Each class takes exactly the constructor parameters its moved bodies reference, under the SAME names as the original
constructor (so bodies compile unchanged), plus the sibling collaborators it calls. The executor may move a member to
a different destination than listed only to resolve a real dependency (e.g. a helper this inventory missed), recording
each such move and why in `move-evidence.md`; class names are self-approved. Name check: no new class may reuse an
existing file name in the package (`PipelineCreatePreflight.scala`, `PipelineProposalService.scala` already exist).

**D2a — `requireEditorAccess` stays in the entry point (C2).** Collaborators that call it (`PipelineRootWrites`,
`PipelineStepCreate`, `PipelineStepWrites`) receive it as a constructor parameter of function type named
`requireEditorAccess: (PipelineId, AuthenticatedUser) => Future[Either[ServiceError, Unit]]`, so call text
`requireEditorAccess(pipelineId, user)` compiles unchanged. The entry point passes `requireEditorAccess` (eta-expanded).
Its evaluation is a pure repo read at call time, as today.

**D3 — Bodies move byte-identical.** Members keep their 2-space class-body indentation, so moved text is byte-identical,
doc comments included. Cross-class calls keep their unqualified text via named member imports at the top of each class
body (e.g. `import support.{audit, toSummaryResponse}`); a receiver-qualified call is allowed only where an import would
be ambiguous, and each one is listed in the evidence. The only other permitted non-move lines: package/imports, class
scaffolding (class header, collaborator imports, `log` line, closing brace), `private` -> `private[pipelines]` on members
now called across classes, the D1 one-line delegations, collaborator wiring in the entry point, the package README file
list. **No edits inside moved or kept comments at all** (design-gate r3 note 1): positional words the move made false
("above"/"below"/"this file") and stale doc links (`[[x]]`) are left as-is and listed as follow-up candidates, so the
forward check needs no substitution other than `private` -> `private[pipelines]`.

**D4 — Wiring and initialisation order.** The entry point builds the collaborators as `private val`s declared after
`costInputGathering`, in dependency order (support, analyze, node, proposal, root, create-transaction, create,
step-create, step-writes), passing its own constructor parameters by value. One instance of each per `PipelineService`
instance; construction does no I/O, as today. A collaborator must never be declared before a value it captures
(null-capture hazard). `costInputGathering` stays in the entry point and is passed to `PipelineAnalyzeReads` (kept
verbatim, still one instance per service).

**D5 — Logger name.** Every new class that logs declares exactly `private val log = LoggerFactory.getLogger(classOf[PipelineService])`
(never `getClass`), so the logger name stays `com.helio.services.pipelines.PipelineService`.

**D6 — Evidence** (in this change dir; scripts under `move-check/`, adapted from the HEL-1371 archive
`openspec/changes/archive/2026-10-08-split-pipeline-run-service/move-check/`).
(a) `move-evidence.md`: an inventory table assigning EVERY member block of the base class body to exactly one
destination, with its exact BASE span (first..last line) as computed by the rule below. **Member-block rule:** a member
block is the contiguous run of comment lines (`/**`, ` *`, `//`) immediately above a class-body declaration (no blank
line between them and the declaration) through the declaration's last body line. Non-member class-body statements are
blocks too and must be claimed: the `require(...)` statement (:84) and the `//` comment block at 88-90 that belongs to
`costInputGathering` (both kept, D1), and the standalone comment block at 988-990 (to `PipelineAnalyzeReads`). General rule: any
comment-only block separated from the next declaration by a blank line is a standalone block, and the inventory must
assign it explicitly; the checker fails on any unassigned non-blank class-body line. The checker asserts the rule: each block's first line is a comment line or its
declaration, and the BASE line immediately before it is blank or is the last line of the previous block; so a doc can
never be split from its member. A mechanical checker in BOTH directions: (i) forward: each member's base text (`git show BASE:<path>`) equals its text
in the new file, only declared `private` -> `private[pipelines]` substitutions allowed; (ii) reverse: every non-blank
line of the ten resulting files is consumed POSITIONALLY by the next expected item (a member block or an explicit
allow-listed scaffold line tagged with its D3 category); any extra/missing/altered line fails; (iii) coverage: every
non-blank base class-body line is claimed by exactly one member block. Red runs on scratch copies: one token changed
inside a moved body (forward fails); a COPY of an existing line (e.g. a duplicated `}`) inserted outside any member
(reverse fails). Plus a `git diff --color-moved=plain BASE` summary for the PR.
(b) `api-evidence.md`: `javap -public` of `com.helio.services.pipelines.PipelineService` and `PipelineService$` (sbt 2
class output dir) before vs after. **Normalisation, declared up front:** Scala 2.13 emits lambda bodies as public
static `$anonfun$<method>$<N>` methods (numbered per enclosing class, so a move both renumbers and removes them), plus
`$deserializeLambda$` and `$$`-mangled accessors. Normalising only the `$N` suffix is not enough, because the moved
lambdas leave the class entirely; so the filter DROPS every line matching `\$anonfun\$|\$deserializeLambda\$|\$\$`,
and nothing else. The filtered diff must be empty (it still covers the constructor, `$lessinit$greater$default$N`,
`listSummaries$default$2`, every public method and every companion member). Also record the raw line counts and the
count of dropped lines before/after. Red run (must still compile `main`): temporarily add a trailing defaulted
parameter to one public delegation, rebuild, show the filtered diff non-empty, revert.
(c) Guards (grep, recorded): every new file's only logger is exactly D5's line; no new file contains
`ServiceError.Forbidden(` or an access-helper call; no inline FQN (`com.helio.`, `spray.json.`, `java.`, `scala.`,
`org.` qualified names outside import/package lines, string interpolations included) in any new or edited file.
(d) Test-exercise red runs: one behaviour mutation per collaborator file (nine), each changing an observable result in
a moved body (e.g. a status code or message text) that an existing spec asserts; run the affected specs and show each
red with a failure attributable to its mutation (mutations may be applied together in one run only if every failure
message is distinct and named in the evidence); revert and show green. Record the spec and assertion each one hit. If a collaborator has no existing spec asserting an observable result of its
moved bodies, record that as a coverage gap and a follow-up candidate; do NOT write a test (C1).
(e) `test-count-evidence.md`: baseline `nice -n 19 sbt -J-Xmx3g testFull` on the unmodified worktree at BASE (record
total succeeded/failed/ignored, per-suite counts for every suite, and that `[hel1468-guard]` appears); the same after the
change must match per suite and pass. Known flakes are named, not hidden: a failure on either side is re-run alone and
both runs recorded. `git diff BASE...HEAD -- backend/src/test` empty. The suite outlives one Bash call: run it
backgrounded to a log under the run evidence dir, poll with `scripts/concertino/await-sentinel.sh`; shut down every sbt
server started.

## Risks / Trade-offs

- Eager-val initialisation order: a collaborator declared before what it captures would capture `null`. Mitigated by
  D4 and every route spec constructing a real `PipelineService`.
- Widening members to `private[pipelines]` exposes them inside the package. Accepted, as in HEL-1371; the classes
  themselves are `private[pipelines]`.
- Entry point stays ~490 lines (D1), over the ~400 split threshold. Accepted: the remainder is the constructor doc,
  the pinned Forbidden producer, and the companion, which other files call by name.
- Function-typed `requireEditorAccess` parameter adds one closure allocation per service instance. Negligible.

## Planner Notes

- Self-approved: nine collaborators. Driver claims verified: HEL-1417 (#906), HEL-1469 (#918, added
  `PipelineCreatePreflight.scala`) merged; HEL-1436 (#920) did not touch this file. Line count is 2571, not ~2650.
- **`PatchSetApplyResolvers.scala` is NOT in this PR; it becomes its own ticket.** It is 853 lines in a different
  package, and `ExistenceNotLeakedRoutesSpec` pins it three ways (4 Forbidden producers, the dispatch-pair scan reads
  that exact file name, and route rows name it as the site), so splitting it is its own design problem; adding ~850
  moved lines to a ~2600-line move would make this PR unreviewable.
- `stepAddress` (:329) is dead at BASE (no caller); it moves verbatim to Support and is listed as a follow-up candidate.
- `PipelineCreateTransactionalSpec.scala` comments cite `PipelineService.scala` / `:521`; tests stay untouched, so
  those become stale — recorded as a follow-up candidate, not edited.
- No gate-chain (`.husky/**`) impact.

## Standing Constraints

- [C1] Zero diff under `backend/src/test`; per-suite test results equal the BASE baseline.
- [C2] `ServiceError.Forbidden(` appears in `PipelineService.scala` exactly once (in `requireEditorAccess`) and in no
  new file; no new file calls an access helper.
- [C3] Moved code logs via the `classOf[PipelineService]` logger.
- [C4] Moved bodies are byte-identical apart from D3's listed categories; defects found become follow-ups, not fixes.
- [C5] Filtered (D6b) `javap -public` of `PipelineService` and `PipelineService$` is unchanged.
- [C6] No edits inside any moved or kept comment; the only permitted in-member substitution is `private` -> `private[pipelines]`.
