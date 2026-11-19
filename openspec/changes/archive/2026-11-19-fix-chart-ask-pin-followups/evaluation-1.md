## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 19164c2ed3c771f1b287c83fb9c0e540399635be against live-resolved base d8cdfb460f65d130af533770aeadc798dbe30daf
(red commit 817e0ca30, fix commit 19164c2ed).

### Phase 1: Spec Review — PASS
- Item 1 (chart fills card, desktop + phone, light + dark, red first): addressed. `OutputEditorSheet.css` makes
  `.output-preview-pane__chart` a flex column (design Decision 1). The red e2e failed 4/4 at canvas 100 vs card 240
  (persisted log `.concertino/scratch/HEL-1775/red-e2e.txt`).
- Item 2 (question resets with the answer on a dashboard switch): addressed in `AskPanel.tsx` with a scope-keyed
  `{key, text}`, so both surfaces (drawer and Output sheet) are covered. `App.tsx` and `usePanelData` are untouched
  (zero hits in `git diff --name-only`).
- Item 3 (fallback body through the real create route): addressed. `AskPinRealRouteSpec` builds the real `ApiRoutes`
  (`AskApiHarness.buildAskApi` -> `new ApiRoutes(...).routes`) and POSTs to `/api/pipelines/:id/outputs` over HTTP,
  not through a service call. The root id is a fresh `UUID.randomUUID()` that differs from the pipeline id. The builder
  was fixed because the route rejected the old body with 400.
- Tasks 1.1-4.3 are all marked done and match the diff. The spec deltas (ask-ui ADDED, ask-your-data MODIFIED with the
  full requirement block, pipeline-output-sheet ADDED) describe the implemented behavior. No scope creep, no schema or
  contract change.
- CONSTRAINTS: C1-C5, C13 and C14 are honored by what I could observe. The lane DB `helio_hel1775` did not exist when
  I started, and the shared `helio` DB has 0 users, pipelines or sources matching `hel1775`. C12 is discussed under
  "C12 mutation judgment" below.

### Phase 2: Code Review — PASS
Fresh gate runs (mine, in WORKTREE_PATH; logs in `.concertino/scratch/HEL-1775/eval/`):
- `npm run lint`: 0. `npm run format:check`: 0. `npm run typecheck`: 0. `npm --prefix frontend run build`: 0.
- `npm test` (jest, 3 workers): 70/70 root suites (617 tests), 865/865 frontend suites (10219 tests).
- Backend (`sbt -J-Xmx3g testOnly`, sharded per C5, `ANTHROPIC_API_KEY` empty). I did not run the full `testFull`
  because it cannot fit in one tool timeout. Instead I ran every spec that references the pin or the ask/output-create
  path:
  - Shard 1: `com.helio.api.routes.ask.*`, `com.helio.services.ask.*`, `AskSeamSpec`, `InsightSeamSpec`,
    `OutputInsightRoleAndRefreshRoutesSpec`, `ExistenceNotLeakedRoutesSpec`. 10 suites, 138 tests, 0 failed.
  - Shard 2: `com.helio.api.routes.pipelines.Output*`. 9 suites, 213 tests, 0 failed.

Code checks:
- `AskPinBuilder.scala`: `node` is now an `Option`. With neither a step nor a root id, neither key is sent and the
  comment explains why. The key order changed (node first, now built from a Map), which is harmless for JSON.
  `AskSeamSpec` passes, so the committed fixtures still match.
- `AskPanel.tsx`: the scope-keyed state follows the same pattern as `pinNote` and `useAsk`. There is no effect-driven
  reset, and `setQuestion` is not a dependency of any hook. The doc comment is updated.
- CSS change: 2 declarations, no tokens involved (`display` and `flex-direction` only). No DESIGN.md mechanical
  violation.
- Tests are meaningful. Every new red test was confirmed red against reverted code (see below).
- No dead code, no TODOs, no `any`.

C12 mutation judgment (the orchestrator asked for this specifically):
`mutations.md` reuses the pre-fix red runs instead of re-reverting each fix after implementation. I checked whether
that is equivalent. `git diff 817e0ca30 19164c2ed` on test files shows that the e2e spec changed only by a Prettier
re-wrap of two lines. The only other test change is the intended `AskDataServiceSpec` fallback update (task 1.3). So
the red run was exactly "final tests + reverted fix". For each item, the narrowest meaningful mutation is the revert
itself (one CSS rule pair, one key-comparison line, one fallback expression). The record is thin, but in substance the
requirement is met. I re-ran the mutations myself rather than trust the record:
- Item 2: I made a throwaway detached worktree at HEAD and restored `AskPanel.tsx` from the base. Jest: 1 failed / 24
  passed. The failure was the scope-change test: "Expected the element to have value: '' Received: Why is revenue up?"
  (ref `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/eval/jest-mut.txt`).
- Item 3: same worktree with `AskPinBuilder.scala` restored from the base. `AskPinRealRouteSpec` failed 1 / passed 1:
  "rootId '<pid>' does not belong to pipeline '<pid>': 400 was not equal to 201"
  (ref `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/eval/be-mut.txt`).
- Item 1: a live mutation in the running app. Setting `display: block` inline on `.output-preview-pane__chart` and
  resizing gave `.panel-content` 129px and canvas 100px. Restoring it gave content 240 and canvas 211 (the chart had
  an annotation, which takes 29px).
- The throwaway worktree was removed: `git worktree remove --force`, and `git worktree list` shows no straggler.
- Verdict on this point: satisfied, so no change request. See the suggestion below about strengthening `mutations.md`.

Hooks: the red commit used `--no-verify`. That is expected and required: C12 commits the red run, and the hook's jest
step would block it. I cannot prove from git that hooks ran on the fix commit, but every check the hook runs (lint,
typecheck, Prettier, jest) passes on my fresh run of HEAD.

### Phase 3: UI Review — PASS
Servers ran via `start-servers.sh` on 7207/10114 against the lane DB `helio_hel1775` (I created it; Flyway reached
V146). They were stopped with `stop-servers.sh`, and the DB was dropped afterwards. `ANTHROPIC_API_KEY` was empty.

- e2e, run by me with DEV_PORT/BACKEND_PORT/DATABASE_URL pinned, 2 workers, project `dev`:
  - Batch 1 (`hel1775`, `hel1763`, `hel1306`): 17 passed. The hel1775 measurements were card=240 and canvas=240 at
    1280 light, 1280 dark, 375 light and 375 dark. The measure targets `.output-preview-pane__chart` (the 240px box,
    read with `clientHeight` minus padding) and compares it to that box's own canvas, so it is not vacuous: the red was
    100.
  - Batch 2 (`hel1746`, `hel1781`, `hel1773`, `hel1398`, `hel1444`): 50 passed.
  - Batch 3 (`hel1705`, `hel1090`, `hel1573`, `hel1307`, `hel1692`): 24 passed.
  - These batches cover every e2e file matching `.output-preview-pane__chart`, `.panel-content` or the ask question
    field (my own grep agrees with the executor's list).
- Manual checks in the running app:
  - Editor chart at 1440/1280 dark: fills its card, and the annotation footnote sits inside it with its bottom delta 0
    (ref `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/eval/editor-1280-dark.png`).
  - 375 light: same result, no horizontal overflow
    (ref `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/eval/editor-375-light.png`).
  - 1100 and 768: card 240, canvas fills the width.
  - Ask drawer (beta user in the lane DB): on board A I typed a question and got the 503 error state. The question was
    kept, the error was visible, and Retry was offered. I then switched to board B and reopened the drawer. The same
    textbox element was still mounted (identical a11y ref) and was empty, with the Ask button disabled and no stale
    error (ref `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/eval/ask-after-switch-1440.png`).
- Console: the only errors were the expected 404 on `/schedule` for an unscheduled pipeline and the expected 503 ask
  (no key). Neither comes from this change.
- Accessible names are unchanged ("Your question", "Ask").

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `mutations.md`: say explicitly that the test files are byte-identical (modulo the Prettier re-wrap) between the red
  and fix commits. That fact is what makes "reverted by construction" valid. Without it, a later reader cannot tell
  that the red run was a revert of the final tests. Also name the guard tests (AskPanel "question survives a failed
  ask" and AskPinRealRouteSpec case (a)) as guards that were not mutation-proven.
- `AskPinRealRouteSpec` seeds the pipeline and root with SQL. Design Decision 4 said "creates a pipeline via `POST
  /api/pipelines`". The property that matters (root id differs from pipeline id) holds either way, but design.md
  should match what was built.
- The pipeline-output-sheet requirement says "the rendered chart's height equals the preview card's content height".
  With an annotation or truncation footnote, the canvas is correctly shorter (211 of 240). Consider wording it as
  "the chart's panel content fills the card".
