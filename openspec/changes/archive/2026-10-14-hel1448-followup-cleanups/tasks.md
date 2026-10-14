## Standing Constraints

## 1. Frontend

- [x] 1.1 Remove `draftAppearance` from `CommandBarProps` and from App.tsx / CommandBar.test.tsx call sites; verify `npm run typecheck` and the CommandBar jest suite pass
- [x] 1.2 Remove `syncStepsFromServer` from `UsePipelineStepCreationArgs` and the `usePipelineStepStructure.ts` call; verify typecheck and pipelines hook/page jest suites pass
- [x] 1.3 Drop the redundant `as AbortSignal` in usePipelineRunEvents.test.ts; verify that suite passes and lint is clean

## 2. E2E

- [x] 2.1 Add `e2e/support/echartsFiber.ts` exporting `EchartsInstance`/`ReactFiber`; switch hel1304, hel1351, hel1392-remount-staleness to `import type`; verify `npm run check:e2e-types` and `npx eslint` on the four e2e files (recorded) and `grep -n "^type ReactFiber" e2e/*.ts` returns nothing

## 3. Tooling

- [x] 3.1 Extend check-eslint-ts-rules.mjs with test/baseline probe pairs for frontend, helio-mcp and e2e, full @typescript-eslint parity and the exact no-require-imports allowance (design D5); verify `npm run check:eslint-ts-rules` is green
- [x] 3.2 Add the three test-override red cases (no-explicit-any; a rule outside REQUIRED_RULES; a helio-mcp-only override) to the selftest (design D6); show it RED against the pre-change guard, then green; verify `npm run check:eslint-ts-rules:selftest`

## 4. Tests

- [x] 4.1 Run `npm run lint`, `npm run typecheck`, `npm run check:e2e-types`, touched jest suites (max 3 workers), guard + selftest; record outputs
