## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 2d815623f6bdbeeefd3379456caca33be94163d0. The worktree is main plus the untracked change dir only.

### What I verified (with evidence)

- **Round-1 CR1 (full-set parity) is addressed in the text.**
  - D5 now compares every `@typescript-eslint/*` error rule on a same-package baseline, with an exact (path, rule) allowance.
  - D6 adds a second red case outside `REQUIRED_RULES` (`no-empty-object-type`).
  - The spec delta scenario now reads "any typescript-eslint rule ... (including rules beyond the representative required set)".
- **Round-1 CR2 is addressed.** Tasks 2.1 and 4.1 name `npm run check:e2e-types`. Root `package.json:56` is `tsc --noEmit -p e2e/tsconfig.json`. Root `lint` (`eslint .`) covers e2e. Task 2.1 also names per-file eslint.
- **D5's pair table checks out on the real config.** I ran a scratch probe (`calculateConfigForFile`, cwd=repoRoot) for each of D5's four pairs. Each baseline has 20 error-level `@typescript-eslint/*` rules. The only difference is `no-require-imports`, on the three jest paths. `e2e/__guard__.spec.ts` has zero differences. So the allowance map is exact for those four pairs.
- **Items 1-3 are still accurate at HEAD:**
  - `CommandBar.tsx:29`, `App.tsx:219` and `CommandBar.test.tsx:53` match the design.
  - `usePipelineStepCreation.ts:38` declares the arg, and `usePipelineStepStructure.ts:89` is its only call-site pass. The structure hook keeps its own `syncStepsFromServer` (lines 57, 125, 148, 160).
  - The cast is at `usePipelineRunEvents.test.ts:277-278`.
- **The e2e type pair is still byte-identical in the 3 specs.** The `EchartsInstance` block md5 is `02c84052…` and the `ReactFiber` block md5 is `1128fac3…` in hel1304, hel1351 and hel1392-remount-staleness. `^type ReactFiber` appears only in those 3 files.
- **New gap found: helio-mcp test files are not probed.**
  - `git ls-files` shows 47 `*.test.ts` files under `helio-mcp/src`. They are jest tests: root `jest.config.cjs` testMatch is `**/?(*.)+(spec|test).[tj]s?(x)`. The root ESLint config lints them, and the `**/*.test.{ts,tsx}` override applies to them.
  - The guard already treats helio-mcp as a linted package (`PACKAGE_PATHS` has `helio-mcp/src/__guard__.ts`), but D5 adds no helio-mcp test pair.
  - I tested a scratch fixture that `require`s the real `eslint.config.cjs` and appends `{ files: ["helio-mcp/**/*.test.ts"], rules: { "@typescript-eslint/no-explicit-any": "off" } }`. For `helio-mcp/src/__guard__.test.ts` vs `helio-mcp/src/__guard__.ts`, the differences are `["@typescript-eslint/no-explicit-any","@typescript-eslint/no-require-imports"]`. All four D5 pairs are unchanged, so the planned guard passes this fixture silently. The current guard also prints `check-eslint-ts-rules: OK`, exit 0.
  - That is exactly the failure mode the ticket item 4 / AC4 targets ("a config override that turned a TS rule off for test files would go unnoticed"; "any other `@typescript-eslint/*` rule ... turned off for test files fails the guard").

### Verdict: REFUTE

### Change Requests

1. **Cover helio-mcp jest test files (design D5, spec delta, tasks 3.1/3.2).**
   - Add the pair `helio-mcp/src/__guard__.test.ts` -> `helio-mcp/src/__guard__.ts` to D5's probe table.
   - Extend the named allowance map so it covers the jest `no-require-imports` exemption on that path too. The map then holds four jest paths, not three. Measured on the real config: that path differs only by `no-require-imports`.
   - Update the spec delta's first sentence so the test-file paths are a jest test file in each package that has them (frontend and helio-mcp) plus an e2e spec.
   - Optional but cheap: a selftest red case (or a parameter on an existing one) whose override is scoped to `helio-mcp/**/*.test.ts`. That proves the new pair is actually wired. Without it, a typo in the helio-mcp pair would go unnoticed.

### Non-blocking notes

- tasks.md `## Standing Constraints` still reads `(none)`. Consider listing: non-UI, no user-visible change, do not touch hel1444/hel1512, jest at most 3 workers.
- Keep the Delivery trial merge against #1016. The App.tsx hunks sit one line apart (round 1 measured it clean).
