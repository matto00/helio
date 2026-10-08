## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `e5f04b7130e1faf41c6ae40a2a68f627e2bb9ef9` (merge of origin/main 24f6de4cf into 8982c10d9).
Review base (live-resolved via `resolve-review-base.sh`): `24f6de4cf290c216c8ba94359f82d1d35ae88f2a`.
Byte-identity base: `0de17a630` (`PanelCard.tsx` is unchanged between 0de17a630 and 24f6de4cf: empty diff).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC "every module < 400 lines": PanelCard.tsx 325, PanelCardBody.tsx 299, PanelCardHeader.tsx 192,
  controlResultCountText.ts 24, hooks/usePanelCardInspect.ts 135.
- AC "behaviour-preserving, moved code byte-identical": independently re-verified (not from the executor's
  transcript). I ran my own check, `tr -d '[:space:]'` on each base range of `0de17a630:PanelCard.tsx`, then a
  fixed-string substring check against the whitespace-stripped target file. At the pure-move commit 987bdb6b9, all
  10 ranges are IDENTICAL: 52-74 (PanelCard), 76-105 / 126-130 / 132-372 (PanelCardBody), 107-124
  (controlResultCountText), 374-448 / 546-603 / 728-844 (PanelCard), 449-545 (usePanelCardInspect), 604-727
  (PanelCardHeader). Together these ranges cover the whole base file apart from the import block (1-51) and
  blank separator lines. At HEAD, 4 ranges no longer match. I read the diff `987bdb6b9..8982c10d9` in full: the
  only changes are the comment-text edits from Commit 2. No code token changed.
- Hook order. `PanelCardBody` moved as a single verbatim range (132-372), so its hook order is unchanged. In
  `PanelCard`, ranges 374-448, then the hook body 449-545, then 546-603 appear in the same order. The hook is
  called at PanelCard.tsx:116-127, after the fullscreen state and before `useDataInvalid`. The only addition is
  the hook's own `useAppDispatch()` (usePanelCardInspect.ts:24). It is a context read with no state and no effect.
  Render-count suites pass unchanged.
- C2: the test diffs in 987bdb6b9 are exactly 6 `import { PanelCardBody } from "./PanelCard"` →
  `"./PanelCardBody"` lines. The diff for `PanelCard.test.tsx` (41d5110b9) is comment-only. The HEL-1181 suite
  `PanelCard.aggregatePieChart.test.tsx` is byte-identical to main (`git diff 24f6de4cf HEAD -- <file>` is empty)
  and passes (2/2).
- C3: the commits stay separated (move / comments / test comment / spec Purpose). There is no code change for
  item 3.
- Specs: `openspec/specs/chart-type-selector/spec.md` Purpose is rewritten, and `grep "selector appears"` returns
  0. The change deltas (`specs/chart-type-selector`, `specs/panel-appearance-settings`) match
  `resolvePanelChartType.ts` (panel, then Output `config.chartType` if allowed, then `line`).
  `openspec validate split-panelcard-sync-chart-specs --strict` reports the change is valid.
- The D5 test comment is corrected (PanelCard.test.tsx ~597-604).
- CONSTRAINTS C1-C6 are honoured in the diff. HEL-1380's redundant `setIsLoading(true)` is untouched. It is
  inside the verbatim-moved PanelCardBody range.

### Phase 2: Code Review — PASS
Issues: none blocking.

I re-ran the gates myself in WORKTREE_PATH at HEAD e5f04b7:
- `npm run lint` (eslint, `--max-warnings=0`): exit 0
- `npm run typecheck`: exit 0
- `npm run format:check`: exit 0, all files pass Prettier
- Root `nice -n 19 npx jest --maxWorkers=3`: 42 suites / 404 tests passed (no `--coverage`)
- Frontend `nice -n 19 npx jest --config jest.config.cjs --maxWorkers=3`: 468 suites / 4942 tests passed, 0
  failed. This includes PanelCard.test (35), PanelCard.aggregatePieChart (2), PanelCard.aggregateChart (7),
  PanelCard.inspect (5), PanelCardBody.fanoutStatus (2), PanelCardBody.predispatch (2), MobilePanelStack (10),
  and rawElementGuardHel440 (2).
- `npm --prefix frontend run build`: exit 0

Code-quality checks:
- No new `any`. Every new identifier is typed: the `PanelCardHeaderProps` interface, and the hook's parameters
  with an inferred return.
- No dead imports. Lint is clean.
- No circular import. Only `MobilePanelStack` imports `getPanelCardStyle` back from `PanelCard`, and no
  extracted module imports `PanelCard`.
- `check-tokens` ALLOWLIST: `getPanelCardStyle` stays in PanelCard.tsx, so that entry is still true.
- I found no [mechanical] DESIGN.md issue. No CSS or tokens were touched, and the JSX moved verbatim.

### Phase 3: UI Review — PASS
Issues: none.

- Servers were started with `start-servers.sh` (6797/9704), and `assert-phase.sh servers` returned PASS.
- I created a fresh test user via the API (not matt@helio.dev) and logged in through the shared browser.
- Base vs branch comparison on the RUNNING app. I made a throwaway detached worktree of main 24f6de4cf, served it
  via `start-servers.sh` on 6798/9705 against the same dev DB, then stopped its processes by exact PID and removed
  the worktree.
- One scripted flow ran per app and per theme on the "Finance spend (sample)" dashboard (3 output panels: table +
  2 bar charts), using the chart panel "Sample: Spend by category". It captured each state below:
  - normal header
  - Rename, giving the title-edit state, then Escape
  - Delete, giving the delete-confirm state, then Cancel
  - Inspect opened from the menu
  - Fullscreen opened
- Each capture recorded the normalised `outerHTML` of every `article.panel-grid-card`, or of every
  `dialog[open]`, plus 17 computed-style properties and the bounding box of every descendant.
- Result: all 18 state captures (9 states × light/dark) are IDENTICAL between base and branch. One normalisation
  was needed: ECharts' `size-sensor-id` attribute is a global mount-order counter. Base and branch swapped "3"
  and "4" between the two chart cards in dark, purely from async chart-chunk load order. That was the only
  difference before normalisation. Per-state sha256[:16] values:
  - light: normal 5491842f8ac14718, titleEdit 82077c1f7fb8db09, deleteConfirm 5683c790608bf0c2, inspect
    b591a8b29dc8d5e8, fullscreen 32f2780c0dd5ef39
  - dark: normal 7cacba199b11b79c, titleEdit 09889705bfda3dc3, deleteConfirm 8b66b0f37754b73b, inspect
    fa70b209a24b1b1b, fullscreen 939e17ff0a77e2c6
  - After Escape, Cancel, Inspect-close and Fullscreen-close, both apps are back to their original state: title
    restored, 3 cards, 0 open dialogs.
- Grid-context Inspect also opens from a chart click on both an aggregated chart and a scatter chart (see item 3
  below). Fullscreen opens and closes.
- Breakpoints on the branch:
  - 1440 / 1100: desktop grid, no page overflow
  - 768 / 375: MobilePanelStack renders all 5 cards. This exercises the moved `PanelCardBody` import. Page
    scrollWidth equals viewport width; only the data grid scrolls horizontally inside its own container.
- Console:
  - The scripted flows produced no errors.
  - A full `location.reload()` logs a 502 on `/api/pipelines/:id/run-events`. That is the SSE stream aborted
    through the Vite proxy on reload, unrelated to this change.
  - Switching desktop to mobile logs 8 "[ECharts] Can't get DOM width or height" warnings. Base logs the same 8
    warnings for the same resize, so they are not a regression.
- The page's interactive elements have accessible names: Refresh/Fullscreen/actions/Move/Cancel-delete
  `aria-label`s are present and identical to base.

**Item 3 (Inspect column order, investigation only, D7).** I did the live check the executor skipped. I added an
aggregated bar Output (`aggregation: {groupBy: category, agg: sum, yField: amount_usd}`) and a scatter Output on
the same node, then clicked a bar and a point on the branch.
- Both Inspect views show the columns in the same order: `amount_usd, category, date, merchant`.
- `GET /api/outputs/:id/rows` returns row objects whose keys are already in that order, which is alphabetical.
  So `headers = Object.keys(rows[0])` gives identical order on both branches, which confirms D7.
- The Output's declared `schema` is also alphabetical here (`amount_usd, category, date, merchant`). Only the
  source CSV order and the table Output's `columnOrder` are `date, category, merchant, amount_usd`.
- So the owner question stands as framed, and is arguably broader: Inspect follows the server's key order, not
  the source or column order, on BOTH branches. No defect was introduced by this change.

Dev-DB rows created by this evaluation (left in place; ids exact):
- user `2116b05b-7244-4235-b3de-34710932cd23` (eval-hel1365-1791466244@test.local)
- created via `POST /api/first-run/template {"template":"finance"}`:
  - dashboard `1ee408c2-e550-4baa-ad90-f93a0af0f7e5`
  - pipeline `a6341e31-b35e-4fd2-8e8a-cda84cb2d05c`
  - source `3353d3d3-7bb2-4980-8087-6b871390cf9e`
  - outputs `9a0fb99b-e8fe-4954-a96e-bea9034b788a`, `3522c708-6b9c-4ca5-9491-09b9fcfa7959`,
    `aa45b7e6-7886-4a5d-9077-7dabfe16cda0`
  - panels `86334f30-0d0d-4650-a82a-f929bd24589f`, `7d571947-6b86-4da7-9c1e-99a545bb5ce8`,
    `22c02173-a3d0-4d7b-91d0-05cbab46ebfc`
- created directly:
  - outputs `c83c907f-c9d4-4520-9faf-a27b9a6929ea` (aggregated bar), `ad73f2d7-b388-445f-ad0e-b123de07f215`
    (scatter)
  - panels `edd47270-636c-4b57-b59a-81c6ca5917bd`, `6cbc05a9-c23f-433c-b513-5d8177b71dce`
- plus the session rows from the register/login calls for that user.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `frontend/src/features/panels/hooks/usePanelSortFilter.ts:76`: the comment says `output` here comes from
  "`PanelCard`'s own pre-existing `useOutputMeta(outputId)`". It actually comes from `PanelCardBody`'s own
  `useOutputMeta` (PanelCardBody.tsx:78-82, HEL-1027 cycle 4). This inaccuracy predates the change, but the split
  makes it more misleading. Line 82 of the same comment was updated; line 76 was not. It is a one-word,
  comment-only fix ("`PanelCardBody`'s") and can go to a follow-up or into the next touch.
- The change dir `openspec/changes/split-panelcard-sync-chart-specs/` (including both spec deltas) is untracked at
  HEAD. Make sure the archive/commit step picks it up, otherwise the `panel-appearance-settings` sync never lands.
- `controlResultCountText.ts` uses a trailing `export { controlResultCountText };` to keep the moved function
  byte-identical. That is fine for this ticket. A later touch could inline `export function`.
- Owner question (item 3): should Inspect follow the Output's declared `schema` order or the source/`columnOrder`
  order rather than server row-key order? The evidence is above.
