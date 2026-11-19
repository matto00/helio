## Skeptic Report — final gate (round 4, skeptic-final-4.md)

I reviewed HEAD `bad4f30372de05bd25e99d8bf883e0fbc8412157`. I resolved the base live with `resolve-review-base.sh`: `daf40bfbf` (rc 0). That is also `origin/main` per `git ls-remote`.

Since round 3's REFUTE on `b79cf81ae`, one commit (`bad4f3037`) has landed. It touches only `e2e/shard-weights.tsv` and `variance.md`. The change has no UI: the only `frontend/` edit is a comment in a jest file. So the visual step does not apply and I did not start any servers.

### What I verified (with evidence)

**1. Counting was checked for every main CI run since 33dd755d9, at job level and at report level, not from run conclusions.**

Run list source: `gh run list --branch main --workflow ci.yml`. The newest run is 44589133697 on daf40bfbf, which is main's current head.

| run | head | run conclusion | e2e legs (jobs API) | other failed jobs | shard reports | unexpected / flaky (all shards) | counts |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 44589133697 | daf40bfbf | success | 7 success | - | 7 | 0 / 0 | yes |
| 44587029243 | febb2013b | failure | 6 success, `e2e (3)` failure | ci-complete | 7 | shard 3 unexpected 1 | no |
| 44533329820 | 3bf3590ec | failure | 6 success, `e2e (3)` failure | ci-complete | 7 | shard 3 unexpected 1 | no |
| 44498291938 | b2603ab79 | success | 7 success | - | 7 | 0 / 0 | yes |
| 44488684006 | a1cfd19dc | success | 7 success | - | 7 | 0 / 0 | yes |
| 44468195695 | 27b4a7402 | success | 7 success | - | 7 | 0 / 0 | yes |
| 44464180222 | 62df9ff48 | failure | 7 success | `backend (1)`, `docker-image`, ci-complete | 7 | 0 / 0 | **yes** |
| 44455550476 | 108c04b7f | success | 7 success | - | 7 | 0 / 0 | yes |
| 44446279352 | 33dd755d9 | success | 7 success | - | 7 | 0 / 0 | yes |

- I downloaded all 63 `playwright-json-shard-*` reports fresh into my scratchpad and read `stats` per shard.
- Result: 7 counting runs.
- The 5 most recent are 44589133697, 44498291938, 44488684006, 44468195695 and 44464180222. That is exactly the committed table's `# Runs` header. Round 3's CR1(a) is resolved.

**2. The table reproduces byte for byte.**
- I made a fresh HEAD list: `npx playwright test --list --reporter=json --project=dev`, rc 0, 943 tests, 126 top-level files.
- I then ran `node scripts/e2e-shard.mjs weights --list <my list> 44589133697 44498291938 44488684006 44468195695 44464180222` over my own downloads. It exited rc 0.
- `diff` against the committed `e2e/shard-weights.tsv` (header included) is empty.
- `plan` lists no defaulted specs. Its per-leg loads are 1426 / 1421 / 1421 / 1425 / 1424 / 1424 / 1424 s, which matches `variance.md`.
- The tool attributes each result by the top-level suite's file (`testsOf` walks from `top.file`). Tests registered inside the support modules are therefore weighted to the part file that calls them, not to `e2e/support/*`.

**3. The `variance.md` corrections are accurate (CR1(b)).** I recomputed per-spec sums from my downloads over the 7 runs:
- hel1665: 685 / 785 / 704 / 699 / 756 / 723 / 693.
- hel1733: 332 / 330 / 467 / 325 / 334 / 336 / 392.
- hel1583: 200 / 204 / 311 / 203 / 203 / 209 / 253.
- hel1608: 96 / 84 / 80 / 79 / 103 / 86 / 103.
- The medians it cites hold: hel1582-sweep-375 358, state-surface-contrast-guard 316, hel1575-dashboard-tabs 740.

All of these match `variance.md`, in the stated run order. The jobs-API leg wall times also match:
- slowest legs: 1178 / 1077 / **1395** / 984 / 1161 / 993 / **1219** s;
- mean legs: 964 / 959 / 964 / 892 / 967 / 897 / 946 s.

The counting table now names 44464180222 as counting, with the reason (per-leg rule, not the run conclusion). It names 44533329820 and 44587029243 as not counting, because an e2e leg failed.

The AC3 expectation was revised honestly. The main-population worst is now 1395 s (105 s headroom), and the 1200 s line is crossed on 2 of 7 main runs, both on leg 3 in its slow mode with hel1733, hel1583 and hel1579.

**4. The before set includes 44464180222 (CR1(c)).** `.concertino/scratch/HEL-1778/before.md` lists all 7 counting runs. Its per-run slowest and mean legs and its headroom agree with my jobs-API numbers. It reports a 7-leg imbalance of 74.1 s.

**5. No PR measurement attempt exists yet (CR1(d) / C17).** Task 5 is unticked, so the regeneration comes before any measurement.

**6. The split code is unchanged since round 2's CONFIRM.**
- `git diff 638732135 HEAD` over the hel1665, hel1733 and hel1583 part files, the three support modules, `scripts/e2e-shard*.mjs` and `e2e/README.md` is empty.
- Title paths, my HEAD list against the executor's base list:
  - hel1665: 90 = 90 identical;
  - hel1733: 32 = 32 identical;
  - hel1583: 30 = 30 identical;
  - every other test is unchanged (780 at base);
  - the only additions are the merged hel1781 and hel1784 specs;
  - nothing is missing from the base.
- C18: the part files define no shared helpers. The only local functions are `openFromList` and `createOnStepOne` in `hel1733-...-drafts.spec.ts`, and no other part or support module uses them.

**7. Gates at HEAD** (each one I ran):
- `node scripts/e2e-shard.selftest.mjs`: 28 cases passed.
- `check:e2e-types`, `check:e2e-user-cleanup`, `check:e2e-evidence-paths`: rc 0.
- `npm run format:check`: clean.

**8. Acceptance criteria.**
- **AC1** (variance cause, then cut or split): the cause is named per spec in `variance.md` as a leg-wide uniform slowdown, with the per-test spread as evidence. The three specs are split 4 / 3 / 2, and the title-path identity is shown above.
- **AC2** (table from 7-leg main runs, hel1608 fixed): reproduced above; hel1608 is now 86.
- **AC3** (at least 5 counting CI runs with slowest and mean leg): this is Delivery task 5 and is not expected yet. The before set is ready.

### Verdict: CONFIRM

### Non-blocking notes
- In `variance.md` the outside-drivers table says hel1575-dashboard-tabs is "listed because it is one file of 760 s on one leg". Its median is now 740 s, as the same row's first cell says. This is cosmetic.
- At Delivery, if a PR attempt's reports are lost, the log fallback must key on title path, not the printed file (carried over from round 2).
- At Delivery, a slowest leg over 1200 s on a PR attempt needs its driver named. Leg 3's slow mode is now evidenced on main as well, so expect it.
- Gate-chain note (carried over from round 3, still true of `evaluation-4.md`): that evaluation accepted "44464180222 failure, does not count" from the run conclusion. Run counting has to be checked per e2e job and report, as done here.
- No conclusion in this review rests on mtime ordering. Report and table equality are shown by recomputation and `diff`.
