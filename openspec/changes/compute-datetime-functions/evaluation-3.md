## Evaluation Report — Cycle 3 (evaluation-3.md)

Cycle 3 is the final cycle (EXECUTION_CYCLES = 3).

- Reviewed HEAD: `b3fa7ec5f660464a90b9adf5df2af1df08c27329`.
- Diff base, re-resolved live: `bc8ccac45160dbd5ddc6a4043bc07055e5c09c39`.
- Cycle-3 delta (`81bb621b9..b3fa7ec5f`):
  - `PipelineDetailPage.css`: a `margin-top: var(--space-2)` under the touch gate;
  - `computeExpressionDescription.test.ts`;
  - the committed `evaluation-2.md`, byte-identical to the persisted copy.
- Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1314/evidence/eval3-*`.

### Phase 1: Spec Review — PASS

No behaviour, spec or API change this cycle. The findings from cycles 1 and 2 stand.

### Phase 2: Code Review — PASS

Gates (rerun fresh in WORKTREE_PATH):

| Gate | Result | Transcript |
| --- | --- | --- |
| lint, format:check, typecheck | exit 0 | `eval3-static.txt` |
| root jest, including helio-mcp | 46 suites, 444 passed | `eval3-jest-full.txt` |
| frontend jest | 518 suites, 5551 passed | `eval3-jest-full.txt` |
| frontend build | exit 0 | `eval3-frontend-build.txt` |

- `PASS helio-mcp/src/tools/computeExpressionDescription.test.ts`.
- **Backend:** not re-run, with self-authenticating justification. `git rev-parse 81bb621b9:backend` and `b3fa7ec5f:backend` are the same tree, `fad7e3dec26f7d88bb0c8ab7f56658e9983bbe50` (`eval3-backend-tree-identity.txt`). `shared-test-fixtures/` is also unchanged. My cycle-2 `sbt testFull` on that tree passed: 6920 tests, 0 failed, `[hel1468-guard] failed=0` (`eval2-backend-testFull.txt`).
- **helio-mcp test: now word-bounded and bidirectional.** Mutations ran in a throwaway detached worktree, since removed (`eval3-mcp-mutation.txt`):

  | Mutation | Result | Before this cycle |
  | --- | --- | --- |
  | Baseline | 3/3 pass | |
  | A: fixture gains `now` | FAILS | passed |
  | B: fixture drops `add_days` | FAILS | passed |
  | C: doc drops `abs(x)` | FAILS | |
  | Restored | 3/3 pass | |

### Phase 3: UI Review — FAIL

**Method.**
- Servers started via `start-servers.sh` on 6746/9653. `assert-phase servers` PASS, and both listeners' cwd is this worktree.
- Isolated Chromium contexts from the repo's `playwright` library, logged in as `matt@helio.dev`, with `hasTouch` and `isMobile` so `(pointer: coarse)` matches. I did not touch the shared MCP browser.
- Every tap uses `page.touchscreen.tap`.
- A capturing click listener records which control actually received each tap. `elementFromPoint` gives the geometric owner of the same point.

**Dev-DB rows.** All created under the dev account and deleted by exact id. Each delete returned 204, every follow-up GET returns 404, and no source is still listed.

| Pipeline | Source |
| --- | --- |
| `6cddc485-1166-4a7f-b155-d95a963c6dc3` | `99e9e0a3-baf4-4c3f-8dea-1c873806d109` |
| `6e490d37-7e46-4414-a5a4-14b12828c679` | `7358544a-0445-4d24-8dab-59c79cb5ea9e` |
| `534e969f-27de-4447-a720-e93e554a6c6e` | `a2edd819-2e66-4180-8f04-17ad4963a3e5` |
| `bdcf8797-8f50-4b0c-8f66-9da3697ad4d0` | `096cb4e5-820d-4247-971f-9152f4430fba` |

**Servers.** Stopped by exact PID; ports are free.

**The change's own pair** (`probe-output.txt`, `counterfactual-margin-output.txt`):
- The geometry fix works:
  - input bottom 520, summary top 532, expander top 524, so 4 px are clear;
  - `elementFromPoint` at the input's last pixel rows is the input;
  - the summary's hit height is still 44 px.
- But **real touch taps 0.5, 1 and 1.5 px above the input's bottom edge still go to the summary and open the function list**, at both 375 and 1100. Taps 2 px or more inside the input focus the input.
- This reproduces the executor's disclosed caveat. The geometric owner of those points is the input, so the browser's touch adjustment is snapping the tap to the summary.

**Baseline: is this generic browser behaviour between adjacent controls? No** (`baseline-output.txt`).
- I enumerated every pre-existing pair of vertically adjacent interactive controls on the pipeline page with a gap of 12 px or less, at 375 and at 1100 touch. On each pair I tapped the upper control 1 px and 2 px above its bottom edge.
- The pairs include:
  - sidebar nav links and pipeline-list links, only 2 px apart;
  - "New pipeline" icon button above the filter input;
  - the filter input above a list link;
  - "Dry run" above "Run pipeline". "Run pipeline" has an expander overhanging into a gap that leaves only 2 px clear, tighter than our 4 px.
- **In every pre-existing pair where the tap point's geometric owner was the upper control, the tap went to the upper control. There were 0 snaps.**
- The only geometric-owner-to-neighbour snap anywhere is this change's Expression input to Functions summary pair.
- The two other baseline taps that went elsewhere both landed on a non-interactive `DIV` that geometrically covers the point ("Add transformation step" / "Add Outputs" bottoms). That is ordinary adjustment from a non-target, not a stolen tap.

**Counterfactuals.** These were applied at runtime in the isolated page only; no code was changed. Taps measured at the input's bottom minus 0.5 / 1 / 1.5 / 2 / 3 / 4 / 6 px (`counterfactual-output.txt`, `counterfactual-margin-output.txt`):

| Variant | Clear gap | Taps that open the list instead of focusing the input |
| --- | --- | --- |
| As shipped (`var(--space-2)`) | 4 px | -0.5, -1, -1.5 (375 and 1100) |
| `tap-expand-44` removed (the pre-change state) | 12 px | none |
| expander `z-index: auto` | 4 px | -1 (unchanged; z-index is not the cause) |
| `margin-top: var(--space-3)` | 8 px | **none (375 and 1100)** |
| `margin-top: var(--space-4)` | 12 px | none |

**Conclusion.**
- The residual snap is caused by this change: the summary's expander sits 4 px below the input, and only this pair snaps.
- It is not generic touch-adjustment behaviour between adjacent controls.
- One more token of geometry removes it entirely: an 8 px clear gap.
- The new CSS comment ("leaves a clean 4px so a touch within ~2px of the input edge is not snapped") is falsified by measurement.

**Unchanged from cycle 2, and still verified by the cycle-2 probe** (this cycle only adds a gated margin):
- the chevron in both themes;
- keyboard Tab / Enter / Space;
- accessible names;
- no overflow.

### Overall: FAIL

### Change Requests

1. **Widen the touch-gated gap to 8 px clear and fix the comment** (`frontend/src/features/pipelines/ui/PipelineDetailPage.css`, the final `@media (max-width: 768px), (pointer: coarse)` block).
   - Change `.pipeline-detail-page__compute-functions { margin-top: var(--space-2); }` to `margin-top: var(--space-3);`. That gives a 16 px gap, so 8 px stay clear of the 8 px expander overhang.
   - Rewrite the comment to state the measured reason: below 8 px clear, the browser's touch adjustment snaps taps on the input's last ~1.5 px to the summary.
   - Verify with a real `page.touchscreen.tap` in a `hasTouch`/`isMobile` context at 375 and 1100. Taps at the input's bottom minus 0.5 / 1 / 1.5 / 2 px must focus `#compute-expression`, with `details.open` false. `elementFromPoint` alone is not sufficient evidence.

### Critical Path

This is the final cycle, so the critical path is short.

- **Must fix before merge:**
  - **CR1 above.** It is a one-token CSS change. My runtime counterfactual has already shown that `var(--space-3)` removes every snap at both widths without affecting anything else in the step card. The block is gated, so it has no desktop effect.
- **Already done:** everything else.
  - Backend semantics, the shared parser, the datebucket characterisation (only the enumerated delta rows change), the seam tests across all three consumers (each proven failable), all gates, and the docs.
  - Cycle-1 CR1, CR3 and CR4, and the cycle-2 geometric overlap, are resolved.

**Recommendation for the human:**
- Apply the one-token change and do a single targeted re-verification of the touch tap. A full evaluation cycle is not needed; the diff is a single CSS value.
- If you judge a 1.5 px snap at the extreme bottom edge of a text input on touch acceptable, the change is otherwise merge-ready. But the baseline shows no other control pair in the app behaves this way, so I do not recommend waiving it.

### Non-blocking Suggestions

- Carried from cycle 1: `.pipeline-detail-page__compute-functions-summary` duplicates `.usage-card__summary`, and `UsageCard`'s summary has the same marker and touch-floor gaps. A shared disclosure-summary recipe could be a spinoff.
- The `.playwright-mcp/` files timestamped `10-57-*` were created by another lane's MCP session during this cycle. They are not mine, so I left them in place.
