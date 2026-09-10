## Evaluation Report — Cycle 2 (evaluation-2.md)

Commit reviewed: `f35a9d57` ("Address evaluator CRs: shared IconButton, pure state
updater") on top of cycle 1's `7bbc49d1`. Both cycle-1 blocking change requests are
correctly and completely addressed. All gates re-run by me. CR1 re-verified against the
running app; CR2 re-verified by an independent mutation probe in a throwaway worktree.

### Phase 1: Spec Review — PASS

Issues: none.

- No scope change; cycle 2 is confined to the two change requests plus their
  documentation. design.md Decision 3 is properly corrected (it now records *why* the
  round-1 hand-rolled control violated DESIGN.md §5, rather than silently swapping the
  implementation), and `files-modified.md` gains an accurate cycle-2 section.
- The `files-modified.md` note describing the round-1 control as "a 16.75px `<button>`"
  conflates the measured *hit extent* (16.75px) with the box (16×16). Immaterial.
- No AC re-interpreted; all cycle-1 Phase-1 findings still hold.

### Phase 2: Code Review — PASS

**Gates (all re-run by me in `WORKTREE_PATH`; `CLEAN_WORKTREE` not set):**

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS (0 warnings) |
| `npm run format:check` | PASS |
| `npm run typecheck` | PASS |
| `npm test` | PASS — frontend 299 suites / **3172** tests (+1 vs cycle 1), helio-mcp 25 / 248 |
| `npm --prefix frontend run build` | PASS |

No backend files changed → `sbt test` not applicable.

**CR1 — shared `IconButton`: addressed.**
`DataGrid.tsx:861-893` now renders `IconButton` (`variant="ghost"`, `size="xs"`) with
`aria-label` kept verbatim, an explicit short `title`, and `aria-pressed` preserved.
`DataGrid.css:211-220` is correctly reduced to only the two things `IconButton`'s
variants genuinely don't express — inline spacing in this `<th>`'s flow, and the
pressed-state accent color via the `className` passthrough. That is the right split:
no new `IconButton` variant was invented for a one-off color. The 44px gate at
`DataGrid.css:479-489` extends the *existing* sibling rule rather than adding a
parallel one.

The `IconButton.tsx:36-42,74,97` change is the only shared-component edit, and it is
minimal and additive: an optional `"aria-pressed"?: boolean` passthrough following the
exact pattern the existing `aria-expanded`/`aria-haspopup` props already use, applied
via `aria-pressed={ariaPressed}` so the attribute is simply absent for every existing
non-toggle consumer. No default changed, no existing call site affected; the full
`IconButton` suite is green. Adding a toggle affordance to the shared primitive is the
correct home for it rather than a local escape hatch.

**CR2 — side effect out of the state updater: addressed, and I verified the executor's
own caveat rather than accepting it.**
`TableRenderer.tsx:404-416,429-441`: the reorder effect now reads the previous count
from `pinnedCountRef` (synced by its own effect, declared *before* the reorder effect so
effect ordering guarantees freshness) and calls `persistPinnedColumns` in the effect
body, outside any updater. `setPinnedCount(clamped)` is now called only when the value
actually changes — behaviourally identical (React bails out on an equal value anyway)
and slightly cleaner.

The executor flagged that its new StrictMode test does not go red against the old buggy
shape, and correctly refused to label it a mutation-failable guard. **I reproduced this
independently** in a throwaway `git worktree --detach` at `f35a9d57` (removed
afterwards; `git worktree list` is clean, and the delivery worktree was never modified):

1. Baseline — new test passes against the shipped fix.
2. Reverted `TableRenderer.tsx` to the exact pre-CR2 updater shape → **the test still
   passes**. The executor's claim (b) is accurate.
3. Instrumented the reverted updater → it is invoked **exactly once** in that scenario.
4. Synthetic probe — `React.StrictMode` in this Jest/RTL/React-19 harness double-invokes
   a `setState` updater (measured 2 updater calls per 1 effect run). The executor's
   claim (a) is also accurate.

So both halves of the executor's characterization hold up. **I can also supply the
mechanism it did not identify, and it matters:** the reorder test keeps the pinned
*count* unchanged (only the keys move), so `clamped === prevCount` and React takes its
**eager-bailout** path — evaluating the updater once to see whether state changed,
finding it unchanged, and never replaying it during render. The doubling is therefore
not absent, only masked by that specific scenario.

I confirmed this by constructing the case the bailout can't hide — a reorder that
*shrinks* the column set so `clamped (1) !== prevCount (3)`:

- against the reverted pre-CR2 shape: **2 identical `pinnedColumns` PATCHes**
- against the shipped fix: **1 PATCH**

That is a real, measured defect the fix eliminates — so CR2 was a genuine bug, not only
a purity principle. It also means a mutation-failable guard **is** constructible, which
the current test comment says it is not. That correction is worth making, but it is a
test-strength improvement on an already-correct fix, so it is a suggestion below, not a
blocker.

Issues: none blocking.

### Phase 3: UI Review — PASS

Re-verified against the running app (`:5897`/`:8804`), same 82-column table panel.

**CR1 fix, measured on the live DOM (compare cycle 1's numbers):**

| | Cycle 1 | Cycle 2 |
| --- | --- | --- |
| Element | hand-rolled `<button>` | `ui-icon-btn ui-icon-btn--ghost ui-icon-btn--xs ui-data-grid__pin-toggle-btn` |
| Box | 16 × 16 | **24 × 24** |
| Hit extent (bisected) | 16.75 × 16.75 | 24.5 × 24.75 desktop / **44 × 44** at the coarse gate |
| `title` | `null` (inherited `<th>`'s "category") | **"Pin" / "Unpin"** |
| `aria-label` | "Unpin column category" | unchanged — "Unpin column category" |
| `aria-pressed` | "true" | unchanged — "true" |

- The misleading tooltip is gone: `title` is now the action, while the enclosing
  `<th title="category">` no longer shows through.
- Touch gate confirmed live at 375px: `matchMedia('(max-width: 430px), (pointer: coarse)')`
  matches, computed `min-width`/`min-height` are `44px`, measured box `44 × 44`. The
  header row grows to 60.5px on a coarse pointer — the accepted, identical consequence
  of the pattern its filter-row siblings in the same block already carry. No page-level
  horizontal overflow at 375px.
- Icon is `aria-hidden="true"` inside `IconButton`'s own `__icon` span.

**No regression from the CR fixes** (the header JSX was rewritten, so I re-ran the core
checks rather than assuming):

- Keyboard: the control is still a real tab stop; focusing the 3rd column's button
  ("Pin column date") and activating it pinned through columns 1-3.
- Offsets/stickiness intact: `left` 0/160/320, z-tiers 3/3/3 pinned vs 2 non-pinned;
  under `scrollLeft = 4000` the pinned body cells held at x=297/457/617 (grid left edge
  = 297) while column 4 moved to x=-3223.
- Accessible names still consequence-aware: "Unpin column …" ×3 then "Pin column game_id";
  titles "Unpin"/"Unpin"/"Unpin"/"Pin".
- Persistence intact across a full reload (pins restored at 0/160/320).
- Light theme re-checked visually — the 24px control sits correctly in the dense header,
  separator and pinned-cell backgrounds unchanged from cycle 1.
- Console: 0 errors, 0 warnings across reload + pin/unpin interaction.

Issues: none.

### Overall: PASS

Both blocking change requests are fully addressed, with no regression to any behaviour
verified in cycle 1 and no new issues introduced. Everything in cycle 1's Phase-3
evidence (AC1/AC2/AC3/AC4 under real scroll, doubly-sticky corner cells, Decision 6
backgrounds in both themes, clear-to-`[]` against the real backend merge, and the full
AC6 regression sweep) still holds; the cycle-2 diff touches only the control and the
persist call site, both of which I re-measured.

Worth recording: the executor self-reported that a test it had just written was weaker
than my change request implied, instead of leaving a false "mutation-failable" claim in
a comment. That is the right instinct, and independently checking it is what surfaced
the eager-bailout mechanism and a genuinely stronger guard.

### Change Requests

None.

### Non-blocking Suggestions

- **The reorder guard can be made genuinely mutation-failable.**
  `TableRenderer.test.tsx` (the "exactly ONE pinnedColumns PATCH" test and its comment).
  The current scenario is masked by React's eager bailout because the pinned count is
  unchanged. A second case where the count must clamp — e.g. mount with
  `columnOrder={["a","b","c"]}` / `pinnedColumns={["a","b","c"]}` then rerender with
  `columnOrder={["a"]}` — measures **2 PATCHes against the pre-CR2 shape and 1 against
  the fix**, i.e. it is red-on-mutation. Adding it would convert "structural protection
  only" into a real regression guard, and the comment could then be trimmed to state
  the bailout mechanism rather than that no guard is possible.
- Cycle 1's DRY note still stands (the duplicated leading-prefix walk in
  `TableRenderer.tsx:99-107` and `DataGrid.tsx:~262-272`); untouched this cycle, still minor.
- Cycle 1's 375px observation (a pinned run wider than the grid leaves nothing to
  scroll) is unchanged and still a matter for the skeptic's judgment, not a defect.

### Shared-component drift note (HEL-520 lane)

Checked concretely this cycle rather than by inspection alone. HEL-520's worktree
(`task/focus-management-keyboard-navigation/HEL-520`, at `79431f21`) touches
`Modal.test.tsx`, `PipelineDetailHeader.css`, `tokenAuditSweep.css.test.ts` and a set of
`e2e/` focus/contrast probes — **no overlap** with `IconButton.tsx`, `DataGrid.tsx`, or
`DataGrid.css`. No merge-conflict risk from this ticket's shared-component edit.

Two forward-looking flags for the orchestrator, neither a defect here:

1. HEL-520 adds `e2e/focus-presence-guard.spec.ts` / `hel520-focus-presence-guard.regression.spec.ts`.
   Once both land, that guard will encounter this ticket's new per-column focusable
   control. On a 75-column table that is 225 header tab stops (accepted in design.md
   Decision 3 and explicitly deferred to "the a11y pass"). Whether the guard tolerates
   that volume is worth checking at merge time — it is outside this ticket's gates.
2. `IconButton` now has an `aria-pressed` prop. If HEL-520 is reasoning about focus or
   roving-tabindex behaviour on that primitive, it should know a toggle affordance now
   exists on it.
