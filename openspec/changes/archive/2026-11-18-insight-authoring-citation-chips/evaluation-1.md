## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit `d467a6a7fc1e28bdd666554e9d51560bf611d182` against live base `1e0d610bbabb8744c75d11f901a4a88110d5efd5`
(`resolve-review-base.sh`; origin/main has not moved and HEL-1743 / L4 has not merged, so the seed path is still the
right one).

Gates I ran myself in `WORKTREE_PATH`:
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm run typecheck`: exit 0. `npm --prefix frontend run build`:
  exit 0. `npm run check:schemas`: exit 0.
- `npm test` (`HELIO_JEST_MAX_WORKERS=3`): root 66/66 suites, 579 tests. Frontend 809/809 suites, 9826 tests. Exit 0.
  I also ran the named suites on their own (ProvenanceTrigger*, usePortalPopover, PanelContent, OutputEditorSheet*,
  outputKindDrift, the `insight/` suites, insightNode, usePanelData.insight): 28/28 suites, 319 tests.
  `ProvenanceTrigger*.test.tsx`, `usePortalPopover*` and `e2e/hel1756-popover-viewport-fit.spec.ts` are unchanged
  (`git diff --stat` shows nothing), so the D6 refactor is exercised by tests it did not touch.
- `sbt -J-Xmx3g testFull`: I read the summary lines myself: `Suites: completed 722, aborted 0`, `Tests: succeeded 9846, failed 0, canceled 5`, `All tests passed.` Exit 0, run time 18m39s. The 5 cancelled tests are the measurement-only cases gated on `HELIO_MEASURE=1` and similar. These suites ran and passed: `OutputKindDriftSpec`, `OutputInsightPublicRoutesSpec`, `OutputInsightRoutesSpec`, `OutputInsightRlsSpec`, `OutputInsightRetentionSpec`, `OutputInsightReadServiceShapeSpec`. Log: `/home/matt/Development/helio/.concertino/scratch/HEL-1744/eval1/sbt-testFull.log`.
- e2e (`DEV_PORT=7176`, 2 workers): hel1744-insight-panel (5), hel1756-popover-viewport-fit (18), hel1632-live-output
  (15), hel1705-live-output-refresh (4), hel1733-draft-outputs-shapes (32), hel1189-output-panel-controls-live (2),
  hel1510-output-editor-table-overflow (1). Result: **77 passed, 0 failed, 0 flaky, exit 0**. No known flake was hit
  and nothing was re-run.

How I did the UI review: servers came from `start-servers.sh` on 7176/10083, and I checked the port before every
browser step. I seeded my own throwaway data: one beta owner with 7 insight Outputs (rendered, failed after ok, quota
after ok, unchanged after ok, rich markdown, hostile markdown, none) plus a table Output on one board, and one free-tier
owner with an insight and no render. I checked light and dark, at 1440, 1100, 768 and 390 widths. Surfaces covered:
the editor card (create and existing), every panel state, chip focus and the popover, and the public viewer, both
logged out and with a share token. Afterwards I deleted both users by exact id (`buildUserDeleteSql`) and confirmed
zero users, pipelines, dashboards and `output_insights` rows remain. I stopped the servers with `stop-servers.sh`.

### Phase 1: Spec Review — FAIL

The ACs are met: authoring without a prompt, two cited sentences, chip popover with focus in a real browser, public
viewer showing no cost, light/dark and desktop/phone. Every task is ticked. There is no scope creep, and C1-C10 are
honoured: no cost/model/token anywhere, no render trigger, no refresh endpoint, no model key. Issues:

1. **The executor's edit to the `Insight panel fetches no rows` spec leaves the spec contradicting itself and the
   implementation.**
   - The requirement text now allows "a cold first load ... single first request".
   - The scenario under it still says "WHEN a dashboard with an insight panel loads THEN no rows request is made for
     that panel's Output". The implementation fails exactly that scenario.
   - Measured on the running app:
     - A cold load of the board made `GET /api/outputs/<id>/rows?offset=0&limit=200` for all 7 insight Outputs.
     - After a pipeline run completed on a WARM board (all bodies mounted), every insight Output requested its rows
       again. The run invalidates the held metadata, so the gate `getOutputMetaCached(outputId)?.kind === "insight"`
       (`usePanelData.ts:108`) is false at refetch time.
   - So the gate holds only on a warm remount. On load and after every run (the most frequent paths) ignored rows are
     still fetched.
   - Design D7 did allow "or state why it cannot be, with the request count measured". It did not allow rewording the
     requirement while leaving the scenario false. No request count is recorded in any artifact.
   - The ticket's L1 carry-over names "a panel refresh that re-fetches ignored rows". The refresh button is fixed. A
     run completion still re-fetches ignored rows.
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1744/evidence/.concertino/scratch/HEL-1744/eval1/rows-after-run.txt`.
2. **Design D5 deviation (hand-written renderer instead of react-markdown):**
   - Sanitization is sound. In the real browser the hostile render produced only `P/SPAN/BUTTON` elements, no
     `a/img/script/iframe`, no inline handlers, and `window.__pwned` stayed undefined.
   - Markdown fidelity regressed against what the design specified and what the ticket asks ("renders as markdown").
     Seen in Chromium on the `P rich` panel:
     - A list that follows a lead-in line with no blank line (`Leaders:\n1. north 640 [c2]\n2. west 575 [c1]`)
       renders as one paragraph: "Leaders: 1. north 640 ② 2. west 575 ①". This is the natural output shape for the
       `leaders` preset ("Name the leading rows ... in rank order") and for any "use bullets" custom prompt.
       CommonMark lets both `-` lists and `1.` lists interrupt a paragraph.
     - `## A heading` renders with the literal `##`.
     - `> a quote line` renders with the literal `>`, although D5 explicitly allows `blockquote`.
     - `__strong__` and `_em_` render as literal underscores.
   - The executor's stated reason ("react-markdown is mocked in jest") does not stop the designed approach. The
     sanitizer could be asserted in the e2e on a real build, as this spec already does for the chips. That makes this
     an unrequested design change, not a forced one.
   - See CR 2.

### Phase 2: Code Review — FAIL

The other reported deviations are acceptable:
- **3. PanelContent hides the rows states for insight.** Correct. The insight body owns its own states, and an empty
  or unmaterialised rows read says nothing about a render.
- **4. Footer only in PanelCard.** Correct. At base the only "Updated" footer is `PanelCard.tsx`. The phone stack,
  fullscreen and public viewer never had one, and the public viewer has no card footer at all (HEL-1207 A1).
- **5. Ownership lookup only when it can change what is shown.** Correct, and it avoids a `GET /api/pipelines/:id` per
  panel. A small side effect is listed under suggestions.
- **6. PanelContent.test.tsx mocks the insight read.** Correct. The panel now mounts `InsightPanelBody`, and the
  existing assertion was tightened (`role="status"`), not loosened.

The `useProvenancePopoverHost` extraction is a faithful move: same `placeProvenance`, focus, Escape and focus return.
`ProvenanceTrigger*` and `hel1756` pass unmodified.

Backend D8 (`PublicPanelOutputResolver.panelIdsByOutput`) is correct:
- It is scoped to one dashboard, runs after the ACL check and `resolvePanelOutput`, and picks the lowest panel id.
- It is pinned by the placed / unplaced / elsewhere and the double-placement spec cases. The schema is updated.

Issues:

1. **Hand-rolled panel error state with an unstyled button (DESIGN.md §6 [mechanical]: "Use these; do not hand-roll
   equivalents").**
   - `frontend/src/features/panels/insight/InsightPanelBody.tsx:110-117` renders its own `role="alert"` div with
     `<button className="panel-content__state-action">`.
   - `panel-content__state-action` is defined nowhere: `grep -rn state-action frontend/src` has one hit, the usage
     itself. So the Retry is an unstyled native button.
   - Every other panel's error state (`PanelContent.tsx:173-187`) uses `panel-content--error` plus the shared
     `InlineError` (`variant="banner"`, `onRetry`, `announced={false}`).
2. **Phone layout breakage in the insight settings card (390x844, dark; mechanical, measured):**
   - In the create sheet with Kind = Insight, `.insight-fields` spans x 57–375. Its card
     (`.output-editor-sheet__group--card`) spans x 40–350, with `scrollWidth 334 > clientWidth 308`.
   - The Preset `Select` and the Refresh `ui-segmented` control (`scrollWidth 316`) cross the card's right border.
   - `.ui-modal__body` scrolls sideways (`scrollWidth 355 > clientWidth 350`).
   - The same sheet with Kind = Chart does not overflow (`308 == 308`).
   - Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1744/evidence/.concertino/scratch/HEL-1744/eval1/phone-card-overflow.txt`
     and `.../eval1/card-create-dark-390.png`.
3. **Two tests prove less than they claim.**
   - (a) The e2e footer assertion is vacuous.
     - `e2e/hel1744-insight-panel.spec.ts:257-260` expects `Updated <today>`.
     - The seeded render's `created_at` defaults to `now()`, and the panel's `meta.lastUpdated` is also today.
     - So reverting `PanelCard.tsx:337-344` to `panel.meta.lastUpdated` still passes. No jest test renders
       `PanelCard` with an insight body either: `useInsightChrome` is consumed by `PanelCard.tsx`/`MobilePanelStack.tsx`
       and exercised by no test.
     - I confirmed the wiring works by eye: footers showed 11/15 and 11/17 for renders seeded 2 days and 100 minutes
       back. Still, no test would catch the regression.
   - (b) The `usePanelData.insight.test.tsx` gate is tested only for held metadata. The run-completion path (Phase 1
     issue 1) is untested.

### Phase 3: UI Review — FAIL

What works, observed in the running app:
- Happy path. All seven states render as specified: rendered; failed-with-previous (error-colour note); unchanged and
  quota (quiet notes); not-yet-rendered as `role="status"`; upsell for the free owner with a working
  `/settings#beta-access` link.
- No console errors from this change. The 404s on `/schedule` and `/steps/__root__/preview` and the 502 on
  `/run-events` through the Vite proxy all predate it.
- Chip click and Enter both open the popover:
  - computed `visibility: visible`, opacity 1, non-zero rect, `elementFromPoint` at its centre inside it;
  - `document.activeElement` is inside the popover;
  - Escape returns focus to the chip with an accent focus ring, and `aria-expanded` toggles.
- The popover fits at 390 wide (x 32–382).
- Public viewer (logged out, share token):
  - chip c1 fetched the table panel's `/provenance`; chip c2 fell back to the insight panel's own;
  - no notes are shown;
  - the page and the public response carry no model, token or cost value or word, and no Output id.
- Pull-to-refresh and refresh-button wiring: the refresh button re-read only `/insight`.
- Dark theme parity is fine on the panels and the popover.

Issues:
- The phone layout breakage in Phase 2 issue 2.
- The markdown fidelity gaps in Phase 1 issue 2. Both are visible in the running app.

### Overall: FAIL

### Change Requests

1. **Rows gate: make the run-completion path skip rows, and make the spec honest.**
   - Code: an Output's kind cannot change after create (the sheet locks it), so a resolved `insight` kind can be
     remembered per Output id. For example, keep the kind from `usePanelData`'s own resolved `output` across a
     freshness invalidation, or read it from a kind map that the invalidation does not clear. Then `usePanelData.ts:108`
     stays true after a run, and a run completion on a mounted insight panel makes no `/rows` request.
   - Test: add a case to `usePanelData.insight.test.tsx` where held metadata is invalidated by a pipeline-terminal
     event and no rows request follows.
   - Spec: rewrite the `No rows request` scenario in `specs/insight-panel/spec.md` so it matches the requirement. One
     scenario for the cold first load making exactly one ignored request; one for a run completion or warm remount
     making none.
   - Record the measured cold-load request count in the change, as D7 asked.
2. **Insight markdown fidelity.** Pick one option:
   - (a) Implement D5 as designed: react-markdown, lazy, in MarkdownPanel's chunk, with `skipHtml`, the
     `allowedElements` allow-list, `unwrapDisallowed`, `urlTransform: () => ""` and the citation handler. Assert the
     hostile-markdown and chip cases in `e2e/hel1744-insight-panel.spec.ts` against the real build, since jest mocks
     react-markdown.
   - (b) Keep `InsightMarkdown.tsx` and extend it, with jsdom tests for each case:
     - a `-`/`*`/`1.` list line that interrupts a paragraph starts a list (the `Leaders:\n1. …\n2. …` shape);
     - ATX headings `#`–`######` render their text without the hashes, as a paragraph or `strong`, never as `h*`;
     - `> ` lines render as `blockquote` (D5 allows it);
     - `__x__` and `_x_` render as strong and em, without breaking `snake_case`;
     - a `[cN]: url` definition line is dropped rather than turned into a chip followed by the URL (D5: "definitions
       are removed").

   Either way, keep the current guarantee: no `a`, `img`, `script` or `iframe` element and no inline handler.
3. **Use the shared panel error recipe** in `InsightPanelBody.tsx:110-117`: `className="panel-content
   panel-content--state panel-content--error" role="alert"` wrapping `<InlineError error="Could not load this insight"
   variant="banner" onRetry={refetch} announced={false} />`, matching `PanelContent.tsx:173-187`. Then delete the
   undefined `panel-content__state-action` class. Add or adjust the jest error-state case to assert the Retry action.
4. **Fix the phone overflow of the insight card.**
   - The card's grid track must be allowed to shrink: e.g. `.insight-fields > * { min-width: 0 }`, or
     `grid-template-columns: minmax(0, 1fr)` on `.insight-fields` in `OutputEditorSheet.css`.
   - The Refresh `SegmentedRadioGroup` must fit the 276px content box at 390 wide, e.g. by letting it wrap or using the
     shorter labels the other segmented groups in this sheet use. Its natural width is 316px.
   - Verify `.output-editor-sheet__group--card` `scrollWidth === clientWidth` and `.ui-modal__body` has no horizontal
     overflow at 390x844, in both themes.
   - Add that assertion to the phone run of `e2e/hel1744-insight-panel.spec.ts`.
5. **Make the footer test able to fail.**
   - In `e2e/support/insightSeed.ts`, accept an optional `createdAt` (validated ISO) and seed a render dated several
     days back.
   - In `e2e/hel1744-insight-panel.spec.ts:257-260`, assert `Updated <that date>` and that today's date is NOT shown.
   - Optionally add a jest case rendering `PanelCard` around an insight body that asserts the footer uses
     `renderedAt` and not `panel.meta.lastUpdated`.

### Non-blocking Suggestions

- `OutputEditorSheet.tsx` grew from 384 to 439 lines, past CONTRIBUTING's ~400-line threshold. Propose a split in the
  PR description, for example moving the insight node/candidates/default block (l.146-187) into a `useInsightEditorState`
  hook.
- The checklist group label reads "Same step" for a root-bound insight (seen in the editor, where both Outputs are
  root-bound). "Same node" or "Same source" would be accurate for roots.
- The free-tier owner briefly sees "Not yet rendered" before the ownership fetch resolves and the upsell replaces it.
  Consider holding the state until ownership is known when `ownershipMatters` is true.
- The chip popover's visible heading is the generic "Data provenance". It does not name the cited field or Output.
  D6 suggested "Source: <field>" as the label. This is a judgment call for the skeptic.
- On the public viewer, the insight `ul` sits inside the viewer's own list, so it gets `circle` bullets instead of
  `disc`. Setting `list-style-type: disc` on `.insight-markdown ul` would keep the two surfaces consistent.
- `InsightMarkdown.tsx:65,74` use non-null assertions (`BULLET.exec(l)![1]`). Capturing the match in the
  `every`/`map` pass would remove them.
