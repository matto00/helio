## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD fd99c3ddec646ecc982518daddd31a047671574e (planning artifacts are untracked in the change dir).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=bug/eslint-ts-recommended-rules/HEL-1448`.
- **Owner ruling is real:** `.concertino/runs/HEL-1448/events.jsonl` has `escalation.raised` (id HEL-1448-1791576230489-3f9354, options fix-all-now-with-conventions/fix-all-strict/exempt-with-followups/warn-only) followed by `escalation.answered` with `answer: fix-all-now-with-conventions`, `answer_source: human`, `resolution_channel: chat`. The proposal's scope matches what the owner picked, including the two conventions named in the recommendation (the `^_` ignore patterns plus ignoreRestSiblings, and no-require-imports off only for test files).
- **Root cause claim:** `eslint.config.cjs:76` spreads `...tseslint.configs.recommended.rules`. With typescript-eslint 8.56.1 / eslint 9.39.3, `configs.recommended` is an array of 3 entries: [0] `typescript-eslint/base` (languageOptions+plugins, no `files`), [1] `eslint-recommended` (`files` ts/tsx/mts/cts, 23 rules), [2] `recommended` (no `files`, 23 rules). This matches design.md Context exactly. Through the ESLint API with the live config, `calculateConfigForFile(frontend/src/main.tsx)` has 0 `@typescript-eslint/*` rules, and `lintText` on a probe with an unused import and an `any` gives `[]`. So the bug is confirmed red on the base.
- **Baseline claim (105/67):** `lint-baseline.json` tallies to no-unused-vars 70, no-require-imports 25, no-explicit-any 10, with 0 warnings. All 25 require-imports hits are in `*.test.ts(x)` or `frontend/src/test/jest.setup.ts`, none in production code. The 10 `any` hits are 8 in e2e, `toastListeners.ts:71`, and `usePipelineRunEvents.test.ts:277`.
- **Residual after D1+D2+D3 (independent re-measurement):** I built a scratch copy of the proposed config in my scratchpad (not in the worktree) and ran `npx eslint -c <scratch> . -f json` from the worktree. Result: exactly no-unused-vars 48 and no-explicit-any 10 in 41 files, 0 warnings. That matches task 2.3's expected "~48 + 10". The test-file glob clears all 25 require hits, including `frontend/src/test/jest.setup.ts`.
- **D1 ordering/scoping:** Inserting the mapped entries before the existing TS block lets the TS block's `"no-unused-vars": "off"` and the D2 options win. Rescoping entry [1] from ts/tsx/mts/cts to `**/*.{ts,tsx}` loses nothing: `git ls-files '*.mts' '*.cts'` returns 0.
- **D6 guard feasibility (ESLint API outside base path):** I tested empirically from the scratchpad with `new ESLint({ cwd: repoRoot, overrideConfigFile: <file in scratch> })`:
  - A fixture outside the repo that uses bare `require("typescript-eslint")` fails with `Cannot find module 'typescript-eslint'`.
  - A fixture that uses `createRequire("<repo>/package.json")` works. With the correct wiring it reports 20 TS rules, and `lintText` reports no-unused-vars and no-explicit-any. With the broken `.rules` spread it reports 0 TS rules and `[]`.
  - `**/*` patterns resolve against `cwd`, so base-path placement is not the issue. Module resolution is.
  - `calculateConfigForFile` on a path that does not exist (`helio-mcp/src/doesnotexist.ts`) still returns a config.
  - So the mkdtemp selftest design works, as long as the fixture resolves its modules through the repo.
- **Parity checker:** `scripts/check-precommit-ci-parity.mjs` requires every `npm run <x>` in `.husky/pre-commit` to also appear in a `ci-complete`-needed job in `ci.yml`, either by name or by `node <path>`. Adding both scripts to the hook and as steps in the existing `frontend` job satisfies it. Task 4.3 already covers this.
- **AC coverage:**
  - AC1 (red first) → task 1.1.
  - AC2 (wiring, keep overrides) → D1 / task 2.1.
  - AC3 (measure, escalate, zero warnings) → measured, escalated, answered, C4 / task 3.4.
  - AC4 (guard) → D6 / tasks 4.1–4.4, including a mutation proof.
  - No AC is left uncovered, and there is no out-of-ticket scope.
- **Placeholders:** none blocking. "~67 files"/"~48" are measured, and I reproduced the 48.

### Verdict: CONFIRM

### Non-blocking notes (the executor should act on 1–3)

1. **C3 vs D3 contradiction (resolve during execution):** D3's override globs include `**/*.spec.{ts,tsx}`. But `git ls-files '*.spec.ts' '*.spec.tsx'` shows all 55 such files live in `e2e/`. Those are Playwright specs, not jest, and they have zero require-imports hits. So that glob only exempts non-jest files, which contradicts C3 ("off ONLY for jest test/setup files") and the spec scenario's "jest test file" wording. Drop `**/*.spec.{ts,tsx}` from the D3 override. The measured residual does not change, since no `.spec` file has a require hit.
2. **D6 fixture module resolution:** a selftest fixture config under mkdtemp must load `typescript-eslint` via `createRequire(<repoRoot>/package.json)` (or absolute paths). A bare `require` fails outside the repo. Use this instead of the in-repo temp-path fallback, which would collide with `check:test-temp-dir-hygiene`.
3. **Sites where D2's "remove, never rename" rule needs judgment (no runtime change either way, but keep the diff tight):**
   - `e2e/state-surface-contrast-guard.spec.ts:511` `ROUTE_KEYS` is "only used as a type" (`type RouteKey = (typeof ROUTE_KEYS)[number]`). It cannot simply be deleted. Replace it with an explicit union type, and do not rename it to `_ROUTE_KEYS`.
   - `frontend/src/features/panels/ui/grid/mobilePanelHeights.ts:80-81` `h`/`w` are unused params of the exported `computeMobilePanelHeight`. Its doc comment says they are kept on purpose, and there are 2 production callers (`MobilePanelStack.tsx:114`, `MobilePanelStackSkeleton.tsx:16`). Either removing them and updating the callers, or `_`-prefixing them as intentionally reserved parameters, is defensible. Record which one was chosen and why in files-modified.md.
   - `frontend/src/app/App.test.tsx:779` `const { store } = renderApp(...)` and `e2e/hel516-palette-quick-create.spec.ts:320` `const output = (await outputRes.json())` have side-effecting initializers. Per C1, keep the call and drop only the binding.
4. `e2e/support/isolateLivePage.ts` has no top-level side effects (it only has type imports and exported functions), so deleting the 15 unused `isolateLivePage` imports is a true no-op.
5. Wiring entry [1] (`eslint-recommended`) also turns off some core rules for TS files (e.g. `no-undef`) and turns on `prefer-const`/`no-var`/etc. That is intended upstream behaviour and produces no new hits in the measured residual. Mention it in the PR body as an expected config change.
