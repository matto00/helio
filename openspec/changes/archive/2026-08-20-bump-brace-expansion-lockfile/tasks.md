## 1. Investigate

- [x] 1.1 Run `npm audit` at the repo root and confirm the exact `brace-expansion` version range and dependency paths flagged for GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895 (currently: `node_modules/@typescript-eslint/typescript-estree/node_modules/brace-expansion`, `node_modules/glob/node_modules/brace-expansion`, `node_modules/minimatch/node_modules/brace-expansion`) — confirmed: range `2.0.0 - 2.1.3 || 4.0.0 - 5.0.8`, all three paths flagged as stated.
- [x] 1.2 Run `npm ls brace-expansion --all` (or equivalent) in `frontend/` and `helio-mcp/` and run `npm audit` in each to check whether they carry the same vulnerable range independently — both report **0 vulnerabilities**. `frontend/` has its own `brace-expansion` instances but already at patched versions (2.1.4, 1.1.18, 5.0.9); `helio-mcp/` has no `brace-expansion` dependency at all. Neither needed a fix.
- [x] 1.3 Run `gh api "repos/matto00/helio/dependabot/alerts?state=open"` and check whether Dependabot has raised an alert for GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895 against any of the three lockfiles (as of design-gate time: zero open alerts). If an alert is found, note its number(s) for task 6.1/6.2 below — this is what makes AC3 ("If Dependabot alerts exist for this pair by then, they are verified closed post-merge via the alerts API") a live check rather than a hypothetical — re-verified live at execution time: response `[]`, still zero open alerts. AC3 is vacuously satisfied; 6.1/6.2 are N/A.

## 2. Fix — root lockfile

- [x] 2.1 Attempt `npm update brace-expansion` at the repo root first; if that alone does not move every flagged nested instance to a patched version, add a scoped `overrides` entry to the root `package.json` (matching the existing pattern already used there for `@eslint/eslintrc`/`@istanbuljs/load-nyc-config`) pinning `brace-expansion` to the first version that patches both GHSAs — `npm update brace-expansion` alone patched 2 of the 3 flagged instances (hoisted `@typescript-eslint/typescript-estree` chain to `5.0.9`; `glob`'s nested instance to `2.1.4`) but left `node_modules/minimatch/node_modules/brace-expansion` pinned at the vulnerable `2.1.2` (that instance is shared by `eslint`/`eslint-plugin-react`/`jest`'s transitive `minimatch@3.1.5`, deduped to one node). Added a version-scoped override `"minimatch@3.1.5": { "brace-expansion": "^2.1.4" }` — scoped to the exact vulnerable pairing only, so it doesn't also collapse the unrelated `minimatch@10.2.4` chain (which legitimately needs `brace-expansion@^5.0.2`) down to an incompatible major.
- [x] 2.2 Regenerate the root `package-lock.json` (`npm install`) and confirm every installed `brace-expansion` instance is at/beyond the patched version — all three flagged paths now resolve to `5.0.9`, `2.1.4`, and `2.1.4` respectively; `npm audit` reports 0 vulnerabilities.

## 3. Fix — sibling lockfiles (only if 1.2 found the vulnerable range present)

- [x] 3.1 Apply the same targeted fix (update or scoped override) to `frontend/package-lock.json` if affected — N/A, 1.2 found `frontend/` already clean (0 vulnerabilities); no fix needed, no changes made.
- [x] 3.2 Apply the same targeted fix (update or scoped override) to `helio-mcp/package-lock.json` if affected — N/A, 1.2 found `helio-mcp/` has no `brace-expansion` dependency; no fix needed, no changes made.

## 4. Verify

- [x] 4.1 Re-run `npm audit` at the repo root and confirm GHSA-mh99-v99m-4gvg / GHSA-rgw5-rvv9-x895 no longer appear — `npm audit` reports "found 0 vulnerabilities" (exit 0).
- [x] 4.2 Re-run `npm audit` in `frontend/` and `helio-mcp/` if either was touched in step 3, and confirm the pair no longer appears there either — N/A, neither was touched in step 3 (both already clean).
- [x] 4.3 Run root `npm test` and confirm it passes — 8 root/helio-mcp test suites (186 tests) + 220 frontend test suites (2376 tests), all passed.
- [x] 4.4 Run root lint and confirm it passes (and `frontend`/`helio-mcp` test/lint too, if their lockfiles were touched) — `npm run lint` passes (0 warnings); `frontend`/`helio-mcp` lockfiles untouched so their lint gates weren't independently re-run beyond what root `npm test` already covers.

## 5. Tests

- [x] 5.1 No new application tests are needed — this is a lockfile-only dependency bump with no code-path changes; existing suites (root, and frontend/helio-mcp if touched) serve as the regression check — confirmed: full root `npm test` (which chains into `helio-mcp` and `frontend` suites) passes with no code changes involved.

## 6. Delivery follow-through (orchestrator-owned — Phase 3/4, not executor scope)

> **Reviewer note (evaluator + skeptic):** this section only has action items if task 1.3 found an open
> Dependabot alert for this GHSA pair. If task 1.3 found zero open alerts (the state as of this design round),
> AC3 is vacuously satisfied and 6.1/6.2 are N/A — mark them `[x]` with that note rather than leaving them
> open. If an alert *was* found, 6.1/6.2 are *expected to remain unchecked* through Execution, Evaluation, and
> the final skeptic gate — they structurally cannot complete until Delivery (6.1) or after the human merges the
> PR (6.2). Unchecked boxes in that case are NOT an incomplete-task defect; enforcement lives in the delivery
> artifacts themselves (design.md's AC3 Decision).

- [ ] 6.1 If task 1.3 found an open alert: PR body explicitly lists the alert number(s) as a post-merge TODO — executor re-verified task 1.3 live at execution time (`gh api` response `[]`, zero open alerts), so per the reviewer note above this is N/A; left unchecked/orchestrator-owned per the executor's scoping instructions rather than checked off here.
- [ ] 6.2 If task 1.3 found an open alert: after the human merges this PR, re-run `gh api "repos/matto00/helio/dependabot/alerts?state=open"` and confirm the alert(s) noted in 6.1 are no longer open before closing the Linear ticket; surface any survivor rather than assuming it closed — N/A per 6.1; left unchecked/orchestrator-owned for the same reason.
