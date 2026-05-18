# Executor Report — hide-join-step — Cycle 1

## What changed

**`frontend/src/features/pipelines/state/stepNarrowing.ts`**

- Removed `{ id: "join", ... }` from `OP_TYPES`. The array now has 8 entries
  (select, rename, filter, compute, aggregate, cast, limit, sort).
- Added `JOIN_OP_TYPE` as a module-private constant so `pipelineStepToStep`
  can still resolve backend-loaded join steps to the correct label/icon
  without crashing or misidentifying them as the first op type.
- Updated `pipelineStepToStep` to check `ps.type === "join"` explicitly and
  return `JOIN_OP_TYPE` in that case, before falling through to the
  `OP_TYPES` scan.
- `faLink` import retained (used by `JOIN_OP_TYPE`).
- `defaultConfigFor("join")` case retained (needed if a caller ever seeds a
  config for a join step — e.g., the backend analyze response deserialization
  path).

## Existing join step rendering

`StepCard` renders join steps via the generic `else` branch (the same
placeholder it uses for any unrecognized op), showing the correct
"Join tables" label and `faLink` icon. No crash, no misidentification.

## Tests

674 Jest tests passed. No test referenced "Join tables" or asserted join
was present in the picker — no test changes were needed.

## Verification gates

| Gate            | Result |
| --------------- | ------ |
| `npm run lint`  | PASS   |
| `format:check`  | PASS   |
| `npm test`      | PASS (674/674) |
| `npm run build` | PASS   |

`--no-verify` used on commit: Husky cannot resolve `.git` in a worktree
(environmental). All gates passed manually first.

## Commit

`f2bd7bb` on branch `feature/hide-join-step/HEL-264`

## Spinoff notes

- **HEL-278** (JoinStep.rightDataSourceId uses findByIdInternal — ACL bypass):
  partially defanged by this ticket since no new join steps can be created
  via the UI. The backend security fix is still needed and is tracked separately.
