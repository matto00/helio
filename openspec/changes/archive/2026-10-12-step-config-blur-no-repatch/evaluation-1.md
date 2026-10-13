## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `5037cdd0bdcd7d657203cf86fa6c2a1236d2fb38`. Diff base, resolved live: `317284497b44808c410c32b6423a1ad7f5c31826`.

### Phase 1: Spec Review — PASS
Issues: none.

- AC1 (enumerate and probe): I re-ran the grep `onBlur` under `frontend/src/**` (non-test, pipeline/step paths). It returns the same 8 sites as `probe-notes.md`: the 4 removed ones, plus `AggregateConfig.tsx:252` (local touched state), `PipelineDetailFooter.tsx:179` (edit-mode toggle) and `ConditionalFormatsField.tsx:219,234` (output-editor `onTouch`). None of those 4 re-emits step config. No other directory renders step-config editors; the only non-pipelines match for `StepCard|stepConfigs` is `shared/ui/DataGrid.tsx`, which has no step config. The executor's before-probe logs (persisted `probe/HEL-1507-probe-before.txt`) show 2 byte-identical PATCHes for edit-then-blur on all 4 fields, and 1 PATCH for a no-edit blur.
- AC2 (one PATCH after the fix): I confirmed this with my own independent live probe (below).
- AC3 (no change to the persist hook's wire behaviour): the diff does not touch `hooks/`. `useStepCardState.characterization.test.ts` is unchanged and passes.
- AC4: the old "calls onChange on blur" test is inverted for both compute inputs. Convertformat and upsertsource now pin `toHaveBeenCalledTimes(1)`. The StepCard-level integration suite `StepCard.blurNoRepatch.test.tsx` asserts exactly one `updatePipelineStep` call per field, and zero for a no-edit blur. Red pre-fix verified independently (below).
- Tasks 1.1–2.5 are all checked and match the diff. There is no scope creep: 4 removed `onBlur` lines, tests, and planning artifacts.
- The spec delta (`pipeline-editor-page`, ADDED requirement) matches the behaviour. `openspec validate step-config-blur-no-repatch` reports it valid. No API, schema or migration impact.
- CONSTRAINTS: `[]`. Nothing to honour.

### Phase 2: Code Review — PASS
Issues: none.

Gates (my own fresh run in `WORKTREE_PATH`; `HELIO_JEST_MAX_WORKERS=3`, `nice -n 19`):
- `npm run lint`: exit 0
- `npm run format:check`: exit 0
- `npm run typecheck`: exit 0
- `npm test`: exit 0. helio-mcp 49/49 suites, 458 tests. Frontend 579/579 suites, 6904 tests.
- `npm --prefix frontend run build`: exit 0
- Targeted suites run verbosely (`StepCard.blurNoRepatch`, the 3 stepConfig tests, `useStepCardState.characterization`): 5 suites, 220 passed.

Red check (independent of the executor's claim):
- I made a throwaway detached worktree at `5037cdd0b`, restored the 3 components from the base, and ran the new and changed suites.
- Result: 12 failed, 34 passed, 4 suites failed. This matches the executor's "12 failed".
- Every new and changed assertion is among the failures: both compute blur cases, the convertformat once-check, the upsertsource once-check, and all 8 StepCard cases.
- The throwaway worktree was removed afterwards (`git worktree list` shows no straggler).

Code:
- The change removes the 4 `onBlur` re-emits on controlled inputs whose `onChange` already commits every keystroke.
- D2 holds in code. `persist` in `useStepCardPersist.ts:61-81` returns early for temp ids. Blur only ever re-invoked the identical change handler, so no draft-create or validation path depended on it, and none of the 3 components renders from blur state.
- The test file follows existing StepCard test conventions: `jest.mock` of `pipelineService`, and `as never` / `!` used the same way as sibling tests.
- No dead code and no type escapes in production code.

### Phase 3: UI Review — PASS
Issues: none.

Servers: started with `start-servers.sh` / `assert-phase.sh servers` (PASS). I confirmed that the Vite-served modules for the 3 components contain 0 `onBlur`, so the post-fix code was the code under test.

Independent live probe:
- Setup: Playwright chromium on dev 6939 / backend 9846, a fresh throwaway user `hel1507-eval-1791868727577@example.test`, and my own seed with a different config from the executor's.
- Typing: real per-character keystrokes, not `fill`, followed by a 1.5 s wait past the debounce.
- Two blur methods: a mouse click elsewhere, and the Tab key (keyboard path).
- Coverage: all 4 fields, each in 2 scenarios × 2 blur methods.

Results (16/16 as expected):

| Field | Edit then blur (click / Tab) | No-edit blur (click / Tab) |
| --- | --- | --- |
| convertformat Destination field | 1 / 1 PATCH | 0 / 0 |
| compute Output field name | 1 / 1 | 0 / 0 |
| compute Expression | 1 / 1 | 0 / 0 |
| upsertsource New source name | 1 / 1 | 0 / 0 |

Each PATCH body carried the edited value.

Evidence (persisted):
- `/home/matt/Development/helio/.concertino/runs/HEL-1507/evidence/.concertino/eval-probe/results.json`
- `/home/matt/Development/helio/.concertino/runs/HEL-1507/evidence/.concertino/eval-probe/evalprobe.mjs`

Console: there was one console error during the flow, `404 GET /api/pipelines/:id/schedule`. It is the pre-existing "no schedule yet" response on any pipeline page. It is unrelated to this diff, which touches no fetch path.

Breakpoints: the diff changes no markup, class or CSS, only removes an event prop, so layout is unchanged by construction. I did not resize. Keyboard support was exercised by the Tab-blur path. Accessible names are unchanged, and the probe located each field by its aria-label.

Throwaway-user cleanup:
- My user `38d114f0-fd64-4a24-81ba-feef43b16265` was deleted by exact (id, email) via `buildUserDeleteSql`.
- Post-check counts:
  - users with my id or the executor's 2 ids (`109c447c-…`, `29c3bdc5-…`): 0
  - users with email `hel1507-%`: 0
  - pipelines owned by those 3 ids: 0
  - data_sources named `HEL1507%`: 0
- Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1507/evidence/.concertino/eval-probe/cleanup.txt`. This confirms the executor's users are actually gone too.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- `StepCard.blurNoRepatch.test.tsx` emits a jsdom `XMLHttpRequest` `console.error` from an unmocked network call. Existing `StepCard.test.tsx` emits the same (3 occurrences), so this is a pre-existing pattern and not introduced here. A future cleanup could mock the remaining service so these suites run quietly.
- Paste was not probed live. React's controlled `onChange` fires on `input` events, which paste raises, so the risk is low.
