# HEL-951: hel813-mobile-touch-target-floor.regression.spec.ts is never run by CI and has rotted

## Description

`.github/workflows/ci.yml` names Playwright specs individually rather than globbing. It invokes exactly two of the fourteen specs in `e2e/` (lines 302 and 304). Every other spec is on disk, looks like coverage in review, and is never executed by CI.

The ticket was filed against `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` specifically, on the belief that it was an unwired orphan that had silently rotted. Planning refuted that belief and the product owner approved a restated scope (see "Restated scope" below). The regression spec is deliberately excluded by three documented layers, because it mutates real component source on disk; the genuine silent-allowlist failure is the eleven ORDINARY specs that have no exclusion mechanism and no stated rationale.

## Restated scope (product-owner approved)

The premise correction and its approval are load-bearing. Scope item 2 as originally filed ("add it to ci.yml alongside its sibling") would have put a job that rewrites tracked source files into CI, and is explicitly NOT to be done.

## Acceptance criteria

1. `e2e/hel813-mobile-touch-target-floor.regression.spec.ts` is NOT wired into CI. All three existing exclusion layers are preserved intact: `playwright.config.ts`'s `testIgnore: ["**/*.regression.spec.ts"]`, the spec's own `test.skip(!process.env.HEL813_REGRESSION, ...)`, and `playwright.regression.config.ts`.
2. `.github/workflows/ci.yml` carries a comment recording that the `*.regression.spec.ts` exclusion is deliberate, naming the on-disk-source-mutation reason, so this ticket is not re-filed.
3. The regression harness's Case B is resolved deliberately: repaired against a genuinely equivalent surviving control, or DELETED. Deletion is the required outcome if no equivalent control survives. Case B is not repaired merely to keep the case count at two.
4. Any assertion repaired under criterion 3 is mutation-proven RED individually — per assertion, not per file — with the transcript captured as evidence.
5. All eleven orphaned specs are executed and their pass/fail/flake status reported. This report is a deliverable in its own right and is produced BEFORE any of them is enabled.
6. `.github/workflows/ci.yml` invokes Playwright by glob (honouring `testIgnore`) rather than by an individual-spec allowlist.
7. Orphans that pass are wired in via that glob. Orphans that are red or flaky are quarantined via `testIgnore`, each quarantine entry carrying a comment naming a filed follow-up ticket. No `testIgnore` entry is left without a ticket reference.
8. Red orphan specs are NOT fixed in this ticket.
9. The glob is proven to fail loudly for a NEW spec: a throwaway always-failing spec is added, the CI-equivalent invocation is shown to pick it up and go RED, and the throwaway is then removed. Evidence captured.
10. The full orphan enumeration (all fourteen specs, and which are wired, globbed, quarantined, or deliberately excluded) is reported.
11. The final globbed suite is executed once AS A SUITE (one process, sequential, shared backend/DB) after wiring and quarantining. Anything red only in the combined run is quarantined with its own ticket. The measured wall-clock is reported.
12. Any Case B replacement control satisfies all four preconditions in design.md D5 — measured by the shipped guard at 430px via `assertFloor`/`sweepSurface`; baseline-green on both axes by measurement; height floor without width floor; floor declared on its own rule rather than inherited from a shared class or token.
13. Any repaired wrong-axis discriminator imports `DEFAULT_MIN_PX`/`RENDERED_BOX_EPSILON_PX` and compares against the epsilon-adjusted floor, never a re-typed `44`.
14. The stale comment at `ci.yml` lines 199-205 is corrected, not merely appended to.
