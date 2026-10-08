## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD f3113ed454c4636dc466f7eb93deb976d30829a4 (worktree clean except the untracked change dir).

### What I verified (with evidence)

**(a) Every "expected" output in tasks.md, run against the current tree**
- 1.1 `git grep -n "function prefersReducedMotion" -- frontend/src` gives 2 lines: `shared/ui/Toast.tsx:18` and `utils/chartAppearance.ts:89`. Matches.
- 1.1 `git grep -n "prefersReducedMotion" -- frontend/src | wc -l` gives 12. Matches.
- 1.1 the `-c` query-literal grep lists 4 files: Toast.test.tsx, Toast.tsx, chartAppearance.test.ts, chartAppearance.ts, 1 each. No expectation is stated, which is fine.
- 2.2 the describe block is at chartAppearance.test.ts:247-264, and `prefersReducedMotion,` is at import line 8. Matches.
- 3.1 the doc comment plus function span chartAppearance.ts:79-92 exactly (79 `/** Live read…`, 92 `}`). After the edit the expected 2 hits (import plus default param at :253) are correct. The :244 comment says `prefers-reduced-motion` (kebab-case), so it does not match.
- 3.2 buildChartOption.ts: the import is at :8 and the call at :233. Expecting 2 hits after the edit is correct.
- 3.3 Toast.tsx:18-26 is the whole private function, and its 3-line comment is inside the body, so the range is right. The only remaining hits after the edit are the import and the :48 call. Expecting 2 lines and 0 `matchMedia` hits is correct.
- 4.2 the import-grep expectation is correct: the non-test importers after the change are buildChartOption.ts, Toast.tsx and chartAppearance.ts. The test file also prints, and the task excludes it correctly.
- 6.1 run against today's tree, the non-test query-literal grep prints exactly the 2 current copies. The pathspec excludes work, so "exactly 1 after" is achievable.
- 5.1 the test paths exist (ChartPanel*.test.tsx x7, hooks/useIsNarrowerThan.test.ts). Baseline run of the same command without the new module: `Test Suites: 11 passed, 11 total / Tests: 142 passed, 142 total`. "3 passing tests in prefersReducedMotion.test.ts" is correct: 2 moved plus 1 new.

**(b) The useIsNarrowerThan.ts premise.** Confirmed: it is not a reduced-motion copy. It queries `` `(max-width: ${breakpointPx - 1}px)` `` (line 14). It is a reactive hook with a `change` listener (lines 23-35). It shares only the guard expression (lines 17, 24). The only reduced-motion link is the doc-comment pointer at line 6.

**(c) Missed JS readers of prefers-reduced-motion.** I ran `git grep -n "matchMedia"` across the whole repo (excluding archive) and `git grep "prefers-reduced-motion"` over `*.ts/*.tsx/*.js/*.mjs` non-test files. The only JS readers are Toast.tsx:25 and chartAppearance.ts:91. The e2e hit (hel773 spec) uses Playwright `emulateMedia`, which is CSS-driven and not a JS read. helio-mcp has 0 hits, and src/test/jest.setup.ts has no matchMedia shim. Nothing was missed in code. One doc pointer was missed (CR1).

**(d) Behaviour preservation.** The bodies are semantically identical; Toast's only differs by braces. Both call sites call the function at use time: the default param is evaluated per `applyHoverEmphasis` call, and the Toast call runs inside `dismiss`. A named ESM import binding keeps that. No test spies on or mocks `prefersReducedMotion` or Toast: the only `spyOn(chartAppearance, …)` calls target `resolveChartTheme` (ChartPanel.theme.test.tsx:112, PanelCard.aggregatePieChart.test.tsx:154). Toast.test.tsx:270-299 mocks `window.matchMedia` globally, so the shared helper still reads it. The new module has no imports, so there is no cycle risk. Behaviour is preserved.

**(e) Ambiguity for a weaker executor.** See the Change Requests below.

### Verdict: REFUTE

The design is sound and the premise is correct. The refutation is narrowly about tasks.md: one stale pointer the plan forbids fixing, and three instructions that will mislead or vacuously pass for a weaker model.

### Change Requests

1. **Stale prose pointer in `frontend/src/shared/ui/toast.css:60-63`, and C2 forbids fixing it.** The comment reads "`Toast.tsx`'s own `matchMedia` check zeroes the exit delay under the same query". After task 3.3, Toast.tsx contains no `matchMedia` at all; task 3.3's own verify asserts 0 hits. So this sentence becomes literally false. C2 says "Do NOT touch any `.css` file", and the 6.1 stale-pointer grep (`own private .prefersReducedMotion\|Toast.tsx.s .prefersReducedMotion`) does not catch it. The design's risk line ("Stale doc pointers → zero-hit grep") claims coverage it does not have. Fix:
   - Add a comment-only exception to C2 for toast.css lines 60-63. For example, reword to "`Toast.tsx`'s reduced-motion check (`utils/prefersReducedMotion.ts`) zeroes the exit delay…".
   - Add a task with the exact replacement text, plus a verify step (`git diff -- frontend/src/shared/ui/toast.css` showing changes only inside that `/* */` comment).
   - Extend the 6.1 stale grep with `Toast.tsx.s own .matchMedia` (expected: no output).
   - Add toast.css to proposal.md Impact and to the 6.2 expected list.
   - Alternatively, if the planner rules CSS comments untouchable, record that ruling and the known-stale sentence explicitly in design.md. It must not be silently left.

2. **Task 5.2's restoration check is vacuous.** `prefersReducedMotion.ts` is a new, untracked file, so `git diff --stat` never shows it. A botched restore of the guard line would pass this check. Replace it with a check that actually reads the file, for example `grep -c 'typeof window === "undefined" || typeof window.matchMedia !== "function"' "$W/frontend/src/utils/prefersReducedMotion.ts"` with expected output `1`, or a re-`cat` compared against the 2.1 block.

3. **Task 6.2's cross-check is ambiguous.** `git status --porcelain` collapses the untracked change dir into one line, `?? openspec/changes/consolidate-reduced-motion-helper/`. That dir also holds workflow-state.md, verification-log.md, the skeptic report and files-modified.md itself. "Must match exactly" therefore has no clear answer, which is the miscounting trap the prior trial fell into. Give the exact command and the exact expected output. For example, `git -C "$W" status --porcelain -- frontend` should print exactly these 8 entries (9 with toast.css if CR1 is adopted): ` M` for utils/chartAppearance.ts, utils/chartAppearance.test.ts, utils/README.md, shared/ui/Toast.tsx, features/panels/ui/buildChartOption.ts and hooks/useIsNarrowerThan.ts, and `??` for utils/prefersReducedMotion.ts and utils/prefersReducedMotion.test.ts. Also state whether files-modified.md lists only these frontend paths.

4. **Task 2.2 prescribes a lint line that is certain to fail; make the outcome deterministic.**
   - `@typescript-eslint/no-explicit-any` is not enabled. `eslint --print-config frontend/src/utils/chartAppearance.test.ts` registers the plugin, but the rule is `undefined`.
   - `linterOptions.reportUnusedDisableDirectives` is `1` (warn), and `lint` runs with `--max-warnings=0`.
   - So the `// eslint-disable-next-line @typescript-eslint/no-explicit-any` line will always fail lint as unused.
   - Do not leave this to a conditional fallback. Prescribe the final form directly: drop the disable comment and use `Reflect.deleteProperty(window, "matchMedia");`, or keep `delete (window as any).matchMedia;` without the comment.

### Non-blocking notes
- Tasks 3.1 and 3.3 both leave a double blank line: chartAppearance.ts lines 78 and 93 are blank, and Toast.tsx lines 17 and 27 are blank. 5.3 `format:check` will then fail. Tell the executor to delete one of the adjacent blank lines, or to run `npx prettier --write` on the changed files before 5.3.
- design.md D1 says it is "imported by `features/panels` (via `buildChartOption.ts` and `chartAppearance.ts`)", but chartAppearance.ts lives in `utils/`, not `features/panels`. The correct statement is "features/panels (buildChartOption.ts), shared/ui (Toast.tsx), and utils/chartAppearance.ts". Task 4.2 says to state the module "is cross-feature". The accurate wording is "used by `features/panels` and `shared/ui`", because `shared/ui` is not a feature. Pin the exact sentence so the executor cannot over-claim.
- The existing first paragraph of frontend/src/utils/README.md is already false and predates this change. It says chartAppearance.ts is "imported exclusively by `features/panels`", but it is also imported by features/adminUsage/ui/UsageChart.tsx, utils/chartClickSelection.ts, utils/chartTypeOptions.ts and several features/pipelines/ui/outputEditor/* files. Task 4.2 forbids editing it, which is a reasonable scope call. Consider a follow-up ticket rather than placing a new verified sentence next to a known-false one.
- Optional: give an expected count for the 6.1 "after" list as well, since the trial's known failure mode is miscounting.
