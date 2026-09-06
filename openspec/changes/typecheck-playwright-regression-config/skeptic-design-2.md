## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **The gap is real.** `e2e/tsconfig.json` include is exactly `["**/*.ts", "../playwright.config.ts"]`.
   A repo-wide grep for `playwright.regression.config` across json/ts/js/yml/sh (excluding node_modules,
   .git) returns exactly **one** hit — a prose comment at `playwright.config.ts:27`. No tsconfig, no npm
   script, no workflow references it. It is type-checked by nothing.
2. **Before state measured.** `npx tsc -p e2e/tsconfig.json --showConfig` resolves 18 entries in `files`;
   `../playwright.config.ts` is present, `../playwright.regression.config.ts` is absent. Confirms task 1.1's
   expected "before".
3. **After state measured (probe, reverted).** Wrote a throwaway `e2e/tsconfig.skeptic-probe.json` identical
   to the real config plus the one include entry; `--showConfig` then lists
   `../playwright.regression.config.ts` in both `files` and `include`. So the proposed one-line change is
   both correct and sufficient — the entry genuinely pulls the file into the resolved input set.
4. **It compiles clean.** `npx tsc --noEmit` against the probe config exits 0, corroborating design's D3
   premise that the newly-covered file lands green without edits. Probe file deleted;
   `git status --porcelain` shows only the untracked change dir.
5. **The gate is real and runs.** `.husky/pre-commit` line 7 runs `npm run check:e2e-types`
   (`tsc --noEmit -p e2e/tsconfig.json`, package.json:28). So the widened scope is enforced every commit.
6. **Evidence plan (task 3.1) is sound, not a green-run-that-measures-nothing.** `--showConfig` reports
   TypeScript's own resolved `files` list — the direct answer to "is this file covered?" — and the design
   (D2) explicitly states that a passing `check:e2e-types` is necessary but not sufficient because it passed
   while the file was uncovered. The before/after pair I reproduced above is exactly the discriminating
   measurement. Task 4.1 additionally guards the archive against the refuted premise.
7. **No artifact restates the refuted premise as real.** ticket.md, proposal.md ("Why"), and design.md each
   mention the original claim only to label it measured-false, with the reproduction command and the
   687-files/0-under-.claude number. Non-goals correctly exclude the root tsconfig change, any guard script,
   any new gate, and filing the root walk as a follow-up — matching the owner's binding rulings.
8. **`skip_specs: true` is right.** The change is a single build-tooling include entry; no capability, API,
   schema, or runtime behaviour changes, so there is no spec delta to write. Inventing a requirement to
   satisfy validation would be worse. Design's Planner Notes state this explicitly, and correctly waive the
   Gate-Chain Implications Checklist (no `.husky/**` change, no new script — only a widened input set).
9. **Constraints respected.** No DB, backend, or dev-server work is planned or was performed by me; no
   `.github/workflows/ci.yml` edit is in scope; live worktrees untouched.

### Verdict: CONFIRM

### Non-blocking notes

- Minor internal wording tension: `ticket.md`'s third AC says the refuted story "is not preserved in the
  archived proposal or design", but `proposal.md`'s Why and `design.md`'s Context both do retain it — as an
  explicitly labelled refutation. That is the more useful outcome (a future reader finds the measurement
  rather than re-deriving it) and does not violate the fourth AC ("does not restate the false premise as
  though it were real"). No revision required; if anything, tighten the third AC's wording at archive time.
- Tasks 1.1/3.1 would be marginally stronger if they recorded the `--showConfig | grep regression.config`
  output verbatim in the execution report, so the before/after pair is legible in the archive rather than
  asserted.
