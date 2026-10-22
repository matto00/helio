## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed HEAD 26f6a1ede9b8b5f6c2b7144f9dc4d61698ea5a11. The change dir holds untracked planning artifacts only.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/e2e-ci-shard-headroom/HEL-1698`.
- **Owner ruling (D1):** main checkout `.concertino/runs/HEL-1698/events.jsonl` line 6 is `escalation.raised` and line 7 is `escalation.answered`, with `answer:"six-legs"`, `answer_source:"human"` and the same escalation_id. Per instructions I did not re-litigate it.

**Round-1 Change Request 1 (pattern-kill guard reach): resolved.**
- D4a and task 2.5a add `.github/actions/e2e-setup/action.yml`, plus `e2e-slow.yml`, to `SCANNED` (`scripts/check-ci-sbt-no-pattern-kill.mjs:12-17`). The proposal's Impact list now names the guard script.
- The selftest's "real tree is clean" assertion iterates `SCANNED` itself (`check-ci-sbt-no-pattern-kill.selftest.mjs`, final `rec`). Adding to `SCANNED` therefore extends that coverage without any selftest edit.
- `e2e-slow.yml` passes today. I ran `checkText` on it in-memory and got `[]`, so adding it to `SCANNED` will not turn the guard red on arrival.
- Mutation evidence (task 3.2a) runs through `checkText` on an in-memory copy. That is the same function the CLI loop calls (`SCANNED.flatMap(f => checkText(...))`), so it is equivalent evidence. It also respects the run's binding constraint against writing kill text anywhere it could execute.

**Round-1 Change Request 2 (D7 balance reporting): resolved.**
- I recomputed D7's before table from `.concertino/scratch/HEL-1698/before-legs.tsv` (20 rows, 5 runs x 4 legs). Per-leg wall median/max and test-step median/max match D7 row for row (e.g. e2e (2) 1353/1498, 1169/1284).
- Imbalance recomputes to 148.75 s, matching D7's 148.8 s. The formula matches the spec's definition (slowest median test step minus mean of medians).
- The after set uses the same shape over the AC's 5 post-merge main runs, and PR runs serve as a predictor only (task 3.4a).
- The 15 s line is reported with its measured value. The 25-run comparison is defined. The same-window control is explicitly declared unavailable, with the reason (count-based `--shard` was removed by HEL-1361).

**Round-1 non-blocking notes: all addressed.**
- D5 now says local `test()` over `node:assert/strict`.
- The `plan` default shares the D3 constant. I confirmed the current `rest[0] ?? 4` at `e2e-shard.mjs:288`.
- Queue delay is recorded (Risks).
- `e2e-slow.yml` paths add `.github/actions/e2e-setup/**`.

**Fresh review:**
- **D3 premise:** `EXPECTED_SHARD_REPORTS = 4` is at `e2e-shard.mjs:169`, and `findReports` calls `validateRunReports` with no override. Without D3, every 6-leg run would be refused. Task 3.1 covers the 6-report default, `--legs 4`, 5-of-6 refused, and default == ci.yml matrix length. The matrix-drift assertion's mutation evidence is in 3.2.
- **D4 premise:** I compared the step lists of ci.yml `e2e` (ci.yml:615-660), `e2e-prod-build` and `e2e-slow.yml` (lines 57-98). They match from checkout through the backend health wait.
  - Only `e2e-prod-build` diverges after that (build + `vite preview`), which `start-dev-frontend: "false"` handles.
  - None of the moved steps uses a step-level `timeout-minutes` or `continue-on-error`, which composite steps restrict.
  - `if: failure()` uploads and `runner.temp` stay in the jobs.
  - ci.yml triggers on every PR to main (no paths filter), so `e2e` and `e2e-prod-build` exercise the action on this PR. The new paths entry makes e2e-slow do the same.
- **Comment sites:** ci.yml:557 (~7 min), ci.yml:560 (at most 4 legs), ci.yml:825 (four shard reports), `playwright.config.ts:169` and `e2e/README.md:113,115` all exist. Tasks 2.2/2.3/2.6 cover them.
- **Projection sanity:** before max test step 1284 s x 4/6 = 856 s, plus ~180 s overhead, gives ~1036 s. That is consistent with D1's ~1030 s and leaves about 165 s margin to the 1200 s AC. The AC is judged only on real main runs (spec delta + Risks).
- **Ticket coverage:**
  - The AC is covered by the D1 matrix change and the D7(a) post-merge measurement. The ADDED requirement mirrors it and forbids a timeout raise.
  - The three HEL-1667 extras map to D5, D4 and D6.
  - Ticket options 1 and 3 are rejected with reasons (D2 `plan 6` balance; login cut changes coverage, an owner call).
  - The driver constraints (no splits, no hel1632/hel1668 touch, weights not hand-edited, CON-260 file list) are carried into C1-C5 and task 3.5.
- **Placeholders/contradictions:** none found. Tasks match the design one-to-one. `actionlint` is not installed here (`which` found none), and D7/3.3 already say "if installed".

### Verdict: CONFIRM

### Non-blocking notes

- The existing `e2e-ci-sharding` "shard balance is measured in CI" requirement still reads as a SHALL: after imbalance at most 15 s, and below a same-window count-based control. That control can no longer exist. With runner-speed spread dominating, the 15 s line is likely to be missed again at 6 legs.
  - D7 reports both honestly. But HEL-1361's owner acceptance applied to HEL-1361. If HEL-1698's after set misses 15 s, the post-merge report should flag that to the owner as a fresh unmet SHALL rather than citing the earlier acceptance as covering it.
  - A future change could add a MODIFIED delta that retires the unobtainable control clause.
- D4 says "Step order and commands are byte-identical". The executor should keep the HEL-1288/HEL-1299 explanatory comments with the steps they describe when moving them into action.yml, and leave the e2e-slow header's "keep the two in step" sentence replaced, not duplicated.
