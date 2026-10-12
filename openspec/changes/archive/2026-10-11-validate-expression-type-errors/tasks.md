## Standing Constraints

- [C1] validate-expression reports analyze inferType errors as valid:false with the analyze message verbatim; response shape unchanged (owner ruling Q1=error)
- [C2] Item 2 is copy-only: no backend gate/verdict/canRun/autoRunnable change; RunConfigGate, AutoRunTriggerService, PipelineSchedulerService, PipelineRunService untouched (owner ruling Q2=copy-only)

## 1. Live reproduction (before any code change)

- [x] 1.1 On the worktree dev servers, follow design.md D6 steps 1-4 with a throwaway `@example.test` user, verified via `/api/auth/me` with its id recorded up front. Capture validate-expression returning `valid:true` for `coalesce($n, "n/a")` on main code, the analyze `step-config-invalid` reason, and a manual run that succeeds. Verify: transcript saved as `.concertino/runs/HEL-1437/evidence/live-repro-before.md`.

## 2. Item 1: validate-expression type errors

- [x] 2.1 Red first. Add the D3 parity table test (oracle: `analyzeNodes` on one enabled compute step, every D3 row) and the route-spec cases (parse error, blank, coalesce number/text, comparison number-vs-text, `if()` branch mismatch, date-function type error) to `PipelineCapabilitiesRoutesSpec`, or a new focused spec. Run them on unchanged code. Verify: every row that diverges from the oracle FAILS (the type-error rows and the parse-error row at least), and the output is saved to the evidence dir.
- [x] 2.2 Implement the D2 function on `PipelineAnalyzeService` (analyze's own enabled-step composition, ideally a helper shared with `processNode`) and point `PipelineNodeReads.validateExpression` at it, and update the doc comments in `PipelineNodeReads` and `NodeCapabilitiesProtocol`. Verify: 2.1 is green, and the existing `ColumnSchemaInference`/compute/analyze specs are green unchanged.
- [x] 2.3 Add the D4 seam: the committed fixture `backend/src/test/resources/validate-expression/type-error-response.json`, asserted by the backend route spec, plus a frontend `outputService` test reading the same file. Verify: both tests green, and each turns red when the fixture's `error` is edited (mutation noted in the evidence).

## 3. Item 2: step-config-invalid copy

- [x] 3.1 Red first. Change the tests that pin the old copy (`denyReasonCopy.test.ts`, `PipelineDetailFooter.stepConfigInvalid.test.tsx`, plus any others found by grepping `can't run until` in frontend/src and e2e) to the D5 sentence, and add a not-`/can.?t run|cannot run/i` assertion. Verify: red on unchanged code.
- [x] 3.2 Update `denyReasonCopy.ts`'s `step-config-invalid` entry to the D5 sentence. Verify: 3.1 green, and `denyReasonCoverage.test.ts` green.

## 4. Docs and verification

- [x] 4.1 `docs/compute-expression-grammar.md`: state that validate-expression reports the same errors analyze does, including type errors, and that `valid:false` does not mean save rejects. Reword the notice description near the coalesce inference paragraph so it matches D5. Verify: grep shows no "can't run" claim remains.
- [x] 4.2 Live after-check, repeating D6 steps 2-4 on the changed code: validate-expression returns `valid:false` with analyze's message, the page notice shows the D5 sentence, and the manual run still succeeds. Delete residue by exact id. Verify: `.concertino/runs/HEL-1437/evidence/live-repro-after.md`.
- [x] 4.3 Gates (evidence: evidence/gate-backend-testFull.txt, gate-frontend-jest.txt, gates-frontend-lint.txt, eval-1-gates.txt, gates-cycle2.txt). Verify each passes:
  - backend `sbt testFull`, run niced and capped per HEL-1442, with the sbt server shut down afterwards;
  - frontend lint, typecheck, format:check and jest;
  - `openspec validate validate-expression-type-errors --type change`.
