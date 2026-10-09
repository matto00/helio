## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed commit: 3202f24345da16c1d6a08821ff914c2b3f5daab0.
- Base, resolved live: 7ee3f8e36a71c7ee1027cb4d1481ddb7f9bfddf2.
- Cycle-2 delta reviewed: fcdb6925..3202f243.

### Phase 1: Spec Review — PASS

**CR1 from evaluation-1.md is resolved.**

- design.md D2 now matches the implementation:
  - there is no thunk-arg `origin`;
  - `generation` is read at request start and returned in the fulfilled payload;
  - `lastError` is recorded for every page-0 rejection except a cross-filter `eq` rejection;
  - a card shows `lastError` only for the request id it waited on.
- design.md D3 now names `state/outputMetaCache.ts` and says there is no `primeOutputMeta`.
- design.md D4 no longer says "+ prime".
- tasks.md 2.2 and 2.3 are reworded to match.
- Running `rg -n "origin|primeOutputMeta|meta\.arg"` on design.md, tasks.md and specs/ returns only the intended mentions: "origin/main", "regardless of origin" / "whatever its origin" (C6 N3), and the explicit "no `origin`" disclaimers.

**Constraints and scope.**

- C1–C6 are still honoured.
- No rate-limiter change (C2).
- Nothing from HEL-1418 was absorbed (C5).
- The cycle-2 code changes are narrow. They are the four suggestions from evaluation-1 and nothing else.

### Phase 2: Code Review — PASS

**Gates.** I ran each one myself in WORKTREE_PATH at 3202f243:

| Gate                              | Result                                                                |
| --------------------------------- | --------------------------------------------------------------------- |
| `npm run lint`                    | exit 0                                                                |
| `npm run format:check`            | exit 0                                                                |
| `npm run typecheck`               | exit 0                                                                |
| `npm test`                        | exit 0 (root 43 suites / 418 tests; frontend 489 suites / 5141 tests) |
| `npm --prefix frontend run build` | exit 0                                                                |

**The executor's claimed mutations, re-run by me** in a throwaway detached worktree at 3202f243, which has since been removed:

| Mutation | What I changed                                                                  | Result                                                                                |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| M22      | Removed the live-SSE `invalidatePipeline(pipelineId)` in `pipelineRunFanout.ts` | RED, 1 failed. In cycle 1 this same mutation stayed green, so that gap is now closed. |
| M23      | Removed `unsubscribeWait.current?.()` from the cleanup in `usePanelData.ts`     | RED, 1 failed.                                                                        |
| M24      | Removed the `onFreshnessReset(() => lastObservedRunIdByPipeline.clear())` line  | RED, 1 failed.                                                                        |

- The new tests pass without mutations: 25 out of 25.
- M25 (the card-level 3(g) test) I took from `evidence/mutations.txt` and did not re-run.
- I read the 3(g) test itself, `MobilePanelStack.sortFailure.test.tsx`. It asserts five things:
  - an error toast appears;
  - the "East" row stays visible;
  - the "Filters" button stays mounted;
  - no "Failed to load" error state appears;
  - `lastError` is recorded in the store, which proves the toast-only result comes from scoping, not from the failure going unrecorded.

**The subscription change in `usePanelData.ts`** (`subscribeWait`, `waitRecord`, and the mount effect):

- I traced StrictMode's cleanup and re-run. The subscription effect is declared before the fetch effect, so it re-subscribes from `waitRecord` before the fetch effect's N1 early return. That is correct.
- I found no other problems.

**(a) The retry loop in the staleness spec** (`e2e/hel1392-remount-staleness.spec.ts`, final step: up to 4 desktop-to-phone round trips until one crossing reuses). My judgement: **it is a sound bounded wait, not an assertion that can no longer fail.**

- **The cause it cites is real.** `POST /api/data-sources/:id/rows` calls `AutoRunTriggerService.triggerAutoRun`, which upserts a debounce row (`DataSourceService.scala:83-96`, `AutoRunTriggerService.scala:73-79`). The scheduler tick fires it later. Its succeeded SSE event correctly invalidates the pipeline and refreshes once.
- **It can still fail, and I showed it.** I added a browser-level mutation in a scratch copy of the spec: `page.route` rewrites the Vite-served `panelThunks.ts` so that, after the in-app run, every rows window carries a stale generation, meaning reuse can never resume. I also logged every loop attempt.
  - Mutated run: all 4 attempts refetched rows (`rows: 2` each), the loop ran out, and **the test FAILED**.
  - Control run (same file, mutation off): the first attempt reused (`rows: 0, meta: 0`) and the test passed.
  - The mutated run failed on the `seriesTypes == ["line"]` poll on the line just before the `toEqual({rows:0,meta:0})` assert, and that assert would also have failed on `rows: 2`.
  - Diff of the mutation: `/home/matt/Development/helio/.concertino/runs/HEL-1392/evidence/e2e-evidence/HEL-1392/eval-c2/eval-mutation-spec.diff`.
- **What it does weaken:** a defect that made the next 1 to 3 crossings refetch before reuse came back would now pass. That class is already disclosed as "conservative once", so this is acceptable. A tightening is listed under Non-blocking Suggestions.

**(b) Executor's dev-DB cleanup matched users by email prefix** (`hel1392-1%` / `hel1392s-%`) instead of exact id. This **violates the standing exact-id rule**, so I am recording it. I did not find collateral damage:

- Only `e2e/hel1392-remount-request-burst.spec.ts` (`prefix: "hel1392"`) and `e2e/hel1392-remount-staleness.spec.ts` (`prefix: "hel1392s"`) produce these prefixes. I grepped the main checkout and every live worktree (HEL-1423, HEL-1284, matt-audit-repo) and found no other source.
- The only other `hel1392%` user in the dev DB, the orchestrator's probe user `a4d418f0-ec0f-49d7-a982-32f5051a580a` (`hel1392-probe-...`), does not match either pattern and still exists.
- matt@helio.dev cannot match either pattern.
- Limitation: the deleted rows are gone, so I cannot prove after the fact exactly which rows the pattern matched. The 32 ids the executor lists in files-modified.md are the only record.
- This is a process defect, not a code defect, so it does not change the verdict. The orchestrator should make sure future cleanup runs by exact id only.

### Phase 3: UI Review — PASS

**Servers.** `start-servers.sh` reused the running servers. I confirmed that the processes on :6824 and :9731 have their cwd in this worktree.

**Burst spec, re-run at 3202f243.** Every case shows 0 rows and 0 `outputs/:id` per crossing. Request totals per crossing:

| Case                 | Per-crossing totals | Burst total |
| -------------------- | ------------------- | ----------- |
| Read 30s, then cross | `[7,15,7]`          | 29          |
| Early crossing       | `[7,15]`            | —           |
| Cross-filter         | `[7,15]`            | —           |

These match cycle 1.

**Staleness spec at 3202f243, dark and light.** Both pass. The final step reused on its first attempt in both. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1392/evidence/e2e-evidence/HEL-1392/eval-c2/staleness-{dark,light}.json`.

**Visual and other checks from cycle 1.** Cycle 2 changed no CSS and no rendered UI, so the cycle-1 checks still stand:

- both themes;
- 1440 / 1100 / 768 / 360 widths;
- theme toggles sent 0 requests;
- failed sort is toast-only.

**Dev DB.** I removed my cycle-2 throwaway users by exact id, together with their 9 `pipeline_run_rate_window` rows:

- 4bb8614e-3a0b-4088-b4f1-de52b82011b3
- b747dae1-5842-4498-9ab1-7c09f17585da
- 2f261f2e-160b-4e43-a00c-9ce5faec7229
- ca287046-6045-46a4-9b4c-94731df9d9cb
- ed395162-8f3c-4681-87d5-184c1c3b8b5e
- ec0220bf-4c91-445f-aad3-04280858ce9e
- 6fa59207-227a-45c4-b6ae-39323a397f0e
- f86150c5-3d13-4d46-aa24-d69f06ea185a

Before deletion they owned 0 dashboards, 0 pipelines and 0 sources. The specs had already deleted those by exact id, each returning 204. The only `hel1392%` user left is the probe user.

### Overall: PASS

### Non-blocking Suggestions

- **Retry loop evidence.** In the staleness spec's retry loop, write the per-attempt counts (attempt index plus rows/meta) into `staleness-<theme>.json`, so a pass that needed retries is visible in evidence. Optionally, only allow a retry when a new `run-events` / `runs/latest` id appeared, which proves the auto-run is the cause.
- **`subscribeWait` early-settled branch** (`usePanelData.ts`). When the entry is already settled at re-subscribe, the code clears `waitRecord` but leaves `inFlightRef` as it was. StrictMode's synchronous cleanup and re-run cannot hit this. It would only matter if `subscribeWait`'s identity changed (`store` / `panel.id`) mid-wait, which would leave `refresh()` stuck. Setting `inFlightRef.current = false` in that branch would make it robust.
- **Over-budget files.** `usePanelData.ts`, `panelsSlice.ts` and `pipelineService.ts` are over budget. Propose the split in the PR description, as planned.
