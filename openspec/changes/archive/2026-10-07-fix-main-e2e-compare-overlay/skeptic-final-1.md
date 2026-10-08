## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 12cb8f22403d29216726b27fbcb87a5b85588cf4. Diff base resolved live by `resolve-review-base.sh`: e4289e6c88e4d8d0c174b94f1359817fe0466514. That equals `git ls-remote origin main` right now, so the branch contains current origin/main.

### What I verified (with evidence)

**hel1350: does the fix address CI's actual failure? Yes. The proof is the DOM in CI's own trace, not inference.**
- I parsed CI trace `art1350/tr/1-trace.trace` (run 37703155327) myself:
  - call@82, the Compare click: `element is not stable`, then `retrying click action`, then scroll, then click done.
  - call@86, the "7 days" click: 273 loops of `element is outside of the viewport` until the timeout.
- The `after@call@82` frame snapshot in that CI trace holds the listbox's own inline style: `top: 801px; left: 398px; min-width: 644px;`. Main's Select places the panel at `trigger.bottom + 4`, so CI's trigger bottom was 797px.
- I reproduced the spec's forced placement in the live app. After `scrollIntoView({block:"end"})`, the trigger rect is exactly 765..797. That is the same geometry as CI, and it matches the `fitSelectPanel({top:765,bottom:797},180,900)` unit case.
- Main's panel would therefore run from 801 to 981. That matches the red log's `Received: 981` (`hel1350-red-main-2.log`). Option 4, "7 days", lands past 900, and a `position: fixed` element cannot be scrolled into view, which explains the infinite retry.
- So the new viewport assertion is red on the same geometry CI hit. It is not a different, synthetic failure. The unmodified spec passing locally only means local layout did not land the trigger at the bottom; the spec now forces that. C2 is satisfied: red log plus traces (`red-new-spec-main-select/*/trace.zip`), green log, and evidencePath screenshots in both themes.
- Fresh run, by me, of both specs at `TZ=UTC`, `--workers=1`, `nice -n 19`, pinned `DEV_PORT=6805`: 4 passed, exit 0. Ref: `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/logs/skeptic-final-e2e-utc.log`.

**Select change: is it safe for the other consumers? Yes, with evidence.**
- 49 non-test files render `<Select`. `grep` finds no other CSS or TS touching `.ui-select__panel`, and no e2e that asserts the listbox position other than hel1350.
- **Geometry is exact.** `theme.css:300` sets `* { box-sizing: border-box }`, so `scrollHeight + (offsetHeight - clientHeight)` is the border-box height. Live check on Chart type, a below-placement trigger at 345..377: the panel opens at 381 (`+4`, unchanged from main), with `max-height: 146px`, `scrollHeight 144 == clientHeight 144`. There is no spurious internal scrollbar.
- **Scroll re-fit works.** I opened Compare mid-sheet (panel below at 472), then scrolled the trigger to the bottom while it was open. The panel re-fit and flipped to 581..761 above the 765 trigger.
- **Re-renders do not undo the fit.** Hover plus ArrowUp re-rendered the panel (focused option changed). Top stayed 581 and the inline style was unchanged. React only rewrites `top` when the `panelPos` prop changes, and every such change re-runs the layout effect.
- **jsdom is unaffected.** It is guarded by `scrollHeight === 0`. Jest: 463/463 suites, 4892/4892 tests; plus a 39-suite `shared/ui|chartAppearance|Select` subset, 378/378.
- **No interaction with the horizontal clamp.** `usePortalPopover`'s clamp only runs for `right`-anchored panels, and Select is `left`-anchored.
- **Dialog portal path is unchanged.** It uses the same viewport-coordinate assumption as before.

**hel1351 / C1**
- The assertion is scoped to `.chart-tooltip`, a class added via the ECharts `tooltip.className`, with a unit test for it.
- It pins the east category (`^east`) and checks the value/baseline pair with digit lookarounds: `(?<!\d)15(?!\d)`, `(?<!\d)11(?!\d)`.
- The mutation logs read: wrong value (10) red against `"eastsum(amount)15vs 7d11"`, and value-7/date-leak red.
- The old-assertion logs prove the date dependence. Under LA the match was the `7` in `Updated 10/7/2026`; under UTC (`Updated 10/8/2026`) it was null. The seed is backdated relative to now, so the tooltip content itself is not date-dependent.

**Gates (fresh, nice -n 19, 3 workers):** lint 0, typecheck 0, format:check 0, Jest as above.

**UI judgment**
- I looked at the screenshots: `compare-listbox-open-{light,dark}.png`, plus my own dark-theme capture after scroll (ref `/home/matt/Development/helio/.concertino/runs/HEL-1373/evidence/e2e-evidence/HEL-1373/skeptic-final-flipped-after-scroll.png`).
- The flipped panel keeps a 4px gap to the trigger. It uses the same tokens, border and shadow, and does not collide with the footer or the field above.
- Light and dark match. No new tokens or one-offs were added.
- The only console error is a pre-existing `404 /schedule` (no schedule set).

**AC trace**
- AC1: CI trace analysis above, plus `root-cause.md`. Bisection was skipped, but the trace evidence is enough on its own.
- AC2: TZ logs.
- AC3: the hel1351 assertion is strictly stronger. hel1350 only adds assertions.
- AC4: classified as HEL-1215 (evaluator verified the Linear match; PanelCard imports neither changed module).
- AC5: **not yet verifiable.** There is no PR and no remote branch (`gh pr list` and `git ls-remote` are both empty). See the notes.

### Verdict: CONFIRM

### Non-blocking notes
- `tasks.md` 4.2 ("All 4 CI e2e legs green on the PR") is ticked `[x]`, but no PR or pushed branch exists. That claim is false today. AC5 must actually be measured, all 4 legs green on a head that contains origin/main, before merge. Untick it, or tick it only after CI.
- The hel1350 placement poll hard-codes `y > 700`. A future sheet whose scroll area ends above 700px would make the poll time out and hide the real cause. Deriving the threshold from the viewport and the panel height would be sturdier.
- The fit is not re-run when `options` change while the panel is open. No current consumer does that, and the effect would only be cosmetic (a flipped panel keeps its top).
- The folder name `red-unmodified-main/` holds a passing run (the evaluator noted this too).
- When the mouse hovers one option and the keyboard focuses another, two rows highlight at once. This predates the change and is unrelated.
