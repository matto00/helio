## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD 41da8a28a6bd745421bdc7fce2da6b06441f0a63. The base was resolved live (`resolve-review-base.sh`) as b2da43a3d02ba1b84eb8296b9bd9ed742623a353. The branch has 2 commits.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/multi-denial-toast-polish/HEL-1840`.
- **The diff, read in full** (frontend): `deniedPipelinesToast.ts` sorts with an `Intl.Collator("en",{numeric:true})` on name, then `pipelineId.localeCompare`. One sorted array drives both `items` and `message`. `Toast.tsx` adds `toast--rows`. `ToastRowList.tsx` wraps the list in `div.toast__list-frame` and drives `data-overflow-below` from the shared `useScrollEdges().bottom`. `toast.css` adds the icon offset, the `::after` fade (`var(--space-6)`, gradient to `--app-surface-strong`) and `scroll-padding-block-end`. All values are tokens, and the fade reuses the surface-gradient technique already used in `PanelContent.css`, `MarkdownPanel.css` and `CollectionRenderer.css`.
- **Gates (my own fresh runs):**
  - `npm ci` exited 0.
  - jest with 3 workers, filtered to `deniedPipelinesToast|ToastRowList|Toast.test|useScrollEdges|toastsSlice`: 7 suites, 80 tests passed, exit 0.
  - `lint`, `typecheck` and `format:check` all exited 0.
  - Outputs are in `/home/matt/Development/helio/.concertino/scratch/HEL-1840/skeptic-{jest,static}.txt`.
- **AC: order by name, then id, with a test (HEL-1840 item 1, HEL-1844).**
  - The unit fixture uses ids that sort differently from the names, mixes case and numerals, and has two "Gamma" names (expected `b2,d4,0e,c3,g7,f6,a1`). Reverting to an id sort would give `0e,a1,b2,...`, so the test is red under that mutation by construction.
  - Message lines are asserted in row order. The same set in two input orders gives a byte-identical message and coalesces to one toast.
  - The e2e Tab-order test seeds ids in the reverse of name order (`idsOppositeToNames`).
  - **Live check:** 5 pipelines seeded on the lane DB gave the rows `alpha churn, Beta signups, Pipeline 2, Pipeline 10, Weekly revenue`. That is name order, case-insensitive and numeric-aware. **Met.**
- **AC: the first row aligns with the icon at 390px, in both themes.**
  - Live at 1440 the icon top is 612 and the link top is 611. Live at 390 dark the icon top is 508 and the link top is 507. Both match the single-message toast's -1 offset.
  - Before/after screenshots exist in both themes (`before-/after-390-{light,dark}-toast.png`). The before images show a 16px drop; the after images show the rows aligned.
  - The committed e2e output `green-e2e.txt` shows the D2 test passing at 390 light, 390 dark and 1280 light with `single=-1 multi=-1`. **Met.**
- **AC: an overflowing list shows a cue, and a list that fits shows none.**
  - Unit tests cover three cases: overflowing, fits, and scrolled to the end then back up.
  - e2e covers the overflow case at 390 in light and dark, and the fits case at 1280.
  - Live at 390 dark the cue reads well: the next row's name ("Pipeline 2") peeks through the fade (`skeptic-390-dark-5rows-toast.png`).
  - At desktop width it does not. See CR1.
- **Judgment: the icon sits about 15px below the close glyph at 390px in a multi-row toast.** I accept this (see the notes). The ticket asks for icon-to-first-row alignment. A close control pinned to the top-right corner is a conventional, independent anchor. The other option, pulling the list up, was rejected in design D2 for a real clipping reason.
- **Cleanup:**
  - Servers were stopped with `stop-servers.sh` (`STOPPED ports=7272,10179`).
  - The throwaway user `7a89d961-5010-4c7f-bda9-dca774711915` was deleted by exact id via `buildUserDeleteSql`, and a follow-up count of that id returns 0.
  - The browser was left on about:blank.

### Verdict: REFUTE

### Change Requests

1. **The desktop overflow cue does not show that more rows are below in the common case, and in dark theme it is close to invisible.** This affects `frontend/src/shared/ui/toast.css`, the `.toast__list-frame[data-overflow-below="true"]::after` rule and the `.toast__list` max-height.

   **What I reproduced live, 1440x900, 5 pipelines, one `steps-above-bound` reason each:**
   - Each row is 75px tall and rows are 8px apart (83px pitch). The list's visible height is `16rem` minus 4px of padding.
   - The clip therefore lands in the gap after row 3. Measured: frame bottom 863, row 3 bottom 853, row 4 top 861.
   - So nothing of row 4 peeks out. The 24px fade falls on row 3's "Run to update" link plus empty space.
   - The only visible result is that link losing about 32% of its ink. Mean ink difference against the card: 95 → 64 in dark and 126 → 85 in light, compared with an unfaded "Run to update" link in the rows above.
   - The result looks like three complete rows with a slightly dim last link, not like "more below". See `skeptic-1440-dark-5rows-toast.png` and `skeptic-1440-light-5rows-toast.png`.

   **Why this matters:**
   - The ticket's item 3 is exactly "nothing shows that more rows are below", and it asks for a cue that "stays legible in both themes".
   - On overlay-scrollbar platforms (macOS, GTK Firefox) the fade is the only cue.
   - The evaluator flagged the same faintness independently (evaluation-1 and evaluation-2 non-blocking notes).
   - The e2e suite covers the overflow cue only at 390px (`hel1172-multi-denial-toast.spec.ts:254`). Nothing verifies it at desktop width.

   **Fix:** make the cue perceptible at desktop width in both themes for this typical geometry. Two possible approaches:
   - Choose a max-height or fade that guarantees part of the next row is visible under the fade, as already happens at 390px.
   - Make the fade cover enough of the last visible content that it clearly reads as dissolving.

   Keep the existing constraints: the 390px Tab-stop-clear-of-fade test, `scroll-padding-block-end`, and no row painted over the toast border.

   **Acceptance:**
   - New screenshots at 1440 in light and dark of a 5-row, one-reason overflowing toast, saved to the evidence directory, where the cue is evident without side-by-side comparison.
   - An e2e assertion at desktop width that the overflow attribute is set, and that the fade's band overlaps some content of a row that is not fully visible. The point is to show content continuing, not just a dimmed complete row.

### Non-blocking notes

- At 390px the icon sits about 15px below the close glyph in multi-row toasts. This is acceptable: the icon now anchors to the content it labels, which is what the ticket asked for, and the close button stays a corner control. A single-message toast is unchanged.
- At 1440 the first-row alignment is exact (icon 612 vs link 611, the same -1 offset as the single-message toast).
- Partly scrolled at 390, a sliver of the previous row's link underline paints in the list's top padding above the icon. This also happens before the change (`before-390-dark-overflow-midscroll-toast.png`), so it is not a regression, and it stays inside the toast border.
- The evaluator noted that `red-focus-under-fade.txt` came from an earlier form of the predicate. The evaluator's runtime mutation covers that gap; I did not re-run it.
- No gate defect: none of the reports I drilled into rests on an mtime-ordering claim.
