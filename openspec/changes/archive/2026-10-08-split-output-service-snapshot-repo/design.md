## Context

See proposal.md. Base: origin/main 24f6de4cf. Files:
- `services/pipelines/OutputService.scala` (503): class `OutputService` lines 26-450 (constructor 26-58 with 9 params,
  6 defaulted to `null`/`NoBackfillObserver`), companion 452-503.
- `infrastructure/persistence/pipelines/NodeSnapshotRepository.scala` (458): companion types 16-71, class 87-458.

Constraints found while planning (each must hold with zero test edits):
- `ExistenceNotLeakedRoutesSpec` pins `"OutputService.scala" -> 1` `ServiceError.Forbidden(` producer (`create`, :138)
  and names `OutputService.scala` for GET/POST pipeline outputs rows (:448-449). `create`/`listByPipeline` stay.
- `scripts/check-node-root-encoding.mjs` scans a fixed `TARGET_FILES` list and keys 3 exemptions on
  `(NodeSnapshotRepository.scala, scope)` for `overwriteRowsAction`, `listRows`, `nodeFilterFragment`; moving any of
  those scopes would make an exemption stale. None of them moves (D4).
- Open PR #847 (HEL-1371) constructs `NodeSnapshotRepository` and calls `listRows`/`overwriteRows`/`overwriteRowsWith`;
  `PatchSetPreviewProjection` calls `OutputService.mergeConfig`/`validateConfig`; `OutputRoutes`/`PublicDashboardRoutes`
  call `rows`/`filterCapabilities`/`distinctValues`/`listRowsPaged`. All stay source- and binary-compatible (D5b).
- `OutputService`'s logger (`getClass`) is used only by `triggerBackfill`, which stays. No moved code logs.

## Goals / Non-Goals

Goals: genuine single-concern files; identical behaviour; zero test-source diff; moves reviewable as moves.
Non-goals: see proposal.md.

## Decisions

**D1 — `OutputRowReads` (services/pipelines, `private[pipelines] final class`).** Concern: reading an Output's
materialized node snapshot (rows page, filter-capability contract, distinct values, `materialized` derivation) — the
same concern `OutputRowsQuery`/`OutputFilterCapability`/`OutputFilteredMetric` already serve. Receives `rows`
(336-387), `filterCapabilities` (389-401), `distinctValues` (403-427), `materializedFor` (429-449), doc comments
included. Constructor `(outputRepo: OutputRepository, nodeSnapshotRepo: NodeSnapshotRepository, pipelineRunRepo:
PipelineRunRepository)(implicit ec: ExecutionContext)` — same parameter names, so bodies (incl. every `== null`
degrade check) compile unchanged. `OutputService` keeps the three public methods with unchanged signatures/defaults as
one-line delegations (`rowReads.rows(id, page, user, sort, filter)`), each with a one-line doc pointing at
`OutputRowReads`.

**D2 — `OutputRootResolution` (services/pipelines, `private[pipelines] final class`).** Concern: create-time root
anchoring (which root a new Output binds to). Receives `requireUnambiguousRootWhenNeither` (170-191) and
`resolveExplicitRootId` (193-216), widened `private` -> `private[pipelines]`. Constructor `(pipelineRootRepo:
PipelineRootRepository)(implicit ec)`. `create` keeps its call text byte-identical via a member import at the top of
the class body: `import rootResolution.{requireUnambiguousRootWhenNeither, resolveExplicitRootId}`.

**D3 — config-write validation joins `OutputConfigValidation` (services/pipelines, existing `object`).** Concern:
write-time validation of an Output's `config` — which `OutputConfigValidation.scala` (157 lines, HEL-1313) already owns,
together with `OutputConfigWritePolicy`. The companion's `validateFieldMapping` (457-477), `validateConfig` (479-498),
`mergeConfig` (500-502) move verbatim (doc comments and the `"OutputService: no OutputBindingSpec ..."` exception text
included) into that object, appended after its existing members (~205 lines after). Its existing members are not
edited; its header doc (6-11) gets one scoped amendment of at most two lines saying the object also holds the
whole-config write validators moved from `OutputService` (which judge the MERGED config's `fieldMapping`/`compare`/
`historyPayloads`, outside the key-check tolerance rule) — listed as an allowed D5 line. `validateConfig`'s body text `OutputConfigValidation.validate(...)` stays qualified (still resolves). The
companion keeps `NoBackfillObserver` plus three same-signature forwarders (same parameter names and the `policy`
default) delegating to it. `create`/`update`/`PatchSetPreviewProjection` keep calling `OutputService.*` (text unchanged).
No second config-validation home is created.

**D4 — `NodeSnapshotFilterSql` (persistence/pipelines, `private[pipelines] object`).** Concern: pure SQL-fragment
construction for filtered/sorted snapshot reads (HEL-1027 D6 escaping, HEL-1188 op casts, D4 ordering). Receives
`escapeLikeTerm`, `likeEscapeChar`, `quickTermFragment`, `opValueCastExpr`, `opFragment`, `filterWhereFragment`,
`sortCastExpr`, `orderByFragment` (205-311). None touches `ctx`. `filterWhereFragment`/`orderByFragment` widen to
`private[pipelines]`; the rest stay `private`. The repository keeps call text byte-identical via
`import NodeSnapshotFilterSql.{filterWhereFragment, orderByFragment}` at the top of the class body. `nodeFilterFragment`
STAYS in the repository: it is the node-scoping predicate every method shares and carries a guard exemption.
`NodeSnapshotFilterSql.scala` is added to `check-node-root-encoding.mjs`'s `TARGET_FILES` (one line, no exemption
change), so moving code out of a scanned file never removes it from the scan.

**D5 — Byte-identical moves.** Moved members keep their 2-space class/object-body indentation and doc comments.
Permitted non-move lines only: package/imports; class/object scaffolding; `private` -> `private[pipelines]` on members
now called across files; D1/D3 delegations and their one-line docs; `private val` collaborator wiring; D2/D4 member
imports; positional words in comments the move made false ("above"/"below"/"this file"/"this service"/"THIS class"),
each listed; the D3 header amendment; removal of imports left unused by the move.
Stale cross-references in moved docs (e.g. "see `hasAnyRow` below") are not edited unless positional — listed as
follow-up candidates.

**D5a — Wiring.** `OutputService` declares `private val rowReads = new OutputRowReads(outputRepo, nodeSnapshotRepo,
pipelineRunRepo)` and `private val rootResolution = new OutputRootResolution(pipelineRootRepo)` right after `log`.
Strictly `private` (not `private[pipelines]`) so no public bytecode accessor appears. Construction does no I/O.

**D5b — Evidence (change dir; scripts in scratchpad, copied into `move-check/`).**
(a) `move-evidence.md`: inventory assigning every original member of both files to one destination; a mechanical
checker, forward (each member's text from `git show 24f6de4cf:<path>` byte-equals its new text, modulo the listed
visibility widenings) and reverse/positional (every line of the 6 resulting files is claimed by exactly one member span
or one allow-listed D5 line; `OutputConfigValidation.scala`'s pre-existing lines are claimed as "kept" against
its own base text). Red runs: one token changed in a moved body (forward fails); a duplicated existing line
inserted outside any member (reverse fails). Plus a `git diff --color-moved=plain` summary.
(b) `api-evidence.md`: `javap -public` of `OutputService`, `OutputService$`, `NodeSnapshotRepository`,
`NodeSnapshotRepository$` and its nested companion types, plus `OutputConfigValidation`/`OutputConfigValidation$`,
before vs after. Publish the RAW unfiltered diff. Then classify every differing line: compiler synthetics
(`$anonfun$`, `$deserializeLambda$`) may differ; any name containing `$$` is NOT blanket-filtered — an ADDED `$$` name
on any checked class fails the check (would be a leaked private, e.g. `$$rowReads`). The only pre-approved `$$`
changes are the two REMOVALS on `NodeSnapshotRepository`:
`com$helio$infrastructure$persistence$pipelines$NodeSnapshotRepository$$escapeLikeTerm(String)` and
`...$$likeEscapeChar()` (made public today only because `filterWhereFragment`'s `collect` closure reads them), with
`git grep` on HEAD and on ca3f5619 showing nothing references either name. `OutputConfigValidation`/`OutputConfigValidation$`'s diff may only ADD: the three moved public methods,
`validateConfig$default$4()`, the static forwarders the mirror class emits for those four, and `$anonfun$` synthetics;
every pre-existing member stays identical. `OutputService`/`OutputService$` must still carry
`validateConfig$default$4()` (proves the forwarder kept its default). Everything else (constructors, `$lessinit$greater$default$N`, `*$default$N`, every
public method/companion member) must be identical. Red runs: (i) temporarily add a defaulted param to a public method,
rebuild, show the classifier fails, revert; (ii) temporarily make `rowReads` `private[pipelines]`, show an added
public accessor fails the classifier, revert.
(c) `mutation-evidence.md` (ticket AC): one single-token mutation per new/receiving file — `NodeSnapshotFilterSql`
(e.g. `>=` -> `>` in `Gte`), `OutputRowReads` (e.g. `materializedFor`'s `!t.isBefore`), `OutputRootResolution` (e.g.
`roots.size > 1` -> `roots.size > 2`), and the moved validators in `OutputConfigValidation` (e.g. `mergeConfig`
operand order) — each shown red via `testOnly` of a spec that reaches it THROUGH the public `OutputService` /
`NodeSnapshotRepository` methods (proving the delegation/forwarder is live), then reverted. A mutation that stays green
is recorded as a test-gap follow-up candidate (and a second mutation tried), never silently dropped.
(d) `test-count-evidence.md`: baseline `nice -n 19 sbt testFull` on the unmodified worktree (totals + per-suite counts
for OutputRoutesSpec, NodeSnapshotRepository*Spec, OutputService*Spec, ExistenceNotLeakedRoutesSpec, PatchSet*Spec,
PublicDashboardRoutes*Spec); after the change totals equal and pass. `git diff 24f6de4cf...HEAD -- backend/src/test`
empty. Suite outlives a 10-minute Bash call: background it to a log, poll with `await-sentinel.sh`-style bounded waits.
(e) `npm run check:scala-quality` (no inline FQNs; eyeball every `s"${...}"` in new files — HEL-1386 blind spot),
`npm run check:node-root-encoding` green, plus a red run inserting a standalone `node_step_id IS NULL` line into
`NodeSnapshotFilterSql.scala` (proves the new file is scanned), reverted.

## Risks / Trade-offs

- [Eager `private val` captures a null collaborator] → collaborators are constructor params, never late-initialised;
  null-degrade fixtures in OutputRoutesSpec exercise every branch.
- [Implicit `ec` differs] → each new class takes the same implicit `ec` the service was built with.
- [Final sizes stay over 250 (~330 / ~355)] → accepted and stated in the PR; the remainder is the pinned constructor
  docs, the `create` Forbidden producer, and companion types that cannot leave the file.
- [Member import shadows a same-named public def] → none of the imported names exist on the importing class.

## Planner Notes

- Self-approved: three new files (D3 reuses `OutputConfigValidation.scala`, skeptic-design-1 R2); `assertionStatus` stays (one 33-line method, splitting it further is fragmentation).
- Driver claims checked: HEL-1313 validateConfig/policy and HEL-1356 backfillObserver confirmed; payload history and
  retention/advisory locks are NOT in these files (NodePayloadHistoryRepository / OutputHistoryRepository) — stale claim.
- The moved exception text `"OutputService: no OutputBindingSpec ..."` stays verbatim (follow-up candidate).
- Gate-chain: `check-node-root-encoding.mjs` is not invoked by `.husky/pre-commit` (only CI); `check:scala-quality` is,
  and is not edited. No `.husky/**` change.

## Standing Constraints

- [C1] Zero diff under `backend/src/test`; test totals equal the 24f6de4cf baseline and all pass.
- [C2] Public API (`javap -public`, raw diff classified per D5b(b)) of `OutputService`(+companion) and
  `NodeSnapshotRepository`(+companion, nested types) is unchanged; no `$$` name added; only the two named `$$` removals.
- [C3] Moved bodies byte-identical apart from D5's categories; defects found become follow-ups, not fixes.
- [C4] The single `ServiceError.Forbidden(` producer stays in `OutputService.scala`; guard exemptions unchanged.
- [C5] `services/pipelines/README.md`: line 5 (`Holds:`) untouched (PR #847 rewrites it); additions sit >=1 unchanged
  line away; a trial merge with ca3f5619 is conflict-free.
