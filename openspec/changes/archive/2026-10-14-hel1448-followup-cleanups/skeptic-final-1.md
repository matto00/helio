## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `3bd40f36f827ec46bcb9add03fadc4dc2e077c7a`, base resolved live by `resolve-review-base.sh` = `2d815623f6bdbeeefd3379456caca33be94163d0` (origin/main). One commit on the branch.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/remove-dead-props-lint-guard/HEL-1453`.
- **AC1 (dead props removed):** the diff removes `draftAppearance` from `CommandBarProps` (CommandBar.tsx:29), App.tsx:219 and CommandBar.test.tsx:53, and removes `syncStepsFromServer` from `UsePipelineStepCreationArgs` and its one caller (usePipelineStepStructure.ts:89). `grep draftAppearance frontend/src/app/CommandBar*.tsx` returns 0 hits. App.tsx still reads `draftAppearance` at lines 187 and 245 (preview context and the appearance fallback), so the state is not orphaned. The remaining `syncStepsFromServer` references are its definition in usePipelineStepStructure and the other consumers (StepMutations, RootAndToggleActions, DetailPage), as D2 describes. The design.md D1/D2 justifications cite commit history. Frontend typecheck exits 0, which shows nothing still passes the removed props. The change is type-only, so no UI review was needed.
- **AC2 (e2e type dedupe):** the new `e2e/support/echartsFiber.ts` contains the byte-identical pair. hel1304 and hel1351 use `import type { EchartsInstance, ReactFiber }`. hel1392 uses `import type { ReactFiber }` only, which is correct: grep shows no explicit `EchartsInstance` reference in that file. `grep -rln "getEchartsInstance?: () => EchartsInstance" e2e` finds only the support file. The differently-shaped `EchartsInstance` types in hel1305, hel1306, hel1311 and hel1508 are left alone, as scoped. `npm run check:e2e-types` exits 0. eslint `--max-warnings=0` on the 4 e2e files and the 2 scripts exits 0.
- **AC3 (cast removed):** usePipelineRunEvents.test.ts:277 no longer has the trailing `as AbortSignal`. The suite passes (see jest below).
- **AC4 (guard covers test paths, with an independent red-first check):** I ran the pre-change guard (`git show 2d815623f:scripts/check-eslint-ts-rules.mjs`, with repoRoot pinned to the worktree) and the new guard against 6 fixture configs I wrote myself. Each fixture spreads the real `eslint.config.cjs` and adds one test-scoped override:
  - c1 `**/*.test.{ts,tsx}` turns off no-explicit-any: old exit 0, new exit 1 (names the test path and the rule)
  - c2 `**/*.test.{ts,tsx}` turns off no-empty-object-type (outside REQUIRED_RULES): old 0, new 1
  - c3 `helio-mcp/**/*.test.ts` turns off no-explicit-any: old 0, new 1 (names `helio-mcp/src/__guard__.test.ts`)
  - c4 `e2e/**/*.spec.ts` turns off no-require-imports (no allowance for e2e): old 0, new 1
  - c5 `frontend/src/test/**/*.ts` turns off ban-ts-comment: old 0, new 1
  - c6 `**/*.test.{ts,tsx}` turns off no-require-imports (the documented exemption): old 0, new 0. The allowance is exact.
  - On the real config: `npm run check:eslint-ts-rules` prints `check-eslint-ts-rules: OK`, EXIT=0. `npm run check:eslint-ts-rules:selftest` prints `check-eslint-ts-rules selftest: OK`, EXIT=0. The three selftest cases match the three configs the AC requires.
- **AC5 (gates):** frontend `npm run lint` exit 0. Frontend `npm run typecheck` exit 0. `check:e2e-types` exit 0. `prettier --check` on every changed ts/tsx/mjs file reports all formatted. Jest (`--maxWorkers=3`, patterns CommandBar|usePipelineRunEvents|PipelineDetailPage|usePipelineStep|App.test): `Test Suites: 18 passed, 18 total`, `Tests: 283 passed, 283 total`, exit 0.
- **Scope:** the diff touches no hel1444 or hel1512 specs. The App.tsx and CommandBar.tsx edits are single-line removals, consistent with the planned #1016 overlap note.

### Verdict: CONFIRM

### Non-blocking notes
- The guard's test-path parity compares only `@typescript-eslint/*` rules. Core rules turned off for tests are out of scope, which matches the AC wording.
- `evaluation-1.md` is untracked in the worktree. Delivery should commit or persist it, as usual.
