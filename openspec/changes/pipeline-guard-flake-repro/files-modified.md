# Files Modified — HEL-1195

Diff base: `c740775e7b73c51b248619e39967fa710f4c8d4e` (resolved live via
`scripts/concertino/resolve-review-base.sh`, `main`/`origin`).

## Production code

None. This is a test-only fix (Hypothesis 3 confirmed — see `repro-findings.md`);
no production code (`PipelineRunGuardRepository`, `PipelineRunService`, etc.) was
touched.

## Test code

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunGuardIntegrationSpec.scala`
  — root-cause fix for the flake: raised `rateWindowSeconds` from `60` to `3600` in
  all 6 rate-limit tests (an absolute, wall-clock-anchored fixed window at 60s has a
  small but real chance of straddling a once-a-minute boundary between two
  sequential submissions in the same test; 3600s cuts that exposure ~60x). Also
  added a Decision-4 guardrail: `withClue` on the concurrency-cap test's
  admitted/rejected assertions so a future failure self-describes the actual
  observed admitted/rejected counts. A doc comment above the rate-limit `describe`
  block explains the root cause in place. See `repro-findings.md` for the full
  probe-confirmed diagnosis.

## OpenSpec change-dir artifacts (this change's own record)

- `openspec/changes/pipeline-guard-flake-repro/proposal.md` — change proposal.
- `openspec/changes/pipeline-guard-flake-repro/design.md` — design decisions
  (including the Gate-Chain N/A determination — this change never touches
  `.husky/**` or its wired scripts).
- `openspec/changes/pipeline-guard-flake-repro/tasks.md` — task checklist, all
  tasks 1-5 now checked complete with evidence pointers.
- `openspec/changes/pipeline-guard-flake-repro/repro-findings.md` — full
  reproduction, classification, root-cause probe, fix rationale, and task-5
  post-fix verification results (isolation 10x, reproduction re-run 3x, full
  suite once).
- `openspec/changes/pipeline-guard-flake-repro/skeptic-design-1.md`,
  `skeptic-design-2.md` — design-gate skeptic rounds (REFUTE then CONFIRM).
- `openspec/changes/pipeline-guard-flake-repro/ticket.md` — ticket text.
- `openspec/changes/pipeline-guard-flake-repro/.openspec.yaml` — change metadata.
- `openspec/changes/pipeline-guard-flake-repro/repro-evidence/1/TEST-com.helio.services.pipelines.PipelineRunGuardIntegrationSpec.xml`
  — surefire XML for the original task-1.1 reproduced failure.
- `openspec/changes/pipeline-guard-flake-repro/repro-evidence/.task1-main-done`,
  `.task5-2-round{1,2,3}-done` — completion marker files from the reproduction/
  re-verification loop scripts.

Note: `repro-evidence/*.log` (task1, task5-1, task5-2, task5-3 console logs) are
present on disk but gitignored (`*.log` in the repo's `.gitignore`) — they are
local verification artifacts, not part of the tracked diff, consistent with the
prior task-1/task-5.2 logs already on this branch.

## Open question for evaluator/skeptic (not resolved by the executor)

Per explicit driver directive, the trade-off between this statistical mitigation
(60s -> 3600s widening, makes the race ~60x rarer, does not eliminate it) versus a
deterministic clock-injection seam (would eliminate the race entirely but likely
requires a small production-code change, in tension with this ticket's Non-Goals)
is left for the evaluator and final-gate skeptic to rule on next. See
`repro-findings.md`'s "Fix" section for the full justification of the mitigation
as currently implemented.
