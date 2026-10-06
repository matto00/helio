## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD: `318e117ceefe0882f5e1e5a435e270195f1ad1ae`. Base (resolved live): `b16bfa1b3a74905eefc0208a01793efa047909c5`.
History is not rewritten: 4f543009b, b92f6d54e and d3f8e6183 are unchanged, and the cycle-1 fixes are the single new commit 318e117ce.

Evidence is persisted under `/home/matt/Development/helio/.concertino/runs/HEL-1340/evidence/eval-evidence/c2/` (written as `EV2/` below).

### Phase 1: Spec Review — PASS

- **AC1:** still pinned. The reorder-carry mutation (usePipelineDetailPage.ts:1089) fails only `a non-head reorder keeps a created draft's card open` (`EV2/hel1340-eval2-m3-reordercarry.log`).
- **AC2:** unchanged from cycle 1, PASS.
- **AC3 plus the D4 test plan:** now fully met.
  - **CR1 verified.** I reverted StepCard.tsx:382 to `{!isDraft && (`. Scenario 2 then fails with `Received: <span class="...diff-chip--removed">− notes</span>` (`EV2/hel1340-eval2-m1-chipcond.log`). It is green at HEAD.
  - **CR2 verified.** I applied the exact-anchor mutation at usePipelineDetailPage.ts:546: `pendingDraftMetaRef.current.get(stepId) ?? draftFallbackMetaRef.current.get(stepId)` becomes `pendingDraftMetaRef.current.get(stepId)`. The rewritten lane test (`p-0 → anchor-1`, root source exposes `other`) then fails: `Expected other / Received …` (`EV2/hel1340-eval2-m2-exactanchor.log`). With the code restored, 12/12 pass (`EV2/hel1340-eval2-baseline.log`).
  - **CR3 verified by reading the test.** Scenario 2 records `analyzePipelineMock.mock.calls.length` before `create.resolve` and waits for it to increase before asserting. So both the select assertion and the new no-chip assertion run while the post-swap `/analyze` has been sent and is still held. M1 going red confirms that the chip assertion actually runs inside that held window.
- **Constraints:**
  - C1–C6 are honoured. The cycle-2 commit touches only frontend UI and hooks, the test file, and openspec docs. It does not touch the backend, ci.yml, playwright.config.ts or .gitignore.
  - C2 (no test-file edits in the refactor) applies to b92f6d54e only, which is untouched.
- **Planning artifacts:** probe-evidence.md records the cycle-2 red runs for CR1 and CR2. One nit: it cites the mutation site as `:555`, but since the DRY change it is now `:546` (non-blocking).
- **`.npm-cache-hel1340/`:** still untracked (`git ls-files` returns 0). Not touched.

### Phase 2: Code Review — PASS

**Gates, run by me** in WORKTREE_PATH at 318e117ce, under nice 19, with Jest `--maxWorkers=2`. All passed:

| Gate | Result |
|---|---|
| lint | pass |
| format:check | pass |
| typecheck | pass |
| root Jest | 38 suites / 371 tests |
| frontend Jest | 439 suites / 4585 tests |
| frontend build | pass |

**Can the `hasOwnAnalyze = true` default mask anything?** I checked every render site and the data flow:

- **Every production site passes the prop.**
  - StepCard is rendered in exactly 3 places: LaneColumn.tsx:212 and :264, and PipelineRiverView.tsx:367. All three pass `hasOwnAnalyze={hasOwnAnalyzeEntry?.(step.id) ?? true}`.
  - LaneColumn is rendered in 3 places: RootColumn.tsx:120, LaneColumn.tsx:154 (recursive) and PipelineRiverView.tsx:428. All three forward `hasOwnAnalyzeEntry`.
  - RootColumn is rendered once (PipelineRiverView.tsx:506) and forwards it.
  - PipelineRiverView is rendered once (PipelineDetailPage.tsx:261) and receives the hook's `hasOwnAnalyzeEntry`.
  - So every production path supplies the real function. The `true` default only applies when a test renders StepCard, LaneColumn or RootColumn directly, where behaviour is exactly as before.
- **The flag can only hide chips in the fallback window.**
  - `hasOwnAnalyze` is false exactly when `analyzeByStepId` has no entry for the step. In that case `getAnalyzeOutputSchema` is `[]`.
  - `getAnalyzeSchema` is `[]` too, unless fallback meta exists. If fallback meta exists, the step is either a temp-id draft (already hidden by `isDraft`) or a created draft in the post-swap window, which is the intended suppression.
  - With input and output both `[]`, `computeSchemaDiff` returns nothing, and its rename pairing needs a dropped and an added field. So `StepSchemaDiffChips` already returned `null` there.
  - Hiding chips is therefore a no-op for every step except the fallback window.
- **The flag cannot show chips that were hidden before.** The guard only adds a conjunct to `!isDraft`; it never removes one.
- **Memoisation.** `hasOwnAnalyzeEntry` changes identity only when `analyzeByStepId` changes, the same as the sibling `getAnalyze*` callbacks. So StepCard's `React.memo` behaviour is unchanged.

**The `completeDraft(field = "notes")` helper change is acceptable.**
- The default parameter keeps every existing call site byte-for-byte the same in behaviour (they all still choose `notes`). Only the new lane test passes `"other"`.
- It is not in the refactor commit, so C2 does not apply. The ticket's "existing tests unmodified" rule binds item 2 only.
- Rewriting the lane test in place, rather than adding a new one, is the CR2 fix asked for in cycle 1, so it is not a weakened existing test.

**DRY:** both meta refs now use `PendingDraftMeta` (usePipelineDetailPage.ts:168 and :175).

**Other checks:**
- CONTRIBUTING [mechanical]: no inline FQNs, imports at the top of each file, no `any`.
- The new props have JSDoc.
- No dead code.

### Phase 3: UI Review — PASS

Servers were started via `start-servers.sh` on 6772/9679, and `assert-phase servers` returned PASS. I drove the page with my own headless Playwright run (1 worker, nice 19), using `isolateLivePage` and a dedicated `@example.test` user.

- **Lane draft, live** (`EV2/hel1340-eval2-e2e-lane.log`):
  - While the create is in flight, the select shows `notes`.
  - After the swap, with the step's own `/analyze` held (held count 1), the select shows `notes` and the removed chips are `[]` (`EV2/lane-post-swap-analyze-held.png`). This was `["− notes","− id"]` in cycle 1.
  - Once analyze settles, the select shows `notes` and the chips show `["+ summary"]`, so real diff chips still render (`EV2/lane-settled.png`).
- **Forced create 500:** the inline error shows, and the select still shows `notes`.
- **Breakpoints 1440 / 1100 / 768 / 375:** horizontal overflow is 0 at every size.
- **Errors:** no `pageerror`. The only console lines are resource logs: 401 before login, 404 for the expected no-schedule GET, and the 500 I forced.

**Shared dev DB rows I created, all deleted by exact id:**
- user `08bad09e-4d73-4b55-8254-b2cdb05de3d1`
- pipeline `e653e75e-ff85-40ad-84e3-0af5aabc816d`, with steps `55eefb65-217b-4760-8f8d-5b4b84b3c659` and `086b32c4-cb37-404a-9472-69bcdcf808d2`
- data source `11e845a0-34d2-4548-b731-64e81a50d52d`

Counts afterwards are 0 for each.

**Cleanup of my own processes and files:**
- Servers stopped by exact PIDs 394791, 394776, 394548, 394390 and 394348. The ports are free.
- The throwaway worktree `/home/matt/Development/helio/.claude/worktrees/eval-scratch-HEL-1340-c2` was removed by exact path, and no straggler remains.

### Overall: PASS

### Non-blocking Suggestions

- probe-evidence.md cites the CR2 mutation site as `:555`. After the DRY change it is `usePipelineDetailPage.ts:546`.
- Consider making `hasOwnAnalyzeEntry` / `hasOwnAnalyze` required props. Today a future StepCard call site that forgets the prop gets `true`, which reintroduces the false chips. It stays optional only to keep direct-render unit tests compiling.
- Carried over from cycle 1, for HEL-1345: a trunk append of an AI draft makes the created step vanish after the swap until reload, because the backend head-splices it. This is pre-existing (reproduced at base b16bfa1b3).
- usePipelineStepCreation.ts is 347 lines, over the ~250-line soft budget. Mention it in the PR description.
