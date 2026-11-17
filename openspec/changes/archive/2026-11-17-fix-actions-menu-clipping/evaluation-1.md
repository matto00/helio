## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: 304e7a7c3304d7776375d1b54785d792e4866d54 (base 2e98eba9287d61a47957129f1f097ea039125d92, resolved live).

### Phase 1: Spec Review — FAIL

Verified:
- AC1 (desktop): met. Live, mouse pointer, 1280x400, dark and light, last rail row: the panel flips above (`bottom: 36px; max-height: 165px`). All five items lie inside the viewport and each is the `elementFromPoint` hit at its own centre. Focus lands on Rename.
- AC1 (phone): the phone dashboard list has no row menu, so this part is met by absence (design gate). Phone menus I checked live: the step sheet at 390x844 opens below and fits; at 390x300 it is capped to 219px, scrolls inside, and the last item is hit.
- AC2 (probe-found cause): met. The cause is the one-shot `trigger.bottom + 8` with no collision handling, not a clipping ancestor. The fix is in the shared component, not a bigger container.
- AC3 (other menus): all 13 call sites are listed. My grep found exactly 13 production `<ActionsMenu` users. Other popovers are listed for a follow-up.
- AC4 (red-first e2e with `elementFromPoint`): met for the desktop case (see Phase 2 CR2 for what it actually measures).
- HEL-719 `align` tests and every other existing test in `ActionsMenu.test.tsx` are unmodified. The diff is a pure append after line 193. `selectPanelFit.test.ts` is not in the diff and passes.
- D2/D2a: `fitPanelVertically` uses Select's rule verbatim for `prefer: "below"`. The new no-layout branch (natural 0 gives the preferred side, `Infinity` height) cannot reach Select, because `Select.tsx:148` returns early on `scrollHeight === 0`. Anchoring is `top` when the menu opens below and `bottom` when it opens above.

Issues:
1. **The phone deviation is technically justified, but the planning artifacts were not amended.**
   - SpineOutputs' menu has exactly one item ("History", `SpineOutputs.tsx:80-86`). Its trigger must sit above the 68px bottom nav to be tappable. Even at the lowest tappable point, about 776px, the menu ends at 776 + 8 + 54 = 838, which is still under 844. So the Output menu cannot go red. Choosing a multi-item phone menu was correct.
   - However, `specs/actions-menu-viewport-fit/spec.md` still has the scenario "Pipeline Output menu near the bottom of a phone viewport" at 390x844. Its WHEN is effectively unreachable and no test covers it.
   - `tasks.md` 3.1 is ticked `[x]` but still says "phone pipeline Output ⋮ (SpineOutputs) at 390x844".
   - Design D8 names SpineStepRow as the only sanctioned alternative. The executor used MobileStepSheet at 390x300 instead, a size D8 never mentions.
   - The spec delta is what gets archived into `openspec/specs`, so a scenario describing a test that does not exist would ship as canonical spec. See CR1.
2. **D7 required a live probe of SidebarItemList; it was skipped.** files-modified.md marks it "not live-probed (needs assistant conversations)". D7 names it among the five sites that must be probed. See CR3.

### Phase 2: Code Review — FAIL

I ran every gate myself in WORKTREE_PATH:
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm --prefix frontend run build`: exit 0
- `npm test` (jest, 3 workers): 66 suites / 579 tests and 781 suites / 9553 tests, all pass
- `check:e2e-types`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`: clean
- `e2e/hel1750-actions-menu-viewport-fit.spec.ts` with `--repeat-each=3`: 6 of 6 pass

No backend change, so `sbt testFull` was not required.

Code quality: the fix is sound and reuses the hook's existing `place` mechanism (HEL-1668), as designed.
- Re-placement on resize uses `scrollHeight + chrome`, so it does not depend on an earlier cap. Checked live: opened capped at 180px tall, resized to 500, and the menu re-placed uncapped at 165px.
- The hook's horizontal clamp is a no-op after `place` clamps.
- Inline `maxHeight` and `visibility` are popover positioning, which DESIGN.md §1 sanctions.
- No `any`, no dead code, no TODOs.

Reds:
- The desktop e2e red (619 > 400, no hit) matches the orchestrator's independent probe on unchanged code (`premise-validation`). The phone red was 342 > 300.
- I checked the unit-test reds by reading the old code. The old code set `top = 353` and never `bottom`, never hid the panel, and never set `maxHeight`. So the flip, below, cap and hidden tests are genuinely red against it.
- The focus test is honestly labelled: it is red only against the intermediate state. The left-edge test is honestly labelled as a guard, red only under mutation.
- I did not re-run the reds against unfixed code (that would need a second worktree with servers). This rests on code reading plus the executor's recorded output.

Issues:
1. **The desktop e2e case does not measure the desktop (mouse) menu** (`e2e/hel1750-actions-menu-viewport-fit.spec.ts:61-62`).
   - `test.use({ hasTouch: true })` applies to the whole describe. The comment says "isMobile stays off so the 1280px case is unaffected". That is false: `hasTouch` makes `(pointer: coarse)` match.
   - Under coarse pointer, `ActionsMenu.css:107` makes every item 44px tall, and the `(hover: hover)` rules switch off.
   - Evidence: the executor's own green probe shows the desktop panel at 124-354 (230px, 44px items). The owner's mouse menu, which I measured live, is 165px with 31px items.
   - So the reported surface (desktop, mouse) is not what the desktop case exercises. See CR2.
2. Non-blocking: the unit test titled "opens below, uncapped, when it fits" (`ActionsMenu.test.tsx`, new block) asserts `maxHeight: 165px`. "Uncapped" means capped to the natural height. Consider renaming it.

### Phase 3: UI Review — PASS (with the e2e caveat above)

Servers: canonical `start-servers.sh` reused healthy servers on 7182/10089. I confirmed Vite serves this worktree's `panelFit.ts` and `placeActionsMenu`.

Live checks, all with mouse pointer unless noted:
- **Desktop 1280x400, dark and light, last rail row:** flipped above, all items hit, focus on the first item.
  - Dark: `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval-desktop-dark-flipped.png`
  - Light: `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval-desktop-light-flipped.png`
- **Room below** (dashboard meta ⋮ at the top right): opens at `top: trigger.bottom + 8` exactly as before.
- **No side has room** (1280x180, middle row): capped to 62px below. The menu scrolls inside, and the focused last item is in view and hit.
- **Phone 390x844, light:** step-sheet menu opens below and fits; portalled inside the dialog, not clipped.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval-phone-light-stepsheet.png`
- **Phone 390x300, dark:** capped to 219px and scrolls; the last item is hit.
  - `/home/matt/Development/helio/.concertino/runs/HEL-1750/evidence/.concertino/scratch/HEL-1750/eval-phone-dark-capped.png`

Styling looks unchanged in both themes.
- Console: no errors from the menu. The one 404, `GET /api/pipelines/:id/schedule` for a pipeline with no schedule, is pre-existing and unrelated.
- Accessible names on the triggers are unchanged.
- Dev-DB residue: my evaluation user `101078e8-baf7-4346-b72f-ef0431a735c1` (with its dashboards, source and pipeline) was deleted by exact id through `buildUserDeleteSql`. `/api/auth/me` now returns 401. e2e users were removed by the harness teardown.

### Overall: FAIL

### Change Requests
1. **Amend the planning artifacts to match the phone case that was built.**
   - In `specs/actions-menu-viewport-fit/spec.md`, replace the scenario "Pipeline Output menu near the bottom of a phone viewport" with the case actually tested. For example: "Multi-item touch menu in a short phone-width viewport — WHEN the user opens the step sheet's Step actions ⋮ in a 390x300 viewport where no side holds the menu, THEN it is capped, scrolls inside, and the last item lies inside the viewport and is the `elementFromPoint` hit at its centre."
   - Keep the requirement's intent ("touch-sized menu fits on a phone").
   - In `design.md` D8 (phone bullet), state why SpineOutputs cannot breach: one item, and the trigger must sit above the 68px bottom nav, with the 838 ≤ 844 arithmetic. Name MobileStepSheet at 390x300 as the case used.
   - Reword `tasks.md` 3.1 to match.
2. **Make the desktop e2e case measure the mouse-pointer menu.**
   - In `e2e/hel1750-actions-menu-viewport-fit.spec.ts`, move `test.use({ hasTouch: true })` into a nested `test.describe` that wraps only the phone test, so the desktop test runs with a fine pointer.
   - Delete or correct the false comment at line 61.
   - The desktop case must stay red against unfixed code. With 165px menus at 1280x400 and the last row scrolled to the end, the trigger at about y = 357 still gives 365 + 165 > 400. Re-confirm the red, for example by temporarily reverting `ActionsMenu.tsx`, and record it in files-modified.md.
3. **Probe SidebarItemList live, as D7 requires.**
   - Seed enough assistant conversations through the API to make the list's last row sit low. If creating a conversation needs a live model call, say so in files-modified.md and say what was probed instead.
   - Record the result (last item inside the viewport and hit) in the call-site audit table.

### Non-blocking Suggestions
- The `8` margin is now defined in three places: `VIEWPORT_MARGIN` in `panelFit.ts`, `VIEWPORT_MARGIN` in `ActionsMenu.tsx`, and `usePortalPopover.ts`. Consider exporting one constant.
- The spec says "8px margin from the left and right viewport edges". `placeActionsMenu` clamps only the left. A trigger closer than 8px to the right edge would put the menu under 8px from it, which matches today's behaviour. Either clamp `right >= 8` or reword the spec to "aligned to the trigger's right edge".
- In the phone e2e, the final `tap()` on the last item has no follow-up assertion. Asserting its effect (for example the add-output UI appearing) would prove the click landed, not just the hit-test.
- Rename the unit test "opens below, uncapped, when it fits".
