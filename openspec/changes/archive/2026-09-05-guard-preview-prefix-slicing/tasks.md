# Tasks — Guard previewAtNode's dependency-closure slicing

## 1. Confirm the hole before building for it

- [x] 1.1 Read `previewAtNode` (`PipelineRunService.scala` ~lines 500-540) and confirm the live slicing
      expression and its line number; correct the plan in place if it has moved again.
- [x] 1.2 Confirm `outcome.stepCounts` is keyed per EXECUTED ENABLED node by reading the engine
      (`InProcessPipelineEngine.scala:449`, `if (next.enabled) counts = counts.updated(...)`) — and record what
      it is keyed by. If it is not per-executed-node, stop and revisit design Decision 1 before writing any test.
- [x] 1.3 Apply mutation M1 (`closureOf(sortedSteps.toVector, target)` -> `sortedSteps.toVector` at line 507),
      run the existing named test (`PipelineRunRoutesSpec`, "only applies steps up to and including the target
      step") and the AC5.5 test in `PipelineRunServiceSpec`, and CONFIRM both stay GREEN. Capture the output.
      If either goes red, the premise is refuted — stop and escalate rather than building the guard.
- [x] 1.4 Revert M1.

## 2. Build the guard (step-preview site, line 507)

- [x] 2.1 Add a `PipelineRunServiceSpec` test (relocated from the originally-planned
      `PipelineRunRoutesSpec` — evaluation-1.md CR2: the site-2 spy-backend guard, task 3, needs
      service-level construction to inject a custom `executionBackend`, so both line-507 guards
      were kept alongside it in the same file for locality) on a fixture with a linear trunk PLUS
      at least one node outside the target's closure (e.g. a tail off an ancestor, and/or a
      downstream node past the target). Assert `result.stepRowCounts.keySet` equals exactly the
      ENABLED members of the target's closure — a PROPER subset of the pipeline's nodes.
- [x] 2.1a Every off-closure node in every fixture must be `enabled = true` (design Decision 2, gate CR3). A
      disabled off-closure node gets no `stepCounts` key even when executed, which makes M1 silently
      non-discriminating — a passing guard that proves nothing. Assert this property of the fixture explicitly.
- [x] 2.2 Add a second fixture with a branching/multi-lane shape (a join, or two roots) where a sibling lane is
      NOT in the target's closure, and assert its key set the same way. This is design Decision 3's M4 axis.
- [x] 2.3 In each test's comment, state explicitly: the pipeline's full node set, the target's closure, and why
      they differ, and that every off-closure node is enabled — so non-degeneracy is checkable without
      re-deriving it.
- [x] 2.4 Assert on the key SET, not only on counts, and avoid asserting anything routed through the node-keyed
      lookup at line 527 as the sole discriminator.

## 3. Guard the second slicing site — `evaluateNodeRowsForBackfill` (line 662), via a spy backend

Corrected at the design gate (CR1/CR2): line 662 is `evaluateNodeRowsForBackfill` (reached from
`backfillOutputNode`, :592), NOT `previewOutputs` (:329, which does not slice at all).

- [x] 3.1 Do NOT assert on the persisted rows. They are read through the same node-keyed lookup at :664, so they
      are invariant under the widening mutation by construction — the exact masked test this ticket exists to
      prevent.
- [x] 3.2 Write a spy `PipelineExecutionBackend` that captures the `steps: Vector[PipelineStep]` argument passed
      to `execute`, and inject it via `PipelineRunService`'s `executionBackend` constructor parameter
      (`PipelineRunService.scala:108`). Assert the captured slice's id set against the expected closure.
- [x] 3.3 Demonstrate the M1 widening mutation at line 662 RED against this spy guard, with captured output.
- [x] 3.4 Scoping this site out is permitted ONLY after demonstrating, with captured output, that the spy-backend
      approach itself fails. A judgement that it is "hard to assert" is not sufficient. If it genuinely fails,
      record that in `design.md` Decision 4 and file a follow-up ticket.

## 4. Prove the guards red (the actual deliverable)

- [x] 4.1 Apply M1, run the new tests, capture the verbatim failure output, revert.
- [x] 4.2 Apply M2 (wrong node targeted), same. Revert.
- [x] 4.3 Apply M3 (self-only / ancestors dropped), same. Revert. M3 is expected to be at risk of redding for
      the WRONG reason (dropping ancestors leaves `isReady` unsatisfiable, so the engine fails and the test reds
      on a 500, not a key-set mismatch). If so, use the pre-committed replacement from design Decision 3:
      `closureOf(sortedSteps.toVector, target).dropRight(1)` — an off-by-one at the terminal end that still
      executes a valid connected slice. Record which form was used and why.
- [x] 4.4 Confirm M4's branching fixture is red under M1 specifically (the ambiguity axis), not only the linear
      fixture.
- [x] 4.5 Apply the widening mutation at line 662 (`evaluateNodeRowsForBackfill`), capture the spy guard red,
      revert.
- [x] 4.7 In `mutation-evidence.md`, state the axis accounting HONESTLY (design Decision 3, gate CR4): which
      mutations are distinct CODE axes and which are the same code mutation on a different FIXTURE. If M3's
      original form was discarded, say so and name what replaced it.
- [x] 4.6 Write `mutation-evidence.md` with, per mutation: the exact edit, the exact command, and the verbatim
      failure output. Include the final all-green run with every mutation reverted.

## 5. Verify and hand off

- [x] 5.1 `cd backend && sbt "testOnly com.helio.api.routes.pipelines.PipelineRunRoutesSpec com.helio.services.pipelines.PipelineRunServiceSpec"` green.
- [x] 5.2 Full backend suite green (`sbt test`).
- [x] 5.3 `git diff --stat` shows NO production-source change and NO migration file. If either appears, stop.
- [x] 5.4 Do not run Playwright or e2e specs; do not touch the shared dev database.
- [x] 5.5 Commit with the `HEL-957` prefix and write `files-modified.md`.
