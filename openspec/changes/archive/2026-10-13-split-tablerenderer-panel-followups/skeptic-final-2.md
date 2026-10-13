## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `85e44e1840d73a35cbccf53f1c46fe0eb59c8b65` against the live-resolved base
`f63ab8365d2b0e6cac36154a83437b6d26b3a209` (`resolve-review-base.sh`, exit 0). Evidence paths are absolute under
`/home/matt/Development/helio/.concertino/runs/HEL-1449/evidence/` (my artifacts are prefixed `skeptic-final-2-`).

### What I verified (with evidence)

- **What changed since round 1.** `git diff --stat 1730daa1f HEAD` touches exactly 2 files:
  - `frontend/src/features/panels/ui/detailModal/PanelDetailModal.css`: `.panel-detail-modal__inner` changes from
    `height: 100%` to `height: calc(100% + 2 * var(--space-5))`, plus a comment;
  - `openspec/specs/write-path-audit/spec.md:188`: the row now names `panelThunks.ts` (the file exists and holds 16
    `createAsyncThunk`s).

  No renderer, hook or test file changed. So round 1's pure-move verification of 496b603b9 (AC3), and its D3/D4
  checks, still apply to identical bytes.

- **The CR1 fix is correct in the running app.** Setup:
  - Servers came up via `start-servers.sh`; `assert-phase.sh servers` printed PASS.
  - Vite serves the new rule: `curl …/PanelDetailModal.css` contains `calc(100% + 2 * var(--space-5))`.
  - I used my own throwaway user `a221d4b8-8305-4d71-a96d-c86f32c5c223` / `hel1449-skeptic2-1791918420788@example.test`
    with a fresh seed: an output chart panel with 4 controls, a table output panel and a text panel.

  Live `getBoundingClientRect` geometry is in `skeptic-final-2-geometry.txt`:

  | Viewport / theme | Header bottom | Fade box | Footer top | Fade bottom − footer top | Fade top − header bottom |
  |---|---|---|---|---|---|
  | 1440×900 light | 172 | 172..732 | 732 | **0** | 0 |
  | 1440×900 dark | 172 | 172..732 | 732 | **0** | 0 |
  | 390×844 light, full-screen | 61 | 61..787 | 787 | **0** | 0 |
  | 390×844 dark, full-screen | 61 | 61..787 | 787 | **0** | 0 |

  - The deltas held at the top, mid and end scroll positions in every case.
  - The fade classes follow scroll correctly: `--bottom` at the top, `--top --bottom` mid-scroll, `--top` at the end.
  - The body never scrolls itself: `.ui-modal__body` scrollHeight equals clientHeight in every state (560/560 desktop,
    726/726 mobile). So the taller inner box adds no second scrollbar.
  - At the end of the form the last child sits at 712, which leaves the form's own 20px padding above the footer.
    Nothing is clipped.

  Screenshots I viewed:
  - `skeptic-final-2-edit-{top,mid,end}-light-1440.png`
  - `skeptic-final-2-edit-{top,mid}-dark-1440.png`
  - `skeptic-final-2-edit-top-{light,dark}-390.png`

  Content now visibly runs under the footer divider, with the fade sitting on it in both themes. The dark glow is
  subtle and symmetric top and bottom. The round-1 asymmetry (top flush, bottom floating 40px off) is gone.

- **No regression in view mode, which shares `.panel-detail-modal__inner`.** For before-vs-after I injected
  `.panel-detail-modal__inner{height:100% !important}` (the base rule) on the same page and removed it afterwards:
  - **Before:** the view body ends 40px above the dialog's bottom edge, the same dead band (116..805 at 1440;
    61..804 at 390).
  - **After:** it fills the body exactly (116..845; 61..844), and the body's sh equals its ch, so there is no
    overflow or scrollbar.
  - **Chart view** (`skeptic-final-2-view-{after,before-emulated}-light-1440.png`): the chart is 40px taller and
    still has its own bottom margin.
  - **Table view** (`skeptic-final-2-table-view-end-{light,before-emulated-light}-1440.png`): the DataGrid's
    internal scroll now ends at 837 against the dialog bottom at 846. That gives an 8px bottom gap matching the
    8px top gap, where before it was 48px. The grid is inset 12px against a 14px corner radius, so the rounded
    corners clip nothing, and the last row (300) is fully visible.

  This is a correction of the same defect in view mode, not a regression.

- **The discard-warning row lays out correctly.** At 1440 the form/fade spans 172..682, the row 682..732 and the
  footer starts at 732. The row now sits flush on the footer divider; before (emulated) it floated at 642..692,
  40px above it. At 390 the fade spans 61..707, the row 707..787 and the footer starts at 787. The fade ends at the
  row's top edge. Screenshots: `skeptic-final-2-discard-light-{1440,390}.png`.

- **The non-overflowing text form shows no fade.** Light 1440, dark 1440 and light 390 all show sh equal to ch and
  fade class `''`.

- **The fade tracks content changes live (spec delta, "Content height changes").** I scrolled to the end, then
  deleted the 4 controls one by one: sh went 1725 → 1442 → 1159 → 876 → 659. The fade class matched the measured
  top/bottom edges after every step. I discarded the edit afterwards (Cancel → Discard).

- **Console.** The only errors were the pre-login `/api/auth/me` 401s and the pre-existing
  `/api/pipelines/<id>/run-events` 502 through the Vite proxy, which round 1 also noted. Neither comes from this
  diff.

- **Gates, fresh, under nice -n 19** (`skeptic-final-2-tc-lint-format.txt`, `skeptic-final-2-jest-scoped.txt`):
  - `npm run typecheck`: exit 0.
  - `npm run lint`: exit 0.
  - prettier from the repo root over `DESIGN.md`, `openspec/specs/write-path-audit/spec.md` and `detailModal/`:
    clean. My first run reported a warn on `spec.md`, but only because I ran it from `frontend/`; the root
    `.prettierignore` excludes `openspec`.
  - Scoped jest, maxWorkers 3: 66 suites / 728 tests pass. Pattern:
    - panels `renderers|detailModal|PanelCard|PanelContent|OutputPanelContent`;
    - shared/ui `useScrollEdges|DataGrid|SortableTable`;
    - `theme/elevationTokenGuard`;
    - `outputHistory/HistoryRows`.

  I did not re-run the full suite. The only change since the evaluator's pasted full-suite shards is one CSS
  declaration, which jsdom does not lay out.

- **AC2, path existence.** I looped over every `frontend/src/...` path in `write-path-audit/spec.md`: 0 MISSING.

- **AC5.** By id, the 5 HEL-1399 users, the 3 HEL-1399 skeptic ids and every `hel1449%`/`hel1399%` email return 0
  rows (`skeptic-final-2-d6-recheck.txt`).

- **C7 / mergeability.**
  - Open PRs #994, #1000 and #1001 share no file with this diff.
  - #986 and #996 are merged, with no overlap either.
  - `git merge-tree --write-tree origin/main HEAD` exits 0 against the current origin/main 43f2b72be, so the merge
    is clean.
  - No session link or `Claude-Session` trailer appears in any branch commit.

- **Cleanup.**
  - My user was deleted by exact (id, email) via `buildUserDeleteSql`: before = 1 row, after_count = 0
    (`skeptic-final-2-user-cleanup.txt`; the records array is in `skeptic-final-2-user-cleanup-records.json`).
    Its dashboard and data source cascaded away (0 rows).
  - Servers were stopped via `stop-servers.sh` (`STOPPED ports=6881,9788`).
  - Dev DB only.

- **mtime discipline.** No claim in this report rests on mtime or directory ordering. Every before/after claim
  comes from same-session DOM geometry with the base rule injected and then removed.

### Verdict: CONFIRM

### Non-blocking notes

- The fix is pure CSS and has no automated guard; jsdom cannot lay it out. The live measurements above are the
  record. A Playwright geometry assertion (`fade.bottom === footer.top`) would pin it if this modal is touched
  again.
- The executor's `geometry/summary-after.txt` shows the fade class as `''` at dark 390×844 edit-top/mid/end. My own
  run at the same viewport and theme shows `--bottom` / `--top --bottom` / `--top` correctly. That was most likely
  a capture-timing artifact on their side, but the executor's summary should not be cited for that row.
- Pre-existing, not this diff: in view mode the panel-controls bar sits flush against the dialog's left edge (x=121,
  no inset), in both before and after. Worth a polish ticket.
- The change dir `openspec/changes/split-tablerenderer-panel-followups/` is still untracked; the archive step must
  commit it.
