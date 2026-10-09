## Standing Constraints

- [C1] The undo red test journals via a REAL pipelineStep-delete apply over an Output row stored with dead keys, never a hand-written journal row; assertions read stored configs from the repo.

## 1. Backend

- [x] 1.1 Write the D4 red test first (pipelineStep-delete undo with a pre-V117 journal); run it on unfixed code and save the failing transcript
- [x] 1.2 Add the pure normaliser (design D2) next to OutputConfigValidation; verify with its unit tests (2.1)
- [x] 1.3 Normalise in PatchSetUndoService.restoreBoundOutputs before insertInternal; verify 1.1 turns green
- [x] 1.4 Normalise the merged config in OutputService.update under RestorePriorStored only; verify with 2.2
- [x] 1.5 Enumerate every other captured-Output-config write site (D1) and record the result in files-modified.md

## 2. Tests

- [x] 2.1 Unit tests for the normaliser: every rename, every drop class, shadowed-by-live, null/invalid values, untouched keys
- [x] 2.2 OutputService.update RestorePriorStored test: dead keys normalised; ValidateWrite behaviour unchanged
- [x] 2.3 V117 parity spec (design D3) on embedded Postgres; non-vacuity assertions; record a mutation that turns it red
- [x] 2.4 Run the backend suite for touched areas (patchsets, pipelines, V117 spec) via the worktree-pinned sbt invocation
