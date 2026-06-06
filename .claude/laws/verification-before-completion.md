---
name: verification-before-completion
description: Iron Law for completion claims — no claim without fresh verification evidence.
applies_to: linear-executor, linear-evaluator
inspired_by: superpowers/verification-before-completion (https://github.com/obra/superpowers)
note: Inspired by superpowers; rewritten and tuned for Helio. No runtime dependency.
---

# Verification Before Completion

## The Iron Law

**NO COMPLETION CLAIM WITHOUT FRESH VERIFICATION EVIDENCE.**

You may not state that something passes, builds, works, or is done until you have
**run the verifying command fresh, read its full output and exit code, and the
output matches the claim.** Paste the evidence. Assertion is not evidence.

## The gate function (every claim passes through this)

1. **IDENTIFY** the command that verifies the claim.
2. **RUN** it fresh and in full (not from memory of an earlier run).
3. **READ** the complete output and the exit code.
4. **VERIFY** the output actually matches the claim.
5. **ONLY THEN** state the claim — with the output pasted as evidence.

## Helio verification commands

| Claim                   | Required evidence                                                  |
| ----------------------- | ------------------------------------------------------------------ |
| Lint clean              | `npm run lint` output, zero warnings (zero-warnings policy)        |
| Formatting clean        | `npm run format:check` output, exit 0                              |
| Frontend tests pass     | `npm test` output showing zero failures                            |
| Frontend builds         | `npm --prefix frontend run build` output, exit 0                   |
| Backend tests pass      | `cd backend && sbt test` output showing success                    |
| Bug fixed               | the original symptom's test/probe now passing (was failing before) |
| Regression test added   | the test fails before the fix and passes after — show both         |
| Acceptance criteria met | line-by-line checklist against actual observed output              |

Run only the gates for the areas you touched (`git diff --name-only main...HEAD`).

## Evidence rules

- Gate results in your return/handoff must be **pasted command output with exit
  codes**, not prose summaries. "Tests pass" is not evidence; the test runner's
  summary line is.
- Never rely on a sub-agent's _report_ of success — verify independently. (This is
  why the evaluator re-runs gates rather than trusting the executor.)

## Banned hedge language (STOP before using)

"should," "should be fine," "probably," "seems to," "I think it works," and
premature celebration ("Done!", "Perfect!", "All set!") **before** the evidence
exists. Run the command, read the output, then claim — never the reverse.
