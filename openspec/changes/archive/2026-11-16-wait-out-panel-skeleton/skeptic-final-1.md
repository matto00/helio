## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: b10c64398e327d03e6cd809175fdd99a54205a15. Base resolved live: fd7064f7d700e49a2f7dfc1f6a244aab02048fd2
(`resolve-review-base.sh`, exit 0). Spawn-cwd guard: READY.

### What I verified (with evidence)

- **Diff read in full** (`git diff fd7064f7d...HEAD -- e2e`). It is test-only: a new helper `e2e/support/panelGridReady.ts`,
  a new guard spec `e2e/hel1633-panel-grid-ready.spec.ts`, and 1-3 line conversions in 11 specs. There is no product code
  change. HEL-1644 (hel1575-dashboard-tabs) and hel1681 are untouched.
- **Helper ordering is sound.** Step 1 is the live-layer `toHaveCount(count)`, the positive anchor. Step 2 is
  `getByLabel("Loading panels")` count 0, which means the skeleton layer has unmounted. The doc comment states that the
  helper is desktop-only.
- **Desktop-only premise at each call site.** hel1023 `openAt` (:355-365) calls `goto` only on the first call per
  dashboard+theme, and both callers (:440, :515) iterate `windows`, whose first entry is 1900 px (:46). The count of 8
  matches the 8 seeded panels (:120-131). hel1573-motion-grid-chart runs at 1900 px. hel1572 density runs at 1600 px.
  The guard runs at 1600 px.
- **AC1: hel1572 `--repeat-each 30` with zero failures.** Durable `ac1.txt` reads `450 passed (17.5m) exit 0`. That is
  15 tests x 30, so the Compact gutter test ran 30 times. Load average was 4.81 before and 11.40 after, with
  `free -g` recorded (`ac1-before.txt`, `ac1-after.txt`).
  - **Coverage of HEAD:** `git diff --stat 93bc696bf HEAD` touches only hel1023, hel1573-motion-grid-chart and
    openspec docs. The helper and hel1572 are byte-identical between the AC1 commit and HEAD, and product code
    is unchanged, so the AC1 evidence covers HEAD.
  - **My own run at HEAD:** hel1572 `--grep density --repeat-each 15 --workers=2` under `nice -n 19` gave
    30 passed, 0 failed or flaky. Evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1633/evidence/.concertino/scratch/HEL-1633/skeptic-final-hel1572-density.txt`.
- **AC2: the sweep.** `sweep.md` records the command and its raw output (74 hits) and gives one verdict per hit with a
  line reference. I spot-checked several verdicts against the tree:
  - hel1575-reload-after-edit:44 follows a UI "Add Text panel", after "0 panels" was visible and a 2.6 s settle.
  - The hel1023 and hel1573 cycle-2 FIX entries match the code.
  - The secondary `.panel-grid-card` grep is recorded with its counts and follow-up candidates, per D3.
- **Guard failability (C1, C2, C3).**
  - After the helper, the guard takes one-shot reads only (`count()`, a single `evaluateAll`, plain `expect`).
  - The fade stretch targets only `:root .crossfade .crossfade__skeleton` with `!important`, and the guard asserts
    the computed `3s` and that stub `.react-grid-item`s are attached.
  - The evaluator's mutant transcripts show both mutants red on all 5 repetitions:
    - Mutant A failed at :102 (skeleton still mounted). At that point the item count equals the 3 stubs, because
      the `Promise.all` precondition branch waits for the stubs.
    - Mutant B failed at :101 (stub items still present).
    - The no-precondition variant of A was also 5/5 red.
  - `eval-orig-helper.ts` is identical to the HEAD helper, so the mutants were applied to the shipped helper.
- **Fresh runs at HEAD** (servers via `start-servers.sh` with `assert-phase` PASS, stopped via `stop-servers.sh`):
  - The guard, hel1573-motion-grid-chart, hel1575-reload-after-edit and hel1260 at `--repeat-each 3`
    gave 42 passed, 0 failed.
  - hel1023 (full file) gave 5 passed.
  - Evidence: `.../evidence/.concertino/scratch/HEL-1633/skeptic-final-specs.txt` and `.../skeptic-final-hel1023.txt`
    under `/home/matt/Development/helio/.concertino/runs/HEL-1633/evidence/`.
- **Static gates at HEAD.** On every changed e2e file, ESLint `--max-warnings=0` and Prettier `--check` were clean.
  `check:e2e-types` and `check:e2e-user-cleanup` were also clean (140 files).
- **UI/design review:** N/A. The change is test-only, with no `frontend/**` change.

### Verdict: CONFIRM

### Non-blocking notes

- Guard :101 cannot by itself tell "only stubs" apart from "only real items" when the seeded layout has as many entries
  as there are panels (3 = 3). Line :102 carries mutant A's redness. This is acceptable, because both assertions run
  and the mutant is 5/5 red. Seeding a different stub count would make :101 independently discriminating.
- hel1575-reload-after-edit:49 repeats a bare `toHaveCount(1)` straight after `waitForPanelGrid(page, 1)`. It is
  redundant but harmless.
- No mtime-ordering claim is relied on here. AC1 coverage of HEAD rests on a content diff (`git diff --stat 93bc696bf HEAD`).
