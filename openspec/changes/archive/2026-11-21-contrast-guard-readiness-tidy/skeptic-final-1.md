## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD d3e34a6760e29c443f63afa02f944cd39dfeb059 against base 787a283e996288551590a9e9825bd6ff339a2b0a. I resolved the base live with resolve-review-base.sh, and it exited 0. The diff touches 4 e2e files (+51/-8) plus the change dir. No `frontend/**`, `backend/**` or `schemas/**` file changed, so step 4 (UI/design judgment) does not apply. As briefed, I did not use the MCP browser.

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/contrast-guard-readiness-tidy/HEL-1806`.
- **Item 1, the readiness wait at 1440:**
  - In `e2e/support/state-surface-contrast-guard.ts`, `awaitSampleRefreshReady` (around :532) uses web-first `toBeVisible` and `toBeEnabled`. It is called in the 1440 `pipeline-detail` readiness branch (:935), before `stampDocument`.
  - The narrow `awaitReady` now calls the same helper (narrow.ts:209), so the two cannot drift.
  - D2 (:995-1008) checks three things: the button is present once, it was stamped, and its doc id is in `mainSampledDocIds`. That is the probed set, not just the covered set.
- **AC1, red by mutation (reproduced myself):**
  - I applied M1 by deleting both `@media (hover: hover)` blocks for `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)` (PipelineSpine.css:441-451), then ran `routes-dense` in full.
  - Result: 1 failed, 7 passed. The failure is `[dark] /pipelines/:id :: button "" aria="Refresh sample of HEL-866 Guard Source" [ui-icon-btn] (#6) (hover) — ratio=1.0301171241280085`. The light cell stayed green, as designed.
  - I reverted with `git checkout`, and `git diff -- frontend` is 0 bytes.
  - Log: `.concertino/scratch/HEL-1806/skeptic/red-m1.txt`.
- **AC1, green on the unmutated tree:**
  - All five `state-surface-contrast-guard-*.spec.ts` files, full, 2 workers: exit 0, `40 passed (3.4m)`.
  - `[HEL-1806 guard] ... probed at 1440px` is logged for dark and light (doc id 22).
  - Log: `.concertino/scratch/HEL-1806/skeptic/green.txt`.
- **The wait is load-bearing:** M1 alone also reds on the base tree's ordinary timing, so it does not prove this on its own. The committed M3/M4 evidence does. In M3 the console shows `refresh count=1 disabled-at-stamp=true`, and both cells fail on D2's "was stamped" assertion. M4 (M1 with D2 also removed) passes silently, which is how HEL-1628 escaped. That matches the design (D5.3). I read these logs; I did not re-run them.
- **AC2, the same set of checks:**
  - `playwright test --list` over all five files, with the base versions of the 4 e2e files temporarily checked out and then restored: 40 titles at base and 40 at head, and the `diff` is empty.
  - Per-cell `visible/sampled` lines in my green run against the committed baseline (`01-baseline-all-five.txt`): identical except one. `/home` at 1440 shows 9/9 in my run against 8/8 in the baseline, in both themes.
  - Before treating that as a defect, I re-ran `routes-light` on the base e2e files. The base tree also shows `/home` 9/9 now. So the difference is environmental (data or time-of-day; the runs were about 25 minutes apart, around 04:00 UTC) and the change did not cause it. The diff also does not touch the `/home` branch.
  - Log: `.concertino/scratch/HEL-1806/skeptic/base-routes-light.txt`.
- **Item 2, the stale comment:** `grep -rn state-surface-contrast-guard-narrow.spec.ts e2e/` returns no hits. The header now names both part files.
- **Item 3, widths by value:**
  - `narrowWidths(...)` throws unless each named width appears exactly once. The part files call `narrowWidths(1100, 768)` and `narrowWidths(390)`.
  - I mutated the 390 part to `narrowWidths(1101)` and ran `--list`. It failed with `narrowWidths: width 1101px must appear exactly once in NARROW_WIDTHS, found 0`. I reverted it.
- **Static gates:**
  - `npx tsc --noEmit -p e2e/tsconfig.json`: exit 0.
  - `eslint --max-warnings=0` on the 4 files: exit 0.
  - `prettier --check`: clean.
- **Environment:**
  - Lane DB `helio_hel1806`: confirmed with `psql -w -U matt` (`select 1`).
  - The backend pool's connections were on `helio_hel1806` (7 in `pg_stat_activity`).
  - `ANTHROPIC_API_KEY` was exported empty.
  - Every run used 2 workers, one batch at a time. Servers were stopped with stop-servers.sh (`STOPPED ports=7238,10145`).
  - `git status` is clean apart from the untracked evaluation-1.md.

### Verdict: CONFIRM

### Non-blocking notes
- `coverage-comparison.md` says the per-cell counts were identical. That is true for the executor's two runs. `/home` at 1440 can show 8 or 9 elements depending on the environment, which is outside this change.
- `--list` titles for the narrow cells are prefixed with the support file, not the part file. File placement is shown by the `--list` output of each part file (`06-width-by-value-checks.txt`), not by the aggregate title diff.
