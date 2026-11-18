## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit `c37c6adbb78b4e345717c62f79b314158759e07f` (cycle-2 diff `d467a6a7f..c37c6adbb`; the full branch was
also compared against the live base `1e0d610bb`).

Since evaluation-1, origin/main has moved to `9054da2a6` (HEL-1758). I did not merge it. Conflict risk:
- No file is changed on both this branch and HEL-1758.
- `git merge-tree --write-tree HEAD origin/main` is clean.
- HEL-1758 regenerated the e2e shard weights, which do not include `hel1744-insight-panel.spec.ts`. Only the shard
  balance is affected, not correctness.

Gates I ran myself in `WORKTREE_PATH`:
- `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run check:schemas`, `npm --prefix frontend run build`:
  all exit 0. The build emits `InsightMarkdownView-*.js` as its own lazy chunk next to `MarkdownPanel-*.js`.
- `npm test` (3 workers): root 66/66 suites, 579 tests; frontend 809/809 suites, 9827 tests, 0 failures.
- `sbt testFull`: not re-run this cycle.
  - `git diff --name-only d467a6a7f..HEAD` contains no `backend/` or `schemas/` path.
  - The backend is byte-identical to the commit whose full run I read in cycle 1: 722 suites, 9846 succeeded, 0 failed,
    "All tests passed".
- e2e (DEV_PORT=7176, 2 workers): hel1744-insight-panel, hel1756-popover-viewport-fit, hel1632-live-output,
  hel1705-live-output-refresh, hel1733-draft-outputs-shapes, hel1189-output-panel-controls-live and
  hel1510-output-editor-table-overflow. Result: **77 passed, 0 failed, 0 flaky**, exit 0. No known flake was hit.
  All four hel1744 runs logged `cold-load rows requests for the insight Output: 1`.

How I did the UI review: I started the servers with `start-servers.sh` and checked the URL/port before every browser
step. I seeded fresh throwaway data, as in cycle 1:
- a beta owner with 7 insight Outputs (rendered, failed-after-ok, quota, unchanged, rich markdown, hostile markdown,
  none) plus a table, on one board;
- a free owner with an insight that has no render.

I checked light and dark at 1440, 1100 and 390. Afterwards I deleted both users by exact id (0 remain), stopped the
servers with `stop-servers.sh` and closed the browser tab.

### Phase 1: Spec Review — PASS

- **The rewritten `Insight panel fetches no rows` spec is honest and consistent.** The cycle-1 wording contradicted its
  own scenario. The requirement now states the cold-load exception and pins it to *exactly one* request per insight
  panel, with an explicit scenario. It extends "no request" to run completion and warm remount, so it covers more
  than the cycle-1 code did. This is not a weakened requirement: design D7 allowed the cold-load exception if the count
  was measured. The measured counts are recorded in `measurements.md` and match mine.
- All tasks remain done. There is no scope creep. Constraints C1-C10 are honoured: no cost, model or token value
  anywhere; no render trigger, refresh endpoint or model key.

### Phase 2: Code Review — PASS

How each cycle-1 change request was checked:

1. **Rows gate (CR1): fixed.**
   - `outputMetaCache.ts` keeps `knownKinds`. It is set on fetch and on seed, survives a run's invalidation, and is
     cleared only by a freshness reset.
   - `usePanelData.ts` gates on `getKnownOutputKind`.
   - Measured on the running app: a warm board, then `POST /run`.
     - The only rows request was the table Output's.
     - None of the 7 insight Outputs requested rows.
     - All 7 insight panels re-read `/insight`.
   - Cold load with IndexedDB `helio-warm` deleted: exactly one rows request per insight Output.
   - The jest case has a recorded red mutation: the cycle-1 code fails it.
2. **react-markdown per D5 (CR2): fixed.**
   - Code: lazy `InsightMarkdownView` with `skipHtml`, an allow-list (p, strong, em, ul, ol, li, code, br, blockquote,
     `helio-citation`), `unwrapDisallowed`, and `urlTransform: () => ""`. The citation element is mapped through
     `components`.
   - The pure `remarkCitationChips` plugin is unit-tested unmocked. It drops definitions and image references, turns
     headings into a strong paragraph, and leaves inline code alone.
   - Fidelity, measured in Chromium:
     - `Leaders:` followed by `1.`/`2.` gives `<p>Leaders:</p><ol><li>…`;
     - `## A heading` gives `<strong>A heading</strong>`;
     - `> quote` gives `<blockquote>`;
     - `__dunder__` and `_under_` give strong and em;
     - `snake_case_name` stays intact.
   - Sanitization, measured in Chromium:
     - no `a/img/script/iframe/h*/[href]/[src]/[onerror]` inside any `.insight-markdown`;
     - raw HTML is dropped;
     - links become their text;
     - `[c9]` stays literal text;
     - `window.__pwned` stays undefined.
   - The public viewer shows the same results.
   - The deleted `InsightMarkdown.test.tsx` covered the old hand-written renderer. Its role now belongs to the e2e
     `expectRichMarkdown`, which runs against the real build. Its "allow `a`" mutation is recorded red.
3. **Error recipe (CR3): fixed.**
   - `InsightPanelBody.tsx` now renders `panel-content--error` with `role="alert"`, wrapping the shared `InlineError`
     (`variant="banner"`, `onRetry`, `announced={false}`).
   - The undefined class is gone.
   - The error state actually appeared in the running app: a dev-server 429 on one insight read. It used the shared
     error recipe, and Retry recovered the panel to its render plus the failed note.
4. **Phone overflow (CR4): fixed in both themes.**
   - At 390x844 the card measures `scrollWidth 308 == clientWidth 308`, and the visible modal body measures 350 == 350.
   - The segmented control spans x 57–333, inside the card's 40–350. No option label overflows.
   - The e2e asserts `{cardOver: 0, bodyOver: 0}` and has a recorded red mutation.
5. **Footer test (CR5): fixed.**
   - The seed takes a validated `createdAt`, 5 days back.
   - The e2e asserts the rendered date and the absence of today's date.
   - The recorded mutation (reverting `PanelCard` to `meta.lastUpdated`) goes red.

Other diff notes:
- Seed: the markdown is dollar-quoted, with the tag and NUL refused, and the ISO `createdAt` is validated by regex.
  The helper is test-only.
- `useInsightEditorState.ts` extraction: `OutputEditorSheet.tsx` is back under the ~400-line threshold.

### Phase 3: UI Review — PASS

All checks were made in the running app:
- **Panel states:** every one renders correctly in light and dark: rendered, failed-with-previous, unchanged, quota,
  none, error/Retry, and the upsell with a working `/settings#beta-access` link.
- **Chips, desktop and phone:**
  - the popover shows (`visibility: visible`, non-zero rect, hit-tested inside);
  - focus moves into it;
  - Escape returns focus to the chip.
- **Public viewer** (logged out, share token):
  - no state notes;
  - chip 1 fetched the placed table panel's provenance, and chip 2 fell back to the insight panel's own;
  - no seeded model, token or cost value and no such words on the page;
  - `ul` bullets are `disc`.
- **Editor card**, create flow at 390 in light and dark: fits, labelled "Same node".
- **Console:** no errors from this change. The 404s on `/schedule` and `/preview` predate it, and the 429s came from my
  own request volume against the dev rate limit.

### Overall: PASS

### Change Requests

None.

### Non-blocking Suggestions

- **`measurements.md` makes a claim that is false.** It says "The e2e cannot drive a run completion: the dev server's
  Vite proxy does not carry the run-events SSE."
  - On the dev server, a run completion IS observed: `/run-events` stays open through the proxy, `/runs/latest` is
    polled, and every insight panel re-read `/insight` after `POST /run`.
  - Please correct the line before archive so the false claim does not become a durable artifact.
  - Cite this measurement instead:
    `/home/matt/Development/helio/.concertino/runs/HEL-1744/evidence/.concertino/scratch/HEL-1744/eval2/run-completion.txt`.
  - Optionally assert `rowsRequests` stays unchanged after a `POST /run` in `hel1744-insight-panel.spec.ts`. The jest
    case simulates run completion with `invalidatePipeline` + `refresh()`, not the real terminal subscription.
- **The "Not yet rendered" flash for a free-tier owner is still there.** A MutationObserver saw `insight-not-rendered`
  before `insight-upsell` on the free owner's board. The likely cause: `tier` is not loaded yet, so `ownershipMatters`
  is false and ownership resolves to `false`, not `undefined`. The skeleton hold added this cycle does not cover that
  window. This is cosmetic.
- At 390x844 the chip popover's bottom (y=800) sits under the floating bottom nav. This comes from the shared HEL-1756
  placement, not this change. It may be worth a follow-up.
- `InsightMarkdownView.tsx` casts `components` with `as unknown as Components` to key a custom element. A typed
  `Components & Record<typeof CITATION_ELEMENT, …>` would avoid the double cast.
