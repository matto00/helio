# HEL-1453: After HEL-1448: unread draftAppearance/syncStepsFromServer props; duplicated e2e ECharts/fiber helper types; redundant AbortSignal cast; ESLint guard ignores test-file overrides

## Description

Origin: HEL-1448 (matto00/helio#896), lane-reported. Label: Follow-up.

1. `draftAppearance` and `syncStepsFromServer` are declared in their props/options types, but nothing reads them. Remove them, or wire them if they were meant to work.
2. `EchartsInstance`/`ReactFiber` helper types are duplicated in 3 e2e specs. Move them to `e2e/support/` (overlaps HEL-1377, the shared typed e2e ECharts helper).
3. Redundant `as AbortSignal` at `usePipelineRunEvents.test.ts:277`.
4. The `check:eslint-ts-rules` guard probes only non-test paths, so a config override that turned a TS rule off for test files would go unnoticed. Also probe a test path, with a red selftest.

## Acceptance criteria

- AC1: `draftAppearance` is removed from `CommandBarProps` and every call site (App.tsx, CommandBar.test.tsx); `syncStepsFromServer` is removed from `usePipelineStepCreation`'s args type and its one call site (usePipelineStepStructure.ts). The decision (remove, not wire) is justified from code history in design.md. No user-visible behaviour change.
- AC2: The identical `EchartsInstance`/`ReactFiber` type pair duplicated in hel1304, hel1351 and hel1392-remount-staleness lives once under `e2e/support/` and those three specs import it (type-only); `grep` proof of no remaining copies of that pair. Spec-specific, differently-shaped `EchartsInstance` types in other specs are left alone. The fiber-walk function dedupe stays with HEL-1377.
- AC3: the redundant `as AbortSignal` cast in usePipelineRunEvents.test.ts is gone; the test still passes.
- AC4: `check:eslint-ts-rules` also probes test-file paths in every linted package (frontend and helio-mcp jest `*.test.ts(x)`, and an e2e spec); the existing documented test-only exemption (`no-require-imports` off for jest tests) is an exact, named allowance, so any other `@typescript-eslint/*` rule active on the matching non-test path but turned off for test files fails the guard (full-set parity, not just the 4 representative rules). The selftest proves RED for three configs whose test-file override turns off a rule (one inside, one outside the representative set, one scoped to helio-mcp only), and green on the real config.
- AC5: lint, typecheck, jest (touched suites), and the guard + selftest pass; `npm run check:e2e-types` passes and eslint is clean on the edited e2e files.

## Context (from premise validation)

Driver context: overnight, non-UI, no user-visible change allowed. Open PR #1016 (HEL-1574) edits App.tsx and CommandBar.tsx in non-adjacent hunks — note the overlap in the PR body. Do not touch hel1444/hel1512 specs (also in #1016).
