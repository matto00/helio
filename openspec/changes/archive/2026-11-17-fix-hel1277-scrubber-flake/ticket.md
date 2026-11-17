# HEL-1729: Flaky e2e: hel1277 output history scrubber expects 2 history points and sees 3 (run at 00:00 UTC)

## Description

`e2e/hel1277-output-history-scrubber.spec.ts:57` failed once in the CI for PR matto00/helio#1129 (HEL-1644,
2026-11-16/17). The history slider expected the value "2" and got "3": one extra history point. A rerun of only that
job passed. PR #1129 does not touch this spec.

The failing run happened at about 00:00 UTC. That timing may matter: history thinning buckets by age
(5 min / 1 h / 1 d), and the scheduler tick could have recorded an extra point across a boundary. Both are
hypotheses only.

## Acceptance criteria

- [ ] The root cause is found from a probe or trace, for example by pinning the clock across the UTC day boundary.
  No retries and no larger timeouts.
- [ ] The failure is shown red first (a forced repro), then the spec passes 40/40 with `--repeat-each`.
- [ ] If the extra point is a real product defect, such as a duplicate history point, it is fixed with a unit test.

## Driver notes (claims to verify, not facts)

- The 00:00 UTC theory is an unevidenced hypothesis. Other candidates: a test race (the spec's own run or a
  scheduled/auto run lands an extra point), history left by a retried step, a duplicate point from a real backend
  path. Four e2e flakes today were the "spec read state before the app settled" shape.
- Get the CI trace/artifact from PR #1129's failing run if still available.
- A real product defect is in scope with a red-first unit test; a fix growing beyond the ticket is escalated.
