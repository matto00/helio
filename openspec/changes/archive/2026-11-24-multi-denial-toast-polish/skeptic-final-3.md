## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD ded407461e2e2e86030bd43a3da85c38dc7e75cf. The base was resolved live with `resolve-review-base.sh`: 8abb826b745e81afc13419ea26772c71faf0652a (origin/main).

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/multi-denial-toast-polish/HEL-1840`.

- **Diff read in full** (`git diff BASE...HEAD -- frontend/`). The product changes are:
  - `deniedPipelinesToast.ts`: the sort is now `Intl.Collator("en",{numeric:true})` on name, with `pipelineId` as the tie-break. The message is built from the same sorted array.
  - `Toast.tsx`: a `toast--rows` class.
  - `ToastRowList.tsx`: a `.toast__list-frame` wrapper carrying `data-overflow-below`, driven by the existing `useScrollEdges`.
  - `toast.css`:
    - the icon offset for D2;
    - `scroll-padding-block-end`;
    - a `::after` fade, now paired with `box-shadow: inset 0 -12px 12px -12px color-mix(in srgb, var(--app-text) 35%, transparent)`. This is byte-identical to the HEL-1449 sibling cue at `PanelDetailModal.css:54`, and is pinned in `elevationTokenGuard.css.test.ts`.
  - `max-height` is back to `min(40vh, 16rem)`: the 18rem tuning from round 2 was reverted. That was my round-2 CR1 ask.
  - The last commit (ded407461) touches only e2e seeding.

- **AC1 / HEL-1844 order.** The unit fixture has ids a1, b2, c3, d4, 0e, f6, g7, and the test expects the keys in the order b2, d4, 0e, c3, g7, f6, a1. An id sort would give 0e first, so the test is red under an id-order revert.
  - Tests also cover the same message for both input orders, and coalescing to one toast.
  - The e2e test's seed renames pipelines so that the id order is always the reverse of the name order. It asserts Tab order along the name order.
  - Live, the rows rendered in the order "alpha revenue, Beta churn, Gamma, Pipeline 2, Pipeline 10, Zeta weekly rollup by region". That is case-insensitive and numeric-aware.

- **AC2, alignment at 390px.** Measured live at 390x844: the icon top is at 508px and the first link top at 507px.
  - See `skeptic3-390x844-{dark,light}-6rows-page.png`.

- **AC3, overflow cue (my round-2 CR1).** Servers ran on 7272/10179 with the lane DB and an empty `ANTHROPIC_API_KEY`. I seeded 6 pipelines myself and looked at every screenshot. The cue is a visible band at the list's bottom edge in every state I tested:

  | Viewport | State | Where the clip lands | Cue visible? | Screenshot |
  | --- | --- | --- | --- | --- |
  | 1366x640, dark and light | 6 full rows | 2px into row 4 (the round 1/2 failure case) | yes | `skeptic3-1366x640-{dark,light}-6rows-toast.png` |
  | 1440x900, dark and light | after running the first 2 rows | mid row 4 | yes | `skeptic3-1440x900-{dark,light}-6rows-2run-toast.png` |
  | 1440x900, dark and light | scrollTop 116 | inside an inter-row gap (row 5 ends at 254, row 6 starts at 262, the cap is 256) | yes | `skeptic3-1440x900-{dark,light}-gapclip-toast.png` |
  | 390x844, dark and light | 6 rows | mid row 3 | yes | `skeptic3-390x844-{dark,light}-6rows-page.png` |

  - All screenshots are in `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/`, which is outside the worktree and so already durable. These are content screenshots; no claim here rests on mtime.
  - Scrolled to the end, `data-overflow-below` is null and the `::after` content is `none`.
  - A list that fits shows no cue. This is covered by the e2e test "1280px: a list that fits shows no fade" and by the unit test.

- **Gates, run fresh by me on ded407461:**
  - jest (3 workers) on ToastRowList, deniedPipelinesToast, elevationTokenGuard and Toast: 8 suites, 81 tests passed.
  - `npm run typecheck`: clean.
  - eslint (`--max-warnings=0`) on the 6 changed frontend files: exit 0.
  - The full `e2e/hel1172-multi-denial-toast.spec.ts` at `--workers=2` on the lane DB: **16 passed (1.9m)**, exit 0. The teardown deleted 19 users. Output is in `/home/matt/Development/helio/.concertino/scratch/HEL-1840/skeptic3-e2e.txt`.

- **Gate chain.** `evaluation-4.md` covers HEAD ded407461 (PASS), which clears my round-2 CR2. Note that this file is untracked in the worktree: it needs committing with the delivery.

- **Design judgment (DESIGN.md).**
  - The cue reuses the sibling HEL-1449 scroll-edge treatment and the surface token for the fade, with no hardcoded colour. It reads in both themes: a darker band in light, a lighter band in dark.
  - The rows' spacing and typography are unchanged.
  - No row paints over the toast border.

- **Cleanup.**
  - My throwaway user `f8c3cf44-36b1-4d39-bfaa-7b1105e151d6` was deleted by exact id and email via `buildUserDeleteSql` (`COMMIT`), and a follow-up count is 0.
  - Servers were stopped with `stop-servers.sh` (`STOPPED ports=7272,10179`).
  - The browser was left on about:blank.

### Verdict: CONFIRM

### Non-blocking notes
- The edge band spans the list frame only, so it stops about 45px short of the card's right edge (beside the close-button column). It aligns with the content column and reads as intentional. A full-width band would need the frame to extend under the close column.
- The e2e cue assertion checks computed style (an inset shadow distinct from the surface), not painted pixels. Evaluator-3's pixel diff and my screenshots cover the painted result.
- The pre-existing mid-scroll underline sliver at the list's top edge is still there (noted in round 1). It is not introduced by this change.
- At 390px, after an Enter submit, the form showed "Note is required" next to "The row was added." The form-panel code is not in this diff, so this is pre-existing and out of scope. It may be worth a separate look.
