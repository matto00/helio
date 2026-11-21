- `.github/workflows/ci.yml` — e2e `max-parallel: 8`, `shard: [1..8]`; comments at the HEL-1772 history note, the HEL-1288 concurrency note (backend 4 + e2e 8 = 12) and the weights-report note (8 by default)
- `scripts/e2e-shard.mjs` — `DEFAULT_E2E_LEGS = 8`; comment cites HEL-1793
- `playwright.config.ts` — workers comment: 8 legs
- `e2e/README.md` — default plan count 8; report counts (8 since HEL-1793, `--legs 7` for HEL-1772..1793 runs); matrix 8 legs
- `MISTAKES.md` — line 211: HEL-1793 to 8, backend 4 + e2e 8 = 12 (HEL-1772 history kept)
- `e2e/shard-weights.tsv` — regenerated from main runs 44855074949 44845120888 44840748251 44821653778 44811851467 (hel1735, hel1791, both HEL-1649 narrow specs weighted)
- `openspec/changes/add-eighth-e2e-leg/measurement.md` — before table, guard red, weights and plan 8
- `openspec/changes/add-eighth-e2e-leg/tasks.md` — tasks 1-4 ticked

Gates: `check:e2e-shard:selftest` 28 cases passed; `check:ci-complete-needs:selftest` all passed; broad grep for stale count phrases: zero hits (see commit).
