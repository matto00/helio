## Evaluation Report — final pre-skeptic evaluation (evaluation-6.md)

Reviewed head: local `0f1e0047d5468c1159493fcb154fee51d0c2778f`. It is docs-only and sits on pushed `4516a4f8`.
- The diff base was resolved live as merge-base `05004f85b`. origin/main has since moved to `cdb9e43d6` (HEL-1297, HEL-1291). Neither touches ci.yml, `e2e/`, `playwright.config.ts` or `frontend/src`.
- I read CI only through `gh` and pushed, re-ran or cancelled nothing.
- C12 (`accept-detection-without-root-cause`, root cause tracked as HEL-1339) and C9 (`keep-header`) are resolved by the owner rulings recorded as C14.

### Verification against ground truth

1. **ci.yml vs origin/main: PASS.**
   - Every hunk of `git diff origin/main HEAD -- .github/workflows/ci.yml` lies inside the `e2e` job (L419–556). `e2e:` is at L417 and `ci-complete:` at L568.
   - The `security` job (HEL-1296, L246) and HEL-1287's backend matrix, concurrency and timeouts are unchanged. The only `timeout-minutes` line added is the e2e job's 18.
   - `ci-complete` still `needs: [frontend, backend, security, e2e]`.
   - The `--shard=${{ matrix.shard }}/${{ strategy.job-total }}` glob plus `testIgnore` is intact.
   - `scripts/e2e-backend.sh` and `playwright.config.ts` are unchanged since my evaluation-4/5 PASS.
2. **Helper swap: PASS (it preserves what the guards measure).**
   - Old gate: `expect(main .sortable-th__btn).toHaveCount(5)`.
   - New gate: `waitForSettingsAuditTable` (HEL-1336, `e2e/support/settingsReady.ts`). It waits for the "Audit history" section's `table` to be visible, then for the first `thead .sortable-th__btn`.
   - Both gate on the same rendered state: the async `GET /api/audit-events` has resolved and the table is committed. The table, header and rows render in one React commit, so the audit rows in the measured population are present under either gate.
   - The new gate is weaker in one respect: it no longer asserts that the column count is exactly 5. That was a shape check, not a readiness condition, and the per-view population lines still catch any change in population.
   - CI evidence: run 37519143326 at 4516a4f8, merge ref `9b0ee6cb`. My comparison script against main 37337348981 gives **46/46 keys equal, 0 mismatches** in attempts 1, 2 and 3. Attempt 1's logs were fetched per job via `gh api --allow-escape-sequences …/jobs/<id>/logs`. Each attempt has exactly 10 focus view lines, and every attempt ran 46/46/41/44 tests at 2 workers.
3. **Streak: PASS.** All three attempts concluded `success` on head 4516a4f8 (pull_request event).

   | Attempt | e2e legs 1–4 (s) | security | ci-complete |
   |---|---|---|---|
   | 1 | 636/408/357/371 | 60 s | 4 s |
   | 2 | 337/401/286/352 | 68 s | 4 s |
   | 3 | 289/425/266/404 | 73 s | 3 s |

   These match the orchestrator's figures and profile.md.

   **Leg-1 outlier in attempt 1:** the jobs API shows "Install Playwright browsers" at 19:29:06 → 19:34:19, which is 313 s. The suite itself took 228 s.
   - In the retained job log, apt stalls inside `--with-deps` on `azure.archive.ubuntu.com` downloads: 31 s, 50 s, 62 s and 91 s gaps between consecutive `Get:` lines (fonts-freefont-ttf, fonts-wqy-zenhei, mesa-libgallium, …).
   - This is an external mirror stall, not the suite and not this change.
4. **Protected files: PASS.**
   - `git diff 05004f85b...HEAD` is empty for `e2e/hel1260-orphan-owner-repair.spec.ts`, `e2e/hel958-join-step-editor.spec.ts`, `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` and `e2e/support/settingsReady.ts`.
   - The only HEL-1298 target touched is the kept `hel519-recent-navigation.spec.ts` header (+6, C9 `keep-header`).
   - Since f9f18e2b2, the only non-merge code change is 0b03ec24d: the import of the helper and the gate swap, in two lines per guard.
5. **profile.md and tasks.md:** see Phase 1.

### Phase 1: Spec Review — FAIL

`tasks.md` is accurate and current:
- C14 records both rulings.
- Every task is `[x]` except 2.2, which is correctly left for the final skeptic.

`profile.md` has three problems in the new section and the Notes:

1. **A false statement in the new 4516a4f8 section (L150).** It says: "the extra time was before the suite (not investigated; the log was not retained)."
   - The log is retained. I fetched all four attempt-1 e2e job logs.
   - The cause is determinable: "Install Playwright browsers" took 313 s (19:29:06–19:34:19) because the apt mirror stalled. The suite took 228 s.
   - C1 requires CI-sourced, accurate evidence. The outlier is explained by CI data that exists, and that data is stated as unavailable.
2. **The owner rulings are not reflected in profile.md.**
   - The Notes (L153) still say "the e2e backend start hang (…; guard added, cause unproven)" with no mention of C12 `accept-detection-without-root-cause` or HEL-1339.
   - The C9 `keep-header` ruling for `hel519-recent-navigation.spec.ts` (parallel-mode, a HEL-1298 target) is not mentioned anywhere in profile.md.
3. **There is no plain statement of where the ≤ 7 min AC stands at the final head.**
   - The final streak's slowest legs are 10.6 min (apt outlier), 6.7 min and 7.1 min. Even excluding the outlier, attempt 3's slowest leg (7.1 min) is above 7.
   - The owner accepted the timing under C11 (median ~6.9 min).
   - The ticket's AC is the median of 5 post-merge `main` runs, which is unmeasured. Line 134 mentions the driver's post-merge measurement only in passing. The file never says plainly that the AC is not demonstrated pre-merge and that the latest streak sits at about 7 min, mostly just above.

### Phase 2: Code Review — PASS

Gates I ran myself on this head:

| Gate | Result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | clean |
| `npx playwright test --list` | 177 tests in 37 files (the branch now includes HEL-1275's spec via the merges) |
| `bash -n scripts/e2e-backend.sh` | OK |

- No `frontend/**` or `backend/**` files changed relative to the merged main, so Jest, the frontend build and `sbt testFull` are not triggered.
- The helper adoption removes our duplicate readiness logic in favour of the shared one, which is good for DRY.

### Phase 3: UI Review — N/A

No trigger path changed.

### Overall: FAIL

This is doc-only. The code, the CI streak, the population equality and the ci.yml scope all pass.

### Change Requests

All of these are in `openspec/changes/halve-e2e-ci-job-time/profile.md`.

1. **L150:** replace "the extra time was before the suite (not investigated; the log was not retained)" with the CI-sourced cause:

   > "Install Playwright browsers" took 313 s (19:29:06–19:34:19, job steps API) because `--with-deps` apt downloads from azure.archive.ubuntu.com stalled (gaps of 31–91 s between `Get:` lines in the retained job log); the suite took 228 s; external, not this change.
2. **L153 (Notes):** update the backend-hang item to cite the C12 ruling (`accept-detection-without-root-cause`, root cause tracked as HEL-1339). Add the C9 `keep-header` ruling for `e2e/hel519-recent-navigation.spec.ts`'s parallel-mode header, a HEL-1298 target.
3. **Add one "AC status" sentence**, for example:

   > Slowest leg per attempt in the final streak 10.6 (apt outlier) / 6.7 / 7.1 min; the owner accepted ~6.9 min under C11; the ticket's ≤ 7 min AC (median of 5 post-merge main runs) is not measurable pre-merge and is the driver's post-merge measurement.

### Non-blocking Suggestions

- If the slowest-leg variance matters for the post-merge median, a 313 s apt stall is a reminder that `--with-deps` sits on the critical path and is external. That is noted only. The browser cache was measured and dropped, and C11/C14 forbid new caches.
