## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: c8e204e065a817babc5ef5a74df8878bb4af73c0 (branch HEAD = main tip; only the untracked change dir differs).
Scope per orchestrator: items 1-5 and 7. D12 (items 6, 8) is treated as pending, not as a decided scope cut.

### What I verified (with evidence)

- Spawn guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=feature/motion-pass-primitives/HEL-1584`.
- Context claims in design.md that hold up against the tree:
  - Tokens `theme/theme.css` :89-103 match what the design quotes. `--motion-ease-overshoot` is `cubic-bezier(0.2, 0.9, 0.3, 1.1)`, the same curve as the board's `.pop` (`MotionLive.dc.html:28`).
  - `PanelGrid.css` :9-47: the item, placeholder and container are timed on `--motion-duration-move`, and the vendor `transition: none` is re-asserted. `.panel-grid-card` has no transform transition today.
  - `PanelList.tsx` :415-433 has the skeleton / `<PanelGrid key={selectedDashboardId}>` / null ternary. `DesktopPanelGridSkeleton.tsx:57` has `key={dashboardId ?? "no-dashboard"}`.
  - `panelsRestored` is at `panelsSlice.ts:144`. Its only dispatcher is `showDashboardPanels.ts:61`.
  - `Modal.tsx`: `showModal()` is called inside a passive `useEffect`. `Modal.css`: `ui-modal-in` runs on `--transition-slow` with `backwards`, and `::backdrop` has no animation (HEL-1035 confirmed). The e2e dependency on `ui-modal-in` is `e2e/hel1311...:410-422`, which covers the Output editor sheet, not the detail modal.
  - `ChartPanel.tsx` keeps `notMerge={true}`. echarts-for-react is 3.0.6 and does support `replaceMerge` (`lib/core.js:187`).
  - `CommandPalette.css` has no animation of its own, and its results are `<li key={action.id}>` inside grouped sections.
  - Timeline marks are keyed `${pipelineId}:run:${runId}` (`home/utils/timelineMarks.ts:17`). `.tl-shape--failed` has `transform: rotate(45deg)` (`HomePage.css:388`).
  - `motionTokenGuard.css.test.ts:170` pins 149. `--motion-index` is already allowlisted (`check-tokens.mjs:106`). `motionPrimitiveLiterals` scans every file in `shared/motion`.
- **RGL 2.2.4 child props** (`node_modules/react-grid-layout/dist/chunk-7ZM5LVH2.mjs:487-501`): `cloneElement(child, { className: clsx("react-grid-item", childClassName, …), style: { ...style, ...childStyle, ...createStyle(pos) } })`. This confirms two things. A child `--motion-index` style survives, with RGL's transform written last. A child className is also forwarded onto the positioned item. This matters for CR2.
- **`useStaggeredEntrance`** latches with a render-time `setState` ("adjust state while rendering"). React discards that render and re-renders in the same pass, so a D3 hook built the same way adds no commit.
- **`.motion-enter`** (`shared/motion/motion.css`) animates `transform: translateY(...)`. A CSS animation overrides an inline `transform`.
- **`Crossfade`** (`shared/ui/Crossfade.tsx`/`.css`): `fadesIn` is initialised to `loading`. `.crossfade` is a grid, and `.crossfade__layer` is `display: flex` (row) with only `min-width: 0` on its children. Today its only consumer is `PanelContent`.
- **`.mobile-panel-stack`** is a `display: flex; flex-direction: column` root with no width (`MobilePanelStack.css:5-12`). The RGL root gets no inline width; its children are absolutely positioned.
- **`useLayoutSave.ts`** :220-229 dispatches `setLayoutPending(false)` whenever the layout re-baselines or equals the persisted layout again (undo back to it, or a server layout landing), with no save involved.
- **Warm cache persistence**: `warmStore.ts:218` uses IndexedDB. `showDashboardPanels` restores a warm tab after a reload from the browser store through `panelsRestored`, which is the "first activation after a reload" path.
- **Base spec** `openspec/specs/motion-primitives/spec.md:60` requires that "Content replacing a loading skeleton SHALL fade in…".
- **Sibling overlap**: HEL-1583 (PR #1052, open) diffs `PanelList.tsx` in the zoom region, plus `theme.css`, `motionTokenGuard.css.test.ts`, `MobilePanelStack.css` and both SaveStateIndicator hosts (`git diff c8e204e06...origin/feature/mobile-dashboard-glass-nav/HEL-1583`). The textual regions differ from D4/D5's. The Risks section names only the guard file.

### Explicit sign-off: D4 / D8 touch to DesktopPanelGrid, PanelGrid and MobilePanelStack

**Sound in kind, approved subject to CR2.** What D4 adds:
- one `useMemo` over `resolvedLayout`;
- one hook call that latches at render time;
- a `playEntrance` prop;
- a per-child `data-entrance` attribute and `--motion-index` style.

None of these feeds `layouts`, `breakpoints`, `cols`, `width`, the compactor, the handlers or the child keys, which are RGL's only layout inputs. So D4 cannot create a render that changes both layouts and breakpoint, and it cannot reintroduce the HEL-1575 loop.

The HEL-1575 keys stay:
- `PanelList`'s `key={selectedDashboardId}`. D5 moves this element one level down, inside the Crossfade content layer. It is still keyed, and it still unmounts while loading, exactly as the ternary does today.
- The skeleton's `key={dashboardId}`.

D8 in `DesktopPanelGrid` is a pure prop pass-through, so it is fine.

The constraint that must be written down is CR2. `entranceProps()` returns `className: "motion-enter"`, and RGL forwards a child className onto the item. Spreading it there would make the CSS animation override RGL's inline translate, which is exactly the failure D4 warns about, and nothing in the plan makes that mistake hard to make.

### D13 performance method: adequate in shape, with gaps

The method can go red, which is what matters:
- React commit counting through the devtools hook;
- `layout-shift` and `longtask` observers;
- drag rAF intervals;
- 5x medians before and after;
- a jest `<Profiler>` pin on DesktopPanelGrid's drag commits.

It is not yet sufficient for "dashboard load keeps current performance". The gaps are in CR8.

### Verdict: REFUTE

### Change Requests

1. **D8 cannot work as written. The expand-from runs before the dialog is open.** D8 says the measurement happens "in a layout effect after the dialog is shown". But `Modal` calls `showModal()` in a passive `useEffect` (`Modal.tsx`, the "Sync open prop" effect). Layout effects run before passive effects in the same commit. `PanelDetailModal` also mounts with `open` already true (`DesktopPanelGrid.tsx`, `detail.detailPanel ? <PanelDetailModal…/>`). At layout-effect time, then, the dialog is still `display: none`: its rect is zero, `s = origin.width / 0`, and dx/dy are meaningless. Separately, `ui-modal--expanding` must already be on the dialog when `[open]` is applied. Otherwise `ui-modal-in` starts first and is then swapped mid-flight.

   Revise D8 to name the mechanism. One option: the class is derived at render from `expandFrom && motion === "full" && !instant`, and the WAAPI call happens inside (or immediately after) the `showModal()` effect in `Modal`. Add a unit test that fails if `animate` is called while `dialog.open` is false.

2. **D3/D4 API mismatch.** D3's `entranceProps(key)` returns `{ className, style }`, where the className is `motion-enter` or `motion-pop`. D4 needs a `data-entrance` value on an RGL item and says the class must never reach the item. RGL forwards child classNames (`chunk-7ZM5LVH2.mjs:489`), and `.motion-enter` animates `transform`, which beats RGL's inline translate. Revise D3 so the hook exposes the phase (`"enter" | "pop" | null`) and the index separately from the convenience className, and have D4 consume only the phase and index. Add a DesktopPanelGrid test asserting that no `.react-grid-item` carries `motion-enter` or `motion-pop`.

   In the same decision, state:
   - (a) which breakpoint the (y, x) reading order uses. It should be the active one, via `getBreakpointFromWidth(rglBreakpoints, width)` as `shortCardIds` already does.
   - (b) whether the grid entrance runs on `--motion-duration-emphasized`. D3 adds `.motion-enter--emphasized`, but nothing in D4 consumes it.
   - (c) where `playEntrance` is latched. If it is latched in `DesktopPanelGrid`/`MobilePanelStack`, a width crossing of `sm` remounts the other shell and replays the stagger. Latch it once in `PanelGrid`.

3. **D4 contradicts itself on what counts as "cold".** It says the entrance plays on "the first dashboard shown in the session, or any dashboard whose panels came from a network fetch". The only mechanism, though, is `itemsOrigin`. After a page reload, a warm tab is restored from IndexedDB through `panelsRestored` (`showDashboardPanels.ts`, the lazy `readStoredEntry` path), so the first dashboard of the session reads as `"restored"` and gets no entrance. Pick one rule. Either drop the "first dashboard in the session" clause, or add a session-first flag. Then update the "Warm tab switch is instant" scenario to match.

4. **D5/D6: wrapping in Crossfade changes the box of everything wrapped, and the design does not address it.** `.crossfade__layer` is a `display: flex` row whose children get only `min-width: 0`. Placed inside it:
   - the RGL root (no width, absolutely positioned children) shrinks to its content width;
   - `.mobile-panel-stack` (a flex column with no width) shrink-wraps its cards;
   - each lazy route page under `RouteSuspense` becomes a content-sized flex item.

   Specify the sizing rule, for example a Crossfade option or a rule that makes the content child fill the layer. Add a test, ideally in a real browser at 1440 and 375, asserting that the grid root, the stack and the route page are each as wide as their container.

   Also, D5's `loading={showPanelGridSkeleton}` drops the existing `|| showBootstrapSkeleton` arm of the ternary (`PanelList.tsx`, the skeleton condition). State the exact condition.

5. **D6's "already-resolved chunk: nothing animates" is not true of the Crossfade it builds on.** `Crossfade` initialises `fadesIn` from `loading`. `RouteSuspense` starts with `loading={!ready}` set to true, so the content layer gets `crossfade__content--entering` on every route mount, even when `ready` flips before first paint. The existing "no running animation" path only removes the skeleton layer. Specify how an immediate resolve skips the content fade, and keep the planned "already-resolved = no animation" test as the red check.

6. **D10's merge signature lets stale nested options survive a same-shape update.** The signature covers chart type, top-level component keys, axis types and series ids/types. Under `notMerge: false` with `replaceMerge: ["series"]`, ECharts merges every other component, so a property removed from the new option keeps its old value. Examples: an axis `name`, `min`/`max`, a label formatter, a legend option. A config edit that keeps the signature would therefore leave stale state behind, which is the F-027 class of bug `notMerge` exists to prevent.

   Define the signature as the structure of the whole option with only the data payloads stripped (`series[].data`, category-axis `data`, and data-derived `visualMap` bounds if applicable). Then the merge path is taken only when data alone changed. Add a unit test: remove an axis name (or a min) at the same chart type, and expect `notMerge` true.

7. **D11a: "dirty to clean" is not "save completed".** `useLayoutSave.ts:220-229` dispatches `setLayoutPending(false)` in these cases:
   - an undo back to the persisted layout;
   - a re-baseline when a server layout lands;
   - a discarded staged drag.

   `resetPanelSaveState` also clears pending panel updates without any save. Each of these would show the save check falsely. The spec scenario says "finishes saving". Tie the cue to a success signal: the layout PATCH or panel batch save fulfilled while it was pending (or equivalent). Add a test showing that an undo to clean renders no check.

8. **D13 needs these additions before it can certify the AC.**
   - (a) Reconcile the baseline method. D13 says to add the spec "in a scratch copy of the base tree", while tasks 1.2 runs it in the worktree before any source change. Keep the tasks version and fix D13.
   - (b) Add explicit pass/fail thresholds for the load metrics already recorded in 1.1: time to first card content, and long-task total, not only CLS and commits. Define "within noise" numerically, for example within the base run's min-max spread, or within one frame at p95.
   - (c) Include `e2e/hel1575-switch-measurement.spec.ts`'s warm and cold medians before and after. D5 keeps the skeleton's `.panel-body-skeleton` nodes mounted for one standard duration on a cold switch, and that spec waits for `skeletons === 0`. Its shipped cold-switch number will move, so the expected delta must be stated and justified, not discovered afterwards.
   - (d) Fix D4's reference "the before/after numbers of D11" to D13.

9. **Spec delta: Crossfade.** The ADDED requirement "Crossfade options" (content may skip its fade) contradicts the existing `motion-primitives` "Crossfade" requirement (`openspec/specs/motion-primitives/spec.md:60`: "Content … SHALL fade in"). Write it as a MODIFIED "Crossfade" requirement that carries the options, so the archived spec is not self-contradictory.

### Non-blocking notes

- **D9 stagger step.** The ticket and the board both say 30ms (`MotionLive.dc.html:93`), but the plan uses 40ms. The rationale is reasonable and the change is reversible, but it is a visible divergence. Surface it in the PR for the owner rather than leave it only in design.md.
- **D2 drag shadow.** The lift uses `--app-shadow-soft`, which is already the card's `:hover` shadow (`PanelGrid.css`, `.panel-grid-card:hover`). The pointer is over the card while dragging, so the lift adds only the 1% scale. Judge it on screen at task 6.5, and consider a stronger elevation token if it reads flat.
- **Risks list.** Add HEL-1583's overlap on `PanelList.tsx` and `theme.css` (different regions, so a rebase rather than a redesign).
- **Detail-modal e2e specs.** Specs that open the detail modal and measure geometry (`hel716-panel-detail-tall-viewport-footer`, `hel909`, `hel572`) will now see a WAAPI expand that the `ui-modal-in` filter does not cover. Name them in 6.6 as must-stay-green.
- **Later cards.** On cold load, a card with a long stagger delay may become visible with its ECharts entrance already finished. That is acceptable, but look at it in the screenshots.
