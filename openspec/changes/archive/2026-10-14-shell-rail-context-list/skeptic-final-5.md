## Skeptic Report — final gate (round 5, skeptic-final-5.md)

Reviewed HEAD `0cd7d5e6979587a267e3e62af1129c1ff6f06b54` (cycle 6 `20147a5c3` plus evaluation-6.md).

This review stayed inside the owner's bounded scope, items (a) to (c).

- **Spawn guard:** `READY ambient=/home/matt/Development/helio branch=feature/shell-rail-context-list/HEL-1574`.
- **Review base:** resolved live with `resolve-review-base.sh` (exit 0) to `c5cc7eeeed83d296ebf33a5bc576d6e0bb2883b0` (163 files changed).
- **Cycle-6 diff (`git diff a78f5987e 20147a5c3`):** CSS only, plus one e2e case and the round-4 report.
  - `PipelineListTable.css` and `SourceListTable.css` set `container-type: inline-size` on the scroller.
  - Each `__extra-cell > *` gets `position: sticky; left: var(--space-3); max-width: calc(100cqw - 2 * var(--space-3))`.
  - The Pipelines file adds `.pipeline-list-table__share-btn + .pipeline-list-table__delete-btn { margin-left: var(--space-2) }`.

Durable evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/.skeptic-r5/`

### What I verified (with evidence)

**Test data**
- I tested against a throwaway user: `skeptic-hel1574-r5-1792011504@example.test`, id `be77750a-4c42-44c8-859a-513a8160fa11`. It owned 20 static sources and 12 pipelines; each of sources 00–11 is the root of one pipeline.
- Afterwards I deleted the user by exact id and email with `userCleanupCore.buildUserDeleteSql` (COMMIT).
- Post-check: 0 users, 0 of the 20 source ids and 0 of the 12 pipeline ids remain. The dev account was never touched.

**(a) Round-4 CR1, the Share/Delete gap: FIXED.**
- `Delete.left − Share.right` is 8px at 1280, at 820 (list 400), at 768 and at 375.
- The two buttons sit on the same top line, and Delete stays right-aligned in its cell (right edge 1248 against a cell right of 1256 with 8px padding).
- Evidence: `pipelines-1280-light-confirm.png`, `pipelines-768-dark-confirm.png`, `pipelines-820-light-list400-scrolled-confirm.png`.

**(a) Round-4 CR2, the confirm staying in view when the table is scrolled sideways: FIXED for the case it named.**

| Viewport | Page | Scroller | `scrollLeft` | Group rect | Visible text |
|---|---|---|---|---|---|
| 375, light | Pipelines | 24–351 | 364 | x 32–335 | Label begins "Delete R5 Pipeline 6 With A…" at x 32 |
| 820, list at 400, dark | Pipelines | 480–796 | 387 | 488–780 | Full name, both buttons |
| 820, list at 400, light | Pipelines | (as dark) | (as dark) | (as dark) | Full name, both buttons |
| 375, dark | Sources | — | — | 30–333 | Full name, both buttons |
| 1280 | both | — | — | — | Table fits, confirm on one line |
| 768, dark | Pipelines | — | — | — | Fits and reads cleanly |

- At 375 light the buttons sit at 216–335. Evidence: `pipelines-375-light-scrolled-confirm.png`.
- Evidence for the other rows: `pipelines-820-light-list400-scrolled-confirm.png`, `sources-375-dark-scrolled-confirm.png`, `pipelines-1280-light-confirm.png`, `pipelines-768-dark-confirm.png`.

**(b) `container-type: inline-size` and table layout: no effect.**
- I read every `<th>` width with the property on, then with an inline `container-type: normal` override. The results were identical, and so was `scrollWidth`:
  - Pipelines at 1280: `[189,192,80,108,114,115,130]`.
  - Pipelines at 820/400: `[69,84,80,108,114,119,130]`, `scrollWidth` 704.
  - Pipelines at 768 and 375.
  - Sources at 820/400: `[82,44,51,44,44,51]`.
- The scroller never collapsed. Its `clientWidth` equals the parent's width in every case: 928, 316, 720 and 327.

**(b) Cascade.**
- The sticky rule also reaches the 409 notice. At 1280 dark, Sources "R5 Source 05" returned a 409.
  - The notice rendered as the very next `<tr>` after that row, with computed `position: sticky`, inside the scroller (x 492–1244).
  - It listed "R5 Pipeline 6 … (pipeline, root)", and focus returned to "Delete R5 Source 05 …". Evidence: `sources-1280-dark-409.png`.
- At 375 the Delete `::after` is still 44px tall (the expander) and spans only the button's own 54.6px width. With the 8px gap, the expander cannot overlap Share.
- The secondary-at-rest recipe is unchanged in dark: border `rgba(242,239,233,0.09)`, text `rgb(170,164,156)`.

**(c) Earlier fixes.**
- **Focus return on Cancel:** holds. After Cancel, the active element was "Delete R5 Pipeline 1 …" and "Delete R5 Source 00 …".
- **409 placement:** holds (above).
- **Button recipe and 44px expander:** hold (above).
- **Double-click at 375 on the last row (phone shell):** holds. URL stayed `/pipelines`, one confirm opened, `scrollTop` stayed 1000.
- **Double-click and scroll position on the last row at 820 with the list at 400: REGRESSED by this diff.** See CR 1.

**Gates.** Cycle 6 is CSS plus one e2e case, so jest, typecheck and backend are unaffected. I relied on evaluation-6's pasted Playwright result (294 passed, including the new 375 case). Its double-click probe (line 65) was at 375 and on a non-last row only, so it did not exercise the regressed path.

### Verdict: REFUTE

### Change Requests

1. **At 820 with the context list at 400, a double-click on the last row's Delete in Pipelines now opens the pipeline's detail page instead of the confirm. Cycle 6's width bound caused this.**
   - **Scope.** This is item (c) of the scope: "the double-click lands on the clicked row" and "the scroll position is kept on the last row". The configuration is the owner-specified 820 with the list at 400.
   - **Steps.** Dark theme, `/pipelines`, `.app-content` scrolled to the bottom (`scrollTop` 924, the maximum), table scrolled right. Then a real double-click on "Delete R5 Pipeline 1 With A Fairly Long Name" (the last row).
   - **Result.** The page navigated to `/pipelines/c1013397-…`. I reproduced this twice (stable).
   - **Mechanism, measured on a single click.**
     - `max-width: calc(100cqw - 2 * var(--space-3))` bounds the confirm to the 316px scroller, so its label wraps to 5 lines. The group is 77px tall (y 723–800).
     - `focusOnMount` focuses the group, and the browser scrolls `.app-content` from 924 to 949 to reveal it.
     - The clicked row's Delete moves up 25px (top 660.5 to 635.5).
     - The second click therefore lands below the button but still inside the row's actions `<td>`. `handleRowClick` (`PipelineListTable.tsx:133-137`) skips only `a, button` targets, so it navigates.
     - Evidence: `pipelines-820-dark-list400-lastrow-confirm.png`. It shows the row shifted and the 5-line confirm flush with the viewport bottom.
   - **A/B proof that cycle 6 caused it.** On the same page and state, I injected only the pre-diff values:
     - `container-type: normal`, `position: static`, `max-width: none` and `margin-left: 0`.
     - The confirm went back to 2 lines (y 748–780). `scrollTop` stayed 924, Delete stayed at 660.5, the double-click left one confirm open, and the URL stayed `/pipelines`.
     - Reproduced twice.
   - **The same failure on Sources predates this diff.** At 820/400 the Sources table barely overflows, and its confirm already wrapped before cycle 6. The navigation also happens there with the pre-diff override, on "R5 Source 00" (row shifts 36px; `sources-820-dark-list400-lastrow-confirm.png`).
   - **Fix.** Fix it for both tables, since it is one mechanism. Whatever the confirm's height, the second click of a double-click on a row's Delete must never navigate. Either of these would do it:
     - (i) `handleRowClick` in `PipelineListTable.tsx` and `SourceListTable.tsx` also ignores clicks inside the actions cell, and/or clicks with `event.detail > 1`.
     - (ii) Reveal the confirm without moving the clicked row under the pointer.
     - Keep the round-4 CR2 sticky/bounded behaviour. Do not undo it.
   - **Regression test.** Add an e2e case at 820 × 800 with the list at 400 (`End` on the separator). Scroll `.app-content` to the bottom and the table to its end, then `dblclick` the last row's Delete on `/pipelines` and on `/sources`.
     - Assert that the URL is unchanged and exactly one `Confirm delete <name>` group exists.
     - It must fail on today's HEAD. I measured it failing on both pages.

### Non-blocking notes (follow-ups, outside the CR)
- **Inset differs between the two tables.** On Sources, `.source-list-table td { padding: var(--space-2) }` (specificity 0,1,1) overrides `.source-list-table__extra-cell`'s padding (0,1,0). The cell padding is therefore 8px, not the declared `--space-3 --space-4`, and the sticky `left: --space-3` then insets the content 12px. Pipelines' extra cell gets its declared 16px. The cascade predates cycle 6 (cycle 5); this is cosmetic.
- **Stale comment.** `SourceListTable.css:112` still says "an error-toned text button; the confirm is the page's." (carried from round 4).
- **Pre-existing squeeze.** At 820/400 and at 375 the Sources table is crushed: names wrap to 5 lines and "Updated" wraps. This is pre-existing, already noted in round 4, and HEL-1582 territory.
- **No gate defect.** No report I drew on disclosed unsound evidence mtimes, and nothing here rests on mtime ordering. Every claim is a live `getBoundingClientRect`, computed-style or URL reading, reproduced at least twice where it is load-bearing.
- **Housekeeping.**
  - The theme was set through localStorage only.
  - Servers were stopped with `stop-servers.sh` (`STOPPED ports=7006,9913`), and the browser is closed.
  - Playwright MCP initially wrote the screenshots under the main checkout's `skeptic-r5/`. They were moved and persisted, and that directory was removed.
