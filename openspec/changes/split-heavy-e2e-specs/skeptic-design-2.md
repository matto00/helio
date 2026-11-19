## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 3bf3590ec2cb2bf4b1478159a8cae832274becf6 (branch task/rebalance-heavy-e2e-specs/HEL-1778; change dir untracked, no code diff yet).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/rebalance-heavy-e2e-specs/HEL-1778`.
- **Round-1 CR1 (Goals vs Non-Goals): resolved.** The goal now covers only the parts of hel1665, hel1733 and hel1583 ("no part ... heavier than about 250 s"). It names the other heavy files as out of scope and points to Decision 1's rule. The contradiction is gone.
- **Round-1 CR2 (variance analysis widened): resolved on paper.** Decision 1 covers every discovered spec, share of the run total, a per-run slowest-leg excess ranking, a threshold rule for drivers outside scope (follow-up ticket, no widening), an AC3 expectation, and a stop-and-report branch. Tasks 1.2/1.3 match it. See CR1 below for the data this rests on.
- **Round-1 CR3 (balance requirement clause by clause): resolved.** Decision 6 handles the 25-run before set (not met, with the reason, and 6-leg runs shown for context only), the 15 s line (met/not met with the number; the HEL-1361 delivery note in `openspec/specs/e2e-ci-sharding/spec.md` confirms it was accepted as unmet) and the control (not applicable). Tasks 4.3 and 5.1 carry these. The "headroom" requirement (5 consecutive main runs after a leg-count change) does not apply, because the leg count is unchanged.
- **Round-1 non-blocking notes: all taken up.** Title path is defined in the delta, gate names are in task 2.5, `--project=dev` is in Decision 3(a), the `# Regenerate:` line shows `--list`, and the deleted-test misattribution risk is listed.
- **Tool claims:** `scripts/e2e-shard.mjs` `fileSumsForRun` sums per top-level suite `file` per run, `weightsFromRuns` takes the median across runs, and `weightsMode`'s header matches the current `e2e/shard-weights.tsv` header. Table rows: hel1665 674, hel1733 358, hel1583-glass-nav 160, hel1608 8, hel1575-dashboard-tabs 749, as the ticket and design say.
- **Spec delta against the live spec:** the MODIFIED requirement keeps the original three sentences verbatim and the "Assignment is deterministic" scenario. The attribution rules are complete and ordered: (1) the reported file, (2) the single current file, (3) a renamed test in a still-discovered file, (4) an ambiguous move fails, (5) a deleted file is dropped and named.
- **Split feasibility (Decision 2):**
  - hel1665 (623 lines) has file-level `mode: "parallel"` and `test.setTimeout(180_000)` and no describes: tests are top-level, generated in `for` loops over themes and viewports.
  - hel1733 (872 lines) has no file-level configure and four describes with their own `use`/`setTimeout`; `beforeEach`/`afterEach` sit inside the first describe.
  - hel1583 (702 lines) has `parallel` mode and one describe per theme (line 256), so a 2-part split "by theme" is natural.
  - None of the three has a module-level `let` or `beforeAll`. The split boundaries in Decision 2 are achievable.
- **Title-path collisions:** the other files with "Home ..." test titles (hel1678-home-large-font, hel1583-home-375, hel1642-home-phone-timeline) use different title texts, so rule 2 cannot be ambiguous for hel1665's tests today.
- **Reference sites:** the only non-archive, non-change reference to the three file names outside the weight table is `frontend/src/features/home/ui/HomePage.css.test.ts:10`, which task 2.3 covers. There is no hit in `MISTAKES.md` or `e2e/README.md`.
- **Main-run evidence for Decisions 1 and 5:** 44446279352, 44455550476, 44468195695, 44488684006 and 44498291938 are all attempt 1 and each has 7 `playwright-json-shard-*` artifacts (GitHub API, run twice).
- **PR #1172 evidence (Decision 1 population (ii), task 1.1): NOT available as planned.** See CR1.
  - `GET /runs/44428229791/artifacts?per_page=100` returns `total_count` 13, with exactly one set of 7 `playwright-json-shard-*` artifacts.
  - All of them were created between 02:31:10Z and 02:35:05Z. That window is attempt 6 (run_started_at 02:18:00Z, e2e jobs ending 02:31:16Z to 02:35:12Z).
  - I reproduced this with a second query. Run 44410691147 likewise holds only one set (6).
  - The per-test data for attempts 1-5, which include the 1441 s leg (attempt 2, `e2e (3)`, 00:44:31Z to 01:08:32Z = 1441 s), does still exist in the job logs. The CI reporter is `[["list"], ["json", ...]]` (`playwright.config.ts:203-205`), and `gh run view 44428229791 --attempt 2 --job 135248708940 --log` prints per-test lines such as `✓ 114 [dev] › e2e/hel1733-draft-outputs-shapes.spec.ts:430:11 › HEL-1733 ... › create Output on a saved step: ... (20.0s)` (169 result lines in that leg).

### Verdict: REFUTE

### Change Requests

1. **The PR #1172 population in Decision 1 and task 1.1 depends on artifacts that no longer exist. Revise the data source.**
   - **What exists:** run 44428229791 retains `playwright-json-shard-*` reports for attempt 6 only. The whole-run reruns replaced the earlier sets: 13 artifacts in total, all created in attempt 6's window.
   - **Why it matters:** attempts 1-5 are exactly the ones that carry the ticket's 1236/1441/1399 s legs. Attempt 6's slowest leg was about 1028 s.
   - **The risk as written:** task 1.1 ("Download ... attempts 1-6") cannot be done. An executor following it will either:
     - analyse attempt 6 alone, which drops the evidence the ticket is about and could trip Decision 1's stop branch on main-only data; or
     - mistake attempt 6's reports for the other attempts.
   - **Required:**
     - (a) State in the design's Context and in task 1.1 that only attempt 6's reports survive, with the evidence above.
     - (b) Source per-test durations for attempts 1-5 from the job logs. The CI `list` reporter prints `[dev] › e2e/<file>:<line> › <title path> (<n>s)` per test, rounded to 0.1 s. Get them via `gh run view 44428229791 --attempt <n> --job <id> --log` with job ids from `/attempts/<n>/jobs`. Alternatively, declare those attempts job-wall-only and say what Decision 1 can and cannot conclude from them.
     - (c) Have `specvar.mjs` mark which runs and attempts come from JSON reports and which from logs. Note that logs give no per-worker start times, so the "per-worker busy/idle tail" in Decision 1(c) is either derived some other way (log timestamps per line) or marked unavailable for those attempts.
     - (d) Apply the same fact to the after set (Decision 6, task 5.1). A whole-run rerun of the PR replaces the previous attempt's `playwright-json-shard-*` reports. Per-attempt report presence (the counting rule) and any per-spec driver analysis of an over-1200 s attempt must therefore be captured, by downloading the artifacts, before the next measurement rerun starts. Otherwise those checks fall back to logs.

### Non-blocking notes

- Spec delta, scenario "A split spec is weighted ...": "each new file's weight is the summed duration of the tests it now contains" leaves out the median-across-runs step the tool applies (`weightsFromRuns`). Consider "the median across runs of the summed duration ...". The requirement text never states the median, so the scenario reads as a single-run sum.
- Risks: "top-level describes carry ticket ids, so title paths are near-unique" is not true for hel1665. Its tests are top-level with no describe, and titles start with "Home load (...)" or "Home at ...". I found no current collision, but the mitigation that actually carries the weight is the stderr re-attribution list. Say so.
- The design text attributes a "known flake" to hel1583 line 554 and plans to update in-repo references to it. No in-repo, non-archive file names `hel1583-glass-nav.spec.ts:554`, so that part of task 2.3 will be a no-op. That is fine, but the executor should not go looking for it beyond the zero-hit grep.
- The attempt-2 log shows hel1733 action tests at about 20 s each, against the design's 13-16 s on main. That is suggestive of the run-wide hypothesis for the PR population. It is for the executor to measure, and is only noted here as evidence that the log route yields usable numbers.
