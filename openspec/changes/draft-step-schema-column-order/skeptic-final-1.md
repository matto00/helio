## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `7e08e805fe2300939f078d81c160198110684ac2` against base `56b4ae1ffa590fe40065da983cb6234094cb5520`, resolved live with `resolve-review-base.sh` (exit 0). HEAD did not move during the review. Evidence directory: `/home/matt/Development/helio/.concertino/runs/HEL-1732/evidence/.concertino/scratch/HEL-1732/skeptic-final/`. Every claim below rests on content: header lists, request logs, test output and diffs. None rests on mtimes.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=bug/draft-step-preview-column-order/HEL-1732`.

**AC1: preview columns follow the step's output schema.** The code path:
- `inputFrameOrder.ts` re-keys root and source-secondary samples into a declared order: the exact-`rootId` `sourceSchemas` entry, else `inferredSchema`, else code-unit order.
- `usePipelineDraftFrames.ts` sends the draft roots, the saved roots and the secondaries through that re-key.
- `draftColumnOrder.ts` covers D3a (client-evaluated steps, with the sparse-frame rule) and D3b (server-resolved steps: saved order when the lineage is unchanged, else the nearest client ancestor).
- `StepPreviewTable.tsx:164` sets `orderColumns(frameSchema(draftFrame), draft?.columnOrder ?? [])`.

**Running app.** Lane DB `helio_hel1732` (141 Flyway rows), `start-servers.sh` 7164/10071, `assert-phase.sh servers`: PASS.
- Seeded an 8-column static source with steps filter → rename (owner→who) → compute margin → convertformat (server-resolved).
- Draft edit: rename `region→zone` in step 2.
- The headers were identical at 1440x900 and 375x812, in light and dark (`html[data-theme]` confirmed), per `probe.json`:
  - step 1: `id,region,status,amount,total,created,owner,note`
  - step 2: `id,zone,status,amount,total,created,who,note`
  - step 3: `…,who,note,margin`
  - step 4 (server-resolved): `…,who,note,margin`
- Screenshots, which I looked at:
  - `ref=/home/matt/Development/helio/.concertino/runs/HEL-1732/evidence/.concertino/scratch/HEL-1732/skeptic-final/desktop-light-step2.png`
  - `.../skeptic-final/desktop-dark-step4.png`
  - `.../skeptic-final/phone-light-step2.png`
  - `.../skeptic-final/phone-dark-step4.png`
  - `.../skeptic-final/probe.json`
- The grid sits in the shared `DataGrid`, with no new styling. Light and dark render the same. The phone layout is intact: the Preview tab, the "Previewed step" combobox, and the bottom action bar with nothing covering the header row.

**"Fails first" for AC1.** I ran mutations in a throwaway worktree (since removed), never on the branch, against `ui/PipelineDetailPage.columnOrder.test.tsx`. The baseline was 3/3 green.

| Mutation | Result |
|---|---|
| M1: grid back to raw `frameSchema(draftFrame)` | 1 failed |
| M2: `reorderFrame` returns its input unchanged (no D1 re-key) | 2 failed |
| M3: `renameHandler` restored to main's delete-then-`put` | 2 failed |

The page-level test is therefore a real guard. It also asserts that the edit makes no `httpClient` get/post/patch, analyze, step-preview or step-PATCH call.

**AC2: the fallback keeps `truncated`.** `draftStepView.ts:145` reads `line !== undefined ? line.truncated : lastGood?.truncated === true`. I mutated it back to `line?.truncated ?? false`, and `mapStepView › HEL-1732: the last-good-frame fallback keeps the frame's truncated flag` went red (1 failed / 15).

**AC3: checked in the running app.** Done above: desktop and phone, light and dark.

**The seven handler changes alter key order only.** I read every diff hunk:
- **`rename`.** `foldRenames` mirrors main's sequential semantics:
  - It looks up `from` against the current names, so a chain `a->b, b->c` ends as `c` holding `a`'s value.
  - On a collision the survivor gets `from`'s value, which is main's overwrite.
  - A rename of a column onto its own name (`a->a`) is a value no-op.
  - Values are read from the original row by origin index. A row with no matching `from` is returned as `{...row}`, as on main.
- **`datebucket` (cast.ts), `stringops`.** `withCell` → `withCellLast`.
- **`window`, `splittext` index, `extractheadings` index/level, `unpivot` var/value.** `put` → `putLast`.
- `putLast` is `delete row[key]` followed by the same `put`, including `put`'s `__proto__` own-key path. The final value is identical; only the position changes.
- The evaluator parity suites are green inside the full pipelines run below.

**No request on a client-evaluable edit.**
- `npm run e2e:prod-build` via the lane procedure (stop-servers.sh → `e2e-backend.sh lane-start` → prod-build → stop-servers.sh) passed 3/3:
  - `hel1631:183`, "sends no request of any kind": per-edit latency 6.0 / 2.1 / 1.8 / 1.7 / 1.9 / 2.0 / 1.4 / 1.5 / 1.6 / 1.6 ms;
  - `hel1632:260` burst.
  - Log: `e2e-prod.log`.
- The page jest test asserts zero calls (see the mutation table above).
- On the running app the rename sent exactly one `POST /draft-preview`. That is the existing HEL-1630 transport for the downstream server-only convertformat step, and there were zero `analyze-proposal` requests. The `GET .../steps/:id/preview` came from selecting the step, not from the edit.
- The only remaining `analyze-proposal` callers are main's HEL-1733 files. `git diff base HEAD` is empty for:
  - `ui/outputEditor/`
  - `useDraftNodeCapabilities.ts`
  - `PipelineDetailDialogs.tsx`
  - `PipelineDetailPage.draftMode.test.tsx`
  - `e2e/`, `backend/` and `schemas/`

**Gates, run fresh in the worktree.**
- `npm --prefix frontend run lint`: exit 0.
- `typecheck`: exit 0.
- Prettier on the changed frontend files: clean.
- Jest over `features/pipelines` plus `panels/state/columnOrder`, 3 workers, `nice -n 19`: 206 suites / 3191 tests passed, EXIT=0 (`jest-pipelines.log`). This covers every changed module and the evaluator step tests.
- The five new or changed suites alone: 63/63.
- e2e on the dev server, 2 workers: full `hel1631-draft-mode` and `hel1632-live-output`, 25 passed, including `hel1631:560` and `hel1632:216` (`e2e-dev.log`).

**Cleanup.**
- Servers stopped with `stop-servers.sh`.
- `helio_hel1732` dropped, which takes my seeded user with it. The e2e users were deleted by their own fixture.
- The mutation worktree was removed.
- The branch is untouched.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-2.md` is untracked in the worktree (`git status`: `??`). The orchestrator should commit it with the delivery artifacts.
- The draft grid now shows `zone` while the "Output schema" chip row above it still shows the saved `region`. This mismatch already exists on main: the chips render `analyzeOutputSchema` (main `StepPreviewTable.tsx:281-289`), the saved analyze, and main's draft grid also showed `zone`, only at the end. It is outside this ticket's ACs and could be a follow-up. The new type captions are missing for renamed columns for the same reason (types come from the saved analyze).
- The design table's disclosed deviations should go into the PR: rename chain naming, pivot value-column order, unowned/un-analyzed sources in code-unit order, integer-like column names, and the NDJSON step-line hash order as a possible server follow-up.
- `usePipelineDraftFrames.ts` is about 279 lines, over the soft budget. This is informational only.
