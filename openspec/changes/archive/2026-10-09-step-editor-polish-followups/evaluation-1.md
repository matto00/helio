## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `a51f3125128649c1234fb51a88eefa78ea1507d6`. Diff base: `428e1d2d4a61eca7d4d64bb57fe37fe0b21dc1c8`, resolved live with `resolve-review-base.sh`.

### Phase 1: Spec Review — PASS
Issues: none.

- **AC1.** `FillNullConfig.tsx` root now uses `pipeline-detail-page__aggregate-config`. I checked the running app in both themes: the root's row-gap is 20px for fillnull, window and pivot, and the gap between the InlineError and the sibling above it is 20px in all three editors.
- **AC2.** Each editor keeps the user's choice after a 422. The marked control is `aria-invalid="true"`, and its `aria-describedby` points at the InlineError's id, whose text matches the message. The ids are unique per instance (`useId`).
  - A 500 shows the message but marks nothing invalid.
  - The next save clears both the mark and the error.
  - The tests cover all three behaviours, and I confirmed each one in the running app.
- **AC3.** The changes to `PivotStep.validateRawConfig` and `StepConfigValidation.validatePivot` are comment-only. The new doc wording matches FillNullStep and validateWindow. I checked each clause against the code:
  - drafts are accepted (`aggProblem` returns None for an empty agg);
  - a decode failure is left to the shared shape check (`super.validateRawConfig`);
  - analyze short-circuits through `shapeRejection`.
- **AC4.** `WindowStep.apply` now checks in this order: unsupported function, empty draft, missing field, then `enumProblems` (offset). This matches the analyze order in `StepConfigValidation.validateWindow`. Four new tests pin the order; messages are unchanged.
- **AC5.** All three op spec deltas add write-time, draft-saveable and rejected-save scenarios, and window also gets the two run-time order scenarios. I checked the fillnull strategy list against `FillNullStep.SupportedStrategies`.
- **Tasks.** Every task is checked and matches the diff.
- **Scope.** There is no scope creep, and `DedupeConfig` is untouched.
- **Contracts.** No API or schema change.
- **Constraints C1–C6.** All honoured:
  - The red-first evidence is present. I reproduced the frontend red myself (below).
  - Screenshots are in the main checkout's run evidence dir.
  - `@typescript-eslint` lint is clean.

### Phase 2: Code Review — PASS
I ran every gate myself in WORKTREE_PATH:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0 |
| `npm run typecheck` | exit 0 |
| `npm test` (`--maxWorkers=3`) | 501 suites, 5262 tests, all passed |
| `npm --prefix frontend run build` | exit 0 |
| `sbt -J-Xmx3g testFull` | 6520 run, 0 failed, 4 cancelled |
| `check:scala-quality` | clean (soft warnings only) |

- **Backend suite details.** The 4 cancelled tests are the env-gated `HELIO_MEASURE` latency specs, which were cancelled before this change too. The log confirms the 4 new `WindowStep.apply error order (HEL-1422)` tests ran.

**Red-first reproduction (C4).** I did this independently of the executor's transcript:
1. I made a throwaway detached worktree at HEAD.
2. I checked out the base versions of all six non-test frontend source files (`InlineError.tsx`, `useStepCardState.ts`, `StepOpEditor.tsx`, and the FillNull/Window/Pivot configs).
3. I ran the two test files.

Result: StepCard.enumSaveError had 4 failed out of 11. The failures were the three "keeps the value, aria-invalid + describedby" cases and "clears the mark". `InlineError.test.tsx` fails on a TS2322 (`id` is not a prop). This matches `red-frontend.txt`. The scratch worktree has been removed (`git worktree list` shows no scratchpad entry).

The backend red transcript (`red-window-order.txt`) shows exactly the two expected failures (lag/lead: an offset message where "requires 'field'" was expected). I did not re-run that red myself.

- **Code quality.** No inline fully-qualified names and no `any`. `isAxiosError` is imported at the top of the file.
- **DESIGN tokens.** The only styling change is reusing an existing tokenized class (`--space-5`); no new CSS.
- **Error handling.** A 422 marks the control; network and 5xx failures do not. The existing staleness-token guard also covers the new flag, because it is set inside the same `requestTokenRef.current === token` branch.
- **Tests.** They are meaningful. The 500 cases are guards that would catch a mutation always setting the flag to true.

### Phase 3: UI Review — PASS
- **Server provenance.** I checked this before trusting the running servers (MISTAKES.md / CON-155):
  - vite pid 628136 has cwd `.../HEL-1422/frontend`, and its binary is the worktree's own vite.
  - The backend java pid 626020 has cwd `.../HEL-1422/backend`. It started at 20:13:54, after the last edit to `WindowStep.scala` (20:09:38).
- **Throwaway data.** I registered a throwaway user (`b4db9f3c-c8a2-4dc9-817b-1d0f39ed7025`, `hel1422-eval-1791603875789@example.test`).
  - Through the founder template I created a source (`d37b9411-…`), a dashboard (`5f1ee3f3-…`) and a pipeline (`ec0fe655-…`).
  - I also created a pipeline `4d2f3bf9-7550-4741-b12e-c744372f805c` with fillnull, window and pivot steps (`001ae450-…`, `aae2890e-…`, `44ccaf6e-…`).
  - All of these rows, plus the template's 3 panels, 3 outputs and 1 `pipeline_run_rate_window` row, were deleted by exact id in a single transaction.
- **The 422 was INJECTED.** I patched `XMLHttpRequest` in the page to answer `PATCH /api/pipeline-steps/*` with 422 `{message}`. As design D2 notes, no real 422 can be reached today.
- **Happy and unhappy paths.**
  - 422 in all three editors: the value is kept (mean, rank, first), `aria-invalid=true`, and the describedby target holds the error text.
  - Injected 500: the message is shown and nothing is marked.
  - A real PATCH (200) clears both the mark and the error.
- **Console.** The only error is a pre-existing 404 on `GET /api/pipelines/:id/schedule`, which happens on any pipeline with no schedule and is unrelated to this diff.
- **Breakpoints.** At 1440, 768 and 375 there is no horizontal overflow in any editor root or the document.
- **Both themes, cohesion.** The fillnull editor now has the same section rhythm as window and pivot: Columns, then Strategy, then the error, at 20px steps. The error/button spacing is identical in all three cards.
  - Dark: `/home/matt/Development/helio/.concertino/runs/HEL-1422/evidence/.concertino/runs/HEL-1422/evidence/eval-1-all-editors-422-dark.png`
  - Light: `/home/matt/Development/helio/.concertino/runs/HEL-1422/evidence/.concertino/runs/HEL-1422/evidence/eval-1-all-editors-422-light.png`
  - These are the persisted refs. The originals are in the evidence dir.
- **How light theme was set.** I set `document.documentElement.dataset.theme` directly, without going through ThemeProvider. As a result the native checkboxes render as dark squares in the light shot. That is an artifact of how I switched themes, not a defect in the diff.
- **Executor screenshots.** Byte sizes are self-authenticating evidence:
  - before-window = after-window = 37303/37529 bytes, and before-pivot = after-pivot = 34818/35035 bytes. Window and pivot are visually unchanged, which is expected.
  - The fillnull before/after pairs differ.
  - The `gap-above-error-px` lines in the executor's before/after-run.txt (fillnull 0 to 20, window/pivot 20) agree with my own measurement.

### Overall: PASS

### Change Requests
None.

### Non-blocking Suggestions
- **`WindowStep.scala:117-120`.** The two consecutive throws (unsupported, then empty) produce the same message. They could be merged into one check, `if (!SupportedFunctions.contains(cfg.function))`, because an empty string is not in the set.
- **`Select` has no visual invalid state.** It has no `[aria-invalid="true"]` border rule, unlike `.ui-input` in `inputs.css:55`. The marking therefore only reaches assistive tech, and the visible signal is the InlineError alone. This gap was there before (HEL-1084) and is a visual-judgment call for the skeptic or a follow-up, not for this ticket.
- **"clears the mark" test.** The test in `StepCard.enumSaveError.test.tsx` would also pass if `setSaveErrorIsValidation(false)` were removed, because the mark is gated on `Boolean(saveError)` and `saveError` is cleared anyway. It is still a valid guard, but it does not prove the flag reset on its own.
- **File size.** `useStepCardState.ts` is 602 lines, past CONTRIBUTING's ~400-line "propose a split" threshold. It was already over before this ticket; this diff adds 10 lines.
- **Executor test data.** The executor's two throwaway users are listed in its `before-run.txt` and `after-run.txt` (`hel1422-shots-1791602185640@…` and `hel1422-shots-1791602161697@…`) and appear not to have been deleted. The orchestrator should check that they are cleaned up by exact id.
