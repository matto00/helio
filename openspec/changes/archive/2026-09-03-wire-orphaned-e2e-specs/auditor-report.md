## Auditor Report

### Condition 1-3 (check-merge-readiness.sh)
- FAIL CI failed: label-update-type

This is the known HEL-959 false-positive: `label-update-type` is a Dependabot-only
workflow whose designed outcome for every non-Dependabot PR is `SKIPPED` (see
`.github/workflows/dependabot-metadata.yml`). `check-merge-readiness.sh` treats
`SKIPPED` as a failure. Confirmed via `gh pr checks 539`: the check shows
`label-update-type  skipping`, not a real failure. This is a script defect, not a
merge-condition defect, and is explicitly out of scope to hand-fix here (fix lives
in the Concertino repo, needs product-owner approval; scripts/concertino/ is a
render target).

Independently verified via `gh pr view 539`: `mergeable: MERGEABLE`. However
`mergeStateStatus: BLOCKED` and all substantive checks (Analyze x3, CodeQL,
backend, e2e, frontend, security) were still `pending` at time of audit — real CI
has not finished running, separate from the label-update-type false-positive.

### Condition 4 (acceptance criteria, traced cold)
Judged against the archived `openspec/changes/archive/2026-09-03-wire-orphaned-e2e-specs/ticket.md`
(restated, product-owner-approved scope), not the original Linear text.

1. MET — `playwright.config.ts` `testIgnore` still leads with `**/*.regression.spec.ts`;
   the spec's own `test.skip(!process.env.HEL813_REGRESSION, ...)` and
   `playwright.regression.config.ts` are both unchanged in shape.
2. MET — `.github/workflows/ci.yml` lines ~199-221 carry a rewritten, explicit
   comment naming the on-disk-source-mutation reason and pointing at the change dir.
3-4. Not independently re-derived here — traced and mutation-proven by
   `casea-marker-repair-and-mutation-proof.md` / `caseb-search-and-mutation-proof.md`,
   confirmed fresh by the final-gate skeptic twice (skeptic-final-1.md, skeptic-final-2.md).
5. MET — `orphan-status-report.md` present, dated before the wiring commit in the
   change's task sequence.
6. MET — `ci.yml`'s `e2e` job now runs `npx playwright test` (glob), not an
   individual-spec allowlist.
7. MET — `playwright.config.ts` `testIgnore` carries exactly 4 quarantine entries
   (hel665, hel666, hel716, hel908, hel909 — 5 files across 4 quarantine blocks),
   each with a named follow-up ticket (HEL-960, HEL-960, HEL-961, HEL-962, HEL-963).
8. MET — none of the quarantined specs were repaired; diff only touches the
   regression spec's own anchors (Case A/B), not the orphans.
9. Not independently re-derived here — `glob-proof-transcript.log` present;
   corroborated by skeptic-final-1.md's own reproduction (worked file collected
   exactly 8 files).
10. MET — `orphan-status-report.md` covers all 14 specs' disposition.
11. MET — `final-whole-suite-run.log` / `final-whole-suite-run-cycle2.log` present,
   run as a suite.
12-13. Not independently re-derived here — scoped to Case B's `assertFloor`/
   `sweepSurface` usage in the regression spec's diff; traced by both final-gate
   skeptic passes.
14. MET — confirmed directly: the old comment block at the old line numbers is
   gone, replaced wholesale (not appended to) with a new explanation of the glob +
   exclusion design.

Both required run-history gates independently confirmed from artifacts (not taken
on report): evaluator PASS in `evaluation-2.md` ("Overall: PASS"), final-gate
skeptic CONFIRM x2 in `skeptic-final-1.md` and `skeptic-final-2.md` (second round
triggered by a real regression-config defect found and then fixed, matching the
71e47638 commit named in the task brief). `workflow-state.md` corroborates
(SKEPTIC_CYCLE: 2, PENDING_ESCALATION: answered/proceed-with-restated-scope).

No defect found in either of the two called-out anti-goals: the regression spec
remains excluded from CI on all three layers (correct, per AC1), and the eleven
non-regression orphans are quarantined rather than fixed, each with a named
follow-up ticket (correct, per AC8).

### Verdict: ESCALATE

### Reason
`check-merge-readiness.sh` fails closed on `label-update-type=SKIPPED` — filed as
HEL-959, a known script defect (Dependabot-only check's designed no-op outcome for
every non-Dependabot PR, misread as a CI failure), not a real merge-condition
failure. Fix lives in the Concertino repo and needs product-owner approval;
`scripts/concertino/` is a render target and was not hand-edited.

Separately, and independent of the HEL-959 false-positive: at the time of this
audit `gh pr view 539` reports `mergeStateStatus: BLOCKED` with the substantive
checks (Analyze x3, CodeQL, backend, e2e, frontend, security) still `pending` —
real CI has not yet finished. A human should confirm those checks land green
before a manual squash merge.

Acceptance criteria (condition 4) are otherwise satisfied; nothing here blocks a
human-authorized manual `gh pr merge 539 --squash` once CI is confirmed green.
