## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD: `0b46ee0d2f2f898f07737972c7e95ecae513ca62` (executor commit 0b46ee0d2).
Review base (resolved live via resolve-review-base.sh): `f3113ed454c4636dc466f7eb93deb976d30829a4`.

### Phase 1: Spec Review — PASS
- AC1 "Exactly one implementation remains; all callers import it": I checked this against the committed tree. `git grep -n "function prefersReducedMotion" HEAD -- frontend/src` finds exactly 1 hit (`frontend/src/utils/prefersReducedMotion.ts:9`). The non-test JS query literal `prefers-reduced-motion: reduce)"` also has exactly 1 hit, in the same file. The import grep returns `features/panels/ui/buildChartOption.ts`, `shared/ui/Toast.tsx` and `utils/chartAppearance.ts`, plus the new test. Those are the only call sites: at the base they were `buildChartOption.ts:233`, `Toast.tsx:48` and `chartAppearance.ts:253`. `chartAppearance.ts` does not re-export the helper (design D2). I confirmed this in the browser: the runtime module's export keys do not include `prefersReducedMotion`.
- AC2 "Existing reduced-motion tests still pass; behaviour-preserving": the function body is copied verbatim. Toast's old copy used a multi-line `if { return false; }` and the new one uses a single line, so the shape differs but the logic is identical. The existing two-case test block moved unchanged, and the Toast D4 and `applyHoverEmphasis` call-site tests pass untouched.
- `useIsNarrowerThan.ts`: the ticket's "third copy" premise is stale. The plan handled it correctly: only the doc comment changed. The diff touches one line inside `/** */`.
- Scope: 9 frontend files, all listed in `files-modified.md`. The only CSS change is the comment-only edit to `toast.css`, as task 4.3 allows. No archive edits. CONSTRAINTS C1/C2/C3 are honoured.
- Task 6.3 (commit) is still `[ ]` in tasks.md, although the commit exists. This is an artifact nit and does not block (see suggestions).

### Phase 2: Code Review — PASS
Gates, which I re-ran myself in WORKTREE_PATH:
- `npm run lint`: exit 0.
- `npm run format:check`: exit 0 ("All matched files use Prettier code style!").
- `npm run typecheck`: exit 0.
- `npm --prefix frontend run build`: exit 0.
- `npm test`, run as its two halves with `nice -n 19 --maxWorkers=3` and no coverage:
  - root jest: 42 suites / 404 tests passed.
  - frontend jest: 475 suites / 4960 tests passed, 1 snapshot.
- Targeted 5.1 set: 12 suites / 143 tests passed.

Independent re-run of the executor's verification-log.md claims (Haiku-executor trial):
| Claim | Log says | Tree produces now | Match |
|---|---|---|---|
| 1.1 `function prefersReducedMotion` at base | 2 lines, Toast.tsx:18 + chartAppearance.ts:89 | same (grep at `f3113ed45`) | yes |
| 1.1 all `prefersReducedMotion` at base | 12 lines (listed) | 12 lines, identical list | yes |
| 1.1 query-literal counts at base | Toast.test.tsx, Toast.tsx, chartAppearance.test.ts, chartAppearance.ts: 1 each | identical | yes |
| 1.1 stale-pointer probe at base | useIsNarrowerThan.ts:6, toast.css:61, chartAppearance.ts:83 | identical | yes |
| 3.1/3.2/3.3 per-file greps | chartAppearance.ts:4,239; buildChartOption.ts:11,233; Toast.tsx:11,39 | identical at HEAD | yes |
| 4.2 README importer list | buildChartOption.ts, Toast.tsx, chartAppearance.ts | identical (plus the test file, correctly excluded) | yes |
| 6.1 after-state (post-amendment) | 1 def, 1 non-test literal, 16-line full list, stale probe empty | identical at HEAD | yes |
| 5.1 targeted | 12 suites / 143 tests; new file 3 tests | 12 / 143 | yes |
| 5.4 full frontend | 475 / 4960 | 475 / 4960 | yes |
| 5.2 red/green mutation | guard reduced to `typeof window === "undefined"`: 1 failed / 2 passed, "window.matchMedia is not a function"; restored: 3 passed | reproduced in a throwaway detached worktree at 0b46ee0d2 (removed afterward; no edit to WORKTREE_PATH): 1 failed / 2 passed, same error message | yes |

No pasted output disagrees with the tree. Two notes on log fidelity, neither a correctness problem:
- The pasted command lines have their shell quotes stripped (for example `grep -n function prefersReducedMotion --`), so they are not copy-paste-runnable as written. The quoted forms in tasks.md produce the pasted outputs.
- 6.1 has a pre-amendment plain-`git grep` block that reports exit=1 for the definition and literal greps, and the 6.1 and 6.2 sections appear more than once. The log labels the pre-amendment run as not the verdict and records the discrepancy honestly per C1, which is the correct behaviour.

Additional evidence I gathered:
- Call-site mutation in the same throwaway worktree. I changed the shared helper's body to `return false;`. This made the Toast D4 test "removes the toast immediately (no exit-animation delay) when reduced motion is preferred" fail, along with the helper's own "returns true" test. So Toast's call site goes through the shared module and is covered by a test.
- The chart call site has no equivalent wiring test, because the `applyHoverEmphasis` tests pass `reducedMotion` explicitly. I checked the wiring in the browser instead (Phase 3).

Code-quality checklist:
- Canonical (CONTRIBUTING.md): imports are at the top of each file. The new module's JSDoc covers an exported contract. The test comment explains why the fixture is shaped that way, which CONTRIBUTING allows. No violations.
- DESIGN.md mechanical rules: N/A. No CSS rule or token changed; the only CSS change is a comment.
- DRY / modular / type safety / security / error handling: met. One small typed module, no `any`, no new trust boundary. The guard is preserved.
- Tests: there is a new branch test for absent `matchMedia`, and the mutation run above shows it can fail.
- Dead code: none. The old `prefersReducedMotion` import was removed from `chartAppearance.test.ts`, and no unused imports remain (lint is clean).
- Behaviour-preserving: yes. The diff only moves and de-duplicates code; there are no drive-by changes.

### Phase 3: UI Review — PASS
Servers were started via `start-servers.sh` and asserted with `assert-phase.sh servers`: PASS on ports 6611 and 9518.
- I logged out of the shared browser's existing session, which belonged to another run's user `eval-hel1358-1791469637@example.test`. I then registered my own user and instantiated the `finance` persona template.
- Loading the template dashboard with two ECharts panels and hovering the first chart produced no console errors from the app. The only console error was a 404 from my own probe trying to dynamically import `/node_modules/.vite/deps/echarts.js`; it was not caused by the app.
- Chart hover wiring, checked against the live Vite modules:
  - Real browser: `prefersReducedMotion()` returned `false`.
  - With `window.matchMedia` mocked to match the reduce query: the helper returned `true`, and `applyHoverEmphasis(option)` (default parameter → shared helper) set `series[0].animation === false`.
  - With the mock removed: no `animation` key was set.
  - So the default-parameter path reads the shared module at call time, as it did before.
- Toast dismiss was not driven in the browser because every toast trigger needs a residue-creating or clipboard action. It is covered by the jest mutation proof above.
- I did not run the breakpoint sweep. No CSS rule, markup or layout changed (the CSS change is comment-only), so there is nothing that could break layout.

Dev-DB residue I created, all owned by user `4619b8c1-a74f-4ef4-954c-9d76851ceed7`:
- user `4619b8c1-a74f-4ef4-954c-9d76851ceed7` (`eval-hel1179-c1-1791475965163@example.test`)
- dashboard `97507a73-520d-44e5-b7cd-1dd159c71b2d`, with its 3 panels
- pipeline `a7019a6d-bbf9-4ade-b5e7-8a295caad17d`
- source `84b535b9-a1c5-481e-a8e4-cdf2a56c4086`

The shared browser is left logged in as this user.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `openspec/changes/consolidate-reduced-motion-helper/tasks.md`: task 6.3 is still `[ ]` even though commit 0b46ee0d2 exists. Tick it when the change is archived.
- `proposal.md`, `design.md`, `ticket.md`, `.openspec.yaml` and `skeptic-design-*.md` in the change dir are untracked. `tasks.md`, `verification-log.md` and `files-modified.md` are committed. Make sure the archive step commits the full set.
- The removed `chartAppearance.ts` doc comment had a non-derivable "why": `motionTokenGuard.css.test.ts` scans only `.css`, so ECharts motion must be gated in JS. The new module's JSDoc keeps the general idea ("wherever JS (not CSS) has to honour..."), but the specific hazard note is gone. Optional: restore one sentence about it in `applyHoverEmphasis`'s JSDoc.
- Verification-log hygiene for future Haiku runs: paste commands with their shell quoting intact so they can be re-run verbatim.
