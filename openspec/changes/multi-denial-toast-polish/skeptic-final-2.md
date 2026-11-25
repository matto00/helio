## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD 52a03d14192e523e80d02967c4cdfff431dc13ab. Base resolved live with `resolve-review-base.sh`: b2da43a3d02ba1b84eb8296b9bd9ed742623a353. The branch has 3 commits.

### What I verified (with evidence)

- **Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/multi-denial-toast-polish/HEL-1840`.
- **Diff read in full.** The round-2 delta (52a03d141) changes only two things:
  - `.toast__list` `max-height` goes from `min(40vh, 16rem)` to `min(40vh, 18rem)`. The phone/coarse block re-pins it to 16rem.
  - One new e2e test at `e2e/hel1172-multi-denial-toast.spec.ts:371-414`. It runs at 1440x900 only, with 5 rows that each have one reason and a "Run to update" action.
- **Unchanged since round 1, and still sound:**
  - Name-then-id order (an `Intl.Collator`, with a unit test whose fixture is red under an id sort).
  - D2 icon alignment.
  - The `useScrollEdges` wiring.
  - My round-1 verification of the first two ACs stands. Their code did not change.
- **Gate-chain note.** `workflow-state.md` gives `LAST_EVAL_REPORT` as `evaluation-2.md`, and that report covers HEAD 41da8a28a. No evaluator report covers 52a03d141. The executor's `green-e2e.txt` shows the new test passing at 1440x900 (`visibleOfCutRow: 34.4375`). The committed red run shows it failing at 16rem (`2.4375`).
- **Live measurement.** Servers ran on 7272/10179 with the lane DB and an empty `ANTHROPIC_API_KEY`. I seeded 6 pipelines (one `steps-above-bound` reason each) and submitted the form once. A probe measured `.toast__list`'s box against each `.toast__list-item`. All rows are 75px tall with an 83.2px pitch, starting at y=4.

  | Viewport | Rows | List max-height | Visible part of the first clipped row | Cue reads? | Screenshot |
  | --- | --- | --- | --- | --- | --- |
  | 1440x900 dark | 6 full rows | 288px | 34.4px ("Pipeline 10" peeks) | yes | `skeptic2-1440x900-dark-6rows-toast.png` |
  | 1366x657 dark | 6 full rows | 262.8px | 9.2px (a faint sliver) | barely | `skeptic2-1366x657-dark-6rows-toast.png` |
  | **1366x640 dark** | 6 full rows | 256px | **2.4px: identical to round 1's defect** | **no** | `skeptic2-1366x640-dark-6rows-toast.png` |
  | **1440x900 dark and light** | after "Run to update" on the first 2 rows (54px each, no action) | 288px | **0px: row 4 ends at 287, row 5 starts at 295** | **no** | `skeptic2-1440x900-{dark,light}-6rows-2run-toast.png` |
  | 390x844 light | after 2 runs | 256px | 67px (text dissolves mid-line) | yes | `skeptic2-390x844-light-6rows-2run-toast.png` |

  All screenshots are in `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/` (a durable location outside the worktree). Each one is a content screenshot I looked at. None of this relies on mtime ordering.

- **The failure follows from the geometry, so it is not a one-off reading.**
  - Row 4's top sits at 254px, which puts the 288px cap 34px into row 4. That only holds while `40vh ≥ 288`, i.e. a viewport at least 720px tall.
  - For a viewport 612–664px tall, the cap falls in the 245–266px range. There the clip lands in the gap after row 3, or ≤12px into row 4 under a 24px fade that is nearly opaque at its bottom.
  - Typical 1366x768 and 1280x720 laptops have browser viewports of about 610–660px, which is inside that band.
  - The 2-run failure is just as deterministic: two 54px rows shift every later row up by 42px, and row 4's bottom (287) lands 1px above the cap.
  - Both failures look exactly like round 1's (`skeptic-final-1.md` CR1): complete rows and a dimmed last "Run to update", with nothing to say more rows are below.
- **Cleanup.**
  - Servers stopped with `stop-servers.sh` (`STOPPED ports=7272,10179`).
  - Throwaway user `6604ba27-7616-4356-b69f-325c4aa0bf72` deleted by exact id and email through `buildUserDeleteSql` (`COMMIT`). A follow-up count returns 0.
  - The browser was left on about:blank.

### Verdict: REFUTE

### Change Requests

1. **The desktop overflow cue still depends on one row geometry. It fails in two realistic states, so HEL-1840 AC3 ("an overflowing list shows a cue") is not met robustly.**
   - **Where:** `frontend/src/shared/ui/toast.css` — the `.toast__list` `max-height: min(40vh, 18rem)` change and the `.toast__list-frame[data-overflow-below="true"]::after` fade.
   - **What the 18rem change does:** it moves the clip so that it cuts through row 4 for one geometry only: every row at 75px, and a viewport at least 720px tall.
   - **Where it fails:** the cue disappears again (0–2.4px of the next row, under a fade that hides it) in two cases:
     - (a) A 1366x640 viewport, which matches 1366x768 and 1280x720 laptops. See `skeptic2-1366x640-dark-6rows-toast.png`.
     - (b) 1440x900 after the user presses "Run to update" on two rows. Those rows lose their action and shrink to 54px. See `skeptic2-1440x900-{dark,light}-6rows-2run-toast.png`, where two hidden rows give no sign at all.
   - **Why (b) matters most:** pressing "Run to update" is the toast's own primary interaction, so this is not an edge case.
   - **Scope:** changing max-height is in scope in principle, because it serves AC3. But tuning a height to one row pitch is not a fix: the clip position depends on row height, which varies with reason count, name wrap and action presence, and on viewport height.
   - **Required fix:** make the cue independent of where the clip lands. One option is a fade or edge treatment that is visible even when the clip falls in an inter-row gap. Examples:
     - Pair the fade with a bottom-edge inset shadow or rule. This is the sibling scroll cue in `PanelDetailModal.css` (HEL-1449), which design D3 already named as the cohesion reference.
     - A fade band tall enough to always cover the visible content of the last row.
   - **Revert decision:** decide whether 18rem is still needed once the cue is geometry-independent. Revert to 16rem if it is not, so the desktop list height does not change for no reason (design Non-Goal: "changing desktop toast layout beyond the cue").
   - **Acceptance:**
     - e2e at desktop width, in both themes, for at least these states: 1366x640 with 5+ full rows; and 1440x900 after running the first two rows.
     - In each state, assert something that holds whatever the clip position is. For example, the cue's painted band or edge is present and visibly distinct from the card surface where the list is clipped.
     - Asserting that "≥12px of the next row shows" is not enough: it is true only for the tuned geometry.
     - Screenshots of those states go to the evidence directory.
   - **Keep these unchanged:** the 390px focus-clear-of-fade test, `scroll-padding-block-end`, and no row painted over the toast border.

2. **Have the evaluator cover the CR1 commit.** `LAST_EVAL_REPORT` is `evaluation-2.md`, which reviewed 41da8a28a. Commit 52a03d141 (and its successor) goes to final without an evaluator report on its HEAD.

### Non-blocking notes

- The phone layout is more forgiving: a 28px row gap plus 16px padding, and the measured 2-run state cuts mid-text. A shared geometry-independent cue would still remove the same latent fragility there. For example, a short viewport where `40vh < 256px` could land the clip in a gap.
- Round 1's non-blocking notes still apply (the icon-vs-close offset at 390px; the mid-scroll underline sliver that also appears before the change).
- No gate defect regarding mtimes: no report I drilled into rests on mtime ordering.
