## Standing Constraints

- [C1] Every new backend spec uses `VerifiedEmbeddedPostgres.start`; no inline fully-qualified names.
- [C2] Every new test is shown red under a one-line mutation before being accepted; red+green transcripts are saved under `/home/matt/Development/helio/.concertino/runs/HEL-1489/evidence/` (never /tmp, never the main checkout root).
- [C3] sbt output for backend runs must show the `[hel1468-guard]` summary line; shut down every sbt server started; `nice -n 19` heavy jobs; check MemAvailable >= ~15 GB before `sbt testFull` or a full jest run.
- [C4] Stay inside the window step, its editor card, and new test files; no patch-set production-code edits (concurrent HEL-1459).
- [C5] No `--no-verify`/`HUSKY=0`/hooksPath override; commit trailers carry no claude.ai session link or Claude-Session trailer.

## 1. Item 4 — cosmetic alignment

- [x] 1.1 Align the `case` arrows of the non-rolling `cfg.function match` in `backend/src/main/scala/com/helio/domain/steps/WindowStep.scala` (~l.218-223) by hand; confirm `git diff -w` on the file is empty.

## 2. Item 3 — unique window editor ids

- [x] 2.1 Write the two-editor id-uniqueness test (WindowConfig test file) and run it against the unfixed component; save the red output.
- [x] 2.2 Replace `window-offset-input`, `window-frame-size-input`, `window-output-column` in `WindowConfig.tsx` with `useId()`-derived ids (label `htmlFor` updated); grep `frontend/` (incl. e2e) for consumers of the old literal ids and update them.
- [x] 2.3 Re-run the test green; run the existing WindowConfig/StepCard tests, lint, typecheck.

## 3. Item 2 — route-level rolling-frame rejection tests

- [x] 3.1 Add `PatchSetWindowRollingRejectionRoutesSpec` covering `POST /patch-sets/apply` for pipelineStep create, pipelineStep update and pipeline create edits with the invalid matrix in design.md Decision 2, plus positive controls.
- [x] 3.2 Add `PipelineApplyProposalWindowRollingSpec` covering `POST /pipelines/apply-proposal` with the same matrix, plus a positive control and a no-pipeline-created assertion.
- [x] 3.3 Run both specs green (`[hel1468-guard]` line visible).
- [x] 3.4 Mutation proof exactly per design.md Decision 3: four call-site mutations (one at a time) and three WindowStep rule mutations, each with its expected red set; 0/1001 proven by call-site mutations only. Save every transcript to the evidence dir and list them in `files-modified.md`.

## 4. Gates and commit

- [x] 4.1 Run the existing window backend specs (`WindowRollingValidationSpec`, `WindowStepRollingSpec`, `WindowRollingAnalyzeSpec`, `WindowRollingSeamSpec`, `PatchSetStepCreateConfigRoutesSpec`) plus the new ones.
- [x] 4.2 Commit via the normal pre-commit hook (`HEL-1489 ...`), write `files-modified.md`.
