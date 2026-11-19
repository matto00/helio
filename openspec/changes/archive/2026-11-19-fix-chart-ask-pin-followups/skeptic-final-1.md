## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `19164c2ed3c771f1b287c83fb9c0e540399635be` against live-resolved base `d8cdfb460f65d130af533770aeadc798dbe30daf`
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/editor-chart-ask-pin-followups/HEL-1775`.

### What I verified (with evidence)

**Red-first structure.** `817e0ca30` (red commit) touches only tests and openspec (`git show --stat`). Test drift from the red
commit to HEAD is limited to a Prettier re-wrap of two lines in the e2e spec and the intended inversion of the old
`AskDataServiceSpec` fallback assertion (`git diff 817e0ca30 19164c2ed -- e2e frontend/...AskPanel.test.tsx backend/src/test`).
So the red runs recorded in red-evidence.md ran the final tests against the unchanged source.

**Item 1: the editor chart fills its card (AC: desktop and phone, light and dark, red first).**
- Fix: `OutputEditorSheet.css:150-152`. `.output-preview-pane__chart` becomes `display: flex; flex-direction: column`, and the
  240px height is kept.
- Root cause probed live: with the servers on 7207/10114 and the lane DB, I injected a `display:block !important` override for
  `.output-preview-pane__chart` before opening the editor on a fresh page. The result was `.panel-content` 100 and canvas 100.
  Without the override it is card 240 and canvas 240. This reproduces the ticket's 100px and shows the flex parent is the cause.
- E2E run by me (`DEV_PORT=7207 BACKEND_PORT=10114`, lane DB, `--workers=2`, project `dev`): `hel1775-output-editor-chart-fills-card`
  plus `hel1763-output-editor-preview-scroll` gave **9 passed**. The measure lines read `1280 dark card=240 canvas=240`,
  `375 light card=240 canvas=240` and `375 dark card=240 canvas=240`; the 1280 light case also passed. In HEL-1763, the
  375/390 dialog and body scroll extents still end at their content.
- Visual judgment from screenshots I took and looked at:
  - 1280 light: `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/skeptic/editor-1280-light.png`
  - 375 dark: `/home/matt/Development/helio/.concertino/runs/HEL-1775/evidence/.concertino/scratch/HEL-1775/skeptic/editor-375-dark.png`
  - The chart fills the PREVIEW card with the same inset as the card's header. There is no dead space below the axis, the
    spacing matches the sibling "Ask about this Output" card, there is no horizontal overflow at 375 (`scrollWidth` 375), and the
    surface and text tokens are unchanged in dark. No new tokens or hardcoded values were introduced. The CSS is two layout
    properties on an existing class.

**Item 2: the question resets with the answer on a dashboard switch (AC: red-first test for the chosen behaviour).**
- Fix: `AskPanel.tsx:24-28` holds the question as `{key, text}` keyed by `scope.kind:scope.id`. This is the same pattern as
  `useAsk`, with no effect-driven reset.
- Jest, run by me: `npm --prefix frontend test -- --testPathPatterns=features/ask` gave 7 suites and **61 passed**. That includes
  the new scope-change test (field `""`, no stale answer, Ask disabled, one request) and the in-scope retention guard.
- Pre-fix red, by inspection plus a live probe: the base used a bare `useState("")`. In the running app the drawer's textbox is
  the **same DOM element** across a close, a dashboard switch and a reopen (`sameElement: true`), so the base code had to keep
  the question.
- Live check (beta user in the lane DB): on SK Board A I typed a question, closed the drawer and reopened it on A, and the
  question was kept. I then switched to SK Board B and reopened the drawer: same element, value `""`.
- Typecheck exit 0, eslint `--max-warnings 0` exit 0, Prettier clean on the changed files.

**Item 3: a backend test sends the step-less fallback body to the real create route.**
- `AskPinRealRouteSpec` builds `ApiRoutes(...).routes`, the real route tree (`AskApiHarness.buildAskApi`, lines 154-170). It
  seeds a root whose id differs from the pipeline id, builds the pin with the real `AskPinBuilder` for a copy with
  `NodeRef(pid, None, None)`, POSTs it to `/api/pipelines/:id/outputs`, and asserts `201` with `rootId` equal to the real root.
- Fix: `AskPinBuilder.scala:31-46` omits the node instead of guessing `pipelineId`. The ticket's "fix the builder" branch applied.
- sbt, run by me (`-J-Xmx3g`, `ANTHROPIC_API_KEY` empty): `AskPinRealRouteSpec` plus `AskDataServiceSpec` gave **26 succeeded,
  0 failed**, including both new route cases. `AskSeamSpec` plus `AskRoutesSpec` gave **14 succeeded, 0 failed**.

**Specs.** The deltas under `specs/{ask-ui,ask-your-data,pipeline-output-sheet}` match the implemented behaviour.

**Cleanup.** I stopped the servers with `stop-servers.sh` (`STOPPED ports=7207,10114`) and dropped `helio_hel1775`, which also
removes the throwaway user and boards. I modified no code.

### Verdict: CONFIRM

### Non-blocking notes
- The multi-root `400` path for a node-less pin is described in design.md and the spec but has no test. It is unreachable for
  stored Outputs because of V98's CHECK.
- design.md Decision 4 says the pipeline is created via `POST /api/pipelines`. The spec seeds it with SQL instead. The property
  that matters, root id differing from the pipeline id, still holds. I agree with the evaluator's wording nits on
  `mutations.md` and the pipeline-output-sheet requirement (an annotation footnote makes the canvas legitimately shorter).
- The URL stayed on board A's id while the title showed board B after a sidebar switch with the drawer state in play. This is
  not touched by this change. I observed it once and did not reproduce it.
- No gate defect: no mtime-ordering evidence was relied on.
