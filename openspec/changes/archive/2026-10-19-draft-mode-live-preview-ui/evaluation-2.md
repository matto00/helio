## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `fdfeca1ddbc125096aed61237b3282f7e6b7cdd7`. The base was resolved live as `538a867d718204775f7c0844450f683889e145e3`. The commits new since cycle 1 are `f55799baf` and `fdfeca1dd`. This review is scoped to the cycle-2 diff and the four cycle-1 change requests.

### Fresh gate runs (evaluator's own)

All gates ran under `nice -n 19`.

- lint, `format:check`, typecheck and `npm --prefix frontend run build` each exited 0.
- `npm test` with `HELIO_JEST_MAX_WORKERS=2` exited 0.
  - Root suite: 61 suites, 524 tests.
  - Frontend suite: 747 suites, 9277 tests. That is 2 more suites than cycle 1: the flash test and the leave-guard test.
- `e2e/hel1631-draft-mode.spec.ts`, run under the e2e.lock flock with `--trace retain-on-failure`: 8 passed, exit 0.
- I did not re-run the full e2e suite. It runs in Delivery.
- Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/`
  - `eval2-jest.txt`
  - `eval2-e2e-hel1631.txt`

### Phase 1: Spec Review — PASS

**Owner ruling verified.** `events.jsonl` has `escalation.answered` for `escalation_id` HEL-1631-1792466384183-32dd07 with:
- `answer` `accent-22-amend-design`
- `answer_source` `human`
- `resolution_channel` `chat`

**C7 is recorded in tasks.md.**

**DESIGN.md has exactly one change**, a single line in §11: "30%" becomes "22%". `git diff 538a867d7...HEAD -- frontend/src/theme/appearance.ts frontend/src/theme/theme.css` is empty.

**design.md D8 records the cycle-2 decision:** the accent dot on the draft chip and the 22% flash, with the escalation id.

### Phase 2: Code Review — PASS

Cycle-1 change requests:

1. **Flash colour: resolved.**
   - Code: `StepPreviewTable.css:166,180,186` now use `color-mix(in srgb, var(--app-accent) 22%, transparent)`.
   - I measured it in the running app, independently of the executor's c3 file.
   - Full and Subtle, both themes: the animation keyframes are exactly `color(srgb 0.9176 0.7020 0.0314 / 0.22)`. That matches a 22% `color-mix` probe of `--app-accent` #eab308.
   - A sampled Full flash fades on the accent hue: alpha 0.211 at 17 ms, 0.142 at 150 ms, 0.050 at 400 ms, 0.005 at 800 ms, transparent at 1200 ms. That covers the 5 new rows (15 cells).
   - Off, both themes: no animation, and a static tint of exactly that 22% accent that holds after 1.5 s.
   - Chip dot: `rgb(234,179,8)`, which is `--app-accent`, on the desktop header and in the phone `draft-status` slot.
2. **Flash tests: resolved.**
   - `StepPreviewTable.flash.test.tsx` covers:
     - the first frame compared with the saved rows;
     - rows new against the previous frame;
     - no flash without saved rows;
     - no flash on a step switch;
     - the more-than-200 cap.
   - Mutation-red evidence (`flash-mutation-red.txt`):
     - Removing the class logic fails 3 tests.
     - Removing the cap fails 1 test.
   - The cap test is also red against the cycle-1 code. That code compared only the 50 rendered rows, so the cap could never be reached.
   - **Cap behaviour change reviewed: accepted.**
     - New-row count is now taken over the first 1000 rows (`FLASH_SCAN_ROWS`, which equals the sample cap). The previous-frame key set covers the same 1000 rows.
     - Only the 50 rendered rows can be marked.
     - This makes D8's "more than ~200 changed rows does not flash" actually reachable.
     - It also removes a false positive: before, a row that moved from position 60 into the top 50 counted as new.
     - There is no spec or AC conflict.
3. **C6 red-first: resolved.**
   - `c6-red-mutation-patch-restored.txt` shows the burst test failing at its `requests … toEqual([])` assertion (line 195).
   - The recorded requests are 10 × `PATCH /api/pipeline-steps/:id` under the PATCH-restoring mutation.
   - Today the same test is green (e2e above).
4. **Leave-guard tests: resolved.**
   - `useDraftLeaveGuard.test.tsx` covers:
     - interception of a same-origin link;
     - Keep editing (keeps the draft and the location);
     - Discard (discards, then navigates);
     - ctrl, meta, shift, alt and middle clicks passing through;
     - `_blank`, download, same-path and cross-origin links passing through;
     - no interception without a draft;
     - `beforeunload` registered and preventing only while a draft exists, and removed afterwards.
   - The assertions are behavioural, so a regression would fail them.

No new issues in the cycle-2 diff:
- CSS uses tokens only.
- No escape hatches.
- `files-modified.md` lists every new path.

### Phase 3: UI Review — PASS

- Re-checked live on 7063/9970 with a real draft: desktop at 1280 and phone at 375 (`eval2-1280-dark-draft.png`, `eval2-375-dark-draft.png`), plus the flash measurements above across dark/light and Full/Subtle/Off.
- Console: the only error is the pre-existing schedule 404.
- My throwaway pipeline `b5f00356-…` and source `8dbd14f8-…` were deleted by exact id. Both DELETEs returned 204, and a DB check found 0 rows. Recorded in `.concertino/scratch/HEL-1631/eval2-created-ids.txt`.

### Overall: PASS

### Non-blocking Suggestions

- Add a flash test at or just under the cap, for example 150 new rows. It would pin that the cap does not suppress a flash it should allow.
- The leave-guard mutation-red claim has no saved artifact in scratch. Cite the mutation in the PR body.
- The cycle-1 non-blocking items still stand:
  - last-good frames are lost on a desktop/phone layout switch mid-error;
  - the header chip and name are truncated at 1280;
  - programmatic navigation drops the draft;
  - the quarantined hel968 spec still waits for PATCH or PUT;
  - two hooks are over the soft size budget.
