## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md at worktree HEAD bcde936d5e09f22fc0150fba603f70c3065866f6 (= origin/main; change dir untracked).

### What I verified (with evidence)

- **Cited line ranges, all correct against bcde936d.** `wc -l`: PanelContent.tsx 536, PanelDetailModal.tsx 589. PanelContent: imports L1-48, `PanelContentProps` L50-137, the `OutputPanelContent` doc comment starting L139, function L143-398, `PanelContent` L400-536. PanelDetailModal: imports L1-47, `padSeriesColors`/`buildInitialChart` L49-70, `OutputPanelSection` L72-146 (doc comment L72-75), props L148-155, `EMPTY_CONTROLS` L157-160, data wiring L166-217, `useNavigate` L218, edit state L220-292, keydown effect L294-314, handlers L316-377, `renderSubtypeEditor` L379-421, JSX L423-588, `renderSubtypeEditor()` call L559, `<OutputPanelSection>` L551.
- **D2c and D2d each wrap a contiguous run of hooks.** Base order: `useAppDispatch`, `useTheme`, then [`useViewerControls`, `useMemo`, `useMemo`, `useCallback`, `useOutputMeta`, `useCrossFilterServerOps`, `usePanelData`, `useAppSelector`] (L166-217), `useNavigate` (L218), then [`useState`, `useMemo`, `useState` x5, `useRef` x6, `useState` x2, `useCallback`, `useState`, `useCallback`] (L220-292), then `useEffect` (L298). No hook sits inside either span that belongs elsewhere, so wrapping them in custom hooks leaves the fiber hook list unchanged.
- **Every identifier the host still reads is in the return lists.** I checked the D2c list against L316-588. `outputIdForControls` and `crossFilterEq` stay internal, which is correct. I checked the D2d list too. `initialTitle` is read at L357, `subtypeDirty` at L365, `activeEditorRef` at L364, `controlsEditorRef` at L553, and the five content refs by `renderSubtypeEditor`. `setSubtypeDirty`, `appearanceDirty` and the `initial*` values other than `initialTitle` stay internal, which is correct. Nothing is missing.
- **Line counts, simulated.** I built every D2 module from the base line ranges exactly as the design specifies (scratch script `build.py`). I formatted them with the worktree's `prettier.config.cjs`. The base file is prettier-clean under the same config, so the counts are calibrated. Result: host **359**, `usePanelDetailEditState` 121, `usePanelDetailData` 95, `OutputPanelSection` 85, `renderSubtypeEditor` 76, `panelDetailChartState` 25. The host < 400 claim holds with about 40 lines of margin. OutputPanelContent.tsx comes to about 260 + imports and PanelContent.tsx to about 280. Both are well under 400.
- **No new render-tree layer.** `OutputPanelSection` was already a separate component (L551). `renderSubtypeEditor` stays a plain function called during render. The hooks are not components.
- **The `react-hooks` v7 compiler rules accept the shape.** The plugin is 7.0.1 and its recommended set includes `react-hooks/refs`. Passing ref objects into `renderSubtypeEditor({...})` during render and calling the returned `activeEditorRef()` in handlers raised no error. ESLint exit 0 on the simulated `renderSubtypeEditor.tsx`, both hooks, `OutputPanelSection.tsx` and `panelDetailChartState.ts`.
- **jest.mock paths keep applying.** Detail-modal tests mock by module path (`../../hooks/usePanelData`, `../editors/AppearanceEditor`, `outputService`, `echartsCore`), and those resolve the same for any importer. The only mock of a touched module is `grid/DesktopPanelGrid.test.tsx:36`, which mocks `../detailModal/PanelDetailModal`. That path keeps its `PanelDetailModal` export. No test imports a moved symbol, because none is exported today.
- **No circular import.** `OutputPanelContent` types its props inline (L164-185) rather than through `PanelContentProps`.
- **D5 matches the source nits.** HEL-1378's evaluation-1.md:59-60 and skeptic-final-1.md:21 say the same thing as the design. `getDistinctValues` resolving to `{ values: [] }` fits `.then((r) => r.values)` (L188). JSX inside a jest.mock factory already works in this file (L17-19).
- **Overlap is handled.** premise-validation.md covers HEL-1395 items 3/4 and HEL-1378 (ecaa1a53). HEL-1395 is not absorbed (C7). I found no in-flight worktree or branch for 1395 or 1378. The HEL-1365 precedent 0ebc784b exists.

### Verdict: REFUTE

One defect, which I reproduced twice. As written, D2 cannot pass `npm run lint` (`--max-warnings=0`) without the executor departing from the plan.

### Change Requests

1. **The keydown `useEffect` cannot stay verbatim in the host. Move it into `usePanelDetailEditState`.**
   - **What fails.** Base L298-314 has deps `[modalMode]` and calls `setModalMode`. Today `setModalMode` comes from `useState` in the same component, so `exhaustive-deps` treats it as stable and exempt. Once it arrives destructured from a custom hook, the rule no longer knows it is stable.
   - **Evidence.** Linting the simulated host as D2 specifies, with the worktree's `eslint.config.cjs`, gives this. It reproduced on a second run.
     ```
     120:6  warning  React Hook useEffect has a missing dependency: 'setModalMode' ... react-hooks/exhaustive-deps
     ESLint found too many warnings (maximum: 0).  exit 1
     ```
   - **Why the executor's easy fixes are wrong.** Adding `setModalMode` to the deps or adding an eslint-disable line would edit "host-verbatim" code. That breaks D3/C1 and the D2 line "the host keeps ... the keydown effect ... verbatim".
   - **The fix.** L294-314 is contiguous with D2d's span, and no hook call sits between L292 and L298. Make D2d's body **L220-314** verbatim, add `useEffect` to the hook's react import, and drop `useEffect` from the host. Hook order is unchanged, byte-identity holds, and lint passes: the alternative simulation gives ESLint exit 0 on both the host and the hook.
   - **Edits to the artifacts.**
     - design.md D2d: change the body range to L220-314 and drop "before the keydown `useEffect`".
     - design.md D2 host bullet: remove "the keydown effect" from what the host keeps.
     - design.md D3: the PanelDetailModal host remnant becomes L316-588 minus the L559 call, not L294-588.
     - design.md D3b: no list change is needed, but state that the `useEffect` is now inside (d).
     - tasks.md 2.4: change to match.
   - **Lesson for the plan.** Any other "verbatim host" code with a deps array whose identifiers now come from a hook needs the same check. I found no other instance: the host has no other dependency-array hook once this effect moves.

### Non-blocking notes

- D1, CSS order. The plan places the `./PanelContent.css` import correctly. Module evaluation order still decides the order of stylesheets injected by the renderer modules (ChartOutputPanel, the renderers and so on), and moving their imports into `OutputPanelContent.tsx` can reorder them. The live light/dark before/after comparison in tasks 1.2/5.3 is the right catch. Placing the `./OutputPanelContent` import where the first moved renderer import sat keeps the order closest to the original.
- D5 evidence. "Console-error count >0 then 0" can be polluted by unrelated noise. Count only `ECONNREFUSED`/`AggregateError` lines, which the design already says.
- D4. The stale "above"/"below" pointers move into hook modules: base L195-196 into `usePanelDetailData`, and L243-248 into `usePanelDetailEditState`. Commit 2 is the place to fix them, and the plan already does that.
- I did not run a typecheck on the simulation, because that would mean writing files into the worktree. The prop types of the refs passed to `renderSubtypeEditor` (`RefObject<PanelEditorHandle | null>`) match the `useRef<PanelEditorHandle | null>(null)` objects the base already passes.

### Evidence

Persisted in `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/skeptic-design-sim/`:
- `build.py` (the simulation)
- `fmt_*` (the design as written, prettier-formatted)
- `alt_*` (with the effect moved into the hook; not prettier-formatted)
- `lint-transcript.txt`
