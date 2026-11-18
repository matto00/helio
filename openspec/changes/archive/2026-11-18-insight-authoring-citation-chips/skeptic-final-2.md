## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `766d873f8e6fa8f4d544462383a041c6fd9c002a`. Before reading anything I ran the spawn-cwd guard, which printed `READY`. I resolved the review base live with `resolve-review-base.sh` (main/origin) and got `1e0d610bb`, the merge-base; origin/main is now at `c03fc0a4a`.

### What I verified (with evidence)

**Round-1 Change Request 1: the ownership hold was dead code. It is now fixed.**
- **The hook now returns `undefined`.** `usePipelineOwnership.ts` l.56-59 returns `undefined` when `knownOwner === undefined && fetched?.pipelineId !== pipelineId` and the lookup is enabled. The doc comment now matches the code.
- **The hold has no gap in the first frame.** `ownershipMatters` becomes true on the render where the data arrives (free tier, render null). `enabled` is then true before the effect has fired, so that first frame already returns `undefined` and the skeleton holds.
- **A failed lookup cannot hang the panel.** The fetch-failure path resolves to `null` (`() => null`, l.22), so `fetched` is set and the skeleton cannot hang on a 403/404.
- **Auth window:** `InsightPanelBody.tsx` l.124 and l.170-173 also hold while `auth.status === "loading"`.
  - `authSlice.ts` l.31 shows `loading` always settles to `authenticated` or `unauthenticated`, so the hold cannot hang.
  - Public viewers pass `null` for the pipeline id, so their ownership value is `false`.
- **New jest cases:**
  - The first case holds the pipeline GET pending and asserts that neither not-rendered, a `role=status` element nor the upsell is shown. It then resolves the GET and asserts the upsell.
  - The second case uses auth `loading`.
  - The recorded red against the cycle-2 code (`mutations.md`, `red-evidence.md`: "2 failed, 13 passed") agrees with my reading of the code. With the old hook returning `false`, case 1 renders `insight-not-rendered`. In case 2 `userId` is null, so the old hook returns `false` and there is no auth hold.
  - I did not re-run that mutation myself. Doing so would mean editing code, which my role forbids. The red result is clear from the code alone.

**Round-1 Change Request 2: a false claim in measurements.md. It is now fixed.**
- `measurements.md` now cites the real-browser e2e step and the evaluator's dev-proxy measurement. The false line about the SSE proxy is gone.
- **The new e2e step** is at `hel1744-insight-panel.spec.ts` l.368-378:
  - It posts `/run` on the open board.
  - It polls until `/api/outputs/<insight>/insight` is re-read.
  - It asserts that `rowsRequests` is unchanged.
- **The re-read must come from run completion.** `useInsight.ts` has no polling. A re-read only comes from `subscribeToPipelineTerminal` or `refetch`, so the poll does prove that the run-completion path fired.
- **Recorded mutation** (`mutations.md`): with the rows gate reading invalidatable metadata, the step fails with "Expected: 2, Received: 3".

**Backend unchanged since d467a6a7f:** `git diff d467a6a7f..HEAD --stat -- backend schemas` is empty. sbt testFull was green at that backend in round 1 (persisted log `/home/matt/Development/helio/.concertino/scratch/HEL-1744/skeptic/sbt-testFull.log`).

**Gates, re-run fresh by me on HEAD 766d873f8:**
- **Full frontend jest**, maxWorkers 3, nice 19:
  - `Test Suites: 809 passed, 809 total`, `Tests: 9829 passed, 9829 total`, `Snapshots: 20 passed`, exit 0.
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1744/skeptic2/jest.log`
- **Typecheck:** `tsc --noEmit` reported no errors. This covers the `as unknown as Components` → `as Components` narrowing.
- **ESLint:** run with `--max-warnings 0` on `src/features/panels` and `src/features/pipelines/ui/outputEditor`; it passed clean.
- **Servers:** started with `start-servers.sh` on 7176/10083; `assert-phase servers` printed PASS; stopped with `stop-servers.sh` (`STOPPED ports=7176,10083`).
- **e2e**, DEV_PORT=7176, BACKEND_PORT=10083, 2 workers. Specs: hel1744-insight-panel, hel1756-popover-viewport-fit, hel1632-live-output, hel1705-live-output-refresh, hel1733-draft-outputs-shapes, hel1189-output-panel-controls-live and hel1510-output-editor-table-overflow.
  - **77 passed (4.7m)**, exit 0. No flakes were hit, so no reruns were needed.
  - All four hel1744 matrix runs logged `cold-load rows requests for the insight Output: 1`.
  - The free-tier owner upsell test passed.
  - The 77 throwaway users were deleted by the suite's own teardown.
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1744/skeptic2/e2e.log`

**Acceptance criteria:**
- **AC1, insight added without a prompt, then two cited sentences.**
  - The spec authors the insight through the sheet with no prompt; the POST config has an undefined `prompt`.
  - A run is posted, and a render row is seeded through `e2e/support/insightSeed.ts`. That helper is psql-only, with validated ids and an exactly-one-row check.
  - The panel then shows both sentences and 2 chips.
  - **The seed is test-only:**
    - grep finds `seedInsightRender`/`insightSeed` only in `e2e/`.
    - The backend diff adds no route, no insert and no model call. It is read-side only: `panelIdsByOutput` and the `panelId` field.
    - No production backdoor exists. The seed instead of an L4 trigger is driver-authorized because HEL-1743 is unmerged.
- **AC2, a chip opens the popover and moves focus into it, in a real browser.** `expectPopoverOpenWithFocus` checks:
  - computed `visibility: visible`;
  - a non-zero rect;
  - an `elementFromPoint` hit inside the popover;
  - `document.activeElement` inside the popover;
  - and that Escape returns focus to the chip.
  - It runs on both chips, in all four theme/viewport runs and on the public viewer. All passed in my run.
- **AC3, the public viewer shows no cost.**
  - The spec asserts that the public response and the page text are free of the seeded model, the token counts and the cost.
  - grep for `costMicros|inputTokens|outputTokens|.model` in `features/panels/insight` and `InsightKindFields.tsx`, excluding tests, finds nothing; the service maps the response through an allow-list.
- **AC4, light/dark and desktop/phone.** I opened screenshots written by my own e2e run (02:32-02:33, run finished 02:35):
  - `insight-chip-popover-dark-desktop` → `/home/matt/Development/helio/.concertino/runs/HEL-1744/evidence/e2e-evidence/HEL-1744/insight-chip-popover-dark-desktop.png`. Chips are quiet neutral pills inline with the text. The footer reads `UPDATED 11/13/2026` (the render date), while the sibling table reads today's date.
  - `insight-panel-light-phone` → `.../insight-panel-light-phone.png`. The card fits 390px, the type matches the sibling table card, and the rich markdown (list, heading, quote) sits on the same rhythm.
  - `insight-card-dark-desktop` → `.../insight-card-dark-desktop.png`. The editor card reuses the Configuration card, Select, checkbox list, segmented radio and disclosure recipes. Auto, both Outputs pre-ticked and "On every run" are the defaults, consistent with the sibling kind cards.
  - `insight-public-light-desktop` → `.../insight-public-light-desktop.png`. It matches the public viewer's existing panel chrome. Link and autolink text render as plain text, `[c9]` stays plain text, and the accent focus ring sits on the focused chip.
  - The CSS uses tokens only. The raw values are the 1-2px borders, the outline offset and the em-relative chip sizing.
  - Visual cohesion: acceptable in both themes and at both widths.

**Gate-defect check (CON-160):** none of my conclusions rests on mtime ordering. The screenshots I cite came from my own run in this session; I captured the clock at 02:35 against file times of 02:32-02:33, and the e2e log is persisted.

### Verdict: CONFIRM

### Non-blocking notes
- The dark-desktop chip-popover screenshot is still captured mid-fade ("Data provenance" at reduced opacity over the card). The e2e assertions use computed style and pass, but the evidence image would read better if it were captured after the popover settles. This was noted in round 1 too.
- The new e2e run-completion step uses a fixed `waitForTimeout(1000)` after the insight re-read before asserting the rows count. A late rows request would slip past it. The recorded mutation shows the step does go red in practice, so it is acceptable.
- Carried from round 1: `panelIdsByOutput` reads at most `Page.MaxLimit` panels, and a citation placed beyond that silently falls back to the insight panel's own provenance. That deserves a code comment.
