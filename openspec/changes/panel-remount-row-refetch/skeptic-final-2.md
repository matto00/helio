## Skeptic Report — final gate (round 2, skeptic-final-2.md)

- Reviewed HEAD: 08e38a574f13a42a8e69f2ef59895532eff89357. The worktree was clean.
- Base resolved live with `resolve-review-base.sh` (main/origin), exit 0: 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2.
- Round-2 delta reviewed in full (`git diff 3202f243..HEAD`):
  - `usePanelData.ts`: one line, `inFlightRef.current = false` in `subscribeWait`'s early-settled branch.
  - New `panelThunks.generationStamp.test.ts`.
  - Two new cases in `usePanelData.remountReuse.test.tsx`.
  - The staleness spec now records retry attempts.
  - Prettier reflow of the planning and report markdown. I checked this with a word-diff: it is formatting only, with no substantive edits to earlier reviewers' reports.
- I also re-read ticket.md (including the rows-plus-output-meta owner ruling), design.md, C1–C6, and the D1–D5 source modules (`outputFreshness.ts`, `outputMetaCache.ts`, `panelRowsReuse.ts`, the `fetchPanelPage` payload creator, and the `usePanelData` fetch/wait effects).

### What I verified (with evidence)

**Gates, re-run by me at 08e38a57**

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm run format:check` | exit 0 ("All matched files use Prettier code style!") |
| Full frontend jest (`npx jest --maxWorkers=3`, nice 19) | 490 suites, 5146 tests, all passed |

**Round-1 CR1 (request-start generation stamp has no failing test): RESOLVED.**

I re-ran mutation E myself in a scratch `git archive HEAD frontend` copy, never in the worktree. The mutation deletes `const generation = currentGeneration(outputId);` at `panelThunks.ts:365` and returns `generation: currentGeneration(outputId)` at fulfilment instead.

- **Mutated:** `panelThunks.generationStamp.test.ts` goes RED, with both cases failing (Output write, pipeline write/run). Panels-wide the result is "4 failed, 1513 passed". The other 2 failures are the environmental drift guards `outputControlEligibilityDriftGuard` and `controlFitnessDriftGuard`, which read files outside `frontend/`.
- **Control (same scratch copy, unmutated):** only those 2 drift guards fail ("2 failed, 209 passed" in `state/`). The generation-stamp test passes.

**Is the slice-level guard adequate, given that the hook-level test is masked? Yes.**

- I confirmed the executor's disclosure: under mutation E the two new hook-level "in flight" cases stay GREEN.
- The reason is that the same invalidation also makes the held metadata unservable (`outputMetaCache.isServable` checks the generation). `isReusable` then returns false for "no cached metadata", and the remount refetches whatever the stamp says.
- So in the common app flow, the metadata gate covers this hazard too. The stamp is the only thing that matters once metadata has been refetched at the new generation before the rows-reuse decision is made. Example: a second consumer, or the detail modal, fetches metadata after the invalidation, and then the card remounts.
- I wrote a throwaway hook-level probe for exactly that ordering, in the scratch copy only and since deleted:
  1. start a deferred rows request;
  2. `invalidatePipeline` while it is in flight;
  3. resolve;
  4. `await fetchOutputMeta("o1")`;
  5. unmount, then remount;
  6. expect 2 rows calls.
- **Results:** it PASSES on HEAD and FAILS under mutation E ("Expected number of calls: 2, Received: 1").
- So the stamp is load-bearing exactly as design.md D2 says, the code is correct, and the slice test pins the property directly. That is adequate. Adding my probe case is a non-blocking note.

**Generation arithmetic soundness (my own review).**

- `currentGeneration` is a sum of three monotonic counters: global, per-Output, and per-pipeline.
- The only non-counter input is `registerOutputPipeline`, which can only add a pipeline term. The sum therefore never decreases.
- A request stamped before its Output's pipeline was registered can only compare unequal later, never falsely equal. In the worst case it is conservative (one extra refetch), never stale.

**M27 (`subscribeWait` early-settled branch clears `inFlightRef`).** The behaviour is correct, but the recorded mutation does not guard the line that was added.

- I deleted the new line `inFlightRef.current = false;` (`usePanelData.ts:156`) in the scratch copy and ran the test twice. "an ownership skip over an already-settled window leaves refresh() usable at once" stays GREEN both times.
- The reason: in that test's path `inFlightRef` starts `false` (fresh `useRef`) and is never set `true` before the early-settled return, so the deleted line is a no-op there.
- Replacing the line with `inFlightRef.current = true` does turn the test RED (1 failed). That is presumably what `mutations.txt` M27 ("leaves the refresh guard held") recorded.
- The fix itself was a non-blocking robustness suggestion, for a path that design-gate and evaluator review found unreachable under StrictMode's synchronous cleanup/re-run. This is therefore not blocking, but the M27 entry overstates what the test proves. See the notes.

**AC trace (re-confirmed at this HEAD, live, my own throwaway user and dashboard).**

The dashboard had 6 panels: 2 plain tables, a bar chart, a line chart, a persisted `columnSort` desc table, and a URL/dropdown-control table. Network dumps are under `/home/matt/Development/helio/.concertino/runs/HEL-1392/evidence/skeptic-final-2-net-*.txt`.

- **Cold load at 1400px:** 6 `GET /api/outputs/:id`, one per Output, so the metadata requests are merged. 7 `/rows`: 6 stripped requests plus 1 sorted correction, as disclosed in D6.
- **I read the dashboard for more than 30s, then crossed 1400 → 1000 → 1400 → 1000 → 1400 (4 crossings, with a theme switch in between).** The cumulative `/rows` and `outputs/:id` counts stayed at **7 and 6**, from `skeptic-final-2-net-cold.txt` through `skeptic-final-2-net-up2.txt`. That is **0 rows and 0 metadata requests per crossing**.
- **The remainder** was `distinct-values` (×2 per crossing, from the control table), `runs/latest` and `run-events` (SSE close/reopen, including aborted duplicates), and `assertion-status` per Output on the way up. This matches the disclosed per-crossing remainder.
- **Theme toggle** (command palette, "Switch to dark theme"): no `/rows` or metadata requests. The only new non-crossing requests were `data-sources`, `pipelines` and `outputs?offset=0`, which the command palette's own search lists fetch when it opens. They are unrelated to the toggle.
- **Root cause, rate limiter untouched (C2), HEL-1418 not absorbed (C5):** unchanged since round 1. The round-2 delta touches no backend file and no other e2e spec.
- **Owner-ruling ACs (invalidation, burst proof, cold-load investigation):** unchanged code since round 1, where I verified them, including a live raw-fetch reconnect staleness probe. The round-2 delta only adds tests and the one `inFlightRef` line.

**Visual (UI / design judgment).** This round changed no CSS or markup. I looked at the reused (post-crossing) cards in both themes:

- `skeptic-final-2-phone-light-reused.png`: phone stack, light.
- `skeptic-final-2-phone-dark-reused.png`: phone stack, dark.
- `skeptic-final-2-desktop-dark-reused-b.png`: desktop grid, dark, after crossing back up.

What I saw:

- The reused windows render identically to a fresh load: same rows, and S1 still sorted `revenue` desc with the sort indicator shown.
- Light and dark are at parity.
- Token usage is unchanged.
- One transient: a screenshot taken about 3s after the up-crossing (`skeptic-final-2-desktop-dark-reused.png`) shows the bar chart's axes without bars. A re-shot moments later (`-b.png`) shows all bars.
- This is the ECharts mount/entry animation on a freshly mounted card. Every desktop-grid card mounts fresh on that crossing whether or not data is reused, so it is not a regression of this change, and the reproduced reading is correct.

**Dev DB.**

- My throwaway user `b9620de9-2f8d-40f3-add2-900279af7f08` (`hel1392sk2-…@example.test`): its dashboard, pipeline and source were deleted by exact id through the API (204 ×3).
- A post-check showed 0 dashboards, 0 pipelines and 0 sources for it.
- I then deleted its 1 `pipeline_run_rate_window` row and its user row by exact id. Post-check: 0.
- matt@helio.dev was not touched.

### Verdict: CONFIRM

Round 1's only Change Request is fixed and independently proven by mutation. Gates are green at HEAD. Live, every crossing at this HEAD shows 0 rows and 0 metadata requests in both themes. Nothing in the round-2 delta regresses behaviour.

### Non-blocking notes

- **Hook-level stamp test.** Add the ordering that makes the stamp observable at hook level: invalidate in flight, then `await fetchOutputMeta(id)` at the new generation, then remount and expect a second rows request. It goes red under mutation E (verified in my scratch probe). The existing hook case is masked by the metadata gate, as the executor disclosed.
- **M27 record accuracy.** `evidence/mutations.txt` M27 should say that the mutation forces `inFlightRef.current = true`. Deleting the added `= false` line leaves the suite green, because the test path never sets `inFlightRef` before the early return. The line is defensive, for a path that is not reachable in tests.
- **Carry-forward from round 1 (still applicable):**
  - label the production per-crossing figures as derived, not measured (files-modified.md now does this, so carry it into the PR body);
  - propose the split of `usePanelData.ts` / `panelsSlice.ts` / `pipelineService.ts` in the PR body;
  - possible follow-up: the ECharts 100px canvas on phone-stack charts (pre-existing).
- **Playwright MCP artefacts.** My session's snapshot and console logs went to the main checkout's gitignored `.playwright-mcp/`, which is the MCP server's fixed output root. Every screenshot and network dump I cite is in the evidence dir.
