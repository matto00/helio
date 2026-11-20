## Evaluation Report — Cycle 3 (evaluation-3.md)

Reviewed HEAD `777a4dc989dde23dedbf2e5b2a47a7e039eb6e0c` (base `94a8ef292`, resolved live).

Commit 777a4dc98 changes only e2e files and the change dir. The `frontend/` tree hash is `1469911a8` at
`c6bd8d5a8`, at `82d4dafc4` and at HEAD. So the product code is byte-identical to the code my cycle-1 regression run
(37/37) and my cycle-2 jest and build runs covered.

### Phase 1: Spec Review — FAIL

Verified:
- Cycle-2 CR1 (rate limits) is addressed.
  - The spec is split into 6 group files over `e2e/support/modalScrollExtent.ts`, and each test registers its own user.
  - Each test asserts `count429 == 0` and a max 60 s window `<= 90` via the existing `apiRequestCounter.ts`.
- Cycle-2 CR2 (shard weight) is addressed.
  - `node scripts/e2e-shard.mjs plan 7` places the 6 files on 6 different legs, at 50 s each (defaulted).
  - The real per-file sums from my run are 49-116 s (largest: shell 116 s; pipeline-dialogs 89 s plus the 15 s popover
    guards). The worst under-weight is therefore about 66 s on one leg, in line with other new specs pending a weights
    regeneration.
  - Playwright `--list` attributes all tests to the 6 `.spec.ts` files, not to the support file, so the partition is exact.
- Cycle-2 CR3 (red re-proof) is addressed; see Phase 3.
- step-palette and command-palette now carry `// GUARD only` on their case objects.
- The `HEL1774_ONLY` debug variable is removed.
- (c) Confirmed: the product diff since my cycle-1 regression run is empty (tree hash above). Not re-running the
  Decision 5 specs is justified.
- (d) Confirmed: the Output history canvas is async render timing, not a moved child.
  - The executor's `cycle3-abs-after-fix.txt` lacks the canvas at 375 and 390 dark.
  - My fixed run logs it at every output-history config.
  - Its containing block is the ECharts `div`, never the dialog.
  - The rects are identical to the executor's unfixed run (375: top 403.64, left 40, 295x260; 390: top 419.64, 310x260).

Issues:
1. **C15 breach: 4 vacuous tests are reported as passing discriminators.**
   - `e2e/hel1774-modal-scroll-dashboard-dialogs.spec.ts` lists `panel-inspect`, `output-picker` and `ask-drawer`.
     All three are `desktopOnly`.
   - So its 375x812 and 390x844 tests (light and dark, 4 tests) register a user, seed, and skip every case
     (`modalScrollExtent.ts`, `if (c.desktopOnly && vp.width < 1000) continue;`). They then pass.
     - Their only assertion is the rate-limit check on 12 setup requests.
     - Their title still claims "every modal in the group ends at its content, natural and with an injected hidden
       element".
   - They are green on the fix, and green in the rule-removed run: in both the executor's `cycle3-unfixed-css-run.txt`
     and my own.
   - C15 says a case green in the red run is labelled a guard, never a discriminator. These are not labelled at all.
     inventory.md:25 calls them tests that "run nothing", which concedes the problem rather than fixing it.
   - They also spend a register and seed in CI four times per run for no assertion.
2. **Evidence misstatement.**
   - inventory.md:22 says "Max requests in any 60 s window: 82 phone".
   - No test in the executor's `cycle3-fixed-default-limits-run.txt` logs 82. Its maximum is 74 (shell 1280), and the
     phone maximum is 70 (shell 375/390).
   - My run gives the same numbers (74 / 70).

### Phase 2: Code Review — PASS

Gates:

| Gate | Result |
| --- | --- |
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `npx tsc --noEmit -p e2e` | clean |
| `npm test` and `npm --prefix frontend run build` | run fresh in cycle 2 against the identical `frontend/` tree (`1469911a8`); passed (617 + 10304 tests) |

- (b) The rate-limit guard threshold is sane and is not a new flake source.
  - In every test, the total `/api` request count equals the max-60 s-window count (for example `shell 375 light 70
    /api requests, max 60s window 70`). The whole test fits in one window, so the number is a deterministic request
    count, not a timing artefact.
  - Slower CI runners can only spread requests out and lower the window.
  - The highest value is 74 against the 90 target and the 120 limit. Twelve-plus spare requests is margin, and a trip
    would mean a real growth in per-modal traffic, which the guard exists to catch (the HEL-1620 convention).
  - The 30/60 s source-fetch limit is not counted separately. Any 429 from it still fails `count429 == 0`, and none
    occurred.
- Splitting into a shared support module plus thin group files is clean.
- `registerModalScrollSuite` throws on an unknown case id.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` on 7206/10113 against `helio_hel1774?user=matt`. `ANTHROPIC_API_KEY` was
empty and there were **no** `RATE_LIMIT_*` overrides. I stopped the servers with `stop-servers.sh` afterwards.

- **Fix, all 6 files:** 38 of 38 pass in 4.5 min. Every test logs `0 x 429`; max windows are 12-74.
  - Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/eval3-fixed-default-limits-run.txt`.
- **Rule removed** (`Modal.css:193` `position: relative;` deleted, then restored with `git checkout`; `git status`
  clean): 32 failed and 6 passed.
  - Every scroll-extent test is red except the 4 vacuous dashboard-dialogs phone tests.
  - The injected case is red on all 20 discriminating modals, at every applicable viewport and theme (94 injected-red
    results). step-palette and command-palette stay green; they are labelled guards.
  - No natural case is red. No 429.
  - The 2 popover tests pass, as guards.
  - Transcript: `/home/matt/Development/helio/.concertino/runs/HEL-1774/evidence/.concertino/scratch/HEL-1774/eval3-rule-removed-run.txt`.

The shared fix itself is sound and proven. The only problems are the 4 vacuous tests and one wrong number in the
inventory.

### Overall: FAIL

### Change Requests

1. In `e2e/support/modalScrollExtent.ts` `registerModalScrollSuite`, compute the applicable cases per viewport before
   declaring the test, using the same `desktopOnly`/`phoneOnly` filter. When none apply, do not register a test for that
   viewport, or call `test.skip(true, "<group>: every case is desktop-only (unreachable on phone, inventory.md)")`.
   The phone runs of `hel1774-modal-scroll-dashboard-dialogs` must then report as skipped, with a reason, not as
   passed. Re-run that one file on the fix and confirm 2 passed and 4 skipped. Update inventory.md:24-25 to match.
2. Correct inventory.md:22. Replace "82 phone" with the logged maxima: 74 shell desktop, 70 shell phone, 63 palettes
   desktop. Alternatively, cite the run that logged 82.

### Non-blocking Suggestions

- `listPositioned` runs before async chart canvases have settled, which is why the canvas went missing in one run.
  Waiting for `settleAnimations` and one animation frame before listing would make the abs evidence deterministic.
- When the PR is opened, note that `e2e/shard-weights.tsv` should be regenerated after the first CI runs. All 6
  hel1774 files are defaulted at 50 s against 49-116 s actual.

### Critical Path

This is cycle 3, the last in budget. One code edit stands between this branch and PASS:

1. Skip, rather than pass, a viewport/theme test when its group has no applicable case. This is about 3 lines in
   `registerModalScrollSuite`. Re-run `hel1774-modal-scroll-dashboard-dialogs.spec.ts` to show 2 passed and 4 skipped.
2. Fix the "82 phone" number in inventory.md.

Everything else is verified independently and green: the fix, the C15 red proof on 20 modals, CI rate limits, shard
placement, gates and regression scope.

Recommendation for the human: both items are mechanical and low-risk. A short fold-in cycle, or a driver-approved
fixup, is enough. No product-code change is needed, and no re-review of the fix itself.
