# HEL-985: Assert the nodePath() wiring, not just the pure function

## Description

Spun off from HEL-968 (PR #553, merged as `56875fdc`), flagged by that run's round-2 final-gate skeptic as non-blocking.

### The hole

`frontend/src/features/pipelines/state/nodePath.ts` has thorough unit coverage of the pure function — R5 format, the lowest-positioned-root canonical tiebreak, and never emitting the stale bare-`root` head. **Nothing asserts that anything calls it.**

That is precisely the defect HEL-968's own final gate caught. `nodePath()` shipped correct, unit-tested, and with **zero call sites**: no lane path rendered anywhere in the app, in the new format or the old one, so AC3 was unmet. The evaluator had passed the change, crediting the AC on the function plus its test existing. Only a cold skeptic checking for a real display site caught it.

The current test suite would not notice if that call site were removed again. A refactor could silently drop it and reproduce the exact same defect with every gate green — lint, typecheck, and 2636 passing Jest tests included. `typecheck` in particular cannot help here: deleting a call site is perfectly well-typed.

### What "asserting the wiring" concretely means

The round-2 skeptic's DOM verification is the shape of check that would catch it. It loaded a two-root pipeline in the running app and read the rendered step element's `title` attribute, confirming it read `root:<rootId> > <stepId>` — at both the root-level base case and a multi-level lane chain.

The regression guard should assert that **rendered output** contains an R5-format path, not that the function returns one. Concretely: render `PipelineRiverView` with a two-root fixture and assert a step's `title` matches the `root:<rootId>`-headed format. A component-level Jest test is likely sufficient and much cheaper than an E2E; the load-bearing property is that the assertion fails when the call site is deleted.

**Verify the guard is real by mutation:** delete the `nodePath()` call in `PipelineRiverView.tsx` and confirm the new test goes red. A test that stays green under that mutation is another instance of the same evidence-shaped-non-evidence pattern, one level up, and is worse than no test because it looks like coverage.

### Scope

`frontend/src/features/pipelines/ui/PipelineRiverView.tsx` (the single call site, currently ~line 294) and its `LaneColumn.tsx` / `RootColumn.tsx` threading. Test-only change; no product behavior should change.

## Acceptance Criteria

- **AC1** — A component-level Jest test renders `PipelineRiverView` with a two-root, multi-step fixture and asserts that a rendered step element's `title` attribute matches the R5 format `root:<rootId> > <stepId>`, covering both the root-level base case (a step directly on a root) and a multi-level lane chain (a step at least two hops from its root).
- **AC2** — The guard covers every rendered `title` site the wiring flows through, not only one: the direct site in `PipelineRiverView.tsx` and the `LaneColumn.tsx` sites reached via the `nodePathByStepId` prop threading through `RootColumn.tsx`.
- **AC3** — **Call-site mutation is red:** deleting or neutering the `nodePath()` call in `PipelineRiverView.tsx` makes the new test fail. Evidence is a recorded transcript of the mutated run, not a claim.
- **AC4** — **Function mutation is red:** independently breaking `nodePath()`'s own logic (e.g. emitting a bare `root` head instead of `root:<rootId>`) also makes a test fail. Evidence is a recorded transcript of the mutated run.
- **AC5** — Both mutations are reverted; the tree is restored to its unmutated state and the full gate set (lint, typecheck, format, Jest) passes on it.
- **AC6** — No product behavior changes. Any non-test edit is confined to what a testability seam genuinely requires (e.g. exporting a fixture helper or adding a test id) and is justified in the change's design notes.
