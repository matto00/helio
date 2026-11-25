## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: 8ded3978f44ce6715fcd238e75e9468a406b7b77 (base b2da43a3d02ba1b84eb8296b9bd9ed742623a353, resolved live).

### Phase 1: Spec Review — PASS
- HEL-1840 AC1 (name, then id, with a test): `deniedPipelinesToast.ts:11-16` uses `Intl.Collator("en", {numeric:true})` with an id tie-break. The new unit block covers case, numeric order and equal names. The mutation record M1-M4 is consistent with the tests as written: going back to id order cannot produce `["b2","d4","0e","c3","g7","f6","a1"]`.
- AC2 (first row aligned at 390px, both themes): I measured it myself. In the e2e run and the live app the multi-row offset is -1 and the single-message offset is -1, at 390 light and dark and at 1280/1440/768. Before the change the gap was 16px at 390 and 4px on desktop (`evidence/red-e2e.txt` and `d2-measurements-before.txt` agree).
- AC3 (cue when it overflows, none when it fits): the attribute and the `::after` gradient were present at the top and in mid-scroll, and gone at the end of the list (checked live). The fits case has no attribute and `background-image: none`.
- HEL-1844: rows are in name order. For the message, "byte-identical" is read as the coalescing invariant (design D1, reviewed by the skeptic at design time), and the same set in either input order coalesces. Tab order follows the rendered order in the e2e test, where ids are seeded opposite to names, so the test discriminates. A unit test goes red if the sort goes back to id order.
- tasks.md matches the diff. The spec delta matches what was implemented. No scope creep. `workflow-state.md` CONSTRAINTS is empty. I honored the standing C1-C14 run constraints in this review.
- The red evidence is genuine. `red-unit.txt` shows 6 failing tests (sort and frame missing). `red-e2e.txt` shows 7 of 11 failing on unmodified code: Received 16/16/4 for alignment, frame not found, and wrong Tab text order.

### Phase 2: Code Review — FAIL
Gates (my own fresh runs, in WORKTREE_PATH):
- `npm run lint`: exit 0. `npm run typecheck`: exit 0. `npm run format:check`: exit 0. `npm run check:e2e-types`: exit 0. `check:openspec`: clean.
- jest (3 workers), filtered to deniedPipelinesToast, ToastRowList, Toast, useScrollEdges, toastsSlice and FormPanelView: 13 suites and 171 tests passed.
- Full `e2e/hel1172-multi-denial-toast.spec.ts`, `--workers=2`, lane DB `helio_hel1840`, servers restarted fresh with the lane env and an empty `ANTHROPIC_API_KEY`: 11/11 passed in 3.7 min.

Code: the change is small, uses tokens only (`--space-1/4/6`, `--app-surface-strong`, plus the existing 1px nudge), reuses the shared `useScrollEdges` hook as DESIGN.md §6 requires, and adds no `any`.

Issues:
1. **e2e seed can fail on a rate-limit 429. This is a latent flake.** In `e2e/support/multiDenialSeed.ts` only the step POSTs (`:66`) go through the retrying `post()` helper. The source POST (`:45`), pipeline POST (`:59`), output POST (`:74`), rename PATCH (`:86`), dashboard POST (`:93`) and panel POST (`:100`) are plain `request.*` calls that assert 201/200. The six-pipeline overflow seed makes about 150 calls against a 120-per-60s fixed window. The window is keyed per user, so the browser's own calls during login, isolation and polling count toward it too. The window's 121st request is the first to be refused. If that request is any of the non-retried calls, the seed asserts 201 and fails. For example, with 4 or 5 pre-seed calls in the window, request 121 lands on pipeline 6's POST or pipeline 5's output POST. Each overflow test ran for 1.1 min in my run and in the executor's run, which confirms the seed does hit the limit and waits on Retry-After. Passing 2 of 2 runs here does not make the window offset deterministic.

### Phase 3: UI Review — FAIL
Live check at port 7272 with my own throwaway user on the lane DB (deleted afterwards by exact id with `buildUserDeleteSql`). I seeded five pipelines named "Pipeline 10", "alpha", "Pipeline 2", "Zeta" and "Beta".
- Happy path: the rows render as alpha, Beta, Pipeline 2, Pipeline 10, Zeta (numeric-aware collation confirmed). The cue is present at the top and in mid-scroll and gone at the end. The fade colour matches the toast background in each theme (light `rgb(255,255,255)`, dark `rgb(38,35,32)`). The first row is aligned at 390, 768 and 1440. Nothing breaks at 390, 768 or 1440. The console showed no errors in the tested flow; the only entries were an expected 401 on `/api/auth/me` before login, and 429s caused by my own seed burst before I reloaded.
- Issues:
2. **The fade covers a keyboard-focused control.** At 390px light, Tab from Beta's "Run to update" to the "Pipeline 2" link. The list does not scroll (`scrollTop` stays 0), because the link is already inside the scrollport: link rect 729.4-746.2, `ul` bottom 747. The whole link therefore sits under the 24px `::after` fade (frame bottom 723-747), and the focused label renders washed out, well below text contrast. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/eval-390-light-focus-under-fade.png`. Desktop does the same: in `eval-1440-dark-5rows-toast.png` the last visible "Run to update" sits under the fade. The cue must never cover the control that has keyboard focus.

### Overall: FAIL

### Change Requests
1. `e2e/support/multiDenialSeed.ts`: send every seed request through the 429-retrying helper, not just the step POSTs. Generalise `post()` to take a method, or add a `send(request, method, url, data, headers)` helper, and use it for the source POST (`:45`), pipeline POST (`:59`), output POST (`:74`), rename PATCH (`:86`), dashboard POST (`:93`) and panel POST (`:100`). The existing status assertions should then apply to the post-retry response.
2. Keep a keyboard-focused row control clear of the overflow fade. Suggested technique: `scroll-padding-block-end: var(--space-6)` on `.toast__list` in `frontend/src/shared/ui/toast.css`, so focus-induced scrolling brings the control above the fade band. Verify in Chromium that focus scrolling honors it. If it does not, use another token-only approach, such as suppressing the fade while `.toast__list-frame:focus-within` has a focused element in the bottom band, or scrolling the focused row into view with block-end padding. Add an e2e assertion to `e2e/hel1172-multi-denial-toast.spec.ts`. In the 390px overflow case, Tab from the first visible row's run action to the next row's link, then assert that the focused element's `getBoundingClientRect().bottom` is at or below `list.bottom - fadeHeight`, where `fadeHeight` is the `::after` computed height, or that the frame no longer carries `data-overflow-below`. Record the assertion red on the current code before the fix (C12).

### Non-blocking Suggestions
- Visual cohesion, for the skeptic to judge. At 390px the icon now sits about 15px below the close glyph (close 44px box top 479, glyph centre about 501; icon top 508). In a single-message toast the two are level. The before/after screenshots and my live look read acceptably (close anchored to the corner, icon with its content), but this is a judgment call I'm not grading.
- Desktop cue strength, for the skeptic. At 1440 the 24px fade often falls over the inter-row gap or a short "Run to update" line, so it is faint: `eval-1440-dark-5rows-toast.png` barely reads as "more below". This is not a mechanical failure, because the attribute and gradient are present.
- `e2e/hel1172-multi-denial-toast.spec.ts` is 324 lines, over CONTRIBUTING's ~250 soft budget (under 400). Fine for now.

Evidence (durable, outside the worktree): `/home/matt/Development/helio/.concertino/runs/HEL-1840/evidence/eval-390-light-5rows-toast.png`, `eval-390-light-focus-under-fade.png`, `eval-1440-dark-5rows-toast.png`. Gate logs: `/home/matt/Development/helio/.concertino/scratch/HEL-1840/eval-*.txt`. Servers were stopped with `stop-servers.sh`.
