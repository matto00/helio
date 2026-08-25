## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Read fresh from ground truth: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
`specs/mobile-touch-target-verification/spec.md`, plus `DESIGN.md`, `.github/workflows/ci.yml`,
`playwright.config.ts`, `frontend/src/features/panels/ui/PanelList.css`,
`frontend/src/features/settings/ui/PreferencesEditor.tsx`.

**Round-1 change requests — status:**

| CR | Status | Evidence |
|---|---|---|
| 1. `sweepSurface` exemption contract | RESOLVED | design.md D2 now specifies `sweepSurface(page, { selectors, exempt = [] })` with `{ selector, reason, ticket? }`; exempt matches are logged, asserted-to-exist, and explicitly "not counted toward, and cannot on their own satisfy, the non-zero visible-floored-match requirement — a surface consisting only of exempt matches still fails." Mirrored in spec Req "Discriminates floored from intentionally-unfloored controls", task 1.1, task 2.5 and task 5.2 (D4's color swatch now flows through the same mechanism). |
| 2. Task 4.2 must verify CI for real | RESOLVED | tasks.md 4.2 now requires pushing the branch, opening/using the PR, and capturing actual `gh pr checks` / `gh run view` output for the new `e2e` job, and explicitly says a YAML-validity review is not evidence. Confirmed observable: `ci.yml:11` triggers on `pull_request: branches: [main]`, and the change touches non-`paths-ignore`d files (`.github/workflows/ci.yml`, `e2e/**.ts`, `playwright.config.ts`), so the job will fire on the PR. |
| 3. Regression harness excluded from default run | RESOLVED (both layers) | design.md D1 "Regression harness isolation" + task 4.3 add `testIgnore: ["**/*.regression.spec.ts"]`, and task 3.1 additionally gates every test on `test.skip(!process.env.HEL813_REGRESSION, ...)`. Confirmed current `playwright.config.ts` has `testDir: "./e2e"` and no `testIgnore`, so the fix is load-bearing. |
| 4. proposal.md must stop claiming an existing CI Playwright job | **NOT RESOLVED** | The Impact section was corrected (proposal.md:49-51 now says "no Playwright job exists in `.github/workflows/ci.yml` today. This change adds a new `e2e` job scoped to the one new guard spec"). But the *same falsehood survives verbatim* in "What Changes", proposal.md:23: "Wired into the existing CI Playwright job." Verified false: `grep -n "^  [a-zA-Z_-]*:" .github/workflows/ci.yml` returns only `frontend:` (23) and `backend:` (41). The proposal now contradicts itself 26 lines apart, and contradicts design.md D5. See CR1 below. |
| 5. No-vacuous-pass vs. expected-hidden surface 6 | RESOLVED | design.md D2 adds `assertHiddenAtWidth` ("Distinct from, and never satisfies, `sweepSurface`'s non-zero visible-match requirement"); D3 surface 6 and task 2.2 pair it with a `.panel-list__add` `sweepSurface` assertion; spec Req "No vacuous pass" gains a dedicated scenario for exactly this coexistence. Verified against real CSS: `PanelList.css:176-178` floors `.panel-list__add` to `min-height: 44px` inside `@media (max-width: 768px)` (so it *is* a real visible floored match at 430px), and `PanelList.css:~196-200` hides `.panel-list__zoom-widget` via `display: none` inside `@media (max-width: 430px)`. The plan's factual premise holds. |
| 6. Task 1.2 non-task | RESOLVED | Section 1 of tasks.md now contains only 1.1; no jsdom-skip checkbox remains. |
| 7. Green-before/red-after pairing | RESOLVED | design.md D1 "Green-before/red-after pairing" requires three measurements of the same control via the same helper; tasks 3.1 and 3.2 each spell out baseline PASS → mutate → FAIL → revert → PASS, and 3.3 requires the captured output to show "both cases' full pass/fail/pass sequences" plus a clean `git status --short`. |

**Original binding constraints re-checked against the revised plan:** all still hold — not a
`*.css.test.ts` text match (spec Req 1 forbids it); rendered `getBoundingClientRect()` on both axes at
430/768 (D1/D2, spec Req 2); RED against both the inert-`@media` and height-only-on-fixed-width shapes
(tasks 3.1/3.2, now with baselines); fail-on-zero-visible-match (spec Req 3, D2); discriminating
unfloored control (D4, grounded — `input[type="color"]` confirmed at
`frontend/src/features/settings/ui/PreferencesEditor.tsx:204,237,249`); `::after` bisection with the
`>= 44 - samplingStep` epsilon, now asserted *inside* `bisectHitExtent` so no call site can reintroduce
a literal `>= 44` (my round-1 non-blocking note, adopted); surfaces enumerated with three named
exclusions (D3); allowlist-with-ticket for new violations (tasks 5.1-5.3, spec Req 4). Nothing in the
revision broke a previously-met constraint.

### Verdict: REFUTE

Six of seven change requests are genuinely and well resolved — the exemption contract, the
hidden-vs-swept separation, and the three-point RED pairing are all real mechanism, not gestures, and
each is reflected in design.md, tasks.md *and* the spec deltas consistently. CR4 was only half-fixed:
the false CI claim was corrected where I quoted it and left standing where I did not. On a ticket whose
entire subject is verification claims that were not true, shipping a proposal that asserts the change
is "wired into the existing CI Playwright job" — when no such job exists, and this change's own Impact
section says so — is not a typo I am willing to wave through into the archived spec and the PR body.
It is a one-line fix.

### Change Requests

1. **proposal.md:23 still states the falsehood CR4 asked to remove.** The "What Changes" bullet reads
   "Wired into the existing CI Playwright job." No Playwright/e2e job exists in
   `.github/workflows/ci.yml` (only `frontend:` and `backend:`), design.md D5 adds a *new* `e2e` job,
   and proposal.md:49-51 already says exactly that. Rewrite the bullet to match D5 and the corrected
   Impact section — e.g. "Adds a new `e2e` job to `.github/workflows/ci.yml` (none exists today) that
   runs this one guard spec against a full-stack postgres + backend + Vite environment." Re-scan the
   proposal for any other surviving instance of the same claim before resubmitting.

### Non-blocking notes

- **Task ordering:** task 4.3 (add `testIgnore`) lands after section 3, which runs the source-mutating
  harness. The `test.skip(!process.env.HEL813_REGRESSION)` guard makes this safe in practice, but
  moving 4.3 ahead of 3.1 would remove the window entirely.
- **Section citations drift.** proposal.md says "DESIGN.md §5/§8", design.md says "§5", the ticket says
  "§8". The 44px floor and the `::after`/bisection clause actually live at `DESIGN.md:200-224`, i.e.
  under §3 ("Tokens are the source of truth", starting at line 82), not §5 (Buttons, 273) or §8
  (Accessibility baseline, 378). The substance is quoted faithfully in all three; only the pointer is
  wrong. Worth fixing once so the executor doesn't read the wrong section.
- **Per-surface routes still unrecorded** (repeat of round 1's note 3). D3 names surfaces 1-5 by
  incident ticket and class family but not by the concrete route the spec navigates to. Surface 6 is
  now grounded to real selectors and is much more auditable as a result; the same treatment for 1-5
  would make coverage checkable at the final gate rather than inferable.
- D5's `postgres:16` choice remains correct (matches prod); dev is 18. Don't let a version-sensitive
  CI failure be misdiagnosed as a guard defect.
