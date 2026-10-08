## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `80196536d3024a35cc2a9b807be946ea444d25cc` (diff base `0ebc784be678caa547bebe76c070a6834bad7e6b`, resolved live by `resolve-review-base.sh`).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- AC1: verified live. A 1,234-row chart Output loaded 200 rows and showed "Based on the first 200 of 1,234 rows." under the chart, for both a raw line chart and an aggregated bar chart. Design D2 chose "Based on" over the ticket's example "Showing", and the reason is sound: an aggregated chart plots 5 bars, not 200 rows. The ticket gave "Showing" only as an example ("e.g."), so this is not a silent reinterpretation.
- AC2: verified live. The 41-row "over time" chart and the 5-row "top region" chart rendered no note, on both the authenticated and the public dashboard.
- AC3: verified live. The public share-link viewer showed the same note on both truncated charts and none on the complete ones. The public rows endpoint already returned `total: 1234` (curl check). No backend or schema file is in the diff.
- AC4: the note uses existing tokens only (`--space-*`, `--app-text-muted`, `--font-sans`, `--text-xs`). Computed contrast: light `rgb(100,94,86)` on `rgb(253,252,250)` is about 6.4:1, and dark `rgb(170,164,156)` on `rgb(26,24,22)` is about 7.9:1. The note is a plain `<p>` with text in the DOM and is not under `aria-hidden`.
- AC5: the overlay gate (`history/chartOverlay.ts`) is untouched. `PanelContent.chartTruncation.test.tsx:160-172` shows "vs 7d" present while the chart is untruncated and absent once truncated, so it fails if the gate breaks. proposal.md states the overlay is deferred; the PR body still has to say so too (orchestrator).
- Tasks: 1.1–2.6 are done except 2.5, which was delegated to this evaluator and is now done (evidence below). tasks.md still shows 2.5 unchecked.
- Scope: frontend only, matching the proposal's Impact list. No scope creep.
- CONSTRAINTS: `[]`. Nothing to honor.

### Phase 2: Code Review — PASS
Gates, run fresh by me in WORKTREE_PATH (`nice -n 19`, jest `--maxWorkers=3`):
- `npm run lint`: clean (0 warnings)
- `npm run format:check`: "All matched files use Prettier code style!"
- `npm run typecheck`: clean
- `npm test`: 473/473 suites, 4,958/4,958 tests passed, plus a second project with 42/42 suites and 404/404 tests (EXIT=0)
- `npm --prefix frontend run build`: succeeded (EXIT=0)
- Backend: no `backend/**` files changed, so `sbt testFull` does not apply.

Review:
- Correctness:
  - `chartTruncationNote` fails closed: it returns nothing unless `rowsTruncated === true`, the total is a finite number, and loaded < total.
  - The loaded count is `rawRows.length` before any cross-filter is applied, so a client-fallback cross-filter does not shrink the numerator. Confirmed live: the note kept "200 of 1,234" while the disclosure read "40 of 200 loaded rows match."
  - `narrowed` = viewer filter or server cross-filter, which matches the HEL-1027/HEL-1191 rule that `total` becomes the filtered total in those cases.
  - Fullscreen and the detail modal read the same `paginationState[panel.id].total` the grid card uses (D5). No new fetch.
- DESIGN.md [mechanical]: compliant. Font size, spacing and color all use tokens, with no hard-coded hex values and no inline styles. `line-height: 1.4` matches the existing `.chart-panel__annotation` precedent.
- CONTRIBUTING: no type escape hatches. No dead code. Comments explain why. `PanelContent.tsx` (531 lines) and `PanelDetailModal.tsx` (587 lines) were already over the ~400-line threshold before this change (+9 and +3 lines here); see suggestions.
- Tests are meaningful: the pure helper is tested with locale-independent formatting, plus render tests for shown, complete, unknown and aggregated cases, DOM order of the three footnotes, and the overlay staying hidden.

### Phase 3: UI Review — PASS
Servers were started with `start-servers.sh` and `assert-phase.sh servers` passed. I confirmed they serve this worktree's code: the listening PIDs' cwd for ports 6790 and 9697 is this worktree, and Vite serves the new `chartTruncationNote.ts`.

Test user: a new user of my own, logged in through `/api/auth/login` from the page (not `matt@helio.dev`).

Observed:
- Happy path: grid card (1440, dark and light), fullscreen, detail modal, mobile stack (768 and 375), and the public viewer (dark and light) all show "Based on the first 200 of 1,234 rows." on the two truncated charts and no note on the complete charts.
- Three footnotes together at the default grid size (aggregated chart, md breakpoint, 567×262 card), after "Filter dashboard" on the North bar of the top-region chart:
  - The cross-filter fell back to client-side filtering.
  - DOM order: annotation, then truncation note, then "40 of 200 loaded rows match."
  - All three sit inside the card. The canvas drops to 67px with all three present (94px with annotation and note only).
- Breakpoints: at 1440, 1100, 768 and 375 the note stays inside its card and there is no horizontal page overflow. It is not ellipsized at any default panel size.
- Narrow panel (w=2 at md, card 216px wide): the note is ellipsized to "Based on the first 200 of …". The full text is in the DOM and in `title`. The canvas is 22px; most of the space goes to the 3-line title and the 2-line annotation. See suggestions; this is a design-D3 trade-off for the skeptic.
- Console: no errors caused by this change. Seen on our origin:
  - A 403 from my own first login attempt, which lacked the CSRF header.
  - Intermittent `502` on `/api/pipelines/<id>/run-events` (the SSE stream, cut off when the page navigates or reloads). Neither the backend nor the Vite config is in the diff, so this predates the change.
  - ECharts "Can't get DOM width or height" warnings during breakpoint remounts (already known; see HEL-1392).
- Not exercised live: the "matching rows" wording, since no viewer control or server-path cross-filter hit a >200-row chart in this fixture. It is covered by `chartTruncationNote.test.ts` and `PanelContent.chartTruncation.test.tsx:96`.

Evidence. Durable refs from `persist-evidence.sh`, all under `/home/matt/Development/helio/.concertino/runs/HEL-1358/evidence/.playwright-mcp/hel1358-eval1/`. Claims rest on DOM measurements quoted above, not on file ordering.
- `01-auth-grid-dark-1440.png`
- `02-auth-coexist-annotation-note-crossfilter-dark.png`
- `03-auth-grid-light-coexist.png`
- `04-auth-fullscreen-light.png`
- `05-auth-detail-modal-light.png`
- `06-auth-mobile-375-light.png`
- `07-auth-narrow-panel-w2-dark.png`
- `08-public-dark.png`
- `09-public-light.png`

Dev-DB residue created by this evaluation (exact ids):
- user `6a8a98d9-f0db-4314-8a1b-3a9d7dd4cc72` (`eval-hel1358-1791469637@example.test`), plus its sessions
- data source `a357d74c-5b57-4e17-9df6-115d8e96db56` (uploaded file `csv/a357d74c-5b57-4e17-9df6-115d8e96db56.csv` in the shared uploads root)
- pipeline `35f180c6-70f9-4c13-97c7-313fd39a3361` (plus its first-run pipeline run rows)
- outputs `c0b3d554-7d4a-46eb-bed8-8373d5b55f8e`, `7ec418f8-939d-49df-92f6-690b0f00bdd3`, `977ec07e-ee43-400d-af91-f20500a481a7`, `eb94375f-38d2-4c22-a7bf-063253344ed6`, `ad30d29e-7fca-45ba-b2d6-356117c7c3d1`
- dashboard `ac8e5646-ac82-4883-abd5-16218eec3636` (layout edited: lg and md breakpoints for panel `8491486b-…` set to w=2)
- panels `b309ea91-1b27-42df-98c2-251e9703cc06`, `eaf75c2b-cccf-432a-911b-9c092295f8f3`, `c8bfed44-d4bd-490b-aed1-8b33183ab404`, `936cab63-23b6-4e18-9579-91db3b0cb337`, `8491486b-7fed-47d1-b2bc-5644d7833c8a`
- share token `129b0bd0-422e-4a7b-a45f-359149d4d075`

Shared-browser side effects:
- The shared Playwright browser's `localhost` session cookie now belongs to the eval user. The previous user's (`skeptic-hel1365-…`) server-side session was not logged out, only displaced.
- `localStorage['helio-theme']` = `light` on origin `localhost:6790`.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- For the skeptic (design D3 trade-off): at the minimum panel width (w=2, a 216px card) the one-line ellipsis hides the denominator ("Based on the first 200 of …"). That is the number the ticket exists to show, and touch users cannot see the `title` tooltip. Two options: allow the note to wrap to two lines like the annotation (`-webkit-line-clamp: 2`), or switch to a shorter form when space is tight ("200 of 1,234 rows"). Evidence: `07-auth-narrow-panel-w2-dark.png`.
- DRY: `.chart-panel__truncation-note` (`PanelContent.css:394-406`) repeats eight declarations from `.chart-panel__annotation` (`PanelContent.css:180-195`). A shared footnote rule (grouped selector or base class), with only the clamp behavior differing, would stop the two drifting apart.
- CONTRIBUTING.md:24: `PanelContent.tsx` (531 lines) and `PanelDetailModal.tsx` (587 lines) are over the ~400-line threshold. The PR description should propose a split, as the rule asks.
- Tick task 2.5 in tasks.md and cite this report's evidence refs.
- The PR body must restate that the "vs" overlay for charts over 200 rows is deferred pending the owner's decision (AC5).
