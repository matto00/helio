## Standing Constraints

- [C1] Never pkill/pgrep/killall; stop only an sbt server you started, by its own recorded PID/`sbt shutdown`. Never delete caches or cancel other workflows' runs.
- [C2] No `--no-verify`/`HUSKY=0` without explicit disclosure in the report. Check `free -g` before committing (under ~15 GB free: wait). Use `-J-Xmx3g` on your own sbt invocations; `sbt testFull`, never bare `sbt test`.
- [C3] Single-file jest: `npm --prefix frontend test -- --testPathPatterns=X` (the root form does not narrow, HEL-1466). Use `git -C`, not `cd`. Bash timeout 600000. Namespace scratch files by ticket (HEL-1422).
- [C4] Red-first: every new behaviour test (D2 marking, D4 order) must be shown failing on the WHOLE pre-fix tree (not a single reverted file), with the transcript recorded.
- [C5] Never print, cat, source or echo `backend/.env` or any env map. Dev DB: throwaway users only (never matt@helio.dev); record every created id; delete only by exact id.
- [C6] Visual checks in the RUNNING app in both themes; screenshots under `.concertino/runs/HEL-1422/evidence/` of the MAIN checkout (not the repo root). `@typescript-eslint/recommended` is enforced (HEL-1448).

## 1. Backend: run-time order and comments

- [x] 1.1 Red first: add WindowStep tests. (a) `lag` with no `field` and `offset: 0` fails with the "requires 'field'" error. (b) The same for `lead`. (c) An unsupported function with no field still fails with the unsupported-function error. (d) `lag` with a field and `offset: 0` still fails with the offset error. Show (a)/(b) failing on the pre-fix tree.
- [x] 1.2 Reorder `WindowStep.apply` per design D4 (unsupported function → empty draft → missing field → offset); `enumProblems` unchanged. Tests pass.
- [x] 1.3 Align the `PivotStep.validateRawConfig` doc and the `StepConfigValidation.validatePivot` inline comment with their fillnull/window counterparts (D3), comment-only.

## 2. Frontend: InlineError id + rejected-save marking

- [x] 2.1 `InlineError` text variant accepts an optional `id`; unit test; existing call sites unchanged.
- [x] 2.2 `useStepCardState.persist` records whether the captured rejection was a 422 (D2) and exposes it alongside `saveError`. It resets when `saveError` resets, and the existing staleness-token guard applies.
- [x] 2.3 FillNullConfig/PivotConfig/WindowConfig: stable error id; mark the D2-specified enum `Select` (fillnull strategy / pivot agg / window function) via `ariaInvalid`/`ariaDescribedBy`, only while a validation (422) rejection is shown; wire props through StepOpEditor/StepCard.
- [x] 2.4 Red first: extend `StepCard.enumSaveError.test.tsx` (or the per-config tests). For each kind, a 422 keeps the chosen value, and the expected control has aria-invalid plus an aria-describedby whose element contains the message. A non-422 failure shows the message with no aria-invalid. The mark clears on the next save attempt.

## 3. Frontend: fillnull spacing

- [x] 3.1 FillNullConfig root uses `pipeline-detail-page__aggregate-config` (D1); update any test relying on the old class.
- [x] 3.2 Running-app before/after screenshots of the fillnull, window and pivot editors showing a rejected-save error, in both light and dark themes, saved to the run evidence dir. No 422 is reachable in the running app today (D2), so inject it: use Playwright `page.route` on the step PATCH to return 422 with a realistic `{message}`. State in the evidence that the 422 was injected.

## 4. Gates

- [x] 4.1 Frontend lint, typecheck, format:check, full jest; backend `sbt testFull` (`-J-Xmx3g`) or the targeted Window/Pivot/StepConfigValidation specs plus whatever the gate-selection requires.
- [x] 4.2 Record the files you modified in `files-modified.md`.
