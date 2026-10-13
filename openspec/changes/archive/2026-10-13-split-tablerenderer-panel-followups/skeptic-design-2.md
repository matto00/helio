## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: f63ab8365d2b0e6cac36154a83437b6d26b3a209 (worktree HEAD; the only change is the untracked change dir).
`git diff --stat f63ab8365 origin/main -- frontend/src/features/panels frontend/src/shared/ui frontend/src/theme DESIGN.md openspec/specs/write-path-audit`
is empty, so the move of origin/main does not overlap this change.

### What I verified (with evidence)

- **Spawn cwd**: assert-cwd.sh printed `READY ambient=/home/matt/Development/helio branch=task/hel1399-followups-split-tablerenderer/HEL-1449`.
- **Owner ruling**: events.jsonl line 5 is `escalation.answered`, `answer:"scroll-hint"`, `answer_source:"human"`. D5 is judged on execution only.

#### Round-1 CR1 (D1e range): only partly fixed; a new off-by-one
- `nl -ba TableRenderer.tsx` at base shows:
  - L603 `}, [outputId]);`
  - L605-611 handleSort's doc comment
  - L673 `function handlePinToggle`
  - L693 `    }, PERSIST_DEBOUNCE_MS);`
  - **L694 `  }`**, which closes `handlePinToggle`
  - L695 blank
  - L696 starts the HEL-451 D4/4.1 render comment
- The design says `handlePinToggle` ends at L693, sets D1(e) to "L470-693", and starts the host remnant at L694-903 ("render L695-903").
- Read literally, the hook body is cut one line before the function's closing brace, and the host remnant begins with a stray `}`. `git show f63ab8365:... | sed -n 693,695p | cat -A` confirms this (`    }, PERSIST_DEBOUNCE_MS);$`, `  }$`, `$`).
- The orphaned-comment problem from CR1 is fixed: the handlers now move with their doc comments.

#### D2 partition does not cover L1-903 as claimed
- The listed blocks are 1-30, 31-121, 123-241, 243-282, 284-336, 337-468, 469, 470-693 and 694-903.
- They omit L122, L242 and L283, all blank (checked with `sed -n`).
- The design says "Every base line belongs to exactly one block; the transcript proves the union covers L1-903". A transcript built from these ranges cannot prove that.

#### Round-1 CR3 (line budget): addressed
- Removing a (91 lines), b (119), c (40), d (132) and e (225, using the corrected L470-694) from 903 leaves about 296 lines. The design says ~297/~340 after imports and call sites, which is credible and well below 400.
- `useTablePersistedState` would be about 225 lines plus imports, signature/params and return, so about 260-270. Under 400.
- Moving the handlers into the hook was one of the round-1 options. It is behaviour-preserving, and none of the render-section hooks (L787-801 useMemo) depend on anything declared later.

#### D1 hook/closure dependencies
- The hook calls at L310, L319, L340-452 (all in d) and L476-582 (all in e) are listed by `grep -n`. The render section only has the three useMemos.
- Because of TDZ, d cannot read anything from e. e reads d's outputs (`columns`, `toggleSort`, `sortState`, `setFilters`) and props.
- The two `eslint-disable-next-line` lines are at L448 (d) and L577 (e). Both move with their blocks.

#### Round-1 CR2 (mount timing): addressed
- `EditFormScrollArea` mounts together with the form, so the attach effect in `useScrollEdges.ts` (`useEffect(..., [measure])`, bails when `!el`) always sees the real element. The "panel switch remounts" correction is accurate.
- Test 6.2 starts in view mode and toggles to edit. Under the host-level-hook mutation, `ref.current` is null at host mount, so neither the layout-effect measure nor the listener attach ever runs again. The class stays absent and the mutation goes red as designed.
- Note for the test author: the form mounts fresh on toggle, so jsdom scroll metrics have to be stubbed before the toggle, for example on the prototype. A ref-callback stub like the one in `useScrollEdges.test.tsx` would not be in place before the layout effect.

#### Round-1 CR4 (fade under opaque children): addressed in Decisions, contradicted in Risks
- The overlay is a sibling `aria-hidden` div with `position: absolute; inset: 0; pointer-events: none; z-index: 1`. Its inset shadow paints above the form's opaque `--app-surface` rows.
- There is a measurable visibility signal (pixel delta) and a click-through check.
- **The Risks section still says** "[Inset shadow under opaque child backgrounds] → same trade-off as the existing horizontal fades; judged live". That is the round-1 text CR4 objected to, and it contradicts D5's decision.

#### New wrapper and the flex layout
- Today `.panel-detail-modal__inner` is `display:flex; flex-direction:column; height:100%` (PanelDetailModal.css:19-24). The form is `flex:1; overflow-y:auto` (binding.css:1-9).
- The wrapper is `flex:1; min-height:0; display:flex` with the default row direction. In it:
  - the form is a row-flex item;
  - its height comes from `align-items: stretch`, so it is definite;
  - `overflow-y:auto` makes `overflow-x` compute to `auto`, so `min-width:auto` resolves to 0 and wide content cannot blow out the width;
  - `flex:1` fills the width.
- So the layout is equivalent. The discard-warning sibling stays below the wrapper, as it does today.
- No test, CSS file or e2e file references `.panel-detail-modal__content`, `.panel-detail-modal__inner` or `panel-detail-edit-form` beyond the defining CSS. I checked this with a grep over frontend/src and e2e. Existing PanelDetailModal tests and CSS tests (`*.css.test.ts` read only the tap-target and safe-top rules) are therefore unaffected.
- Mobile CSS (`PanelDetailModal.mobile.css`) has no rule on the content, inner or form. In the edit form, `Select` is portaled (`createPortal`) and there are no in-form z-indexed popovers, so the overlay's `z-index:1` cannot cover a menu.

#### useScrollEdges and the guard
- `useScrollEdges` change is additive. `measure` already calls `setEdges` with a fresh object on every call, so render counts do not change. Consumers are `DataGrid.tsx:520` and `SortableTable.tsx:82`. Existing tests read only `left`/`right` text, so no `toEqual` breaks.
- `elevationTokenGuard.css.test.ts` pins by exact file, declaration and count. `isAllowedShadow` accepts only `--app-shadow-card/soft` or `none`, so each new vertical inset must be pinned, as the design says.

#### D3, D4, D6
- D4: the outputService mock (chartTypeDefault.test.tsx:24-30) has no `getFilterCapabilities`, so the premise holds.
- D3 and D6 are unchanged from round 1, which already verified them.

### Verdict: REFUTE

The scroll-hint execution (CR2, CR4) and the line budget (CR3) are now sound. The remaining problems are precision defects in exactly the mechanism CR1 asked to make exact. As written, the binding D2 proof cannot pass on a correct implementation: block e lacks its closing brace, the host remnant gains it, and the claimed L1-903 union has three holes. An executor following D2 literally either reports a false defect or improvises ranges. The Risks section also still contradicts D5.

### Change Requests

1. **Fix the D1(e) range and the host-remnant boundary** (design.md Context "handlers L605-693 … ending L693 … render L695-903", D1(e) "L470-693", D2 "e L470-693 … L694-903"; tasks.md 2.3 "L470-693").
   - `handlePinToggle` closes at **L694**, L695 is blank, and render starts at **L696**.
   - Change e to **L470-694**, the handlers to **L605-694**, and the render/host remnant to **L695-903** (or L696-903 with L695 its own block).

2. **Make the D2 partition actually cover L1-903.**
   - Add the blank lines L122, L242 and L283 to a block (for example "separators L122, L242, L283 (blank)"), or extend the neighbouring ranges.
   - Have the transcript assert mechanically that the blocks are disjoint and that their union is 1..903, for example with a `seq 1 903` versus listed-ranges comparison. That way an off-by-one like CR1 fails the proof instead of being absorbed.

3. **Remove the stale Risks bullet** "[Inset shadow under opaque child backgrounds] → same trade-off as the existing horizontal fades; judged live".
   - Replace it with the D5 decision: overlay sibling above the children, plus the pixel-delta and click-through acceptance.
   - Two artifacts that disagree on whether the fade can be hidden is the ambiguity CR4 asked to close.

### Non-blocking notes

- D5 overlay CSS location is unspecified. If it goes in a new CSS file, `elevationTokenGuard.css.test.ts`'s "walks every CSS file (currently 132)" count must go to 133 with a HEL-1449 note. Putting it in `PanelDetailModal.binding.css` avoids that.
- D5 adds three new distinct inset values (top, bottom, combined), not one. DESIGN.md:342-343's "four distinct values" sentence should name the vertical family accurately, not as "a fifth member".
- D5: say whether the wrapper is `display:flex` with the default row direction (works, as analysed above) or a column. Either works with `min-height:0`; state it so the CSS is not guessed.
- D5: the overlay covers the form's scrollbar strip. With `pointer-events:none` this is harmless, but check it in the 1280×720 screenshots that the fade does not visually smear the scrollbar thumb in dark mode.
- Test 6.2: stub `scrollHeight`/`clientHeight` before toggling to edit (prototype or `defineProperty` on `HTMLFormElement.prototype`). The `useLayoutEffect` measure runs at EditFormScrollArea mount, before any per-element ref stub.
- Spec scenario "Content height changes" depends on the child ResizeObserver catching the change. A form child that mounts after EditFormScrollArea (a fragment-returning editor) is not observed. The design's "verify live, fix in hook red-first" covers this. Make sure 4.3 includes an async-loaded Controls section (capabilities/outputs fetch resolving after mount).
