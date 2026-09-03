## Context

`e2e/` holds 14 Playwright specs. `.github/workflows/ci.yml` runs two of them by name (lines 302, 304). No other workflow and no npm script invokes Playwright in CI (`package.json`'s `e2e` script is `playwright test`, but nothing in CI calls it). Twelve specs are therefore never executed by CI.

One of those twelve is excluded deliberately and correctly; eleven are not. Telling those two groups apart is the whole design problem, and getting it wrong in either direction is costly: force-running the deliberate exclusion puts a source-mutating job into CI, while leaving the eleven unexamined preserves the bug.

## Goals

- CI spec selection fails LOUDLY for a new spec, not silently.
- Every exclusion is explicit, greppable, and carries a stated reason.
- No exclusion can become a silent allowlist again — a quarantine without a ticket is the same bug.
- The deliberate `*.regression.spec.ts` exclusion survives this change and is documented where the next person will look.

## Non-Goals

- **Fixing red orphan specs.** Explicitly out of scope, product-owner directed. A spec that has never run in CI failing is new information. Fixing an unknown number of unknown failures inside a ticket about wiring is how a clean change ends badly.
- **Making the regression harness run in CI.** Anti-goal, not merely a non-goal.
- Reworking `touchTargetProbe.ts` or the steady-state guard's surfaces.
- Reducing CI wall-clock. Running the coverage costs time; that is the point.

## Decisions

### D1 — Glob with `testIgnore` exclusions, not an allowlist

`ci.yml` invokes `npx playwright test` with no per-file arguments. Discovery is then governed by `playwright.config.ts` (`testDir: "./e2e"`, `testIgnore`).

Rationale: the failure mode of an allowlist is silence (a new spec is skipped and nothing says so); the failure mode of a glob is noise (a new spec runs and may go red, loudly). For a repo that has now found eleven blind gates, prefer the mode that fails loudly.

This also unifies CI with a bare `npm run e2e`, so a developer running locally exercises the same set CI does — today they do not, and that divergence is itself part of why the orphans went unnoticed.

Rejected: keeping the allowlist and adding a "spec is listed in ci.yml" lint. That is a second mechanism guarding the first, and the guard would itself need a guard. The glob removes the failure rather than detecting it.

### D2 — `testIgnore` is the single exclusion register, and every entry names a reason

Two entry classes, both requiring a comment:

- **Permanent/by-design** — `**/*.regression.spec.ts`. Comment states the on-disk source-mutation reason.
- **Quarantine** — a spec red or flaky as of this change. Comment MUST name the follow-up ticket that will remove the entry.

A quarantine entry without a ticket reference is prohibited. Without that rule, `testIgnore` degrades into precisely the silent allowlist `ci.yml` currently is, and the change would have moved the bug rather than fixed it.

### D3 — Measure before enabling

The eleven orphans are executed and their status reported to the product owner as a deliverable, before any is enabled. Enabling first and discovering redness in CI would conflate "this change broke CI" with "this spec was already broken," and the second is the more important fact.

The report distinguishes pass / fail / flake, and for each failure states the observed error — enough for a follow-up ticket to be filed without re-running.

Flake determination: a spec that does not produce the same verdict across repeated runs is flaky and is quarantined. `playwright.config.ts` sets `retries: 0` and `fullyParallel: false`, so a single run is a single sample; a spec passing once is not thereby proven stable, and this design does not claim otherwise. Quarantining on observed instability is the conservative direction, consistent with D2's requirement that every quarantine carry a ticket.

### D4 — Prove the glob fails loudly (mutation-test the fix, not just the bug)

A throwaway always-failing spec is added under `e2e/`, the CI-equivalent invocation is run, the run is shown to pick the new file up and go RED, and the throwaway is then removed.

This is the standing evidence bar applied to the fix itself. Without it, the change asserts "a glob catches new specs" on reasoning alone — and the specific thing being replaced is a mechanism everyone assumed worked. The proof must show the NEW file being collected, not merely that the suite can go red.

The throwaway must not be committed. Its transcript is the artifact.

### D5 — Regression harness Case B: repair against an equivalent control, or delete

Case B's anchor `.panel-list__add` is gone from `frontend/src`. The steady-state sibling's own surface-6 comment records that the panel-list header bar was removed and that "Add panel" moved to the command bar's `.actions-menu__trigger`.

Case B exists to catch ONE specific failure mode: a height-only floor on a control that also carries a fixed sub-44px width — HEL-781's wrong-axis bug. A replacement control must satisfy ALL FOUR of the following preconditions. Any candidate failing one is disqualified, and if no candidate satisfies all four, Case B is DELETED under 6.3.

- **P1 — measured by the shipped guard.** The candidate MUST be a selector currently measured by a surface in `e2e/hel813-mobile-touch-target-floor.spec.ts` at 430px via `assertFloor`/`sweepSurface` — NOT `assertExpanderFloor`, NOT `assertHiddenAtWidth`. This is the precondition whose absence would let a tautology through: the old anchor was surface 6's own measured anchor, and demonstrating that the *helper* is width-sensitive on a control that no shipped guard covers certifies nothing about the guard. Sensitivity must be shown on a control the guard actually watches.
- **P2 — baseline green, measured not reasoned.** The candidate must be MEASURED to satisfy `assertFloor` on BOTH axes, unmutated, at 430px, and that measurement recorded in the report. Case B's contract is PASS(baseline) → FAIL(mutated) → PASS(reverted); a control that already renders sub-44px wide would make the mutated red vacuous and unattributable to the mutation.
- **P3 — height floor, no width floor.** Determined by runtime measurement / computed style at 430px, per D6's mechanism constraint.
- **P4 — the floor is declared on the candidate's OWN rule.** A height floor inherited from a shared class or a `--control-*`/`--space-*` token does NOT qualify: the harness's mutation would then alter other controls' rendering, so the observed red could not be attributed to this control. The mutation must be confined to the candidate's own rule.

Controls that reach the floor via an `::after` hit expander are excluded by P1 and independently by P3. Their painted box is deliberately compact and `assertFloor` does not govern them; mutating their width would not exercise the wrong-axis mode Case B was written to protect. The steady-state sibling moved most controls to that mechanism, which is precisely why a survivor is not guaranteed.

If no control satisfies all four, Case B is DELETED, `e2e/README.md` updated to describe a one-case harness, and the deletion stated plainly in the PR body. Deleting is the correct outcome here. Repairing the assertion to match whatever markup exists today would convert a guard into a tautology — it would pass, look like protection, and catch nothing, which is the exact disease this ticket is about. Case count is not a goal.

**Epsilon, not the bare literal.** Case B today asserts `expect(mutatedBox.height).toBeGreaterThanOrEqual(44)` as its wrong-axis discriminator, while `assertFloor` passes at `DEFAULT_MIN_PX - RENDERED_BOX_EPSILON_PX` (43.25). A replacement control legitimately measuring e.g. 43.6 — a documented, expected sub-pixel outcome per `RENDERED_BOX_EPSILON_PX`'s own 120-sample HEL-818/HEL-935 evidence — would make a repaired harness spuriously RED on the very axis that is supposed to stay clear. Any repaired discriminator MUST import `DEFAULT_MIN_PX` and `RENDERED_BOX_EPSILON_PX` from `e2e/support/touchTargetProbe.ts` and compute the floor, never re-type `44`.

### D6 — Per-assertion mutation proof, and search by property not by string

Any assertion repaired under D5 is proven red individually. A case that mutates two things at once and observes one red proves neither leg: a conjunction guarded as a unit guards neither conjunct. Each repaired assertion gets its own mutation, its own observed red, and its own captured transcript.

**Candidate search is by runtime property, never by string search.** Grepping `min-height: 44px` structurally cannot see a height floor reached via `height`, via a `--control-*`/`--space-*` token, via padding plus line-height, or via a shared class declared in another file — an audit keyed on one spelling cannot see sites reaching the property another way. The search therefore enumerates the steady-state spec's measured selectors (P1's candidate set is finite and small) and determines P2/P3/P4 by runtime measurement and computed style at 430px.

### D7 — The final globbed suite is run as a suite, not inferred from individual runs

Eleven specs each passing alone does not compose to "the suite passes". The glob runs them in ONE Playwright process with `fullyParallel: false`, `retries: 0`, a single worker, sequentially, against a shared dev backend and a shared Postgres that accumulates registered users, dashboards, pipelines and toasts across specs. Cross-spec interference — an accumulated-state assumption, a leaked viewport, a toast still on screen — is invisible to individual runs by construction.

So after wiring (task 3) and quarantining (task 4), the exact committed glob invocation is run once as a whole suite. Anything red ONLY in the combined run is quarantined with its own ticket, exactly as an individually-red spec would be. The wall-clock from that run is the number reported against the Risks section, rather than an estimate.

## Risks

- **CI wall-clock and cost.** The `e2e` job goes from 2 specs to up to 12. Accepted; measured and reported so the number is known rather than discovered.
- **Newly-enabled specs prove flaky under CI's different timing.** Only local evidence is available before merge; CI is a different machine. Mitigated by D2 (quarantine is cheap and greppable) and by D3's conservative flake handling, but not eliminated — a spec green locally and flaky in CI is a real residual risk of this change, and the honest mitigation is that unquarantining is a one-line revert.
- **Cross-spec interference in the combined suite.** Addressed by D7's whole-suite run, which is the only evidence that composes. Residual risk remains that CI's timing differs from local; mitigated by cheap, greppable quarantine.
- **Quarantining many specs makes the glob cosmetic.** If most orphans are red, `testIgnore` ends up listing most of `e2e/` and CI's real coverage barely rises. That would still be an improvement — the exclusions become explicit and ticketed rather than invisible — but the report from D3 should say so plainly rather than let the glob imply coverage it does not deliver.

## Migration

None. No data, no schema, no API. Reverting is a one-line change to `ci.yml`.
