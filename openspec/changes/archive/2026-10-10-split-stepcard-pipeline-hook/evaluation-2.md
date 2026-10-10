## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `1c2d12ab5f5ba1e4910cb4c7cb41894882a122f3` against the live-resolved base `1b765f59d0d09d2d60d5c05f31a2e06083e3a105`. The cycle-1 report reviewed `590c0b671`; this one covers what changed since then.

**What changed since cycle 1.** `git diff 590c0b671..1c2d12ab5` has one commit, `1c2d12ab5`. It touches only `openspec/changes/split-stepcard-pipeline-hook/`: `tasks.md`, `proposal.md` and `design.md`, plus the committed `evaluation-1.md`. `git diff --quiet 590c0b671 HEAD -- frontend backend` exits 0, so the code tree is byte-identical to what cycle 1 verified. Cycle 1's fresh gate runs, proof re-runs and running-app comparison (`/home/matt/Development/helio/.concertino/runs/HEL-1465/evidence/eval-*`) therefore still apply to this HEAD unchanged, and I did not repeat them.

### Phase 1: Spec Review — PASS

- **Cycle-1 CR1 (HEL-1478): resolved.** I checked the ticket directly with `get_issue`:
  - It names the five shipped sub-hooks, with `usePipelineAnalyzeDeferWatchdog` scoped to "clearDeferWatchdog / forceDeferredAnalyze / unmount cleanup only".
  - **Item 1** is the 7 `react-hooks/refs` errors that the host's existing suppression (~L423) hides. It states that fixing them is a behaviour change that needs its own characterization, and it cites D2b and `eval-D2b-probe.txt`.
  - **Item 2** is extracting the debounced re-analyze effect once item 1 is done.
  - **Item 3** is the rest of the host. **Item 4** is `useStepCardState.ts`. **Item 5** is the 271-line `usePipelineStepStructure.ts`.
  - With this, AC2's "remainder filed as a follow-up" is accurate.
- **Cycle-1 CR2 (plan text): resolved.**
  - `tasks.md` 3.1 now names `usePipelineAnalyzeDeferWatchdog` and the narrowed L373-403 range, and says the effect stays in the host per D2b.
  - `proposal.md:8` now reads "analyze defer watchdog".
  - The design.md D2 C1 bullet is marked "SUPERSEDED by D2b".
- **Everything else from cycle 1 still holds:** AC1, AC3, AC4, AC5, the D2b ruling, the commit order and constraints C1–C4, all on the identical code tree.

### Phase 2: Code Review — PASS
There is no code change since cycle 1. Cycle-1 results on the identical tree:
- `lint`, `format:check`, `typecheck`, jest and `build` were all green, and `sbt testFull` passed 6659 with 0 failures.
- The byte-identity, hook-sequence and deps-check proofs reproduced, each with its red run.
- The F-146 test is a real guard. It goes red under my own mutations in the new sub-hook files.
- The only file in this commit that is not plan prose is the cycle-1 evaluation report.

### Phase 3: UI Review — PASS
There is no change to frontend or backend code since cycle 1. The cycle-1 running-app comparison in light and dark, the accessibility checks and the 1280/768/375 breakpoint checks still apply.

### Overall: PASS

### Non-blocking Suggestions
- `proposal.md:8`'s parenthetical list of what remains still reads "(load/SSE wiring, outputs/sheet handlers, run/save/cancel)" and does not mention the debounced re-analyze effect. HEL-1478 is now the authoritative remainder list, so this is cosmetic.
- I suggested in cycle 1 that a comment be added at `AnalyzeSchemaWarnings.referencedFields` L292, noting that lookup "match field" wording assumes the function returns `sourceKey` only. The comment was skipped. It is still optional.
- The PR body should state the remainder the same way HEL-1478 does, and note the 271-line `usePipelineStepStructure.ts`.
