## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1730daa1f3aebdf6807681f19c838dc22ce6a875` against the live-resolved base
`f63ab8365d2b0e6cac36154a83437b6d26b3a209` (`resolve-review-base.sh`, exit 0). Four commits: 496b603b9 (move),
5fc32982a (pointers), 9dfccd7b5 (mock), 1730daa1f (scroll hint). Evidence paths below are absolute under
`/home/matt/Development/helio/.concertino/runs/HEL-1449/evidence/` (the durable main-checkout evidence dir; my
artifacts are prefixed `skeptic-final-1-`).

### What I verified (with evidence)

- **AC3: the TableRenderer split is a pure move.** I wrote my own check against commit 496b603b9 rather than reusing
  the executor's or evaluator's script. I did a whitespace-stripped substring test of every base range in its new
  file: a L31-122, b L123-242, c L243-283, d L322-468, e L470-694, host L284-320 + L469 + L695-903. All are
  SUBSTRING. I also ran a line-level difflib of base vs new for every file. The ONLY non-moved lines are:
  - import lines;
  - `export` prefixes;
  - the two hook signatures with their `Pick<TableRendererProps,…>` param types;
  - the two trailing `return {…}`;
  - the two host call-site destructures.

  No token in any moved body changed. Commits 2-4 touch these files in comments only (`git diff 496b603b9 HEAD`
  over `renderers/`, comment hunks only). Sizes: host 299, props 101, model 124, persistence 44, useTableRows 209,
  useTablePersistedState 266, all under 400. Hook order holds by construction: each hook wraps a contiguous run at
  its original slot, after `canWrite` and before the D4/4.1 comment.

  Live check: sorting the table panel's `amount` column twice issued `rows?sort=amount:asc` → PATCH → `rows?sort=amount:desc`
  → PATCH, each 200. The debounced persistence moved into `useTablePersistedState` works.
- **AC1:** I re-ran `PanelDetailModal.chartTypeDefault`: 3/3 pass, AggregateError 0, ECONNREFUSED 0, and the same 2
  pre-existing `act()` warnings (`skeptic-final-1-d4.txt`). The executor's `d4-before.txt` holds 2 AggregateErrors.
  I did not re-run the mutation red (read-only); I am relying on the executor's `d4-mutation-red.txt`.
- **AC2:**
  - I re-ran the D3 grep. Each remaining hit is still correct. I spot-checked these:
    - `PanelDetailModal.tsx` renders `<PanelContent` and wires `rowsTruncated`;
    - `PanelContent.tsx:162` carries `role="alert"`;
    - `MetricOutputConfig` has no `trend` field, so the HEL-909 comment in `PanelContent.test.tsx` is not stale.
      It is identical at fd99c3dd:321-327, so "no stale pointer at :323" holds.
  - The path-existence loop over every `frontend/src/...` path in `write-path-audit/spec.md` printed no MISSING.
  - Zero `TableRenderer.tsx:N` / `PanelContent.tsx:N` line pointers remain outside `openspec/changes`.
- **AC5:** I queried the dev DB by id for the 5 HEL-1399 users, the executor's 3, the evaluator's 1, and any
  `hel1449%`/`hel1399%` email. 0 rows (`skeptic-final-1-d6-recheck.txt`).
- **Gates for the changed areas, fresh**, all under nice -n 19:
  - `npm run typecheck` + `npm run lint`: exit 0 (`skeptic-final-1-tc-lint.txt`).
  - Scoped jest, maxWorkers 3: 66 suites / 728 tests pass (`skeptic-final-1-jest-scoped.txt`). Patterns:
    - panels `renderers|detailModal|PanelCard|PanelContent|OutputPanelContent`;
    - shared/ui `useScrollEdges|DataGrid|SortableTable`;
    - `theme/elevationTokenGuard`;
    - `outputHistory/HistoryRows`.

  I did not re-run the full suite; the evaluator's pasted shard transcripts (585 suites / 7013 tests) are unambiguous.
- **AC4 / scroll-fade, in the running app.** Setup:
  - Servers came up via `start-servers.sh` and `assert-phase.sh servers` (PASS), and were stopped via `stop-servers.sh`.
  - I used my own throwaway user `bc124486-ba64-4a5b-9b09-9c5f1f075ea1` / `hel1449-skeptic-1791917166032@example.test`,
    with one UI login.
  - The user is deleted by that exact pair via `buildUserDeleteSql`, after_count=0 (`skeptic-final-1-user-cleanup.txt`).
    The records array passed is in `skeptic-final-1-user-cleanup-records.json`.

  Mechanics are correct. On view→Edit and the E key the form shows `--bottom` (sh 1442 / ch 520). Mid-scroll shows
  `--top --bottom`. The overlay is `aria-hidden` and pointer-transparent. Light and dark both use `--app-text` at
  35%, the same family as the DataGrid horizontal fades.

  **The placement is wrong.** Live geometry, identical in both themes (`skeptic-final-1-fade-geometry.txt`):
  - The overlay's top edge (172) is flush with the header divider (172).
  - Its bottom edge (692) sits **40px above** the footer divider (732).
  - The band 692-732 is dead `.ui-modal__body` padding. `.panel-detail-modal__inner` has `margin: -var(--space-5)`
    with `height: 100%`, so it bleeds up but stops 2 × `--space-5` short at the bottom.
  - The same 40px gap appears at 390×844: fade ends at 747, footer at 787.

  So the controls content is clipped mid-modal. The bottom fade then reads as a floating shadow line (light) or a
  glowing streak (dark) over a blank strip, not as content that continues under the footer. Screenshots:
  `skeptic-final-1-modal-top-light.png`, `skeptic-final-1-modal-mid-light.png`, `skeptic-final-1-modal-top-dark.png`,
  `skeptic-final-1-modal-mid-dark.png`, `skeptic-final-1-mobile-edit-dark.png`.

  The executor's own BEFORE capture (`screenshots/before/10-chart4-edit-top-1440x900-light.png`) shows the dead band
  was always there. It was invisible, and it is part of why the Controls section "looked like the end of the form".
  This change now draws the hint on exactly that wrong edge. The top and bottom fades are asymmetric: one is flush
  with its divider, the other floats 40px off it. An experienced eye would reject this.

  No evidence in this report rests on mtime ordering. Each claim rests on DOM `getBoundingClientRect` values or a
  screenshot I captured and viewed this round.

### Verdict: REFUTE

### Change Requests

1. **The edit form's scroll viewport, and so its bottom scroll-fade, must reach the footer divider.** Today the
   fade ends 40px (2 × `--space-5`) above the `ui-modal__footer` border at every viewport I measured (1440×900:
   692 vs 732; 390×844: 747 vs 787). Content is clipped mid-modal, and the fade floats over a blank strip.
   - **Root cause:** `frontend/src/features/panels/ui/detailModal/PanelDetailModal.css:19-24`.
     `.panel-detail-modal__inner` cancels the body padding with `margin: calc(-1 * var(--space-5))` but keeps
     `height: 100%`, so its box ends `2 × --space-5` above the body's bottom edge.
   - **Fix:** make the edit-mode scroll area fill to the body's bottom edge, so the overlay's bottom equals the
     footer's top, exactly as its top already equals the header's bottom. One way is
     `height: calc(100% + 2 * var(--space-5))` on the inner, or the equivalent on the edit branch only.
   - **Prove it live**, light and dark, at 1440×900 and 390×844: `fade.bottom === footer.top`. Re-capture the
     top/mid/bottom screenshots.
   - **Confirm no regression:**
     - the view-mode body (it shares `.panel-detail-modal__inner`) shows no new overflow or extra scrollbar;
     - the discard-warning row still lays out;
     - the non-overflowing text-panel form still shows no fade.
   - **Guard:** a test or DOM-geometry check would pin this. A pure-CSS fix may stay live-verified, but record the
     measurements as evidence.

### Non-blocking notes

- `openspec/specs/write-path-audit/spec.md:188`: the `panelsSlice.ts | Panel thunks and triggers` row resolves.
  But `panelsSlice.ts` holds 1 `createAsyncThunk`; `panelThunks.ts` holds 16 and is re-exported at
  `panelsSlice.ts:21/423`. Consider naming `panelThunks.ts` (the evaluator raised this too).
- In dark theme the `--app-text` fade renders as a light glow. That is consistent with the existing horizontal
  DataGrid fades, so it is not a defect of this change. Still worth an eye once CR1 puts it flush against the footer.
- The change dir `openspec/changes/split-tablerenderer-panel-followups/` is still untracked; the archive step must
  commit it.
- Observed, not this diff: the `/api/pipelines/<id>/run-events` 502 through the Vite proxy, and the detail modal
  closing when the viewport crosses the mobile/desktop breakpoint.
