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
