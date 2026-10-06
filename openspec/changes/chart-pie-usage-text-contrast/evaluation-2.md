## Evaluation Report — Cycle 2 (evaluation-2.md)

- Reviewed HEAD: `ec949c578c86c37ddaf65d4a12058cf7e84d0e14`.
- Base, resolved live from origin/main with `resolve-review-base.sh`: `2c1884ac5b2cc2578320ace4a21e37b32df5c603`.
- The cycle-2 delta is `76c43eef2..ec949c578`.

### Phase 1: Spec Review — PASS

I checked each of the executor's claims against the evidence:

- **"Re-measured a real percent-label pie, before and after."** Verified.
  - Both raw files now show a distinct `Bravo` series with `formatter: "{b}: {d}%"`, in both themes, before and after. The `Alpha` series has no formatter.
  - In the before shot (`before-dark-pie-percent.png`), the card is titled "HEL-1342 Bravo pie" and its labels read "East: 19.23%" etc. with the white outline.
  - The checksums now differ for all four `pie-default`/`pie-percent` pairs, e.g. `6fb0da5a…` vs `a8b31de6…`.
  - The persisted copies under `.concertino/runs/HEL-1342/evidence/...` match the worktree files byte for byte.
- **"Corrected measure-*.md, §10.1 and task 1.2."** Verified.
  - §10.1 now states that the percent pie's `chartOptions` is on the Output config and that it renders "Name: NN.NN%".
  - The §10.1 ratios are unchanged and still correct. I recomputed them in cycle 1, and this cycle's re-measurement on the running app agrees.
  - Both measure files carry an honest cycle-2 correction note. Task 1.2 has been reworded.
- **"Stopped committing scratch/."** Verified. All 7 `scratch/*` files are deleted in this commit.
- **"Cited the durable evidence path."** Verified. §10.1 cites `.concertino/runs/HEL-1342/evidence/.../{before,after}-{light,dark}-*.png`, and those files exist there.
- AC coverage is unchanged from cycle 1; all ACs are addressed. There is no scope creep. The only new source change outside the two target files is exporting `toSeriesArray`, which was needed for the normalisation.
- The executor's cycle-2 dev-DB ids are recorded in `evidence-ids.md`, deleted children-first, with the user row's re-query returning 0.
- `CONSTRAINTS: []`. `ci.yml`, `playwright.config.ts` and `.gitignore` are untouched.

### Phase 2: Code Review — FAIL

Gates, re-run by me in `WORKTREE_PATH` with the project-local npm cache:

| Gate | Result |
| --- | --- |
| lint | EXIT 0 |
| format:check | EXIT 0 |
| typecheck | EXIT 0 |
| `npm test` | EXIT 0; 4581 tests / 439 suites pass, plus 371 tests at root |
| build | EXIT 0 |

- **"Normalised the pie pass through toSeriesArray."** Verified.
  - `buildChartOption.ts:184` now runs `toSeriesArray(built)`, so a single-object `series` would be handled rather than throwing.
  - For an empty pie, the `pieSeries.length > 0` guard leaves `built` untouched, so no `series` key is written.
  - The export in `chartAppearance.ts:204` is the minimal change.
- **Red on main still holds.** In a scratch worktree at HEAD with the two source files reset to `2c1884ac5`, 7 tests failed out of 43. The scratch worktree has been removed.
- **The new test is vacuous.** `buildChartOption.textColor.test.ts:187-195` is named "a no-data pie gains no series key", but it asserts `expect(option.series).toBeUndefined()`.
  - That assertion is equally satisfied by an explicit `series: undefined` key, which is exactly what the cycle-1 code produced.
  - Mutation proof: with `buildChartOption.ts` replaced by the cycle-1 version (`git show 76c43eef2:...`), all 43 tests still pass.
  - With the assertion changed to `expect(option).not.toHaveProperty("series")`, the cycle-1 code goes red (1 failed) and HEAD stays green (41/41 in that file).
  - So the test guards nothing its name claims, and labels a non-guard as a guard.

### Phase 3: UI Review — PASS

I ran the app at HEAD on my own servers:

- Started with `start-servers.sh`, then `assert-phase.sh servers` returned PASS.
- java PID 3088472 had cwd `.../hel-1342/backend`; vite PID 3088924 had cwd `.../hel-1342/frontend`. I also recorded the parents: 3088900 (npm), 3087976 and 3087931 (sbt).
- All five were stopped by recorded PID, and both ports are free.

I used a throwaway owner user, a headless Chromium context and DPR 2. In both themes:

- The default pie and the real percent-label pie (Output `config.chartOptions.pie.showPercentLabels`) paint their slice labels in `--app-text`: `#211d19` in light, `#f2efe9` in dark. They have `stroke: null` and still do under hover emphasis.
- The percent labels read "East: 19.23%" etc.
- In all 4 usage charts, axis ticks and legends use `--app-text` with no stroke.
- Horizontal overflow is 0 at 1100, 768 and 375 on both the usage page and the dashboard.

My first measurement attempt timed out, and the second logged 15 `429` responses in the dark-theme pass. Both came from my own two back-to-back harness runs exceeding the per-user `/api` rate limit (120 requests per 60s). This is a harness artifact, not a product defect. The completed run captured every reading above.

### Overall: FAIL

### Change Requests

1. `frontend/src/features/panels/ui/buildChartOption.textColor.test.ts:194`: replace `expect(option.series).toBeUndefined();` with `expect(option).not.toHaveProperty("series");`.
   - Without this, the test passes on the cycle-1 code it is meant to distinguish from.
   - I verified the replacement is red on the cycle-1 code and green on HEAD.
   - Alternatively, delete the test if the empty-pie key is not worth guarding.
   - If kept, record the mutation (revert the pie pass to the `?.map` form → red) in `mutation.txt`.
2. `openspec/changes/chart-pie-usage-text-contrast/measure-before.md:3`: fix the stray "``measure-before-raw.txt``, ;" left behind when the JSON reference was removed.

### Non-blocking Suggestions

- The `toSeriesArray` doc comment (`chartAppearance.ts:198-203`) still explains why it is a private copy rather than a cross-module import. Now that it is exported, consider rewording that rationale.
- `measure-before.md`'s percent-label section has two dark slice-label rows: one sampled on the real surface (1.4), one inside the outline (12.63). The cycle-2 note explains this. A single row using the surface ratio would read more simply.

### Evaluator evidence (persisted)

Under `/home/matt/Development/helio/.concertino/runs/HEL-1342/evidence/.eval-hel1342-c2/`:

- `eval-measure.json` and `eval-measure.log`
- `eval-{light,dark}-pie-{Alpha,Bravo}.png`
- `eval-{light,dark}-usage-full.png`

### Dev DB rows created by the evaluator in cycle 2 (all deleted by exact id)

| Row | Id | Delete result |
| --- | --- | --- |
| user `hel1342-eval-1791291464465@example.test` | `1c689cb1-73e1-4d4a-9d3e-4db5cd492830` | Promoted with `UPDATE users SET tier='owner' WHERE id='1c689cb1-…'` → UPDATE 1. DELETE 1. Re-query 0. |
| dashboard | `6193eead-31e4-4773-a05c-8a928009aa1c` | 204 |
| data source | `88502247-97d2-4520-935d-7f6396b7e720` | 204 |
| pipeline | `b0e65c1a-a1a3-4308-96e5-cf231b72a187` | 204 |
| outputs | `84778fd9-8f51-43e0-8157-f4a6a837e76d`, `a53026e7-23f9-4256-8748-b69647b7ae25` | 200 each |
| panels | `0a77319e-6c89-4146-ac3a-f2f74fbd2bb0`, `37d2e4c6-6cd7-45d0-bed3-6aa9d57e30f0` | 204 each |
| `pipeline_run_rate_window` | by `user_id='1c689cb1-…'` | DELETE 1 |

- The first API delete attempt returned 429 (the harness rate limit). I waited until the limit cleared, then retried: all deletes succeeded.
- A re-query by exact id shows 0 rows for every row listed above.
