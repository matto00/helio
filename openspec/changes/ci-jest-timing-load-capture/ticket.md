# HEL-1601: Capture per-test timing and runner load from a failing frontend CI run to find the ~1 s main-thread stall

## Description

Follow-up from HEL-1596 (PR matto00/helio#1028).

HEL-1596 removed the findBy deadline race in one test, but what stalls the CI runner is still unconfirmed. Locally, 0
of 40 cold-cache `CI=true` runs failed. The full suite took 91 s locally against 219 s on the failing CI run.

The next failing frontend CI run should record per-test durations, for example via jest's `--json` output or a
reporter, together with runner CPU and memory load. That would show whether a ~1 s main-thread stall happens, and
where. Possible approaches: a CI-only reporter artifact, or capturing the data on failure only.

origin_kind: followup
origin_ticket: HEL-1596

## Acceptance Criteria (driver brief, 2026-10-15)

- Frontend CI records per-test durations (with wall-clock start times) and runner CPU/memory load for the `npm test`
  run, and uploads them as an artifact with a deliberately chosen `retention-days`.
- No change to test semantics: worker counts, retries and timeouts are unchanged; `CI=true` resource values stay
  exactly as they are (CLAUDE.md "Local resource caps").
- Local runs (CI unset, capture env unset) are unaffected.
- Added CI time and artifact size are small, and both are measured on the PR's own CI.
- Proof on the PR's own CI: the artifact exists and parses; a 1200 ms main-thread stall injected in a scratch commit
  shows up in the artifact at the right test, and that scratch commit is reverted before merge.
- How to read the artifact is documented in CONTRIBUTING.md (or docs/).
- No new third-party action and no workflow `permissions` change (escalate instead).
