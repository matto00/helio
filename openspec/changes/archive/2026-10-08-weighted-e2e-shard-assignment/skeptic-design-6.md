## Skeptic Report — design gate (round 6, skeptic-design-6.md)

Reviewed HEAD `eb3f508f6c5e5203a48062c818a013ed1caf74c6` plus uncommitted artifact revisions (`git diff --stat`: design.md,
proposal.md, spec.md, tasks.md, ticket.md; +71/-10).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Round 6 is authorized:** `.concertino/runs/HEL-1361/events.jsonl` line 23 has `escalation.answered`
  `answer":"extra-round"`, `answer_source":"human"` for escalation `HEL-1361-1791415389614-9180a1`.
- **Round-5 CR1 (time window on per-attempt timestamps; which attempt counts): resolved.**
  - ticket.md AC2(c): "first counting attempt of each run ... whose `run_started_at` falls between the first and last
    after attempt's `run_started_at`, extended back to 5".
  - design.md D8 Control: "Each qualifying run contributes its FIRST attempt that meets the counting rule, timed by
    that attempt's `run_started_at` (GitHub API `actions/runs/<id>/attempts/<n>`)".
  - tasks.md 3.4 says the same.
  - Ground truth: `gh api .../actions/runs/37676655366/attempts/2` returns `run_started_at=2026-10-07T20:03:53Z`. The
    attempt endpoint does expose that field per attempt, so the rule can be computed as written. The window is now
    well-defined and unambiguous.
- **Round-5 CR2 (which commit the control heads must contain): resolved.**
  - D8: "contain the origin/main commit merged in task 3.1 (the merge's second parent; SHA recorded in profile.md;
    inclusion decided per head by `git merge-base --is-ancestor`, recorded)".
  - ticket.md AC2(c) ("containing the merged origin/main commit") and tasks.md 3.4 ("merge's 2nd parent ... each
    head's merge-base --is-ancestor result") agree.
  - The contradiction is gone and the rule can be satisfied.
- **Round-5 non-blocking notes: applied.**
  - D5 now refuses `flaky > 0` and notes `retries: 0`.
  - Task 3.3 has the flaky refusal with selftest red.
  - Task 3.4 records the inclusion test.
- **Fresh review of the whole plan:**
  - No TODO/TBD (grep: zero hits).
  - Every AC is covered by tasks:
    - AC1: done, profile/premise.
    - AC2: tasks 3.3/3.4 + spec requirement 3.
    - AC3: tasks 2.4/3.4.
    - AC4: D2–D4, task 2.3/3.1 + spec requirement 1.
  - The spec's counting rule and bar match ticket AC2, D8 and C4.
  - Task order 3.1 → 3.4 is coherent:
    - The merge comes first.
    - Weights are regenerated from merged-head attempts, with each report authenticated by `stats.startTime`.
    - The after set is measured on the regenerated head.
  - The out-of-scope overhead is carried by HEL-1368.

### Verdict: CONFIRM

### Non-blocking notes

- **Before-25 value is stated two ways.** ticket.md says 25.5 s and D8 says "~26 s". profile.md should use the exact
  number (25.5 s) for line (b).
- **Control head_sha vs merge ref.** For `pull_request` runs, decide inclusion on the run's `head_sha` with
  `--is-ancestor`, and fetch PR heads as needed (`git fetch origin pull/N/head`). State which SHA was tested, so a PR
  whose merge ref contains the commit but whose branch head does not is handled consistently.
- **Old attempts' artifacts may be gone.** For a multi-attempt control run, an earlier attempt's JSON artifacts may no
  longer be downloadable once a later attempt exists. The counting rule then deterministically skips that attempt.
  Record such skips explicitly in profile.md rather than silently.
