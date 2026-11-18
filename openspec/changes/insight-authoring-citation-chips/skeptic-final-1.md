## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `c37c6adbb78b4e345717c62f79b314158759e07f`. The review base was resolved live as `1e0d610bb` (the merge-base; origin/main is at `9054da2a6`).

### What I verified (with evidence)

**Gates, re-run fresh by me:**
- **jest** (maxWorkers 3), filtered to `ProvenanceTrigger|usePortalPopover|PanelContent|OutputEditorSheet|outputKindDrift|usePanelData|features/panels/insight|insightNode|configPatch|buildOutputConfig`: 39 suites and 427 tests passed, 0 failed.
- **e2e** (DEV_PORT=7176, BACKEND_PORT=10083, 2 workers, servers started with `start-servers.sh`, `assert-phase servers` PASS). Specs: hel1744, hel1756-popover-viewport-fit, hel1632, hel1705, hel1733, hel1189 and hel1510.
  - Result: **77 passed**, exit 0, no flakes hit.
  - All four hel1744 matrix runs logged `cold-load rows requests for the insight Output: 1`.
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1744/skeptic/e2e.log`.
- **sbt testFull** (`-J-Xmx3g`, nice 19, full suite): `Suites: completed 722, aborted 0`, `Tests: succeeded 9846, failed 0`, `All tests passed.`, exit 0.
  - The run included OutputKindDriftSpec, with the new case "offer every canonical kind in its create picker".
  - It included all six OutputInsight* specs, among them the two new D8 cases (placed/unplaced/elsewhere, and lowest panel id).
  - Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1744/skeptic/sbt-testFull.log`.
- **Conflict risk with origin/main 9054da2a6:** `git merge-tree --write-tree HEAD origin/main` is clean, and no file is changed on both sides.

**Acceptance criteria:**
- **AC1, author without a prompt, then two cited sentences.**
  - `e2e/hel1744-insight-panel.spec.ts` creates the insight through the sheet. It asserts Auto and On every run, both same-node Outputs pre-ticked, and the disclosure closed. It asserts the POST is 201 with `config.prompt` undefined.
  - It then seeds one `ok` render and asserts both sentences and 2 chips.
  - **The seed is test-only:**
    - `e2e/support/insightSeed.ts` writes through `e2e/support/db.cjs` psql with SAFE_ID/ISO/dollar-quote validation and an exactly-one-row check.
    - grep finds it imported only by the hel1744 spec.
    - The backend diff (`git diff 1e0d610bb...HEAD -- backend`) adds no route, no write path and no model call. It only adds `panelIdsByOutput` (a read) and the `panelId` protocol field.
    - No production backdoor exists.
  - **"After a run":** the pipeline runs before the seed. There is no post-insight run-to-render, because L4 is not merged. This deviation is driver-authorized.
- **AC2, chip popover and focus.** `expectPopoverOpenWithFocus` checks computed `visibility: visible`, a non-zero rect, an `elementFromPoint` hit inside the popover, and `document.activeElement` inside it. Escape returns focus to the chip. This runs on both chips, in all 4 theme/viewport runs, and on the public viewer.
- **AC3, the public viewer shows no cost.**
  - The public response body is asserted free of the seeded model, both token counts, `costMicros` and both cited Output ids.
  - The page text is asserted free of the same values and of `/tokens?|cost/i`.
  - The authenticated page text is asserted the same way.
  - `insightService.ts` maps the response through an allow-list; grep for `costMicros|inputTokens|outputTokens|.model` in `features/panels/insight` and `InsightKindFields.tsx` finds nothing.
- **AC4, light/dark and desktop/phone.** I opened the screenshots my own e2e run wrote (01:49–01:50, `e2e-evidence/HEL-1744/`):
  - insight-panel-light-desktop, insight-chip-popover-dark-desktop and insight-chip-popover-light-phone;
  - insight-public-dark-desktop, insight-card-light-desktop and insight-card-dark-phone.
  - Chips are small neutral pills sized to the text, with the accent only on the focus ring. The editor card reuses the card/Select/SegmentedRadio/checkbox recipes and fits 390px. The render uses body type that matches the neighbouring table panel. The footer reads `UPDATED 11/13/2026` (the render date) while the table panel reads today's date.
  - The CSS uses tokens only. The raw px values are 1–2px borders and the outline offset.
  - Visual cohesion: acceptable in both themes.

**L1 carry-overs:**
- **Footer:** `PanelCard.tsx` reads `insightChrome.renderedAt`. It is the only "Updated" site; the public viewer has no footer.
- **Refresh:** PanelCard, the fullscreen `refresh` prop and the MobilePanelStack pull-to-refresh all route to `insightChrome.refetch`.
- **`role="status"`:** present on `InsightNotRenderedState`, and asserted in PanelContent.test and in e2e.
- **Picker drift exclusion:** removed in jest (`outputKindDrift.test.ts`) and in the backend (`OutputKindDriftSpec`), and both are green.

**Spec honesty, "Insight panel fetches no rows" rewrite:**
- The d467→c37 diff replaces a scenario that contradicted its own requirement ("no rows request" vs the stated cold-load exception) with two scenarios. The cold load makes exactly one request; run completion and warm remount make zero.
- Design D7 explicitly permitted the cold-load exception when the request count is measured. The count was measured as 1, and I reproduced it.
- The rewrite is stricter on run completion. **It is not weakened.**

**ProvenanceTrigger refactor:**
- The diff moves placement, focus, the container and the terminal invalidation into `useProvenancePopoverHost`.
- `git diff --stat` shows no change to any `ProvenanceTrigger*.test`, `usePortalPopover` test or `hel1756` e2e file, and all of them pass.

### Verdict: REFUTE

### Change Requests

1. **The cycle-2 "no Not-yet-rendered flash" fix is dead code.**
   - **Where:** `frontend/src/features/panels/insight/usePipelineOwnership.ts`. Its doc comment and its widened return type `boolean | undefined` claim it "Returns `undefined` while an enabled lookup is still pending".
   - **Why that claim is false:** the hook's only two return statements are boolean.
     - l.55: `if (pipelineId === null || userId === null) return false;`
     - l.62: `return ownerId !== null && ownerId === userId;`
     - While the `GET /api/pipelines/:id` lookup is pending, `fetched` is null, so `ownerId` is null and the hook returns `false`.
   - **Effect:** the skeleton hold in `InsightPanelBody.tsx` l.104-106 (`isPipelineOwner === undefined && render === null`) can never be true.
     - A free-tier pipeline owner with no render therefore first renders `InsightNotRenderedState`, which is a `role="status"` live region announcing "Not yet rendered", and then flips to the upsell.
     - The evaluator observed this flash in Chromium with a MutationObserver (evaluation-2, non-blocking). This code shows why it happens: the attempted fix never took effect.
     - The same window briefly shows the neutral "not updated" note to an owner whose newest attempt is a quota skip.
   - **This violates** the spec requirement "The panel SHALL show exactly one of these states". It also ships a comment that misdescribes the code.
   - **Fix:** return `undefined` while `enabled && pipelineId !== null && userId !== null && knownOwner === undefined && fetched?.pipelineId !== pipelineId`.
     - Also cover the `tier`-not-yet-loaded window if `ownershipMatters` can flip after first paint.
     - Add a jest case that holds the pipeline GET pending for a free-tier owner with `render: null`. It must assert that neither `insight-not-rendered` nor the upsell is in the DOM, then resolve the GET and assert the upsell.
     - Record the red result against the current code in `red-evidence.md`/`mutations.md`.
2. **`measurements.md` asserts something false, and the claim will be archived.**
   - The false line: "The e2e cannot drive a run completion: the dev server's Vite proxy does not carry the run-events SSE."
   - The evaluator measured on the dev server that a `POST /run` re-reads every insight panel's `/insight` and issues no insight rows request (evidence `/home/matt/Development/helio/.concertino/runs/HEL-1744/evidence/.concertino/scratch/HEL-1744/eval2/run-completion.txt`).
   - **Fix:** correct the line to cite that measurement.
   - **Preferably:** add a `POST /run` step to `hel1744-insight-panel.spec.ts` that asserts `rowsRequests` is unchanged and that `/insight` is re-requested. Today the "run completion: 0 rows requests" scenario is proved only by a jest simulation (`invalidatePipeline` + `refresh()`), not by the real terminal subscription.

### Non-blocking notes
- The dark-desktop chip-popover screenshot is captured mid-fade while "Loading provenance…" is still showing. The popover is legible once it settles; consider capturing after `ready` so the evidence image is meaningful.
- `panelIdsByOutput` reads at most `Page.MaxLimit` panels. A dashboard with more panels silently falls back to the insight panel's own provenance for a citation placed beyond that limit. This is acceptable, but worth a code comment.
- `insightSeed.ts` declares `UUID` and uses it only as the output-line filter. That is fine.
- `InsightMarkdownView.tsx` keys a custom element in `components` through an `as unknown as Components` cast (also noted by the evaluator).

Gate-defect check (CON-160): no mtime-ordering claim is relied on. The screenshots I cite were produced by my own e2e run in this session, and the run log is persisted alongside.
