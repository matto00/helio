## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD `eb3f508f6c5e5203a48062c818a013ed1caf74c6` plus the uncommitted revisions to ticket.md, proposal.md,
design.md, tasks.md and specs/e2e-ci-sharding/spec.md (`git diff --stat`: 5 files, +67/-9).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Round-4 CR1 (tool enforces the success half of the counting rule): resolved.**
  - design.md D9 now says `weights` refuses a runDir without exactly the expected number of reports, "or any report
    whose `stats` is missing or has `unexpected > 0` (naming runDir and shard)".
  - tasks.md 3.3 says the same and adds "selftest cases with demonstrated red".
  - A failed-mid-suite leg's partial report can no longer enter `shard-weights.tsv` silently.
- **Round-4 CR2 (control membership is mechanical, fixed in advance): resolved in intent, but the rule as written is
  not yet well-defined.**
  - ticket.md AC2(c), design.md D8 (Control bullet) and tasks.md 3.4 all now say: ALL counting runs, a `created_at`
    window, backward extension to 5, escalate only below 5, every included and excluded id recorded, no subset
    selection.
  - Two defects in the wording leave room for the after-the-fact choice that CR2 set out to remove. See CR1 and CR2
    below.
- **Round-4 non-blocking notes: all applied.**
  - D8's opening sentence now reads "the first 5 counting CI runs".
  - Task 3.4 confirms that all before-25 runs have 4 JSON artifacts. The earliest before-25 run was created
    2026-10-07T00:28Z, so 14-day retention leaves time.
  - The README note about the SHALL bar is in task 3.4.
- **Fresh review:**
  - Task order 3.1 → 3.4 is coherent.
  - HEL-951 contract items (D2–D4, spec requirement 1) are unchanged and sound.
  - HEL-1368 carries the out-of-scope overhead.
  - The spec's counting definition matches D8 and C4.

#### Ground truth for CR1: run-level `created_at` does not move on rerun

The after set is attempts of ONE run id. D8 says "one at a time: wait for each to finish, then `gh run rerun`".

- `gh api .../actions/runs/37676655366` → `run_attempt=7  created_at=2026-10-07T19:43:35Z
  run_started_at=2026-10-07T21:04:19Z`. The run object's `created_at` stays fixed at attempt 1.
- `gh api .../actions/runs/37676655366/attempts/{1,7}` → per-attempt `created_at` 19:43:35Z and 21:04:20Z. The attempt
  endpoint does move.

So "with `created_at` between the first and last after run" has two readings:

- **Run-level `created_at`:** the window is a single instant and holds zero runs. The rule always falls back to "the 5
  most recent such runs", which are runs BEFORE the after set, not in the same window.
- **Per-attempt `created_at` / `run_started_at`:** the window covers roughly the 1–2 h the after attempts took.

The two readings give different control sets. The executor could pick the reading after seeing both, which is the
selection freedom CR2 was meant to remove.

### Verdict: REFUTE

Round 4's CR1 is fully resolved. CR2 is resolved in spirit, but its mechanical rule has a contradiction (CR2 below) and
an ambiguity grounded in the GitHub API's actual behaviour (CR1 below). Either one lets the control line (c) be moved
after the fact. Both fixes are about one sentence each. They are the last open items. I found nothing else blocking.

### Change Requests

1. **Define the control time window on the timestamps that actually move (ticket.md AC2(c) lines 23-24, design.md D8
   Control bullet lines 83-85, tasks.md 3.4).**
   - Replace "`created_at` between the first and last after run" with a definition keyed to attempts. Suggested: "every
     counting attempt (the run's latest successful attempt, per-attempt `run_started_at`) of a qualifying run on another
     head whose `run_started_at` lies between the first and last after attempt's `run_started_at`; if fewer than 5,
     extend backwards in `run_started_at` order".
   - State which attempt of a multi-attempt control run is measured. Suggested: the first attempt that meets the
     counting rule. Otherwise a run whose attempt 1 failed and attempt 2 passed is ambiguous too.
   - Name the API field explicitly, so the rule cannot be read two ways.
2. **Fix the contradiction in which commit the control heads must contain (design.md D8 line 83, tasks.md 3.4 "the
   merge commit").**
   - D8 says "other heads that contain the task-3.1 merge commit". That merge commit exists only on this branch, so no
     other head contains it. Read literally, the control is always empty and the plan always escalates.
   - ticket.md says "contain the origin/main commit merged into this branch", which is the intended and satisfiable
     meaning.
   - Make D8 and task 3.4 say the same thing: the origin/main commit merged in task 3.1, i.e. the merge's second
     parent, with its SHA recorded in profile.md.

### Non-blocking notes

- D9's refusal covers `unexpected > 0` but not `flaky > 0`. A flaky test's retry durations would inflate a file's
  summed weight. Consider also refusing `flaky > 0`, or summing only the final attempt's duration per test. Whichever
  you choose, state it in D5.
- Task 3.4 should record the control's SHA test ("contains the commit" via `git merge-base --is-ancestor`, or the
  compare API) so profile.md shows how each control head's inclusion was decided.
