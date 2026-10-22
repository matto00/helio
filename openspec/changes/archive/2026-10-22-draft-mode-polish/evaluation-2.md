## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `9ad6e851bf56d064197143315bcf2f9dfa459cf8` against the live review base `da39f0f14aee2de7dc4599ed8a0e9b3eb7e82dd9`. The cycle-2 delta is `7eddb2b36..9ad6e851b`.

### Phase 1: Spec Review — PASS

Issues: none.

**Item 5:** now recorded as reproduced, with the correct root cause, a fix and a red/green record (evidence.md). This resolves evaluation-1 CR1 and CR2.
- The fix is `isolation: isolate` on `.mobile-body` (`frontend/src/features/pipelines/ui/mobile/PipelineMobile.css:259`).
- The shared `ActionsMenu.css` is untouched.

**Item 7:** `usePipelineRunStream` now reads the Output ids from the store at terminal time, through a thunk's `getState` and `selectOutputsForPipeline`. It does this in addition to the in-flight skip. This closes the ordering window between `finally` and the next commit that evaluation-1 flagged.

**Item 8:** the test also asserts the errored step's preview row count on the phone (2, against 4 saved). The executor states that this assertion has no separate red of its own, and that the count assertion is what fails first. That is acceptable: both read the same `GoodFrame`.

**files-modified.md:** it adds `PipelineMobile.css`. Every path outside the change dir in `git diff --name-only da39f0f14...HEAD` is listed explicitly. `evaluation-1.md`, committed by the executor, is inside the change dir.

**Scope:** still no CI, e2e-setup or harness files in the diff. Constraint C1 is honoured (see below).

### Phase 2: Code Review — PASS

Gates, re-run fresh in WORKTREE_PATH:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm --prefix frontend run typecheck` | exit 0 |
| `HELIO_JEST_MAX_WORKERS=2 nice -n 19 npm test` | root 61 suites / 524 tests; frontend 762 suites / 9369 tests; all pass |
| `npm --prefix frontend run build` | exit 0 |
| 11 `check:*` scripts | all exit 0 |

The 11 checks are `openspec`, `spec-structure`, `e2e-evidence-paths`, `e2e-user-cleanup`, `e2e-types`, `tokens`, `e2e-prod-build-projects`, `no-credential-leak`, `eslint-ts-rules`, `repo-integrity` and `test-temp-dir-hygiene`.

**E2E:** `e2e/hel1685-draft-polish.spec.ts` was run under e2e.lock against this lane's servers. 4 passed (37.4 s), and the harness deleted its throwaway users.

**Item 5 red, verified in the running app:**
- **How I ran it:** a draft was open, with 1 chart and 4 table Outputs. I ran the spec's own walk: `.mobile-body` from top to end in 12 px steps, testing each kebab centre that lies under the pill or a bar button with `elementFromPoint`.
- **Revert method:** I injected `.mobile-body { isolation: auto !important }`. This is an exact revert of the CSS-only fix.

| Viewport | Shipped CSS | Reverted CSS | Shipped CSS again |
| --- | --- | --- | --- |
| 375, dark, draft open | 20 positions covered, 0 stolen | 20 covered, 20 stolen (`scrollTop 12: popover__trigger actions-menu__trigger`, ...) | 0 stolen |
| 430, light, no-draft bar (Dry run / Run pipeline) | 12 covered, 0 stolen | 12 covered, 12 stolen | — |

The red is real, and the "covered > 0" assertion keeps the test from passing vacuously.

**Item 7 code:**
- The thunk form is valid with the typed `AppDispatch`.
- The unit test now models the "store already lost the Output while the last render still listed it" case, and asserts that only the kept id is previewed.
- The `getState() as RootState` cast is redundant but harmless.

### Phase 3: UI Review — PASS

**Open Output menu, not clipped (checked in the running app at 375, dark):**

| Kebab | Menu position | Placement | Result |
| --- | --- | --- | --- |
| Last kebab ("Extra 4"), list scrolled to the end | top 596, height 54 | portalled outside `.mobile-body` | the "History" item is the hit target at its centre |
| A kebab scrolled to y = 630, just above the bar | rect top 666 to 720, over the pill and the Save & run row | paints above the bar | "History" is the hit target there too (`actions-menu__item`) |

Isolation does not clip or bury the menu.

Evidence:
- `/home/matt/Development/helio/.concertino/runs/HEL-1685/evidence/.concertino/scratch/HEL-1685/eval2-phone-375-menu-open.png`
- `/home/matt/Development/helio/.concertino/runs/HEL-1685/evidence/.concertino/scratch/HEL-1685/eval2-phone-375-menu-over-bar.png`

**Console:** the only error is the pre-existing 404 on `/schedule`, because the test pipeline has no schedule.

**Cleanup:**
- Throwaway data was deleted by exact id: source `13352002-7fa0-4a21-b581-d619c4fcda19`, pipeline `010567d2-7588-4ec3-91b3-f2b5287057af`, and Outputs `ac0aed32-141c-484d-9ea8-6eee6c412df0`, `d82549e9-b840-4335-ad7f-1e0cfe40abc2`, `b708b746-11b2-4889-a566-fc5e52a611e0`, `4dcddf07-851a-4ce4-b015-70e5fe30e335` and `2038d495-d126-412b-b44d-1b2eb287bd27`.
- Servers were stopped with `stop-servers.sh`.

The rest of Phase 3 was established in evaluation-1 and is unchanged by this delta:
- Item 4 at 1280 in both themes.
- The live marker.
- Dialog focus restore.
- Palette select.

### Overall: PASS

### Non-blocking Suggestions
- `usePipelineRunStream.ts`: the `as RootState` cast on `getState()` can be dropped if the thunk's parameters are typed from `AppDispatch`.
- The residual "response lost after the server committed" case from evaluation-1 is still unhandled: previews stay pre-run until reload. This remains non-blocking.
- The `scratchpad/cscripts/` copy of the canonical scripts can be deleted.
