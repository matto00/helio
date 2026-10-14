## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed at HEAD 2d815623f6bdbeeefd3379456caca33be94163d0. The worktree is main plus the untracked change dir only.
The spawn-cwd guard printed `READY`.

### What I verified (with evidence)

- **Round-2 CR1 (helio-mcp jest tests) is addressed in all four places:**
  - D5 adds the `helio-mcp/src/__guard__.test.ts` -> `helio-mcp/src/__guard__.ts` pair.
  - The allowance map now covers four jest paths, adding helio-mcp `.test.ts`.
  - D6 adds a third red case, scoped to `helio-mcp/**/*.test.ts`.
  - Task 3.2 lists all three red cases. AC4 in ticket.md and the spec delta's first sentence both name frontend and helio-mcp jest tests plus an e2e spec.
- **D5's pair table and allowance are exact on the real config.** I wrote my own scratch probe: `calculateConfigForFile`, cwd=repoRoot, `overrideConfigFile` set to a tmp fixture that `require`s the real `eslint.config.cjs` by absolute path. With no extra override:
  - Every baseline has 20 error-level `@typescript-eslint/*` rules.
  - Each of the four jest paths differs from its baseline only in `no-require-imports`: frontend `.test.ts`, `.test.tsx`, `src/test/`, and helio-mcp `.test.ts`.
  - `e2e/__guard__.spec.ts` differs in nothing.
  - So the real config stays green under full-set parity with exactly the named allowance.
- **All three D6 red fixtures are detectable by the planned pairs.** I appended each override to the real config and re-ran the probe:
  - `no-explicit-any` off for `**/*.test.{ts,tsx}` shows up as a diff on frontend `.test.ts`/`.test.tsx` and helio-mcp.
  - `no-empty-object-type` off (a rule outside `REQUIRED_RULES`) shows up on the same paths. So the selftest can tell a 4-rule implementation from a full-parity one.
  - `no-explicit-any` off for `helio-mcp/**/*.test.ts` only shows up on the helio-mcp pair alone. So that case proves the new pair is wired.
  - Both tmpdir fixture globs resolve against cwd=repoRoot, as the Risks entry assumes.
- **Red-first is demonstrable.** The current guard prints `check-eslint-ts-rules: OK`, exit 0, against both the helio-mcp-only fixture and the `no-empty-object-type` fixture. Round 1 showed the same for the `no-explicit-any` fixture. So each new selftest assertion fails before the change.
- **Package coverage is complete.** `git ls-files` shows TS only under frontend/ (1242 files), helio-mcp/ (108), e2e/ (82) and two root playwright configs. The test files are `frontend/src` (596), `helio-mcp/src` (47), `helio-mcp/scripts` (3) and the e2e `*.spec.ts` files. Every linted package now has a test pair.
- **Items 1-3 are unchanged at HEAD and still match the design:**
  - `CommandBar.tsx:29`, `App.tsx:219` and `CommandBar.test.tsx:53` hold the `draftAppearance` prop and its two call sites. App.tsx keeps its own uses at :76/:187/:246.
  - `usePipelineStepCreation.ts:38` declares `syncStepsFromServer`, and `usePipelineStepStructure.ts:89` is its only pass. That hook keeps its own uses at :57/:125/:148/:160.
  - The cast is at `usePipelineRunEvents.test.ts:277-278`.
  - `^type ReactFiber` appears only in hel1304, hel1351 and hel1392-remount-staleness.
  - `e2e/support/echartsFiber.ts` does not exist yet.
  - I did not re-verify the D1/D2 history claims, because HEAD is identical to rounds 1-2, which checked them with `git show`.
- **Commands and validation.** `package.json:50,51,56` defines `check:eslint-ts-rules`, its selftest, and `check:e2e-types`. `openspec validate hel1448-followup-cleanups --strict` reports the change is valid.
- **Design checks:**
  - No placeholders, TODO or TBD.
  - No contradiction between proposal, design, tasks and the spec delta.
  - Every AC maps to a task: AC1 to 1.1/1.2, AC2 to 2.1, AC3 to 1.3, AC4 to 3.1/3.2, AC5 to 4.1.
  - No API or schema surface is touched.

### Verdict: CONFIRM

### Non-blocking notes

- `helio-mcp/scripts` also holds 3 jest `*.test.ts` files. A probe override scoped to `helio-mcp/scripts/**` would get past the `helio-mcp/src` pair. That matches the "every linted package" wording in AC4, so it is fine, but it is not full directory coverage.
- Task 2.1's zero-hit grep only checks `ReactFiber`. That is deliberate, because the differently shaped `EchartsInstance` types in hel1305/1306/1311/1508 remain. Record which `EchartsInstance` hits are expected so the proof reads clearly.
- tasks.md `## Standing Constraints` is still empty. It could list: non-UI, no user-visible change, do not touch hel1444/hel1512, jest at most 3 workers.
- Keep the Delivery trial merge against PR #1016. The App.tsx hunks sit one line apart.
