## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Fresh/cold review. Every claim below was re-derived from source in this worktree; round 1's report
was read as a set of claims, not as facts.

### What I verified (with evidence)

1. **Round 1's core findings re-confirmed independently.** Both byte-identical `pathToRoot` helpers
   still exist at `backend/src/main/scala/com/helio/services/pipelines/PipelineRunService.scala:504`
   (`previewStep`) and `:663` (`evaluateNodeRowsForBackfill`). The 422 mechanism is as design.md
   states: `executeTree` builds `byId` purely from the passed `steps` vector and the pre-walk
   `else if (!byId.contains(dep)) Some(LaneReferenceError(...))` fires on a truncated slice.
   `isReady` = `evaluatedIds.contains(parentKey(s)) && laneDep...forall(...)`; ordering comes from
   `ranks = structuralRank(...)` recomputed inside `executeTree`. D1/D2/D3/D4 stand.

2. **CR2 (`stepCounts`) is genuinely closed.** In `executeTree`'s `loop`,
   `if (next.enabled) counts = counts.updated(next.id.value, nextFrame.size.toLong)` runs for every
   node the walk evaluates — so after the fix a rejoin preview's `stepCounts` really will gain the
   referenced lane's entries. D6's ruling (counts cover the whole executed closure) is the correct
   reading of the code, it is now in design.md, in the spec delta as a bullet AND a scenario, and
   task 3.4c asserts *specific lane step ids with their real counts*, not merely that the map grew —
   which is failable against a filtered-back implementation. **CR2: CLOSED.**

3. **CR1's premise is true.** `PipelineService.validateLaneReference:2317-2334` checks self-reference,
   membership in `pipelineSteps` (pipeline-scoped, from `listByPipelineInternal`), and
   parent-ancestry — **nothing about root membership**. A cross-root closure is legal and reachable
   (corroborated by HEL-913 task 7.5's separate `removeRoot` lane-reference refusal, which only
   exists because cross-root lane references occur).

4. **CR1's fact 2 is true.** Both sites read
   `outcome.nodeOutcomes.get(StepKey(target.id.value)).map(_.rows).getOrElse(outcome.rows)`, and
   `executeTree` computes `TreeWalkResult.rows` from `trunkOfRoot(..., PipelineRootId(lowestRootId))`
   — the lowest-positioned root's trunk terminal (R10). Task 3.4b is accurate.

5. **CR1's fact 3 is true.** `evaluateNodeRowsForBackfill`'s `explicitRootId` filter
   (`allRoots.filter(_._1 == rid.value)`) lives *only* in the `targetStepId.isEmpty` branch
   (`:640-647`); the step-bound branch passes `explicitRootId = None` to `persistBackfilledRows`,
   with a comment saying exactly that. Task 4.0a is a real check.

6. **Spec delta header still matches the live spec exactly.** Live
   `openspec/specs/pipeline-step-preview/spec.md:6` and the delta's `### Requirement:` line are the
   identical string. All five live scenarios of that requirement are carried forward.
   `npx openspec validate preview-lane-aware-path --strict` → `Change 'preview-lane-aware-path' is valid`.

7. **Run constraints respected.** No migration (7.3), no browser/frontend (7.4), sibling paths
   fenced (7.5) including the `loadCsvRowsFromBytes`-same-file caveat.

8. **CR1's fact 1 is FALSE as written — see the Change Request.** Traced in
   `InProcessExecutionBackend.execute`.

### Verdict: REFUTE

One change request. Everything else — including all of CR2 and two of D5's three facts — is closed.
This is a correction to one traced fact and the test it authorizes, not a redesign.

### Change Requests

1. **D5 fact 1 states the wrong failure mode for narrowed `roots`, and task 3.4a's negative
   assertion is therefore unwritable as specified.**

   D5 claims narrowing `roots` to the target's own root "would leave the foreign root's `RootKey`
   unseeded, making the cross-root lane step permanently un-ready and failing the Kahn loop with
   *'Cyclic or unresolved lane reference...'*". That is not what the code does.
   `InProcessExecutionBackend.execute` has a single-root shortcut:

   ```scala
   if (roots.size == 1) {
     val onlyRootId = PipelineRootId(roots.head._1)
     Future.successful(steps.filter(_.parentStepId.isEmpty).map(_.id -> onlyRootId).toMap)
   } else stepRepo.rootIdsOf(pipeline.id)
   ```

   Narrowing to the target's own root necessarily yields `roots.size == 1`, so `rootIdOfStep` is
   rebuilt from the slice and **every parentless step in the slice — including root B's lane step —
   is remapped to root A**. In `executeTree`, `parentKey` then returns `RootKey(A)`, which *is*
   seeded and *is* in `evaluatedIds`. The walk does not fail: it evaluates root B's lane on **root
   A's rows** and returns `200` with silently wrong data. The stated `LaneReferenceError` outcome
   only arises if more than one root survives the narrowing, which this optimisation by definition
   never produces.

   This matters because D5 exists precisely to fence that wrong implementation, and the wrong
   implementation is a silent-corruption case, not a loud one — strictly worse than described, and
   invisible to any assertion on an error message.

   Required revisions:
   1. Correct D5 fact 1 to state the real mechanism: narrowing `roots` to one trips
      `InProcessExecutionBackend.execute`'s `roots.size == 1` shortcut, which remaps *every*
      parentless step in the slice (including the foreign root's) to the surviving root and
      evaluates the referenced lane against the **wrong root frame**, returning `200` with wrong
      rows rather than an error. Keep the "MUST pass the full `roots` vector" ruling — it is right;
      only its justification is wrong.
   2. Rewrite task 3.4a's negative assertion accordingly: drop
      *"fails with 'Cyclic or unresolved lane reference'"* and replace it with a **row-value**
      discriminator, since that is the only signal the wrong implementation produces.
   3. Make the fixture requirement explicit in task 3.4a: **root A's and root B's sources must
      carry distinguishable data** (different rows/column values), so that evaluating root B's lane
      against root A's frame yields observably different rows. As currently written, a fixture whose
      two roots share a source or share row values would pass under the narrowed-`roots` bug — the
      test would be evidence-shaped non-evidence. Mirror this into the spec delta's "different root"
      scenario if the wording there implies otherwise.
   4. Note in D5 (or task 3.4a) that a genuine two-root fixture takes the `else stepRepo.rootIdsOf(pipeline.id)`
      branch, which is a live DB query (`ctx.withSystemContext`, `PipelineStepRepository.scala:859`).
      The cross-root test therefore cannot use the `PipelineStepRepository(null)` /
      steps-constructed-in-memory fixture style that the single-root engine tests rely on; it needs a
      DB-backed pipeline with real `root_id`s. Stating this now prevents the executor discovering it
      as an NPE mid-implementation and quietly downgrading 3.4a to a single-root test.

### Non-blocking notes

- The round-1 `private[engine]` note is properly folded into D2 and task 2.1; `laneDependencyOf` is
  indeed `private[engine]`, so the helper can reuse it from `com.helio.domain.engine`. Closed.
- Task 3.4b as written ("assert the target's rows are read from `nodeOutcomes`, not
  `TreeWalkResult.rows`") is really a code-shape assertion. It becomes a *behavioural* test for free
  if the 3.4a cross-root fixture targets a rejoin that is **not** the lowest-positioned root's trunk
  terminal — worth one clause so it is not satisfied by a comment.
- D3's report-don't-fix ruling on `RuntimeGraphPath`'s scaladoc (doc says transitive; `pathOf`
  consults `laneDep` for the target step only) is still accurate and still the right call.
