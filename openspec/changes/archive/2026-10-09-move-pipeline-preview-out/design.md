## Context

Base: origin/main ecaa1a53. `PipelineRunService.scala` is 652 lines: constructor + wiring (1-155), `auditSubmit`/`submit`
(156-205), `recordUnrunnable` (207-259), `previewStep` (261-269), `previewOutputs` (271-343), `previewAtNode`
(345-534), delegations and existence checks (536-577), companion, `CachedRunStatus`, `TriggerSource`. #847's archived
change (`openspec/changes/archive/2026-10-08-split-pipeline-run-service/`) is the template: its design D1-D6, its move
checker (`move-check/check.py`, `javap.sh`) and its evidence files.

Live constraints:
- `ExistenceNotLeakedRoutesSpec.expectedForbiddenProducers` is compared by exact map equality against a scan of every
  main `.scala` file (code lines only). Producers today: `submit` (:199) and `previewAtNode`'s AI-closure gate (:486).
- `StepConfigInvalidRoutesSpec`/`UpsertTargetWritableRoutesSpec` capture `getLogger(classOf[PipelineRunService])`.
  `previewAtNode` logs only via `support.logExecutionFailure`, which already uses that logger.
- `PipelineRunServiceSpec`/`OutputRoutesSpec` preview tests (incl. HEL-957/HEL-994 closure guards, HEL-1108 AI
  viewer gate) exercise every preview arm through the public `PipelineRunService` API.

## Goals / Non-Goals

Goals: entry point under 400 lines; identical behaviour and public API; the existence-not-leaked pin stays an exact
guard; every ticket item resolved or explicitly dropped with a reason. Non-goals: see proposal.md.

## Decisions

**D1 -- New class `PipelineRunPreview`.** `private[pipelines] final class PipelineRunPreview(pipelineRepo,
pipelineStepRepo, dataSourceRepo, outputRepo, backend, support)(implicit ec)` in
`services/pipelines/PipelineRunPreview.scala`, parameter names identical to the entry point's so bodies compile
unchanged; `import support.{executionFailureError, logExecutionFailure, resolveAllRootDataSourcesInternal,
truncationFields}` (only those used). Producer locations at ecaa1a53: `submit` :199, AI gate :487 (premise said :486). It receives `previewStep`, `previewOutputs`, `previewAtNode` with their doc
comments, in original order, byte-identical (2-space class-body indentation kept). `previewStep`/`previewOutputs`
stay plain `def` inside the `private[pipelines]` class (the #847 convention; skeptic-design-2 note 3), so no
substitution is needed for them; `previewAtNode` `private def` -> `private[pipelines] def` only if needed (it is not).
The entry point keeps both public signatures as one-line delegations, doc `/** Delegates to
[[PipelineRunPreview.previewStep]], where the method and its documentation live. */` (the #847 convention), and wires
`private val preview = new PipelineRunPreview(...)` after `backend`/`support` (D4 of #847: eager-val order).
Alternative rejected: keeping `previewAtNode` in the entry point (the reason it stayed) -- then the file stays >400.

**D2 -- Pin update, not weakening.** `expectedForbiddenProducers` becomes `"PipelineRunPreview.scala" -> 1` and
`"PipelineRunService.scala" -> 1`; the comparison code and every other entry are untouched. Red check (scratch, then
reverted): add a third `ServiceError.Forbidden("x")` producer to `PipelineRunPreview.scala` and, separately, in a
brand-new file; run only the pin test; both must fail. Also the producer set must be classified: append one line to the
spec's doc/comment (no archived file is edited) noting the preview producer moved files unchanged.
`ExistenceNotLeakedRoutesSpec` row "GET pipeline run status" names `PipelineRunService.scala` as its site; the guarded
lookup now lives in `PipelineRunQueries.runStatus`, so that row's site becomes `PipelineRunQueries.scala` (sites only
feed the helper-call coverage check; no PipelineRun*.scala file calls an access helper, so this re-site is cosmetic and
the evidence says so -- a green spec does not verify it).

**D3 -- Commit order, each with its own evidence.** (a) move + pin + delegations; (b) whitespace-only reindent (D6);
(c) delete `resolvePrimaryDataSourceInternal` (D5); (d) comments/docs only (D7, D8). Commits are squashed at delivery;
evidence is computed per commit before that.

**D4 -- Move evidence.** Adapt #847's `check.py` (forward byte-compare, positional reverse check, coverage) to commit
(a): every line of `PipelineRunPreview.scala` is either a moved base line (base = ecaa1a53 `PipelineRunService.scala`
:261-534) or an allow-listed scaffold line (package, imports, class header/close, `import support...`); every removed
entry-point line is claimed by the move or by an import no longer needed; added entry-point lines are only the
delegations and the `preview` val. Red runs: one token changed in a moved body (forward fails); a duplicated line
inserted outside any member (reverse fails). Plus `git diff --color-moved=plain` summary.

**D5 -- Dead member.** Delete `resolvePrimaryDataSourceInternal` (PipelineRunSupport.scala:~96-111 incl. its doc) after
a zero-caller grep across `backend/src` (main + test, including reflection-free string use). Rewrite the two doc
comments that cite it (:113, :117) so they stand alone without the dead reference.

**D6 -- Reindent.** `PipelineRunTerminalWrites.executeRunFailure` body (8 extra spaces) and `previewAtNode`'s two blocks
under `case _ =>` (source-level arm) and `case true =>` (AI-gate arm) re-indented to their nesting depth. Evidence:
`git diff -w --ignore-blank-lines` of commit (b) is empty, and `javap -c -p -l` disassembly of the affected classes is
identical between commit (a) and commit (b) for BOTH `PipelineRunPreview` and `PipelineRunTerminalWrites` (captured at
(a) before starting (b); no line moves, so line tables too). Scala braces make whitespace non-semantic; the bytecode diff
is the proof, not the argument.

**D7 -- Stale refs (item 4): fix ALL of them (skeptic-design-1 CR1 option a).** Scope: every comment/doc line in
`backend/src/main/scala` and `backend/src/test` that attributes to `PipelineRunService` (by `PipelineRunService.x`,
`PipelineRunService#x`, `[[x]]` inside the entry point, or a `PipelineRunService.scala[:line]` citation) a member or site
it no longer holds after #847 + this move: `executeRun`, `executeRunSuccess`, `onRunSuccess`, `onUnblockedRunSuccess`,
`runPipeline`, `trunkOf`, `upsertFieldsFromRows`, `resolveAllRootDataSourcesInternal`, `parseTruncationRecord`,
`previewAtNode`, `previewStep`/`previewOutputs` bodies, `evaluateNodeRowsForBackfill`, `onBlockedRun`, and any other
member the executor's own grep turns up. Each is retargeted to the owning class (`PipelineRunExecutor.executeRun`,
`PipelineRunPreview.previewAtNode`, ...) or to a symbol instead of a line number. Must-fix sites made false by THIS move
(CR2): OutputRoutesSpec.scala:~1981 MUTATION PROOF comment; PipelineRunService.scala:141-142 (`backend`'s
`executeRun`/`previewStep` call-site comment); PipelineExecutionBackend.scala:68; the moved `previewOutputs`/
`previewAtNode` docs' "`executeRun`, this method's sibling" / "only reachable from `executeRun`" wording. Also the
ticket's named ones: Support:83 `[[PipelineRunService.parseTruncationRecord]]`, `recordUnrunnable`'s `[[runPipeline]]`
and "`onBlockedRun`'s persistence pattern below", PipelineRunRepository.scala:476, PipelineRunServiceSpec ~:1353
(`:507`/`:403`/`:329-374`) and ~:2419 (`:108`, "line 662"), file-level citations PipelineStepRepository.scala:~1092,
PipelineRunRoutesSpec:~636, V94OutputsMigrationSpec:~592; ExistenceNotLeakedRoutesSpec:49's stale path to
forbidden-classification.md (now under `openspec/changes/archive/2026-10-02-...`).
Wording sweep: every "this file/this class/this service/this method's sibling/sibling/above/below" in the nine
PipelineRun*.scala files (incl. the new one and the moved docs), each recorded TRUE (kept) or FALSE (fixed) in
`stale-refs-evidence.md`.
Exclusions (recorded with reason): migration SQL comments (V94; applied migrations are immutable), archived OpenSpec
changes (history), and **test describe/it name strings** (e.g. PipelineRunServiceSpec:~447 "PipelineRunService.executeRun
...", :~547 "PipelineRunService.onRunSuccess ..."): they are test identities, not comments; renaming them would break
the by-name per-suite baseline comparison (D9) and C4. They are listed by file:line in a follow-up ticket.
Closing grep (CR3) -- must be able to fail: `grep -rnE 'PipelineRunService([.#](executeRun|executeRunSuccess|onRunSuccess|
onUnblockedRunSuccess|runPipeline|trunkOf|upsertFieldsFromRows|resolveAllRootDataSourcesInternal|parseTruncationRecord|
previewAtNode|evaluateNodeRowsForBackfill|onBlockedRun)\b|\.scala:[0-9])' backend/src/main/scala backend/src/test`
(one line in practice), plus `resolvePrimaryDataSourceInternal` and "Defaulted to `None`". Record the hit count on
ecaa1a53 (non-zero) next to the count after the change (zero, or exactly the recorded describe-name exceptions, each
listed). Additionally grep the bare `PipelineRunService.scala` form and the space form `PipelineRunService <member>`
and classify every hit (skeptic-design-2 notes 1-2); in-scope comment hits are fixed, describe names join the
follow-up list (e.g. PipelineRunServiceSpec:~749). Backtick member refs inside the entry point that remain TRUE as
behaviour descriptions (e.g. "rate-limit check in `executeRun`") are recorded as kept in the wording table, not
skipped. The package README's collaborator list gains `PipelineRunPreview`.

**D8 -- Item 5.** Both copies (PipelineRunService.scala:~544, PipelineRunBackfill.scala:68) state the parameter is
required and every caller passes it explicitly (`None` for a step-bound Output / single-root case). Verify against the
call sites before writing it.

**D9 -- Behaviour evidence.** (i) Baseline `nice -n 19 sbt testFull` on the unmodified worktree, then after all
commits: total succeeded/failed/ignored and per-suite counts identical (record all suites; highlight
PipelineRunServiceSpec, OutputRoutesSpec, ExistenceNotLeakedRoutesSpec, StepConfigInvalidRoutesSpec,
UpsertTargetWritableRoutesSpec, PipelineRunRoutesSpec, TerminalOrdering, AutoRunGuard*). Run backgrounded to a log,
polled with bounded waits. Known flake `AutoRunGuardBurstProofSpec` ("4 was not equal to 3", HEL-1439): re-run that
suite once and note it; twice red -> investigate. (ii) `javap -public` of `PipelineRunService`, `PipelineRunService$`,
`CachedRunStatus(+$)`, `TriggerSource(+$)`, synthetic-filtered (per #847 `javap.sh`): diff empty; red run: add a
defaulted param to `previewStep`, show non-empty, revert. (iii) Test-source diff is limited to the two pin-map lines,
the one row site, and comment lines -- shown line by line in the evidence. (iv) Record measured `wc -l` of the entry point.

## Risks / Trade-offs

- Eager-val order: `preview` must be declared after `backend` and `support` or it captures `null`; every preview spec
  catches it.
- `previewStep`/`previewOutputs` move as two members rather than staying public entry-point bodies: one extra hop, no
  semantic change; javap proves the public surface.
- Scala 2.13 synthetics (`$anonfun$previewAtNode...`) leave `PipelineRunService` -- filtered as in #847.

## Planner Notes

- Self-approved: name `PipelineRunPreview`; moving the run-status row site to `PipelineRunQueries.scala`.
- Item 3 dropped (premise stale: `log` used at :234 since HEL-1384).
- What remains of HEL-1429 after this: items 1, 2, 4 unchanged; item 3's PipelineRunService half likely moot (<400),
  PipelineSchedulerService (314) half untouched. Stated in the PR body.
- No `.husky/**` / gate-chain impact.
- skeptic-design-1 REFUTE (item-4 scope) addressed by D7 option (a). Follow-ups to file: describe-name strings that
  name moved members; `PipelineRepository.findPrimaryDataSourceIdInternal` left caller-less by D5.

## Standing Constraints

- [C1] No behaviour change: full-suite per-suite counts equal the ecaa1a53 baseline; defects found become follow-ups.
- [C2] Forbidden producers: exactly one in PipelineRunService.scala, one in PipelineRunPreview.scala, none elsewhere new.
- [C3] Moved code is byte-identical apart from D1's listed scaffold lines; whitespace commit is bytecode-identical.
- [C4] Test-source diff limited to the pin map, the run-status row site, and comment lines (describe/it names untouched).
- [C5] Synthetic-filtered `javap -public` of the entry point, companion, CachedRunStatus, TriggerSource unchanged.
