## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `d5a52d1d2561307cd8c7f6c5a70f1ab757c1caf8`. The live review base, from `resolve-review-base.sh <wt> main origin` (exit 0), is `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9`, the merge base. `origin/main` has since moved one commit, to `14c08def8` (HEL-1699, CI and e2e harness only). This branch touches none of those files.

Persisted evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1685/evidence/.concertino/scratch/HEL-1685/`, written below as `EV/`.

### What I verified (with evidence)

**Scope, whole change**
- The diff `da39f0f14...HEAD` has 82 files.
- Paths outside the change dir: `comm -3` against `files-modified.md` is empty (67 paths, all listed explicitly, CON-260).
- No `.github/`, playwright config, global setup or shard files are in the diff.
- Round 1 traced items 4–14 and A–J to code and the running app at `9ad6e851b`. The only commit since then is `d5a52d1d2`. I read it in full:
  - the disclosure CSS;
  - the new e2e;
  - the `as RootState` cast removed;
  - the archived HEL-1631 D13 clause (`clearAuth`);
  - the DESIGN.md §10 carve-out, rewrapped. The text is unchanged and still matches the owner's `add-carveout` answer;
  - the evidence, files-modified and evaluation-2 records.

**Gates, re-run fresh**
- `npm run typecheck`: rc=0.
- `eslint usePipelineRunStream.ts --max-warnings=0`: rc=0. The removed cast does not break typing.
- `prettier --check` on DESIGN.md, the e2e spec and the CSS: clean.
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm --prefix frontend test -- --testPathPatterns=usePipelineRunStream`: 2/2 passed.

**(1) Full e2e on the dev project at this head**
- Command: `DEV_PORT=7117 BACKEND_PORT=10024 flock -w 3600 <e2e.lock> nice -n 19 npx playwright test --project=dev --workers=2`, against this worktree's servers (`assert-phase.sh servers` PASS).
- Result: **680 passed, 3 skipped, 1 failed (42.3 m)**.
  - The one failure is `hel1584-motion-surfaces.spec.ts:493`, which is on the driver's known-flake list. Its error was "animation clock ran… Timeout 5000ms".
  - The 3 skips are the same ones as in round 1.
- Rerun of that one test: **1 passed (8.7 s), rc=0**.
- The new addendum-G test (`hel1685-draft-polish.spec.ts:207`) passed inside the full run.
- Logs: `EV/skeptic-final-2-e2e-full.log` and `EV/skeptic-final-2-e2e-rerun-hel1584.log`. Originals are in `/home/matt/Development/helio/.concertino/scratch/HEL-1685/`.

**(3) The G red is real**
- In the running app (900x700, a filter step focused, Output open), I injected the pre-fix rules (`live-output max-height: min(40vh,280px)`, editor `flex-shrink:1; max-height:45%`). Then I measured the same quantities the e2e asserts.
- Old CSS: the editor's `scrollHeight` is 267 and its `clientHeight` 133, and the first condition row is clipped. The test's `scrollHeight <= clientHeight + 1` would fail.
- Shipped CSS: 267 and 267, and the row is not clipped.
- This matches the executor's recorded red at 900x800 (`Expected <= 161, Received 267`).
- So the red is real and the test discriminates. I did not edit any file. The revert was a style tag injected into the page, then removed, and the final measurement matched the shipped values again.

**(2) Disclosure judgment, running app, 3-step pipeline with 3 Outputs, filter step focused**

| Viewport | Build | Editor | Inner scroll | Preview card | Full data rows | Output section |
|---|---|---|---|---|---|---|
| 900x800 | shipped | 267 | no | 196 | 4 | 200 |
| 900x700 | shipped | 267 | no | 96 | **0** (grid 32 px: header + 8 px of row 1) | 200 |
| 900x700 | old CSS | 133 | yes, row clipped | 150 | 2 | 280 |
| 900x600 | shipped | 267 | no | **16** (heading cut) | 0 | 180 |
| 900x600 | old CSS | 106 | yes | 117 | – | 240 |
| 1024x768 (body 720, disclosure) | shipped | 199 | no | 232 | – | 200 |
| 1024x768 | old CSS | 163 | yes | 188 | – | 280 |
| 1280x800 (three columns) | shipped and old CSS | identical boxes (`same: true`) | | | | |

- Screenshots:
  - `EV/skeptic2-disclosure-900x700-dark.png`
  - `EV/skeptic2-disclosure-900x700-light.png`
  - `EV/skeptic2-disclosure-900x800-dark.png`
  - `EV/skeptic2-disclosure-900x600-dark.png`
  - `EV/skeptic2-1280x800-light.png`
- **Light/dark parity:** the light and dark layouts at 900x700 are identical. Tokens only, with no new colour or spacing values; the CSS uses existing `--space-*` and `--app-border-subtle`.
- **1280:** the rules are scoped to `[data-live-layout="disclosure"]`, and 1280x800 is the `column` layout with box-for-box identical geometry. Unchanged.
- **960–1100:** at 1024x768 the body is 720 px wide, so the page is in the disclosure layout (`THREE_COLUMN_MIN_WIDTH` 960 is measured on the body). It is therefore *not* unchanged: it is better on every measure (editor no longer scrolls; preview 188 → 232).
- **Did the fix just move the squeeze? At 900x700, yes. The step preview went from 2 full rows to 0.**
- **I still judge this acceptable, not a REFUTE:**
  - (a) I tested the obvious alternatives, and no allocation of 407 px of column fits all three elements. A 267 px editor plus a 2-row preview (about 150) plus any useful Output section does not fit. With an Output cap of `min(25vh,200px)` the preview gets 121 px and still only 1 full row. Something has to yield on a 700 px-tall window.
  - (b) The owner's complaint (addendum G) was that the *editor* got squeezed, and that is now fixed and guarded.
  - (c) The yielding element is a scrollable grid. The Output section is user-opened and collapses back: closed at 900x600, the preview is 157 px.
  - (d) While editing, the opened Output render is itself the live feedback on the draft.
  - (e) The executor disclosed the trade-off in evidence.md Cycle 3 ("the preview table takes the squeeze, about 100 px at 900x700").

**Cleanup**
- Seed (browser session account): source `85eec1f5-7ea0-40cc-a20f-5b47b1792506` and pipeline `8b76870a-6ab7-4827-8249-c6766930d85a`. Deleted by exact id (both 204).
- Its three Outputs now return 404, and the pipeline returns 404.
- `helio-theme` was restored to dark. No kept drafts remain.
- Servers were stopped with `stop-servers.sh` (`STOPPED ports=7117,10024`).
- Record: `EV/skeptic-final-2-seed-ids.txt`.

**Gate-defect check (CON-160):** no evidence here depends on mtime ordering. Every before/after claim is a same-session measurement pair.

### Verdict: CONFIRM

### Non-blocking notes
- **Preview yields to zero rows.** At 900x700 with the Output open, the step preview shows no complete data row (header plus an 8 px sliver). At 900x600 the preview card collapses to 16 px with its "Rows after step 1" heading cut mid-glyph. Two follow-ups are worth considering:
  - a `min-height` on `.step-preview` (at least its header), so the card never clips its own title;
  - an owner call on which element yields on windows 700 px tall or less (for example, collapsing the Output disclosure automatically below a height).
- **Stale comment.** `PipelineSpineLayout.css:64` ("A tall op editor … never pushes the table below ~8 rows") is no longer true in the disclosure layout, which now overrides it (lines 115-118). It is worth a one-clause update the next time the file is touched.
- **One-sided test.** The addendum-G e2e guards only the editor side. Nothing would catch the preview collapsing further, for example a taller editor at `max(45%, 290px)`.
