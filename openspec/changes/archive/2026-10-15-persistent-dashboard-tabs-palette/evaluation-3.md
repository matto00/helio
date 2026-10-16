## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `9f6cf958001833783dab350a2316d674cfcb74f1`, one commit on top of the cycle-2 head `804d4f603`. The review base, resolved live, is still `cd64409ad`. The cycle-3 diff touches 8 files and no `backend/` path, so `sbt testFull` was not re-run. The cycle-1 run (8145 tests, 0 failed) still stands.

### Gates (fresh runs, this worktree)

| Gate | Result |
| --- | --- |
| `npm run lint` / `format:check` / `typecheck` | exit 0 / exit 0 / exit 0 |
| `npm test` (3 workers, nice 19) | helio-mcp 51 suites / 469 tests; frontend 630 suites / 7473 tests, exit 0 |
| `npm --prefix frontend run build` (the executor did not run it) | exit 0 |
| `check:tokens`, `check:openspec` | exit 0 |
| `e2e/hel1575-dashboard-tabs.spec.ts` (2 workers, nice 19, run from this worktree, `start-servers.sh` 7007/9914) | **18 passed** (1.3m), including the new "touch: a tap on a tab's left edge lands in that tab". Teardown deleted 18 throwaway users; dev DB `hel1575%` users = 0 afterwards |

Mutations, run in a throwaway detached worktree at `9f6cf9580` and removed afterwards:

| Mutation | Result |
| --- | --- |
| Remove the coarse 28px override (back to 24px) | The new CSS-source test "under coarse pointers the 44px expander never reaches past the close's right margin" fails, 1 of 4 |
| Revert `sweepWarm`'s `expireTab` to `releaseTab` | The new `warmCache.sweep.test.ts` "expires a tab that is no longer warm" fails, 1 of 3. This closes the cycle-2 guard gap |

The new touch e2e asserts that `elementFromPoint(tab.left + 0.5).closest(".dashboard-tab") === tab`. My cycle-2 probe of the 24px state found the previous tab's close at that exact point, which this assertion rejects. That probe stands as the red evidence for the e2e.

Rendered-file rule: no `scripts/concertino/**`, `.concertino/laws/**` or `.claude/**` path is in the diff, and `scripts/concertino` is identical to the main checkout's render. The main checkout is clean.

### Phase 1: Spec Review — PASS

- **Cycle-2 CR1 (expander tiling) is addressed.** The CSS comment and `ui-decisions.md` now state the geometry correctly: (44 - 28) / 2 = 8px, equal to the 8px margin.
- **Non-blocking items taken up.**
  - The sweep has a unit guard.
  - `ui-decisions.md` records the cost of shared-Output expiry for the PR.
- **Earlier results stand.** All ACs, spec scenarios and constraints C1-C7 verified in cycles 1 and 2 still hold, and the unchanged e2e cases pass at this HEAD.

Issues: none.

### Phase 2: Code Review — PASS

- **The change is CSS only:** `width/height: var(--control-sm)` inside the existing `(pointer: coarse)` block. Fine pointers keep the 24px close.
- **The new CSS test is sound.** It resolves `var(--token)` values from `theme.css` before comparing, so the coarse size is computed from the token rather than a hard-coded 28.
- **The sweep tests cover all three branches:**
  - a non-warm tab is expired, which invalidates its generation;
  - a warm tab is left alone;
  - the active tab is released without an invalidation.

Issues: none.

### Phase 3: UI Review — PASS

I re-ran my cycle-2 probe (`/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-2/close-hit-region-probe.cjs`) against the live app on `:7007` as `matt@helio.dev`. Output: `/home/matt/Development/helio/.concertino/runs/HEL-1575/evidence/evaluation-3/close-hit-region-probe.json`.

- **Coarse pointer** (`hasTouch: true`; `matchMedia("(pointer: coarse)")` is true):
  - The close box is 28x28, for example 488-516. The next tab starts at 524.
  - The hit region is 479.25-523.75, a width of 44.75 at 0.25px steps: it clears the 44px floor and ends exactly at the tab boundary.
  - Overlap into the next tab is **0 on every adjacent pair**. `elementFromPoint` at each next tab's left edge returns that tab's own `dashboard-tab__button`.
- **Fine pointer:** the close is 24x24 with a hit width of 25. There is no expander and no overlap.
- **Unchanged since cycle 2:**
  - the focus ring keeps `outline-offset: -2px`;
  - the dot is still `var(--app-text)`.
- **Edge clipping:** the last tab visible before the strip's edge has its expander clipped by the strip's own `overflow` scroller. This is inherent to a scroll container, and once the tab is scrolled into view its expander is whole.

Issues: none.

### Overall: PASS

### Non-blocking Suggestions

- **PR body.** Carry the items already listed in cycles 1 and 2:
  - the C7 behaviour change (pending panel edits flushed on leave; a batch save clears only the keys it sent);
  - the 15 min / 8 tab warm cache and the 615 ms cold vs 297 ms warm switch medians;
  - the panel-delete reordering of the dashboards list;
  - the tablet touch-AT close limit;
  - the extra metadata read per succeeded run;
  - the shared-Output expiry cost;
  - file-split proposals for the files over 400 lines.
- **Servers.** I stopped them with `stop-servers.sh` (`STOPPED ports=7007,9914`).
