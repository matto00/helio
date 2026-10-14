## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 2d815623f6bdbeeefd3379456caca33be94163d0 (worktree = main + untracked change dir only).

### What I verified (with evidence)

- **Item 1a, `draftAppearance` (D1): CONFIRMED.** `CommandBar.tsx:29` declares it. The destructure no longer lists it. Repo-wide grep finds only `App.tsx:219` and `CommandBar.test.tsx:48-53` as `<CommandBar draftAppearance=…>` sites. `git log -S draftAppearance -- CommandBar.tsx` returns only 6ba9988be (HEL-724) and a796c8e81 (HEL-1448). `git show 6ba9988be:frontend/src/app/CommandBar.tsx` shows it destructured at line 55 but never read: the body only uses `setDraftAppearance` (`onPreviewChange={setDraftAppearance}`). So nothing in CommandBar ever read it, and removing it is behaviour-neutral. The `DashboardAppearance` import stays used by `setDraftAppearance`.
- **Item 1b, `syncStepsFromServer` (D2): CONFIRMED.**
  - `usePipelineStepCreation.ts:38` declares it in the args type and the destructure omits it. Its only caller is `usePipelineStepStructure.ts:89`.
  - History: 05004f85b's file has 6 references, and `f4601ba2e^` calls `await syncStepsFromServer()` at lines 139 and 244. The test comment at `PipelineDetailPage.draftCreate.test.tsx:419-420` quotes the HEL-1345 rationale verbatim.
  - No jest test calls `usePipelineStepCreation` directly. The design says `usePipelineStepStructure` keeps its own `syncStepsFromServer` (lines 57, 125, 160); I confirmed it does.
- **Item 2, e2e types (D3): "byte-identical" CONFIRMED.** I extracted the top-level `type EchartsInstance` + `type ReactFiber` blocks. The md5 is `ae71943b…` for hel1304, hel1351 and hel1392-remount-staleness. hel1305/1306/1311/1508 have differently shaped blocks (distinct md5s). Six specs declare an in-closure `type Fiber` (hel1305/1306/1311/1508/1444/1512). None declares a top-level `ReactFiber`, so the task 2.1 grep `^type ReactFiber` is a valid zero-hit proof. `e2e/tsconfig.json` includes `**/*.ts`, so the new support module gets typechecked.
- **Item 3, cast (D4): CONFIRMED** at `usePipelineRunEvents.test.ts:277-278`.
- **Item 4, guard gap: CONFIRMED.** `PACKAGE_PATHS` has no test path. The pre-change guard exits 0 against a fixture that turns `no-explicit-any` off for `**/*.test.{ts,tsx}` (run: `node scripts/check-eslint-ts-rules.mjs <fixture>` → `check-eslint-ts-rules: OK`, exit 0). Baseline: `check:eslint-ts-rules` and its selftest are both green (exit 0).
- **D6 fixture mechanism works.** In scratch, a fixture placed outside the repo `require`s the real `eslint.config.cjs` by absolute path and appends a test-file override. I ran it with `cwd: repoRoot` and `overrideConfigFile`:
  - The real config's globs resolve as the design assumes. `frontend/src/test/__guard__.ts` matches `frontend/src/test/**/*.{ts,tsx}`, and `.test.ts(x)` paths pick up the appended override.
  - On the real config, the ONLY `@typescript-eslint/*` rule whose severity differs from the non-test path is `no-require-imports`, on the three jest paths. `e2e/__guard__.spec.ts` differs on nothing. So D5's allowance map is exactly right.
- **"Non-adjacent hunks vs PR #1016": CONFIRMED by trial merge**, though only barely. `#1016` (OPEN, `feature/shell-rail-context-list/HEL-1574`) has an App.tsx hunk starting at line 220, directly after the planned removal of line 219. To test it:
  - I applied the planned one-line removals to scratch copies of App.tsx and CommandBar.tsx at merge-base 273c0b0c9. Both files are identical at HEAD.
  - I ran `git merge-file` against #1016's versions. Both merges exit 0, with 0 conflict markers and no surviving `draftAppearance={draftAppearance}` or `draftAppearance:` lines.
  - #1016's file list does not touch hel1304/hel1351/hel1392-remount-staleness, `usePipeline*`, `check-eslint*` or `eslint.config.cjs`.
- **Spec delta.** `openspec validate hel1448-followup-cleanups --strict` reports the change is valid. The MODIFIED requirement title matches the base spec exactly.

### Verdict: REFUTE

### Change Requests

1. **AC4 is not covered: the design checks 4 rules, the AC says "any other TS rule".**
   - AC4 says the `no-require-imports` allowance is exact and named, "so any other TS rule turned off for test files fails the guard".
   - D5 only asserts "every other `REQUIRED_RULES` entry must be `error`". `REQUIRED_RULES` holds 4 sample rules (`no-unused-vars`, `no-explicit-any`, `ban-ts-comment`, `no-require-imports`), but the real config enables 20 `@typescript-eslint/*` rules on a non-test TS path (measured).
   - So the planned guard would still pass silently if a test-file override turned off one of the other 16, e.g. `@typescript-eslint/no-empty-object-type`. I measured this: my fixture turns off `no-explicit-any` and `no-empty-object-type` for tests, and both show up as differences from the non-test path. The 4-rule check would only catch the first.

   Revise D5, the spec delta and task 3.1 so the test-path check covers every typescript-eslint rule. Two ways to do it:
   - (a) **Differential (preferred: no hardcoded list to drift).** For each test probe path, compare every `@typescript-eslint/*` rule active on the matching non-test path in the same package (`frontend/src/__guard__.ts` for the jest paths, `e2e/__guard__.ts` for the e2e spec). Fail on any rule whose severity is lower on the test path, unless that exact path/rule pair is in the allowance map.
   - (b) Check the full rule set derived from `tseslint.configs.recommended`.

   Update the spec delta's "Test-file override disabling a required rule is caught" scenario to match: say "any typescript-eslint rule active on the non-test path", not "a required … rule".

   Add a second red selftest case to D6/task 3.2 that turns off a rule *outside* the current `REQUIRED_RULES`, such as `@typescript-eslint/no-empty-object-type`. Show it red against the pre-change guard and against a 4-rule-only implementation. Without it, the selftest cannot tell the weak and strong implementations apart.

2. **Task 2.1 / 4.1 should name the e2e typecheck command.** AC5 requires the e2e specs to typecheck. `npm run typecheck` only runs `frontend/tsc`, and task 2.1 just says "verify e2e typecheck/lint". Name `npm run check:e2e-types` (`tsc --noEmit -p e2e/tsconfig.json`) explicitly in 2.1 and 4.1, and require its output to be recorded. Also say how e2e lint is covered: root `npm run lint` covers it, or name an equivalent `eslint e2e/` invocation.

### Non-blocking notes

- tasks.md has an empty `## Standing Constraints` heading. Either fill it (non-UI, no user-visible change, do not touch hel1444/hel1512, jest at most 3 workers) or drop it.
- The design's Risks entry says to "verify with a trial merge at Delivery". This round's trial merge is clean, but keep that step: the App.tsx hunks sit one line apart.
- All history claims in D1/D2 (6ba9988be, 05004f85b, f4601ba2e, a796c8e81) check out against `git show`.
