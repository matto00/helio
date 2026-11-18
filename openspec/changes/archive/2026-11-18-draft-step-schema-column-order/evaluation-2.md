## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `7e08e805fe2300939f078d81c160198110684ac2` against base `56b4ae1ffa590fe40065da983cb6234094cb5520` (resolved live with resolve-review-base.sh, after the origin/main merge 42815a4fd).
Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1732/evidence/.concertino/scratch/HEL-1732/eval2/`. Every claim below rests on content (header lists, request logs, test output). None rests on mtimes.

### Phase 1: Spec Review — PASS
Issues: none blocking.
- **Owner ruling (redesign-no-request) is honored.** No analyze-proposal code remains outside the Output editor sheet. `analyzeProposalService.ts`, `draftNodeSchema.ts` and `useDraftNodeCapabilities.ts` are main's HEL-1733 files. `git diff <base> HEAD` is empty for:
  - `useDraftNodeCapabilities.ts`
  - `ui/outputEditor/**`
  - `PipelineDetailDialogs.tsx`
  - `PipelineDetailPage.draftMode.test.tsx`
  - `e2e/**`
  `useDraftStepProjection*`, `draftProjection*` and `StepPreviewTable.columnOrder.test.tsx` are deleted. The standing requirement "Client-evaluable edits recompute locally with no request" is untouched, and its guards are green (Phase 2).
- **ACs.** The grid follows the step's declared or projected order on desktop and phone, light and dark (Phase 3). The truncated fallback is red-first (confirmed in cycle 1) and the test is unchanged.
- **Spec delta.** It matches D1-D6: an ADDED requirement "...with no request", and it does not modify the standing one.
- **Cycle-1 CR1 (no request; draftMode test back to main):** met.
- **Cycle-1 CR2 (page-level test that can fail):** met. `ui/PipelineDetailPage.columnOrder.test.tsx` renders the real page with a hash-ordered six-column sample, makes a draft rename, and checks the headers of the shown step and a descendant step. It also asserts no `httpClient`, analyze, preview or step-PATCH call. My mutations, in a throwaway worktree:
  - root re-key unplugged in `usePipelineDraftFrames.ts` (draft and saved): 2 of 3 page tests red;
  - only the saved slot unplugged: the flash test red;
  - grid back to raw `frameSchema`: the D3b server-resolved page test red;
  - rename handler reverted to main: 7 red (D2, resolver, page).
- **Cycle-1 CR3 (draft-added step derived through the real walk):** met in substance. `draftColumnOrder.test.ts:116` derives the order through `evaluatePipeline` and the resolver, with no hand-fed schema. On the running app a real draft-inserted rename orders correctly (Phase 3). See the first non-blocking suggestion.
- **Deviation from D5 (`analyzeSourceSchemas` page key and its keys-test line):** legitimate.
  - D1 requires the exact-`rootId` saved `sourceSchemas`.
  - The page exposed no accessor for it: `sourceSchemaForRoot` is internal to `usePipelineAnalyzeLookups` and falls back to `[0]`, which D1 forbids.
  - It is one read-only key holding data the page already has. Nothing from the cycle-1 projection wiring remains.
  - The keys test is an exhaustive key list, so adding the line is the required consequence, not a fixture symptom.
- **Scope.** D2 widened the change to seven client handlers plus `value.ts` (`putLast` / `withCellLast`). This was planned in the round-5 design, disclosed in the files-modified audit table, and is order-only (Phase 2). No backend, wire or schema change.
- CONSTRAINTS in workflow-state.md: none to check.

### Phase 2: Code Review — PASS
Gates (fresh, in WORKTREE_PATH):
- `npm run lint`: exit 0.
- `npm run format:check`: clean.
- `npm run typecheck`: exit 0.
- `npm test` (3 workers): root 66 suites / 579 tests, frontend 828 suites / 9999 tests, all passed, EXIT=0 (`npm-test.log`).
- `npm --prefix frontend run build`: exit 0.

e2e on the lane-private DB `helio_hel1732`. Flyway history had 141 rows there, which confirms the backend ran on it. Dev project, 2 workers:
- Full `hel1631-draft-mode` (including :560), `hel1632-live-output` (including :216), `hel1705-live-output-refresh`, `hel1685-draft-polish` and `hel1683-regex-main-thread`: **35 passed** (`e2e-a.log`).
- `hel1733-draft-outputs-shapes`, `hel1734-draft-roots`, `hel1684-draft-structural`, `hel1579-pipeline-spine-layout` and `hel958-join-step-editor`: **84 passed** (`e2e-b.log`).

`npm run e2e:prod-build`, run by the documented lane procedure (stop-servers.sh, `e2e-backend.sh lane-start`, prod-build, stop-servers.sh):
- **3 passed**: the guard, the `hel1631:183` burst ("sends no request of any kind") and the `hel1632:260` latency burst (`e2e-prod.log`).
- Per-edit latency was 13.0 / 4.4 / 5.6 / 4.3 / 3.0 / 4.4 / 2.8 / 2.9 / 5.6 / 2.7 ms (budget: first < 100, the rest < 50).
- A first attempt on a non-lane `DEV_PORT` failed at login, before any test code ran. That is the backend's CORS pin to `DEV_PORT`, an environmental cause, and the documented procedure fixed it.

Handler changes (D2) alter key order only. I read each diff:
- `rename`: `foldRenames` gives the survivor the `from` value, exactly as main's delete-then-`put` did. On a collision it keeps the earlier of the two positions. A row with no matching `from` returns `{...row}`, as before.
- `datebucket`, `stringops`: `withCell` → `withCellLast`.
- `window`, `splittext` index, `extractheadings` index/level, `unpivot` var/value: `put` → `putLast`.
- `putLast` is `delete row[key]` followed by the same `put` (including the `__proto__` own-key path), so the values are identical.
- `cast.ts` changes only the datebucket handler, which lives in that file.

I spot-checked the audit table against the server; each one matches:
- `ReshapeSchemaInference.scala:30` (datebucket), `:94` (window), `:132-133` (unpivot), `:158` (stringops): `filterNot :+`.
- `TextSchemaInference.scala:133` (splittext index), `:167` (extractheadings index+level): `filterNot :+`.
- `ColumnSchemaInference.scala:27` (rename): mapped in place.

Evaluator parity tests (`pipelineStepParity.test.ts`, HEL-1581 and related) have no diff and are green. Value-level parity therefore holds. Their assertions are key-order-insensitive, so they would not catch order changes; the new `evaluator/steps/columnOrder.test.ts` does. I proved that by making `putLast` behave like `put`: 6 handler tests went red.

Order-sensitive consumers:
- **Flash:** saved and draft frames go through the same orderer, in separate slots. The page flash test goes red when only the saved slot is left raw.
- **Live Output column, compare/history:** the `hel1632` / `hel1705` e2e (including the live-output burst and compare tiles) pass.
- **Memo identity:** a WeakMap keyed by sample frame and `JSON.stringify(names)` (no separator ambiguity, tested), with per-slot array identity. This keeps the walker cache and the draft-preview body stable.

Code quality:
- Pure, typed modules (`inputFrameOrder.ts`, `draftColumnOrder.ts`) that reuse `orderColumns`, `frameSchema` and `laneDependencyOf`. No untyped escape hatches beyond a documented test-store guard. No dead code.
- `usePipelineDraftFrames.ts` is 279 lines, over the ~250 soft budget, which is informational only.

### Phase 3: UI Review — PASS
- **Setup.** Servers via `start-servers.sh` on 7164/10071, lane DB; `assert-phase.sh servers`: PASS. Scripted Playwright (`eval-probe.mjs`), own browser.
  - Source: 8 columns, `/sample` arrives in hash order.
  - Steps: filter → rename (owner→who) → compute margin → convertformat (server-resolved; its NDJSON step line was recorded).
- **Headers.** Identical in all four viewport/theme combinations: 1440x900 and 375x812, each in light and dark. The theme was confirmed through `html[data-theme]`; phone step switching used the "Previewed step" combobox.

  | step | headers |
  |---|---|
  | 1 (client) | `id,region,status,amount,total,created,owner,note` |
  | 2 (draft rename in the shown step) | `id,zone,status,amount,total,created,who,note` |
  | 3 (below it) | `...,who,note,margin` |
  | 4 (server-resolved) | `id,zone,status,amount,total,created,who,note,margin` |
  | draft-inserted rename after step 1 | `id,region,phase,amount,total,created,owner,note` |
  | the step below the inserted one | `id,zone,phase,...` |

- **Network.** Zero `analyze-proposal` requests from any edit (filter burst, rename, insert), on desktop and phone.
  - Each edit sent one `POST /draft-preview`. That is the existing HEL-1630 transport for the downstream server-only convertformat step, which the standing e2e also allows (`hel1631:377` filters `/draft-preview`).
  - The insert also fetched the step catalog (an existing palette load).
  - Opening the Output editor sheet sent its own two `analyze-proposal` requests. This is the existing HEL-1733 sheet behavior, and the sheet code is byte-identical to main.
  - The pure client-evaluable case (zero requests of any kind) is proven by the green `hel1631:183` burst, `hel1631:560` and `hel1632:216`.
- **Console.** Only the pre-existing `404 GET /api/pipelines/:id/schedule` (no schedule exists), unrelated to this change.
- **Screenshots:** `eval-desktop-light-step2.png`, `eval-phone-dark-step4.png`, `eval-phone-light-step5-added.png`, `eval-desktop-dark-step5-added.png`.

### Overall: PASS

### Non-blocking Suggestions
- `draftColumnOrder.test.ts:116` is titled "a draft-inserted compute step" but uses a regular id that `savedSteps` also contains. For client steps the derivation is identical, so this is a naming point. A temp `step-N` id absent from `savedSteps` would make the title literal.
- The resolver's `lineageUnchanged` follows lane dependencies but not `sourceDependencyOf`. That is harmless today, because a secondary-source rebinding is a step-config change and `sameStep` catches it. A one-line comment would stop a future reader re-raising it.
- Disclosed deviations to carry into the PR (already in files-modified.md):
  - rename chain naming;
  - pivot value-column order;
  - code-unit order for an unowned, un-analyzed source;
  - integer-like column names;
  - NDJSON step-line hash order (possible server follow-up).
