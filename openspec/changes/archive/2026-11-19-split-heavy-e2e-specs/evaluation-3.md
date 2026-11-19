## Evaluation Report — Cycle 2, re-run at final head (evaluation-3.md)

This re-run reviewed HEAD `638732135ed5ac6858eab7ed53f7b808d47a811f`. Its parent is `aa973721e`, which was covered by the PASS in evaluation-2.md; the base is `3bf3590ec`.

The new commit moves the test blocks that the hel1583 and hel1665 parts share into the `e2e/support` modules, which is constraint C18 from the final-gate skeptic. It touches only `e2e/**` and this change directory; nothing under `frontend/` or `backend/` changed.

### Phase 1: Spec Review — PASS

**The test list is still unchanged.** I re-ran `npx playwright test --list --reporter=json --project=dev` at the new head and compared it with my base list from cycle 1:
- 932 tests on each side, 932 distinct `project | title path` keys on each side, 0 multiset differences.
- Per project: `{"dev":932}` on both sides.
- The part counts are unchanged:

| spec | parts |
| --- | --- |
| hel1665 | 21 / 23 / 25 / 21 |
| hel1733 | 10 / 9 / 13 |
| hel1583 | 15 / 15 |

**The test bodies are still identical.**
- A raw-text AST comparison showed one difference, in the hel1665 matrix test. It is a Prettier reflow: the block is now nested one level shallower, so `parseFloat(getComputedStyle(...).lineHeight)` fits on one line and its trailing comma goes away.
- After printing each body through the TypeScript printer and removing trailing commas, all three specs show 0 bodies only in base and 0 only in new.
- `expect` counts in the distinct bodies are still 43 = 43, 72 = 72 and 64 = 64.

**C18 holds.**
- Each `test()` call site now appears exactly once across parts plus support: 9 for hel1665, 10 for hel1583, 12 for hel1733.
- The hel1583 parts are now 13 lines each and call `describeGlassNav(theme)`.
- Each part still repeats the original's file-level `test.describe.configure({ mode: "parallel" })`, and each hel1665 part still has `test.setTimeout(180_000)`.
- The `test.setTimeout(120_000)` at `e2e/support/hel1583-glass-nav.ts:474` is the original in-body call (it was at line 479 of the old file).

**The weight table still reproduces.** Running `weights --list <new head list>` over the five source runs reproduces `e2e/shard-weights.tsv` byte for byte. The attribution is unchanged (760 results of 152 tests re-attributed): the list JSON still files each test under its spec file, even though the test is now registered from a support module.

Issues: none.

### Phase 2: Code Review — PASS

I ran these myself at `638732135`:

| gate | result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `check:e2e-types` | exit 0 |
| `check:e2e-user-cleanup` | clean (180 files) |
| `check:e2e-evidence-paths` | clean (180 files) |
| `check:e2e-prod-build-projects` | clean |
| `check:openspec` | clean |
| `node scripts/e2e-shard.selftest.mjs` | 28 cases passed |

I did not re-run the full `npm test` and frontend build: nothing they cover changed since evaluation-2, which ran them green at `aa973721e`. `git diff aa973721e HEAD -- frontend backend` is empty.

The change removes duplication, as C18 requires; there is no dead code and no added abstraction beyond the two registration functions.

Issues: none.

### Phase 3: UI Review — N/A

No UI-trigger paths changed.

### Overall: PASS

### Non-blocking Suggestions
- none
