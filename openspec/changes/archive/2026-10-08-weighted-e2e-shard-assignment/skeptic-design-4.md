## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD `eb3f508f6c5e5203a48062c818a013ed1caf74c6` plus the uncommitted revisions to ticket.md, proposal.md,
design.md (D8, D9), tasks.md (C3/C4, group 3) and specs/e2e-ci-sharding/spec.md (`git diff --stat`: 5 files, +62/-8).

### What I verified (with evidence)

- **Spawn-cwd guard:** `READY ambient=/home/matt/Development/helio branch=task/rebalance-e2e-shard-weights/HEL-1361`.
- **Owner ruling still real:** `/home/matt/Development/helio/.concertino/runs/HEL-1361/events.jsonl:17`,
  `escalation.answered`, `answer:"ship-restated"`, `answer_source:"human"`.
- **Round-3 CR1 (counting rule enforced by tool), partly resolved.**
  - The rule is stated consistently in ticket.md AC2, D8 (Counting rule bullet), C4 and the spec scenario "An incomplete
    run is excluded".
  - The tool enforcement planned in D9 and task 3.3 is a report-COUNT check only: `weights` refuses a runDir that lacks
    exactly 4 reports.
  - That catches a hung leg, which uploads no artifact. It does not catch a leg that failed mid-suite. `ci.yml:586-593`
    uploads with `if: always()`, so a failed leg still produces 4 reports, one of them partial with timeout-inflated
    durations, and the count check passes.
  - Round 3 named exactly this case: "a failed mid-suite (a partial report with timeout-inflated durations) is accepted
    silently".
  - The reports carry what a tool would need. `jq .stats` on the four attempt-7 reports shows
    `{"expected":31|32|64|55,"unexpected":0,"flaky":0,...}`, so refusing `unexpected > 0` is a one-line check.
  - Task 3.3's verify step ("every discovered spec has a row") does not take up round 3's alternative either: it never
    states that each runDir held 4 reports from one all-success attempt.
  - The success half of the rule is still prose only. See CR1 below.
- **Round-3 CR2 (content authentication), resolved.** D9 and task 3.3 record each report's `stats.startTime` beside the
  jobs-API `Run e2e` `started_at` and require them to agree within the ~5 s `--list` lead. That is self-authenticating,
  with no download-order or mtime reasoning. Task 3.2 now cites the four attempt-7 `startTime`s, which match the
  artifacts (21:07:33 / 21:14:08 / 21:07:16 / 21:07:43Z, re-read from `scratchpad/after/*/results.json`).
- **Round-3 CR3 (fixed after set, no bar-chasing), resolved.**
  - "FIRST 5 counting runs of the regenerated-table head, in order. No extra runs added or substituted", with
    report-and-escalate on any failed line. This appears in ticket.md, D8, C4 and task 3.4.
  - The D9 regeneration set is likewise "the first 5 COUNTING attempts".
- **Round-3 CR4 (control as a defined pass/fail line), resolved in substance but under-specified in selection.**
  - Already in place:
    - (c) is an explicit pass/fail line in ticket.md, D8 and task 3.4.
    - The control requires heads containing the task-3.1 merge commit and count-based `--shard`, with the same estimator
      and counting rule.
    - If fewer than 5 runs exist, the plan escalates. If (a) and (b) pass but (c) fails, profile.md says the improvement
      is not distinguishable from old sharding.
  - Gap: WHICH runs make up the control is not fixed. The text says ">= 5 counting runs ... in the same calendar window".
    "Same calendar window" has no bounds, and nothing says to take all qualifying runs or a predefined subset.
  - Why it matters: round 3's leave-one-out on 5 runs swung the imbalance from 3 to 21 s. Choosing which >= 5 runs form
    the control moves line (c) the way choosing after runs would have moved (a). CR3 closed that hole for the after set
    but not for the control set. See CR2 below.
- **Round-3 CR5 (spec alignment), resolved.** The spec requirement and scenario now name the 25-run before, the 15 s
  ceiling and the same-window control, matching ticket.md and D8. D8 marks before-5 (42.5 s) as history only.
- **The before-25 baseline can meet the spec's counting definition.**
  - Its 100 rows in `scratchpad/before_api.tsv` (25 runs) all conclude `success`.
  - The first and last runs (37552111090, created 2026-10-07T00:28Z; 37672748835, created 19:12Z) both still have all 4
    `playwright-json-shard-N` artifacts unexpired (`gh api .../artifacts`, `retention-days: 14`).
  - So "25 most recent counting runs" is attainable, provided the executor confirms artifacts for all 25 (see the note
    below).
- **Fresh review: no new contradictions** between ticket.md, D8/D9, the tasks and the spec, apart from the D8 wording
  note below. HEL-1368 still carries the overhead and install work. Task order 3.1 → 3.4 is coherent.

### Verdict: REFUTE

Three of the five round-3 items are fully resolved, and the plan is close. Two holes remain, and both let a dishonest or
careless measurement satisfy every artifact as written, which is exactly what round 3 set out to close:

- A failed-leg run can feed the weight table, because the tool checks only the report count.
- The control set can be chosen after the fact.

Each needs about one sentence of plan text plus one small tool check.

### Change Requests

1. **Make the tool enforce the success half of the counting rule as well as the count (design.md D9, task 3.3).**
   - Extend the planned `weights` hardening to also refuse, naming the runDir and shard, any report whose `stats` is
     missing or has `unexpected > 0`.
   - Add a selftest case for it, with a demonstrated-red check.
   - Alternative: task 3.3's verify step records, for each of the 5 runDirs, the run id/attempt and all 4 jobs-API
     `e2e (N)` conclusions = `success`.
   - Either way, a partial report from a failed leg must not be able to enter `shard-weights.tsv` silently.
2. **Fix the control set's membership before measuring (ticket.md AC2(c), design.md D8 Control bullet, task 3.4).**
   - Replace "in the same calendar window" with a mechanical rule. Suggested: the control is ALL counting `ci.yml` runs on
     other heads that contain the task-3.1 merge commit and still use `--shard`, with `created_at` between the first and
     last after run.
   - If that is fewer than 5, extend backwards in `created_at` order to the 5 most recent such runs. Escalate only if
     fewer than 5 exist at all.
   - Record every included and excluded run id in profile.md.
   - No subset selection.

### Non-blocking notes

- D8's opening sentence still says "After = >= 5 sequential CI runs of the PR head", while the Fixed-after-set bullet,
  C4 and task 3.4 say "the FIRST 5". Change the first sentence to "the first 5 counting runs" so ">= 5" cannot be read as
  permission to add runs.
- When writing before-25 into profile.md, confirm and state that all 25 runs have all 4 JSON artifacts. I checked only the
  first and last, and retention is 14 days, so do it soon. That makes "25 most recent counting runs" literally true under
  the spec's definition.
- The spec makes "<= 15 s and lower than the before" a SHALL for any future change to shard assignment. That is
  acceptable for this durable capability, but a future weight regeneration will have to meet it. Worth one line in e2e/README.md's
  regeneration section.
- C4 is listed above C3 in tasks.md's Standing Constraints. This is cosmetic.
