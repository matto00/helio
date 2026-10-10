## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD = origin/main = 2951d0b8371b039ac38142726f2505f0a809e2e9. The change dir is untracked and there is no code diff yet.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-utils-readme-importers/HEL-1401`.
- **Round-1 CR1 (the "8 files" count) is fixed.** design.md Context now says "features/panels (7 files: ...)" and lists all 7 paths. I re-ran Decision 1's loop verbatim in the worktree. The chartAppearance output is 15 lines: adminUsage/ui/UsageChart.tsx, 7 panels files (the same 7 named), 5 pipelines/ui/outputEditor files, utils/chartClickSelection.ts and utils/chartTypeOptions.ts.
- **The other Context lists match the grep exactly:**
  - formatRelativeTime: 5 files across connectors, panels, pipelines and sources.
  - aggregate: 8 lines, 7 in panels plus OutputPreviewPane.tsx.
  - chartTypeOptions: buildChartOption.ts and chartDataOptions.ts.
  - prefersReducedMotion: buildChartOption.ts, shared/ui/Toast.tsx and utils/chartAppearance.ts.
- **Round-1 CR2 (the line range) is fixed.** Decision 1 and tasks 1.2 both say lines 3-9. Live `cat -n frontend/src/utils/README.md` shows line 3 starts with "`formatRelativeTime.ts` is genuinely", line 9 is "docs-only.", and line 10 is blank. The tasks 1.2 check `grep -n "docs-only\|exclusively"` is concrete.
- **Guard and call site:**
  - `grep -n 'endsWith(".css")' frontend/src/theme/motionTokenGuard.css.test.ts` prints `32:    } else if (entry.isFile() && entry.name.endsWith(".css")) {`.
  - `grep -n "prefersReducedMotion()" .../buildChartOption.ts` prints `233:  built = applyHoverEmphasis(built, themeTokens, prefersReducedMotion());`.
  - Both match design.md.
- **Decision 2 anchor:** prefersReducedMotion.ts line 4 ends with "`@media` block.", line 5 is ` *`, and line 6 starts with "Guards `matchMedia`". The anchor is unambiguous.
- **End-to-end simulation of the planned edits.** I extracted both fenced blocks from design.md with awk and spliced them into copies of the two live files, in my scratchpad and not in the worktree. Results:
  - README: the new paragraph is lines 3-14 and paragraph 2 is untouched. `grep -n "docs-only\|exclusively"` exits 1, which is the required "prints nothing".
  - prefersReducedMotion.ts: the result is exactly 16 lines with the comment closing at line 12, so `sed -n 1,16p` covers it.
  - `npx --no-install prettier --config prettier.config.cjs --check` on both simulated files printed "All matched files use Prettier code style!" (prettier 3.8.1).
- **Accuracy of the replacement text:** every claim in Decision 1's README text matches the grep, including "non-test importers". The inserted sentence satisfies AC2: it says hover-emphasis motion is JS option config, names `theme/motionTokenGuard.css.test.ts`, says the guard scans only `.css`, and says the motion must be gated in JS.
- **Tooling:**
  - The worktree has no root node_modules, but `npx --no-install prettier --version` resolves 3.8.1 by walking up to the parent checkout.
  - Tasks 3.2's `npm test -- --testPathPatterns=prefersReducedMotion` from the worktree root passed: 501 suites, 5238 tests, 89.6s. The root script does not forward the filter, so it ran the full frontend suite.
  - `npm --prefix frontend test -- --testPathPatterns=prefersReducedMotion` passed 1 suite and 3 tests in 1.9s.
- **Scope and contracts:**
  - `.openspec.yaml` has `skip_specs: true`, so no spec delta is needed.
  - AC1 is covered by tasks 1.1, 1.2 and 3.3. Task 3.3 now says the orchestrator copies the evidence into the PR body.
  - AC2 is covered by 2.1 and 2.2. AC3 is enforced by C1 and the `git status`/`git diff --stat` check in 3.2.
  - There are no placeholders, contradictions or ambiguous tasks.

### Verdict: CONFIRM

### Non-blocking notes

- Tasks 3.2 does not say which directory to run from. Run from the root, the root `test` script runs `jest && npm --prefix frontend test` without passing on the filter, so it runs the whole suite (about 90s, passing). `npm --prefix frontend test -- --testPathPatterns=prefersReducedMotion` is the precise form. Either way it passes, so this is not blocking.
- I checked the evidence by content (grep outputs, line numbers, a prettier run on the simulated result). None of it depends on mtimes.
