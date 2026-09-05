## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Cold reviewer. Every claim below was re-derived from source in this worktree; no prior
skeptic round's finding was assumed correct.

### What I verified (with evidence)

1. **D5 fact 1's mechanism — the `roots.size == 1` shortcut — is TRUE as now stated.**
   `backend/src/main/scala/com/helio/domain/engine/InProcessExecutionBackend.scala` contains
   verbatim:
   ```scala
   if (roots.size == 1) {
     val onlyRootId = PipelineRootId(roots.head._1)
     Future.successful(steps.filter(_.parentStepId.isEmpty).map(_.id -> onlyRootId).toMap)
   } else stepRepo.rootIdsOf(pipeline.id)
   ```
   The corruption chain checks out end to end: narrowing `roots` makes `rootIdOfStep` be rebuilt
   *from the slice*, mapping **every** parentless step (incl. the foreign root's lane step) to the
   surviving root; `executeTree`'s `parentKey` (`InProcessPipelineEngine.scala`) then returns
   `RootKey(A)`, which is pre-seeded into `evaluatedIds` from `rootFrames`, so `isReady` succeeds,
   the walk completes, and the lane is evaluated against root A's frame. No `LaneReferenceError`
   is reachable on that path (the pre-walk guard at `:386` only fires on self/absent/ancestor
   refs, and the step IS present in the slice). Round 2's correction is correct; round 1's
   `LaneReferenceError` claim was wrong. The plan now rests on the true mechanism.
2. **The fixture-construction consequence is real.** `PipelineStepRepository.rootIdsOf`
   (`:859`) is a live `ctx.withSystemContext` Slick query, so a genuine two-root graph does take
   a DB round trip — the `PipelineStepRepository(null)` in-memory style cannot be used for 3.4a,
   exactly as D5 and tasks 3.4a(ii) state.
3. **Both defective copies exist where the design says.** `pathToRoot` at
   `PipelineRunService.scala:504` (`previewStep`) and `:663` (`evaluateNodeRowsForBackfill`),
   byte-identical, parent-only. `previewStep`/`evaluateNodeRowsForBackfill` are the real method
   names (the ticket's `previewAtNode`/`previewOutputs` do not exist); the design already records
   this correction.
4. **D5 facts 2 and 3 verified at the call sites.** Both sites already read
   `outcome.nodeOutcomes.get(StepKey(target.id.value))` with a `.getOrElse(outcome.rows)`
   fallback; `explicitRootId` is narrowed only in the `targetStepId.isEmpty` branch (`:644-647`)
   and is passed `None` on the step-bound branch (`:676`) with a comment saying so.
5. **The engine edge set and the in-repo model are as described.** `executeTree`'s `isReady`
   is parent **and** `laneDep`; `laneDependencyOf` is `private[engine]` on the companion (so D2's
   `private[engine]` helper placement is actually reachable);
   `PipelineAnalyzeService.analyzeNodes` (in `com.helio.domain.engine`, not `services.pipelines`)
   is genuinely already lane-aware via the same predicate — so "analyze is unaffected; it is the
   model for the fix" is confirmed, not repeated on faith.
6. **The D3 "report, don't fix" divergence is real.** `RuntimeGraphPath.scala:14` scaladoc claims
   "or, transitively, a step in its own chain"; the implementation (`:45`) consults
   `laneDep.getOrElse(step.id.value, ...)` — the target step only, one level. Correctly scoped out.
7. **The spec delta targets a requirement that exists** (`openspec/specs/pipeline-step-preview/spec.md:6`)
   and `npx openspec validate preview-lane-aware-path --strict` → valid. The merged
   `pipeline-preview-api` scenario "Preview of a rejoin Output reflects both inputs" exists, so
   task 4.3's "already correct, don't edit it" is grounded.
8. **Round 2's four required revisions are all present**: D5 fact 1 rewritten to silent
   corruption with both consequence clauses; 3.4a is a row-value discriminator with both fixture
   requirements and an escalate-don't-downgrade instruction; 3.4b is behavioural (rejoin that is
   not the lowest-positioned root's trunk terminal); the cross-root spec scenario requires
   distinguishable data and own-root-frame evaluation.
9. Anti-non-evidence coverage is adequate: over-inclusion is fenced by 3.4 (closure membership)
   plus the exclusion scenario; both-paths-wrong-identically by 3.2's independent literal;
   diamonds by 2.3; cycles by 2.2's visited set; parity by 4.1 deriving expectations from the
   pre-change path.

### Verdict: CONFIRM

No remaining defect that would produce wrong code or evidence-shaped non-evidence.

### Non-blocking notes

- **Stale rationale in the spec delta (fix in passing).**
  `specs/pipeline-step-preview/spec.md`, the "Pass the pipeline's FULL set of roots" bullet, still
  justifies itself with "an unseeded foreign root makes the referenced lane step **permanently
  unresolvable**". That is the round-1 mechanism that D5 explicitly retracts — the code does not
  fail, it silently remaps and returns wrong rows. The MUST itself is correct and the behaviour
  implemented is unaffected, which is why this is not a REFUTE, but the clause will be archived
  into `openspec/specs/` and contradicts this change's own design. Suggested replacement: "…never
  narrowed to the target's own root: narrowing trips the engine's single-root shortcut, which
  remaps the foreign root's lane step onto the surviving root and evaluates it against the wrong
  frame — returning 200 with wrong rows."
- `design.md` cites the lane guard at `InProcessPipelineEngine.scala:385`; it is `:386` on this
  base. Task 6.2 repeats the same number. Cosmetic.
- The ticket's required-reading list gives `PipelineAnalyzeService.scala` under
  `services/pipelines`; it actually lives in `com/helio/domain/engine/`. Worth noting for the
  executor so it is not mistaken for a missing file.
