## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `9ad6e851bf56d064197143315bcf2f9dfa459cf8`. The live review base, resolved with `resolve-review-base.sh <wt> main origin` (exit 0), is `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9`, which equals `origin/main`. The diff has 80 files.

Persisted evidence is under `/home/matt/Development/helio/.concertino/runs/HEL-1685/evidence/.concertino/scratch/HEL-1685/`, written below as `EV/`.

### What I verified (with evidence)

**Ground truth and scope**
- `files-modified.md` versus the diff: `comm -3` over every path outside the change dir is empty. All 69 paths are listed explicitly (CON-260).
- Out-of-scope paths are untouched. Only `DESIGN.md`, the new `e2e/hel1685-draft-polish.spec.ts` and `frontend/**` changed. No CI files, `.github/actions/e2e-setup`, playwright config, global setup or shard weights are in the diff.
- Owner triage (`.concertino/runs/HEL-1685/events.jsonl`) has two escalations, both `answer_source: human`:
  - `add-carveout` (t=1792681030453).
  - The sub-answers `decline-record-measurement, pipeline-page-only, defer-followup, keep-defer-followup, defer-followup, defer-followup` (t=1792683688906).
- `evidence.md` D17 maps each owner sub-answer to items 1+2, 3, 13, D, E and H, with reasons. J has no action, with a reason. The shared Modal is out of scope.

**Gates, re-run fresh by me**
- `npm run typecheck` (frontend): exit 0.
- `npm run lint`: exit 0 (`eslint src --max-warnings=0`).
- `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npx jest src/features/pipelines src/features/panels/ui/ChartPanel src/theme src/store`: `Test Suites: 206 passed, 206 total; Tests: 3245 passed`.

**Full e2e (driver requirement 1)**
- Command: `DEV_PORT=7117 BACKEND_PORT=10024 flock -w 3600 <e2e.lock> nice -n 19 npx playwright test --project=dev --workers=2`, run against this branch's servers (`assert-phase.sh servers` PASS).
- Result: **680 passed, 3 skipped, 0 failed (42.3 m), rc=0.** No rerun was needed.
- The 3 skips are the existing `hel1575-switch-measurement` and two `hel1582Phone` MAXIMAL sweeps.
- Log: `EV/skeptic-final-e2e-full.log`. The original is in `/home/matt/Development/helio/.concertino/scratch/HEL-1685/`.

**DESIGN.md §10 carve-out (driver requirement 3)**
- `git diff da39f0f14...HEAD -- DESIGN.md` adds exactly one line, at the end of the "Chart refresh morph" bullet in §10 Motion:
  - "Carve-out: live draft previews (§11) update in place with no morph at every motion level (`ChartPanel` `noAnimation`)."
- §11 is "Live preview", so the cross-reference is correct. This matches the escalation's proposed wording and the owner answer `add-carveout`.

**Acceptance criteria and items, traced to code**
- **4, notice band.**
  - Code: `PipelineSpineLayout.tsx:179-181` adds the `.spine-notice-slot`, and `PipelineSpineLayout.css:5` has a 4-row grid.
  - Running app at 1280x800, stale notice: notice bottom 138, body top 146 (8 px), no document scroll, dark and light.
  - Screenshots: `EV/skeptic-notice-1280-{dark,light}-full.png`.
- **5, phone overlap.**
  - Code: `isolation: isolate` on `.mobile-body` (`PipelineMobile.css:259`).
  - Running app, draft open, every scroll position in 12 px steps: at 375 (dark, Subtle), 38 kebab-under-bar positions with 0 stolen hits; at 430 (light, Subtle), 30 positions with 0 stolen.
  - Screenshots: `EV/skeptic-phone-375-dark-subtle.png` and `EV/skeptic-phone-430-light-subtle.png`. The pill paints over the kebab.
- **6, session expiry.**
  - Code: a `clearAuth` listener (`keptDraftListeners.ts`, registered in `store.ts:39-40`). The test uses the real store plus the real 401 interceptor.
  - Checked: the only kept-draft writer is the overlay/base effect (`usePipelineDraft.ts:69-77`), and it has no unmount write. So nothing re-creates a kept draft after `clearAuth` on the redirect.
- **7, deleted Output request.**
  - Code: `usePipelineRunStream.ts:57-75` skips the refresh while a save is in flight, and reads the ids from the store.
  - Running app: deleting the compute step put 5 Outputs into the cascade. After "Remove and save", only the 2 kept Outputs got `preview` requests, with no 404 for a removed one.
- **8, mid-error switch.** Frame memory moved to the page hook (`usePipelineDetailPage.ts:115`, `usePipelineDraftFrames.ts`). The layout-flip RTL test is in the suite above.
- **9.** The `saveError`/`saveErrorIsValidation` plumbing is removed; typecheck is clean.
- **10.** The cumulative seen-ids set is in `useStepSelection.ts:375-383`.
- **11, copy.**
  - Running app: the cascade dialog shows only the list, with no "(s)" lines (`EV/skeptic-cascade-1280-dark-off.png`), and the removed step's Output card reads "from a deleted step".
  - Backend hints (`DraftSaveTransaction.scala:107-110`) are fully redundant with the list, so dropping them loses nothing.
- **12.** The archived design.md edit is correct: `amend-ac-fetch-on-view` exists in the archive, and `e2e/hel1631-draft-mode.spec.ts` has no `fixme`.
- **14.** The literal `"p-1"` is in place.
- **A, "updating" vs "live".** Sampled the marker per animation frame at 900x800 with the disclosure open:
  - First edit: `none` → `live` at 270 ms.
  - Second edit: `updating` at t=0 → `live` at 270 ms.
- **B.** The cap bypasses idle (`useIdleCoalesced.ts:40-48`).
- **C.** The onToggle guard and mutation are recorded.
- **F.** `withoutMarkAnimation` is applied only in `ChartPanel`'s `noAnimation` memo.
- **G, muted stale marker and single error.**
  - Running app at 1280, Off motion, light and dark: the column's "stale" and the preview's "stale" are the same muted mono caption.
  - The error text appears in the editor and the preview table only. The Output note reads "Showing the last good render."
  - Screenshots: `EV/skeptic-stale-1280-{light,dark}-off.png`.
- **I.** The token guards no longer pin 151.

**DESIGN.md judgment (driver requirement 2)**

| Area | Viewport | Theme / motion |
| --- | --- | --- |
| Notice | 1280 | dark and light, Full |
| Disclosure | 900x800 and 900x700 | light, Off |
| Stale / live / cascade | 1280 | light and dark, Off |
| Phone Steps | 375 | dark, Subtle |
| Phone Steps and Preview | 430 | light, Subtle |

- Tokens are used throughout (`--space-*`, `--app-*`, `--text-xs`, `--font-mono`).
- "live" uses the success dot plus mono text, and "updating"/"stale" use the muted caption, as DESIGN.md §11 requires.
- Light/dark parity holds.
- No console errors beyond the existing `/schedule` 404 and the expected cascade `422`.
- The motion level does not change any of the layouts this change touches.

**Disclosure cap, measured (the finding)**
- Pipeline: 3 steps and 7 Outputs, step 1 Filter focused, disclosure open.
- "Reverted" means the shipped page with `max-height: 40vh` injected, an exact revert of D14.

| Viewport | Build | Editor card | Preview card | Disclosure |
| --- | --- | --- | --- | --- |
| 900x700 | shipped | 133 px | 150 px | 280 px |
| 900x700 | reverted | 133 px | 150 px | 280 px |
| 900x800 | shipped | 178 px | 205 px | 280 px |
| 900x800 | reverted | 160 px | 183 px | 320 px |

- The filter editor's content needs 267 px.
- Evidence: `EV/skeptic-final-disclosure-measure.json`, `EV/skeptic-disclosure-900x700-light-off.png`, `EV/skeptic-disclosure-900x800-light-off.png`.
- The original complaint is `/home/matt/Development/helio/.concertino/runs/HEL-1632/evidence/e2e-evidence/HEL-1632/live-900-light-open.png`.

**Cleanup**
- My seed was on the dev account. Deleted by exact id:
  - Source `a409bbce-18dd-404c-ab49-6fbd5cee335b`.
  - Pipelines `faf80d43-33d1-4ff4-8777-b590b67df050` and `db34545b-6dad-4d1f-b341-82cd1fafbb5a`. Their Outputs now return 404.
- The dev account's `motion` preference was restored to unset, and `helio-theme` to dark. No kept drafts remain.
- Servers were stopped with `stop-servers.sh` (`STOPPED ports=7117,10024`).
- Record: `EV/skeptic-final-seed-ids.txt`.

### Verdict: REFUTE

### Change Requests
1. **Addendum G, "at 900 px the open disclosure squeezes the editor", is recorded as fixed but is not.**
   - **The change.** `PipelineSpineLayout.css:105-106` (`max-height: min(40vh, 280px)`) only differs from the old `40vh` above a 700 px tall window, because `40vh` at 700 px is already 280 px.
   - **At 900x700**, one of the two heights D14 names, the shipped layout is pixel-identical to unfixed main. The editor card is 133 px, against 267 px of filter-editor content, and its first input row (the field select) is clipped.
   - **At 900x800** the editor gains 18 px (160 → 178). The squeeze in the original HEL-1632 screenshot is essentially unchanged.
   - **Why the record is misleading.** D14's acceptance signal ("the step editor's heading stays visible at 900x800 and 900x700") already passes on unfixed code at 700. It is a check with no red, and evidence.md does not label it as one (C1).
   - **Required:** do one of the following.
     - (a) Fix it, so that with the disclosure open at 900x700 and 900x800 the focused step editor shows at least its first complete input row without scrolling inside the editor. A Filter step's field select must be fully visible. Prove it with a red-on-main / green-on-branch measurement, at both heights, in light and dark. Possible levers: a lower or height-aware cap, a minimum block size for the editor card that the preview yields to, or similar. The choice is the executor's.
     - (b) Move this sub-item to the D17 deferrals with a stated reason, and correct the evidence.md §4.4 "Disclosure (G)" bullet so it no longer implies a fix at 900x700.

### Non-blocking notes
- `usePipelineRunStream.ts`: the `getState() as RootState` cast is redundant, as the evaluator also noted.
- The archived HEL-1631 design.md D13 still says kept drafts are removed "by the `logout` thunk". Since this change they are also removed by `clearAuth` (401, failed rehydrate). That is a one-clause addition if the item 12 edit is reopened anyway.
- The DESIGN.md carve-out line is not wrapped to the surrounding ~80-column prose. Prettier passes, so this is cosmetic only.
