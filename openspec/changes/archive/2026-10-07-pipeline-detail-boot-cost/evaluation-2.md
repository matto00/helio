## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `fafc863380c861265ac8a2e14c883db28c495125`. Base: `70b063a47`, the same merge-base as cycle 1.
Since cycle 1's head (45c1800c5), the frontend diff is a single test file (2 lines). Everything else is evidence and docs.

### Phase 1: Spec Review — PASS

**Cycle-1 CR1 (gitignored evidence): resolved.**
- Every cited raw log is renamed to `*.log.txt` and tracked: 81 tracked files under `logs/`.
- `git status --ignored` on the change dir shows only `workflow-state.md`, which is expected to be ignored.
- No `.log` references remain in `measurements.md` or `boot-audit.md`. Only `evaluation-1.md` still has them, as a historical quote.
- Every concrete `*.log.txt` name those docs cite exists on disk. The only unresolved names are glob or brace patterns.
- `created-ids.log.txt` is committed and includes the cycle-2 ids.

**Cycle-1 CR2(a) (after-batch provenance): resolved.**
- `measurements.md` now discloses that the earlier "after" batches ran on the pre-commit tree.
- The request-count and direct-goto timing batches were re-run on the committed head. `logs/cycle2-meta.log.txt` records:
  - `SHA=45c1800c5 dirty-frontend-files=0`
  - loadavg for each batch
  - sha256 prefixes of the five product files
- I recomputed those prefixes from `git show HEAD:<file>` and all five match: `0e25d2c5adca 9121eceba287 5d2d57fb2353 dd2f08a18031 1086fb99b825`. So the re-run measured exactly the code under review. This is a content check, not an mtime check.
- Results on the head:
  - 1x: 877 / 889 / 908 ms
  - 6x: 3938 / 4396 / 4482 ms
  - 12 requests per open in every timing run
  - 10 requests per open in the probe, with 0 run-history GETs
- These agree with the earlier "after" batches, so the "no measurable change" reading still holds.

**Cycle-1 CR2(b) (truncated-open evidence): resolved.**
- `logs/cycle2-after-truncated.log.txt` shows `truncated=true total /api requests=11 run-history GETs=1`.
- The run-history GET is issued at 862 ms, after the pipeline GET, which matches D3's chained boot fetch.

**Unchanged from cycle 1:**
- All acceptance criteria and design behaviours still pass.
- Constraint C1 is honored.
- Scope is clean: no `ci.yml`, `playwright.config.ts` or `.gitignore` changes; no Output editor or `buildChartOption` changes; no `e2e/zz-hel1354-*` files; no `.npm-cache`.

### Phase 2: Code Review — PASS

I ran the gates fresh, in `WORKTREE_PATH`, under `nice -n 19`:

| gate | result |
|---|---|
| `npm run lint` | 0 |
| `npm run format:check` | 0 |
| `npm run typecheck` | 0 |
| `npm --prefix frontend run build` | 0 |
| `npm test` | 0: root 39/39 suites, 376 tests; frontend 456/456 suites, 4764 tests |

**Only code change this cycle:** `PipelineDetailPage.runHistory.test.tsx` now uses 7 rows for the stale record. That makes the `queryByText("7 rows")` absence assertion meaningful (cycle-1 suggestion).

**Product code:** byte-identical to what cycle 1 reviewed and mutation-tested (checksums above), so cycle 1's 8/8 red-by-mutation result still applies.

**File size:** `measurements.md` now proposes a split of `usePipelineDetailPage.ts` for the PR body, which satisfies CONTRIBUTING.md's ">400 lines → propose a split" rule.

### Phase 3: UI Review — PASS

I re-ran my own headless Chromium probe on HEAD. It is not the shared MCP browser and uses no /tmp cookie jars. It ran under `nice -n 19` against :6786 (this worktree's Vite) and :9693.

Dev-DB ids created this cycle:
- user `zz-hel1354-eval-1791364237550@example.com`
- source `237e8452-eacd-4538-93a9-3fb50953e125`
- pipeline `7915b3c3-6e0b-4e42-a8b1-eac670f84d19`
- output `af1cb1f7-e1d4-42d5-b8ca-49a8a1b77450`
- one run of that pipeline

The cycle-1 ids are in evaluation-1.md.

Results, quoted from the probe output:
- **Non-truncated open:** 10 `/api` requests, 0 run-history GETs, 1 data-sources GET. The Outputs tabpanel shows.
- **Opening the modal:** exactly 1 GET. It shows "Run history (0)" and the empty state. Escape closes it. Reopening while fresh issues 0 GETs.
- **Running the pipeline:** the forced refresh issues 1 GET, and the modal shows "Run history (1)".
- **Overflow:** 0 px at 1100, 768 and 375 wide.
- **Truncated open (pipeline GET intercepted):** exactly 1 run-history GET, and the banner renders.
- **Failure case (run-history returns 500):**
  - 0 GETs at boot.
  - 1 GET when the modal opens; it shows the error state with a count-free title.
  - No automatic re-fetch afterwards.
  - Retry via the keyboard issues exactly 1 more GET, then the list shows.
- **Slow response:** the modal shows "Run history" and "Loading run history…".
- **Console:** only network-resource lines, namely the 404 for "no schedule yet" (it predates this branch) and the 500 I injected. No page errors.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- The `auth/me` StrictMode duplicate and the `PipelineScheduleDialog` mount cost are already named as driver follow-ups in `measurements.md`. Carry them into the PR body or into tickets.
- `PanelCard.test.tsx` (HEL-579 re-render count) flaked once under load in cycle 1. It is unrelated to this branch, and this cycle's full run was green. Worth a follow-up if it recurs in CI.
