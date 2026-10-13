## Standing Constraints

(none yet)

## 1. Frontend



- [x] 1.1 Re-enumerate every step-config text field that re-emits config on blur (grep `onBlur` under `frontend/src/features/pipelines` and any other step-config editor dir); list each with file:line in `probe-notes.md` in the change dir
- [x] 1.2 Live before-probe on the worktree's own servers (throwaway `@example.test` user): for each candidate, edit then blur, record PATCH count and bodies; a field is in scope only if it shows the duplicate identical PATCH
- [x] 1.3 Remove `onBlur` from `ConvertFormatConfig.tsx` "Destination field" (in-scope fields only); verify unit tests below
- [x] 1.4 Remove `onBlur` from `ComputeFieldConfig.tsx` "Output field name" and "Expression" (if confirmed in 1.2)
- [x] 1.5 Remove `onBlur` from `UpsertSourceConfig.tsx` "New source name" (if confirmed in 1.2)
- [x] 1.6 Confirm in code that the draft-create path and validation never relied on blur (design D2); note in commit message

## 2. Tests

- [x] 2.1 Invert/tighten blur unit tests in ComputeFieldConfig/ConvertFormatConfig tests, add upsertsource + compute expression cases; show each red against pre-fix code
- [x] 2.2 Add StepCard-level fake-timer test: change, past debounce, blur, past debounce → exactly one `updatePipelineStep` per field, plus focus-then-blur with no edit → zero calls; show red pre-fix
- [x] 2.3 Confirm `useStepCardState.characterization.test.ts` passes unchanged
- [x] 2.4 Live after-probe, same scenarios as 1.2: exactly one PATCH per edit, none for blur without edit; delete throwaway user by exact (id, email) via `buildUserDeleteSql`
- [x] 2.5 Lint, typecheck, prettier, jest (pipelines dir, `HELIO_JEST_MAX_WORKERS=3 nice -n 19`) pass
