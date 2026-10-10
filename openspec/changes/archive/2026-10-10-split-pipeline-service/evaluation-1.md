## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed: HEAD `6aa8f1e7c53fc0349f387c618f7bcde7052184cb` against the live-resolved base `1b765f59d0d09d2d60d5c05f31a2e06083e3a105`
(`resolve-review-base.sh`). This is a backend-only, behaviour-preserving split. I treated the executor's evidence as
claims and re-derived each one. My own evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1463/evidence/eval-1/`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (split into concern-focused files, no behaviour change): there are nine `private[pipelines] final class` collaborators in
  `com.helio.services.pipelines`, and the entry point keeps its name, constructor, public API and companion. The
  bytecode comparison under Phase 2 found no behaviour change.
- AC2 (forward and reverse byte-move with red runs): I re-ran `move-check/check.py 1b765f59d spec.json ...` and it
  returned PASS: 75 blocks, 2434 base lines, 0 unclaimed, 0 multiply-claimed. Both red runs are recorded in `red-runs.txt`.
- AC3 (javap): I compiled BASE myself in a throwaway detached worktree and ran `javap.sh` on both sides. The filtered
  diff is empty: raw/filtered/dropped is 495/56/439 at base and 98/56/42 after, and both filtered files have the same
  sha256 `fe12eea6…`. My base dump also matches the committed `javap-base.filtered`. The red run is recorded in
  `javap-red-run.txt`.
- AC4 (testFull per-suite, `[hel1468-guard]`): `suites.py` on the executor's `sbt-base.log` and `sbt-after.log` gives
  identical output (484 suites, 6659 test lines). Both logs contain `[hel1468-guard] ScalaTest summary: failed=0
  aborted=0 unreadable=0` and 6655 succeeded / 4 canceled. My own fresh run also matches (see Phase 2).
- AC5: `git diff 1b765f59d...HEAD -- backend/src/test` is empty.
- AC6: no defect was fixed in this change. Follow-up candidates are listed in `move-evidence.md` and `mutation-evidence.md`.
- Tasks: every task is marked done and matches the implementation. Specs are untouched (`skip_specs: true`), which is correct for a pure refactor.
- CONSTRAINTS C1–C6 all hold:
  - C1: zero test diff, and per-suite results are identical.
  - C2: `ServiceError.Forbidden(` appears once in `PipelineService.scala` and 0 times in each new file. There are 0
    access-helper calls across the ten files.
  - C3: the four logging collaborators each use exactly `LoggerFactory.getLogger(classOf[PipelineService])`.
  - C4 and C6: the forward check is byte-exact with only the 13 declared `private` -> `private[pipelines]` substitutions,
    and comments sit inside the checked blocks.
  - C5: verified independently (see AC3).

### Phase 2: Code Review — PASS
Issues: none blocking.

Gates I ran myself:
- `nice -n 19 sbt -J-Xmx3g -batch testFull` in WORKTREE_PATH: exit 0. `[hel1468-guard] ScalaTest summary: failed=0
  aborted=0 unreadable=0`; Suites completed 484, aborted 0; Tests succeeded 6655, failed 0, canceled 4. The tests ran for
  559 s, so this was not a cached no-op. Per-suite TSV is identical to the committed `suites-base.tsv` (`eval-1/eval-suites.tsv`, `eval-1/eval-sbt-after.log`).
- `npm run check:scala-quality`: clean. Only the informational soft-budget warnings remain.
- No frontend files changed, so the frontend gates do not apply.

Scaffolding review. The checker proves that the files are BASE blocks plus the declared scaffold lines. It does not check
what those scaffold lines do, so I read every non-move line:
- Imports: I checked each named import in all ten files for use outside comments and found none unused (my script).
  `schemaFieldJsonFormat` is the implicit that `convertTo[Vector[SchemaField]]` needs, and `PipelineAnalyzeReads` keeps it
  together with `DefaultJsonProtocol._`.
  - Implicit-scope risk: BASE had `DefaultJsonProtocol._`, `schemaFieldJsonFormat` and Slick `api._` at file level. A
    collaborator that dropped one of them could silently resolve a different implicit. Across all ten files the only
    implicit-sensitive JSON call is that one `convertTo`. `DBIO` appears only in `PipelineCreateTransaction`, which keeps
    the Slick import.
- Constructor parameter lists: names and types match the original constructor parameters. The function type of
  `requireEditorAccess` matches D2a.
- Wiring and D4 order: support, analyze, node, proposal, root, create-transaction, create, step-create, step-writes. All
  of them are declared after `costInputGathering`. `createWrites` is declared after both of its sibling dependencies,
  so nothing captures a null.
- Delegations: all 62 lines pass their arguments positionally with matching names, and modifiers are unchanged. The five
  `private[services]` members stay `private[services]`.
- Collaborator imports: each import only names members that the class actually uses.
- README: the file-list diff is the single line D3 allows.

Independent behaviour-preservation check (bytecode). I compared `javap -c -p` of every BASE class
(`PipelineService`, `PipelineService$` and its 18 `$anonfun` classes) with the 28 class files after the change:
- String, int and class constant loads (`ldc`/`ldc_w`/`bipush`/`sipush`), as a multiset: the only difference is +4
  `ldc class PipelineService`, which are the four `classOf[PipelineService]` loggers (`eval-1/eval-const-*.txt`). Every
  error message, audit action and literal is unchanged.
- Invoke/new targets (`eval-1/eval-inv2.diff`): every difference has a structural cause:
  - Calls to the moved helpers (`audit` 15, `toSummaryResponse` 5, `stepResponseWithRoot` 7, `upsertOwnershipCheckF` 4,
    and so on) went from `invokespecial` to `invokevirtual` on a collaborator, with identical counts.
  - The 7 direct `requireEditorAccess` calls became 7 `Function2.apply` calls, plus 3 eta-expansion lambdas that each
    call it once. Each call now also boxes and unboxes `PipelineId`.
  - Logger accesses total 10 before and 10 after. `getLogger` calls go from 2 to 6.
  - The rest is new collaborator accessors, constructors and delegation calls.
  - The partial-function `$anonfun` class count is the same: 18 before, 18 after.

Mutation spot-check (independent, in a throwaway worktree at HEAD, removed afterwards): I applied the executor's M4
(`PipelineRootWrites.scala:113` `NotFound(` -> `Conflict(`) and ran `testOnly com.helio.api.routes.pipelines.PipelineRootRoutesSpec`.
- Red: `409 Conflict did not equal 404 Not Found (PipelineRootRoutesSpec.scala:268)`, 1 failed / 14 succeeded
  (`eval-1/eval-mut-red.log`).
- After reverting: green, 15 / 15 (`eval-1/eval-mut-green.log`).

Other checks:
- Inline FQN scan (`com.helio.|spray.json.|java.|javax.|scala.|org.|slick.` outside import/package lines, string
  interpolations included): 0 hits in all ten files.
- Commit message: no claude.ai session link and no `Claude-Session` trailer. It has only the `Co-Authored-By` line.
- No sbt server was left running: there is no `project/target/active.json` in either worktree. The throwaway worktree
  is removed and `git worktree list` has no straggler. The other lane (HEL-1465) was not touched.

### Phase 3: UI Review — N/A
No `frontend/**`, `ApiRoutes.scala`, `schemas/**` or `openspec/specs/**` changes.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- Add to the follow-up list: the route-row `sites` in `ExistenceNotLeakedRoutesSpec` (lines 426-428 and 452-455) still
  name only `PipelineService.scala`. The step and analyze ACL reads now run in `PipelineStepWrites`/`PipelineAnalyzeReads`.
  This does not fail anything today, because the coverage check only requires access-helper call sites to be named and
  none of these files calls one. But the rows no longer point at where the ACL read lives. Do not edit it here (C1).
- The entry point is 446 lines, over CONTRIBUTING.md:24's ~400 threshold. Give the reason (the companion object and the
  pinned Forbidden producer) in the PR description, as that rule asks.
- File the `PatchSetApplyResolvers.scala` split ticket and the follow-up/coverage-gap candidates before merge, as the
  design's Planner Notes commit to.
