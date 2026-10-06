## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed head: `2fcf1773a269c229ed83eef3e726510f2c58c125` (local; docs-only on top of pushed `4516a4f89`, which is
PR #774's head). Review base resolved live via `resolve-review-base.sh` = `05004f85b`. `origin/main` is now
`cdb9e43d6`, two commits ahead of the base (HEL-1297 helio-mcp harness, HEL-1291 PublicDashboardRoutes split). It
merges cleanly (`git merge-tree`), but it is not yet merged into the branch.

### What I verified (with evidence)

**Scope of the diff.** I checked `git diff origin/main HEAD -- .github/workflows/ci.yml` (54 lines, the same as
against the merge base). Every hunk is inside `e2e:`:
- `timeout-minutes: 18`
- `strategy` with `fail-fast: false`, `max-parallel: 4` and `shard: [1..4]`
- background start plus a separate `Wait for backend health` step
- `--shard=${{ matrix.shard }}/${{ strategy.job-total }}`
- per-shard artifact names and an always-uploaded JSON report

The workflow `concurrency:` block, `backend` (HEL-1287 matrix, `timeout-minutes: 15`), `security`, `frontend` and
`ci-complete` (`needs: [frontend, backend, security, e2e]`) are byte-unchanged. No `actions/cache` step was added
(added scope: no new cache entries).

**HEL-951 contract.** `playwright.config.ts` keeps `testDir: "./e2e"` and the same `testIgnore` list. It only adds
`workers: CI ? 2 : undefined` and a CI-only json reporter. CI still runs `npx playwright test` against the config
glob; `--shard` only partitions the collected set.

**`scripts/e2e-backend.sh`.**
- Read in full. The only process operation is `kill -0 -- "-$pgid"` on the PGID recorded at `start` (from `setsid`,
  so PID equals PGID). There is no `pkill`, `pgrep` or `-f`: a grep over the script and ci.yml finds only that line.
  There is no restart path.
- I re-ran the red cases myself with stub commands (scratchpad, port 9627, nothing real started):
  - hang with no compile (`STAGE_TIMEOUT=3`): fails "hung before the compile/run stage" at 3 s.
  - post-fork death: fails "backend process group … is gone after the fork (3s in)".
  - compiling but never healthy (`TOTAL_TIMEOUT=5`): fails at 5 s.
- Each stub group was confirmed gone (`pgrep -g`).
- The executor's real-sbt kill evidence is in profile.md. I did not repeat it.
- On CI, every leg of the final streak logged `backend healthy after 0–59s`.

**Untouched files.** `git diff origin/main...HEAD` is empty for `e2e/hel1260*`, `e2e/hel958*`, `e2e/hel910*` and
both screenshot specs. `hel519-recent-navigation.spec.ts` gains only the parallel-mode header (owner ruling C9
keep-header).

**Parallel-mode files.** None of the 9 files has a `beforeAll`/`afterAll`/serial hook: every grep hit is a comment.
hel1023 and hel1028 turned their `afterAll` residue summary into per-registration logs. hel1028 adds a web-first
`.panel-grid` visibility wait before `boundingBox()`.

**Guard split keeps the population (CI ground truth, not the narrative).**
- I downloaded all 12 e2e leg logs of run 37519143326 (attempts 1–3) and the main e2e job log of 37337348981
  (job 111855375384, head 32571b01).
- I extracted every `[HEL-866 guard] view …` and `[HEL-520 focus-presence guard] view …` line.
- Main has 46 lines. Each attempt has 46 lines.
- The only differences are view labels (`/pipelines/<id>` vs `/pipelines/:id`, `/sources/<id>` vs `source-detail`,
  `/pipelines/<id>` vs `pipeline-detail`). Every count and `sampled` number is identical, view for view, in all
  three attempts.
- The failure verdicts are kept: `throw new Error(… failed the 1.1 contrast threshold)`, focus `throw`s, per-cell
  `unresolvedFraction < 0.5` (L732) and per-cell `measuredThisView > 0` (L356). The latter two are stricter than
  main's run-wide L862/L383.

**3-in-a-row interference AC at the final pushed head.**
- `gh api runs/37519143326/attempts/{1,2,3}`: all three report head_sha `4516a4f89…`, conclusion success, and every
  job re-ran in each attempt.
- e2e leg execution times (startedAt → completedAt), legs 1–4:

  | attempt | leg 1 | leg 2 | leg 3 | leg 4 |
  |---|---|---|---|---|
  | 1 | 636 | 408 | 357 | 371 |
  | 2 | 337 | 401 | 286 | 352 |
  | 3 | 290 | 425 | 266 | 404 |

  These match profile.md (it gives 289 for attempt 3 leg 1, against my 290).
- In every leg the log grep shows only `N passed`: "Running 46/46/44/41 tests using 2 workers", 177 tests total, no
  `failed`/`flaky`.
- ci-complete succeeded in each attempt.
- The commits after 4516a4f8 (to 2fcf1773a) only touch `evaluation-6.md` and `profile.md`, so the tested code equals
  the reviewed code. **Met.**

**Apt-stall claim (attempt 1, leg 1).**
- The log shows `Run npx playwright install --with-deps chromium` at 19:29:06 and the next step at 19:34:19 (313 s).
- `Get:` timestamp gaps are 31, 51, 25, 63 and 92 s.
- The suite reported `46 passed (3.8m)`.
- The claim is accurate. It is an external mirror stall, not this change.

**Cancelled-run proof (added scope).**
- Run 37392082526 (head 1bdbbbd8): all e2e legs, backend and frontend `cancelled`; security `success`; ci-complete
  `failure`.
- Its log shows `results: cancelled, cancelled, success, cancelled` and `A required CI job was cancelled.`
- **Met.**

**≤ 7 min AC: is it represented honestly? Yes, in profile.md.**
- Its closing paragraph states:
  - the final streak's slowest legs (10.6 / 6.7 / 7.1 min);
  - that even excluding the outlier the latest attempt is above 7;
  - that the owner accepted a ~6.9 median (C11);
  - that the ticket's criterion (median of 5 post-merge main runs) is unmeasurable before merge.
- Every timing number I spot-checked traces to the jobs API.
- My own read of the last three streaks' slowest legs (21ddb3c5: 6.75 / 7.05 / 6.9; aa18aa24: 6.85 / 6.5 / 6.7;
  4516a4f8: 10.6 / 6.7 / 7.1) gives a median of about 6.85 min.
- So the ≤ 7 min post-merge median is plausible but has almost no margin. It is an open AC for the driver, not a met
  one, and nothing in profile.md claims otherwise.
- The PR body is still the WIP placeholder ("Not for merge yet"), so the PR is not yet in a PR-ready state (see
  note 1).

**Other ACs.**
- Profile artefact: before per-step and top-15 come from 37337348981; after per-step and top-15 come from 21ddb3c5
  attempt 3. Present.
- Counts: 149 → 177 (−2 serial guards, +28 cells, +2 HEL-1275). Consistent with the CI "Running N" sums.
- Removals: none applied. The proposed ledger is recorded.
- Quarantined specs: config unchanged.

**UI review.** Not applicable: no `frontend/**` change.

### D2 / C7 removal ledger — per-row verdict (task 2.2)

I read both specs in full and every cited surviving test. Every survivor runs in CI: it appears in the attempt-3
list output and is not in `testIgnore`.

**`e2e/hel516-screenshots.spec.ts`** (2 tests: light, dark)

| # | Removed behaviour (implicit check) | Survivor | Verdict |
|---|---|---|---|
| 1 | Ctrl+K opens the palette (`expect.poll` on `.command-palette[open]`, L21–29) | `hel510-keyboard-shortcuts.spec.ts:180` (L185–186) and `:197` (L202–208): real Ctrl+K, then `toHaveAttribute("open")` | **CONFIRM**, class (a). Explicit, stronger. |
| 2 | Palette offers "Switch to light theme" and it is clickable (L44–45; no post-check) | `hel1090-form-panel-assembled-a11y.spec.ts:449–453` and `hel1088-compact-counter-chrome.spec.ts:186–190`: same palette path, plus palette closes and `html[data-theme=light]` | **CONFIRM**, class (a). Strictly stronger. The ledger cites 446–448 / 183–185, which are 3–5 lines early; the content is correct. |
| 3 | `?` opens the help overlay (`waitForSelector(".help-overlay[open]")`, L68–69) | `hel510-keyboard-shortcuts.spec.ts:47`: `?`, then `toHaveAttribute("open")` and `toContainText("Keyboard shortcuts")` | **CONFIRM**, class (a). Stronger. |
| 4 | Hover, ArrowDown and 4 screenshots | none needed | **CONFIRM**, class (b). The screenshots go to `.concertino/runs/HEL-516/evidence/`. They are never compared or uploaded (the CI upload covers only `test-results/` and the logs). The hover is conditional on `count > 0`, so it is not a check. |

**`e2e/hel519-screenshots.spec.ts`** (2 tests: light, dark)

| # | Removed behaviour (implicit check) | Survivor | Verdict |
|---|---|---|---|
| 5 | API-seeded source → `/sources` list click → `waitForURL(/sources/<id>)` → palette shows a "Recent" group (L54–68) | `hel519-recent-navigation.spec.ts:90` (L94–101): identical list click and `waitForURL`, plus Recent label visible, plus the named source option visible | **CONFIRM**, class (a). Strictly stronger. The ledger's "e.g. :84" points at the `navigateViaSidebar` helper, not a test; the right citation is `:90`. Its HEL-1298 fragility is tracked, and HEL-1298 forbids quarantining it, so the survivor stays in CI. |
| 6 | Palette light-theme switch (L58–62) | as row 2 | **CONFIRM** |
| 7 | `items.nth(0).hover()`, an implicit "≥ 1 palette item" check | subsumed by row 5's named option visible (`:101`) | **CONFIRM** |
| 8 | Light-theme run of "Recent visible" | Presence only, not a colour, contrast or focus assertion, so D2's no-collapse rule for theme-dependent assertions does not apply. `state-surface-contrast-guard` overlays cells also assert the palette's Recent rows in both themes (L811–812). | **CONFIRM** |

Conditions on executing task 2.2 (they do not reject any row):
- `e2e/hel588-cross-filter-panels.spec.ts:375` comments "(see hel516-screenshots.spec.ts's identical rationale)".
  The deletion must reword that comment so it does not dangle.
- A deletion changes the collected set and the shard split, so the head that merges must have its own green CI run.
  The 4516a4f8 streak certifies the tree without the deletion.

### Verdict: CONFIRM

The change does what the ticket asks within the owner's rulings:
- ci.yml is confined to the e2e job.
- The HEL-951 contract is intact.
- The guard population is identical on CI.
- The 3-in-a-row interference AC is met at the final pushed head.
- Cancellation fails ci-complete.
- The backend wait is fail-fast with no pattern kill.
- profile.md is honest that the ≤ 7 min median is unmeasured and sits right at the line.

### Non-blocking notes

1. **The PR body must be written before merge.** It is the WIP placeholder now. The added scope and D7 require it to
   state: expected leg time (~6.7–7 min), the `timeout-minutes: 18` derivation, that the ≤ 7 min post-merge median
   is unmeasured at merge, and the no-removal or ledger outcome.
2. **`tasks.md` 4.3 is ticked `[x]` but its own verify signal failed.** The signal was "slowest-shard job ≤ 6.5 min
   on the PR"; measured slowest legs were 6.5–7.1 min. Annotate it as superseded by C11 (owner accepted ~6.9) rather
   than leaving a false tick in the archive.
3. **`origin/main` moved after the streak.** The new `cdb9e43d6` includes HEL-1291's backend PublicDashboardRoutes
   refactor. Merging it gives a new head, and per CON-166 that head needs its own green CI before merge. This
   CONFIRM's `head_sha` is `2fcf1773a`.
4. **Ledger line citations are off.** hel1090 and hel1088 are a few lines early, and hel519 cites `:84` instead of
   `:90`. Fix them if the ledger is carried into the archive.
5. **`evaluation-7.md` is untracked** in the worktree. The orchestrator should commit it with the delivery.
6. **The ≤ 7 min margin is about 0.15 min** on the median of the last nine attempts. The driver should expect the
   post-merge 5-run median to land at roughly 6.7–7.1, and an apt-mirror stall (as in attempt 1) can push one sample
   past it.

### Gate-defect check

No report I drilled into disclosed unsound evidence-directory mtimes, and no conclusion here rests on mtime ordering.
All timing comes from the GitHub jobs API and log timestamps.
