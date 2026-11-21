# HEL-1793 measurement

Scripts (adapted from HEL-1789; `LEGS` env sets the leg count, `counting()` also requires each leg's
`e2e-runner-shard-<n>` record with a `cpu_model:` line): `/home/matt/Development/helio/.concertino/runs/HEL-1793/evidence/measurement/`
(lib.mjs, measure.mjs, capture.sh). Raw outputs are in the same directory (`before-5runs.txt`, `before-all-candidates.txt`, `before-perleg.txt`).

## Before (7 legs, main runs, target <= 1200 s)

Runs used: the 5 newest counting 7-leg main runs. Excluded: 44854332613 (3fa325155, hel1791's merge run) did NOT count:
e2e (4) failed on a timing assertion in `hel1573-motion-grid-chart` (616 ms vs < 600 ms), so it is not counting; next older taken.
44855074949 (13180246a, HEL-1649) counts and contains hel1735, hel1791 and both HEL-1649 narrow specs.

| run | counting | slowest leg | slowest wall s | mean wall s | headroom s | slowest test-step s | its setup s | mean setup s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 44855074949 | true | 7 | 1324 | 1090 | 176 | 1117 | 164 | 138 |
| 44845120888 | true | 3 | 1312 | 1071 | 188 | 1095 | 174 | 143 |
| 44840748251 | true | 5 | 1330 | 1092 | 170 | 1119 | 169 | 142 |
| 44821653778 | true | 6 | 1160 | 1005 | 340 | 987 | 133 | 127 |
| 44811851467 | true | 2 | 1371 | 1038 | 129 | 1169 | 159 | 133 |

counting runs: 5; slowest leg median 1324 max 1371; runs over 1200 s: 4; mean-leg median 1071

Per run, per leg wall and CPU model (jobs API wall, `e2e-runner-shard-<n>/identity.txt`):

run 44855074949
  leg 1 | 1036s | AMD EPYC 9V74 80-Core Processor
  leg 2 | 996s | Intel(R) Xeon(R) 6975P-C
  leg 3 | 1293s | AMD EPYC 7763 64-Core Processor
  leg 4 | 983s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 961s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 1034s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 1324s | AMD EPYC 7763 64-Core Processor
run 44845120888
  leg 1 | 1251s | AMD EPYC 7763 64-Core Processor
  leg 2 | 1012s | Intel(R) Xeon(R) 6975P-C
  leg 3 | 1312s | AMD EPYC 7763 64-Core Processor
  leg 4 | 945s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 943s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 1070s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 964s | Intel(R) Xeon(R) 6975P-C
run 44840748251
  leg 1 | 943s | Intel(R) Xeon(R) 6975P-C
  leg 2 | 1027s | Intel(R) Xeon(R) 6975P-C
  leg 3 | 972s | Intel(R) Xeon(R) 6975P-C
  leg 4 | 1284s | AMD EPYC 7763 64-Core Processor
  leg 5 | 1330s | AMD EPYC 7763 64-Core Processor
  leg 6 | 1023s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 1063s | AMD EPYC 9V74 80-Core Processor
run 44821653778
  leg 1 | 944s | Intel(R) Xeon(R) 6975P-C
  leg 2 | 972s | AMD EPYC 9V45 96-Core Processor
  leg 3 | 997s | Intel(R) Xeon(R) 6975P-C
  leg 4 | 912s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 953s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 1160s | AMD EPYC 9V74 80-Core Processor
  leg 7 | 1099s | AMD EPYC 9V74 80-Core Processor
run 44811851467
  leg 1 | 984s | Intel(R) Xeon(R) 6975P-C
  leg 2 | 1371s | AMD EPYC 9V74 80-Core Processor
  leg 3 | 1010s | Intel(R) Xeon(R) 6975P-C
  leg 4 | 1062s | AMD EPYC 9V74 80-Core Processor
  leg 5 | 859s | AMD EPYC 9V45 96-Core Processor
  leg 6 | 995s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 988s | Intel(R) Xeon(R) 6975P-C

HEL-1789 cross-check: its 5 PR runs (44708860497, 44712167515, 44716239460, 44723866593, 44728460728) had a slowest leg of 1321-1334 s and a mean leg of 1011-1106 s (its after.md).

Reading: 4 of 5 counting runs have a slowest leg over 1200 s (1312-1371 s). Every leg over 1200 s ran on AMD EPYC 7763
(1251, 1284, 1293, 1312, 1324, 1330 s) except 44811851467 leg 2 (AMD EPYC 9V74, 1371 s). Mean leg 1005-1092 s.

## Guard red (existing selftest, `npm run check:e2e-shard:selftest`, failable by mutation)

Mutation (a): ci.yml `max-parallel: 8` and `shard: [1..8]`, `DEFAULT_E2E_LEGS` left at 7. Exit 1:

```
8 !== 7
    at .../scripts/e2e-shard.selftest.mjs:211:10
  actual: 8, expected: 7, operator: 'strictEqual'
```

Mutation (b): only `max-parallel: 8` (matrix and constant 7). Exit 1:

```
8 !== 7
    at .../scripts/e2e-shard.selftest.mjs:216:10
  actual: 8, expected: 7, operator: 'strictEqual'
```

Both restored with `git checkout .github/workflows/ci.yml` (`git status` clean for tracked files).

## Weights (task 3.1)

`e2e/shard-weights.tsv` regenerated with `node scripts/e2e-shard.mjs weights --legs 7 --list <list.json> <5 run dirs>` from main runs
44855074949 44845120888 44840748251 44821653778 44811851467 (header lists them). 44854332613 was not used (not counting, see Before).
All four specs the task named are weighted (not defaulted), from 44855074949 (the only counting run containing the two HEL-1649
specs and hel1791; hel1735 is in the others too):

- hel1735-feature-hover 135 s
- hel1791-compact-counter-stack-height 84 s
- state-surface-contrast-guard-narrow-1100-768 137 s (single run of evidence)
- state-surface-contrast-guard-narrow-390 83 s (single run of evidence)

Risk: the three newest specs rest on one run (44855074949) each, not a 5-run median.

`DEV_PORT=5999 node scripts/e2e-shard.mjs plan 8`: no `defaulted` file. Per-leg weighted loads (raw: evidence `plan8.txt`):
- leg 1/8: 19 files, 1462s weighted
- leg 2/8: 19 files, 1465s weighted
- leg 3/8: 19 files, 1463s weighted
- leg 4/8: 19 files, 1462s weighted
- leg 5/8: 19 files, 1464s weighted
- leg 6/8: 19 files, 1462s weighted
- leg 7/8: 20 files, 1465s weighted
- leg 8/8: 20 files, 1462s weighted

## After (8 legs, PR #1205's own CI runs, `LEGS=8`, target <= 1200 s)

All 5 runs are `pull_request` runs of this PR (run 1 the push that opened it, runs 2-5 the empty `HEL-1793 CI measurement run N`
commits pushed one at a time after the previous run completed). All 5 are counting (8 reports, unexpected=0, flaky=0, 8 runner
records with a cpu_model line; every e2e job succeeded on attempt 1). No flake, no rerun, no run excluded.

| run | counting | slowest leg | slowest wall s | mean wall s | headroom s | slowest test-step s | its setup s | mean setup s |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 44861555083 | true | 3 | 933 | 888 | 567 | 753 | 137 | 128 |
| 44863392065 | true | 1 | 1181 | 945 | 319 | 966 | 170 | 135 |
| 44865582574 | true | 3 | 903 | 873 | 597 | 733 | 127 | 121 |
| 44867363742 | true | 2 | 905 | 867 | 595 | 749 | 117 | 120 |
| 44869155102 | true | 6 | 1175 | 943 | 325 | 979 | 160 | 131 |

counting runs: 5; slowest leg median 933 max 1181; runs over 1200 s: 0; mean-leg median 888

Trigger per run: 44861555083 = cbe994093 (PR open); 44863392065 = 80db63b36 (run 2); 44865582574 = c166bed73 (run 3); 44867363742 = 1052a0c77 (run 4); 44869155102 = 6ef349eb9 (run 5).

Per run, per leg wall and CPU model (raw: `after-perleg.txt`, `after-5runs.txt`):

run 44861555083
  leg 1 | 875s | Intel(R) Xeon(R) 6975P-C
  leg 2 | 900s | Intel(R) Xeon(R) 6975P-C
  leg 3 | 933s | Intel(R) Xeon(R) 6975P-C
  leg 4 | 876s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 872s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 871s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 901s | Intel(R) Xeon(R) 6975P-C
  leg 8 | 879s | Intel(R) Xeon(R) 6975P-C
run 44863392065
  leg 1 | 1181s | AMD EPYC 7763 64-Core Processor
  leg 2 | 1033s | AMD EPYC 9V74 80-Core Processor
  leg 3 | 883s | Intel(R) Xeon(R) 6975P-C
  leg 4 | 864s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 858s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 884s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 859s | Intel(R) Xeon(R) 6975P-C
  leg 8 | 996s | AMD EPYC 9V74 80-Core Processor
run 44865582574
  leg 1 | 843s | Intel(R) Xeon(R) 6975P-C
  leg 2 | 897s | Intel(R) Xeon(R) 6975P-C
  leg 3 | 903s | Intel(R) Xeon(R) 6975P-C
  leg 4 | 875s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 861s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 863s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 869s | Intel(R) Xeon(R) 6975P-C
  leg 8 | 869s | AMD EPYC 9V45 96-Core Processor
run 44867363742
  leg 1 | 856s | Intel(R) Xeon(R) 6975P-C
  leg 2 | 905s | Intel(R) Xeon(R) 6975P-C
  leg 3 | 865s | AMD EPYC 9V45 96-Core Processor
  leg 4 | 838s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 860s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 824s | Intel(R) Xeon(R) 6975P-C
  leg 7 | 905s | Intel(R) Xeon(R) 6975P-C
  leg 8 | 885s | Intel(R) Xeon(R) 6975P-C
run 44869155102
  leg 1 | 844s | AMD EPYC 9V45 96-Core Processor
  leg 2 | 1054s | AMD EPYC 9V74 80-Core Processor
  leg 3 | 1027s | AMD EPYC 9V74 80-Core Processor
  leg 4 | 857s | Intel(R) Xeon(R) 6975P-C
  leg 5 | 845s | Intel(R) Xeon(R) 6975P-C
  leg 6 | 1175s | AMD EPYC 7763 64-Core Processor
  leg 7 | 887s | Intel(R) Xeon(R) 6975P-C
  leg 8 | 858s | Intel(R) Xeon(R) 6975P-C

Leg factor (design D4: that leg's wall over the mean of the run's other legs): 44861555083 1.06, 44863392065 1.30, 44865582574 1.04, 44867363742 1.05, 44869155102 1.29.

### Verdict

Met: the slowest leg is <= 1200 s on all 5 counting runs (903-1181 s; median 933 s), against 1160-1371 s (median 1324 s, 4 of 5 over) on the 5 7-leg main runs. Mean leg 867-945 s (7 legs: 1005-1092 s).
The two highest values (1181 s run 2 leg 1, 1175 s run 5 leg 6) are both on AMD EPYC 7763, factor about 1.3: the slow-CPU effect is still there but 8 legs leave it 19-25 s under the limit. Headroom on a 7763 leg is thin: setup (about 160-170 s on those legs) does not shrink with more legs. Only 2 of the 5 runs drew a 7763 leg; the three runs without one finished at 903-933 s. No leg on a fast CPU exceeded 1100 s (the next highest after the two 7763 legs is 1033 s on AMD EPYC 9V74).
Sample: 5 runs is small; a run with two or more 7763 legs or a heavier spec on one could still cross 1200 s. The post-merge main watch (design D4a) is pending.

### Re-running the measurement

Scripts and raw outputs: `/home/matt/Development/helio/.concertino/runs/HEL-1793/evidence/measurement/` (lib.mjs, measure.mjs, capture.sh, waitrun.sh). They read and write `/home/matt/Development/helio/.concertino/scratch/HEL-1793/art/<runId>`
(mkdir it if the scratch was swept). `bash capture.sh <runId>` then `LEGS=8 node measure.mjs after <runId>...`; run them from a copy in the scratch dir (or this one; `S` in lib.mjs is the art path). They need `gh` auth only.
