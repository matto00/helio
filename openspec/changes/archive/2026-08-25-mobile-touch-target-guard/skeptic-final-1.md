## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Derived cold from the diff, the running app, and live CI. The executor's and
evaluator's reports were treated as claims; every load-bearing claim below was
re-derived by my own run.

### What I verified (with evidence)

**1. Diff is what it claims to be.** `git diff --stat cc0cfe16..HEAD`: 20 files,
1628 insertions, 0 deletions. No production `frontend/` source or CSS is touched
by the shipped change — the only mutations of real component source live inside
the opt-in regression harness and are self-reverting.

**2. AC1 — rendered geometry, both axes, 430px and 768px, not stylesheet text.**
`e2e/support/touchTargetProbe.ts` `measureBox`/`assertFloor` read
`locator.boundingBox()` (i.e. `getBoundingClientRect()`) and assert height AND
width `>= 44`. No `getComputedStyle` and no CSS-source text-matching anywhere in
the new files. `WIDTHS = [430, 768]` drives a full `test.describe` per width;
CI log shows all 12 (6 surfaces x 2 widths) executing.

**3. AC2 — demonstrated RED on HEL-535's above-base-rule `@media` inert floor.**
I ran the harness myself (not the captured file):
`DEV_PORT=6245 HEL813_REGRESSION=1 npx playwright test --config=playwright.regression.config.ts e2e/hel813-mobile-touch-target-floor.regression.spec.ts`
```
[hel813-regression][Case A][baseline PASS] {"width":44,"height":44,"visible":true}
[hel813-regression][Case A][mutated FAIL] box={"width":20,"height":20,"visible":true} threw=true
[hel813-regression][Case A][reverted PASS] {"width":44,"height":44,"visible":true}
```
The mutation is a genuine reproduction of the HEL-535 shape: it *moves* the
existing `@media` block above the base rule without editing a single
declaration, so the `44px` strings remain in the file verbatim — exactly the
case a text-matching test passes and this guard fails. Confirmed the real
`frontend/src/shared/ui/toast.css` currently carries that media block *after*
the base rule (lines 158-180), and the harness hard-errors if that ordering ever
drifts.

**4. AC3 — demonstrated RED on a height-only floor with a fixed sub-44px width.**
Same run:
```
[hel813-regression][Case B][baseline PASS] {"width":103,"height":44,"visible":true}
[hel813-regression][Case B][mutated FAIL] box={"width":26,"height":44,"visible":true} threw=true
[hel813-regression][Case B][reverted PASS] {"width":103,"height":44,"visible":true}
```
Height stays at/above 44 while width fails — the wrong-axis failure mode, caught
on the correct axis. My numbers match the committed
`evidence/regression-run.txt` exactly (44/20/44, 103/26/103), which is direct
corroboration that the captured evidence is genuine rather than authored.
`git status --porcelain` after my run showed no modified CSS: the try/finally
revert is real.

**5. Both RED cases go through the SAME helper the CI guard uses.** The
regression spec imports `assertFloor`/`measureBox` from
`e2e/support/touchTargetProbe.ts`, which is the same module
`hel813-mobile-touch-target-floor.spec.ts` imports. Sensitivity is guaranteed
structurally by import, not asserted in prose.

**6. AC4 — zero visible matches FAILS, does not pass vacuously.** I did not take
this on code-reading alone. I ran an out-of-tree throwaway spec against the live
app calling `sweepSurface(page, { selectors: [".hel813-no-such-control-anywhere"] })`:
```
Expected: > 0   Received: 0
  at .../e2e/support/touchTargetProbe.ts:220
1 failed
```
Confirmed red. I also read the exempt path: exempt selectors are excluded from
`visibleFlooredMatches`, so a surface consisting only of exempt or hidden
matches still fails — the HEL-781 "measured at a width where it's `display:none`"
trap is closed.

**7. AC5 — genuinely discriminating unfloored control.** Surface 2 sweeps the
Preferences swatch row, exempts `input[type="color"]` (DESIGN.md's own named
exemption), asserts the exempt element still *exists*, and then positively
asserts the swatch measures `< 44` on BOTH axes while the `.ui-icon-btn`
immediately beside it in the same row is floored and swept. That is a real
discriminator, not a blanket flag. My local run passed both widths.

**8. `::after` hit-expander handling is real, not vacuous.** `bisectHitExtent`
walks outward from the control's own center in `0.25px` steps asking
`document.elementFromPoint`, and asserts INSIDE the helper against
`>= minPx - samplingStep` (43.75), never a literal 44 — matching DESIGN.md
lines 215-223, which I read directly. I independently reproduced the
measurement with my own standalone Playwright script against the live app at
430px:
```
.user-menu__trigger            box 28x28  ->  x-extent 44.5,  y-extent 44.5
.app-command-bar .ui-icon-btn  box 28x28  ->  x-extent 43.75, y-extent 44.5
```
The painted box is 28x28 while the measured hit extent is ~44 — the probe is
genuinely seeing the expander and not the box, and not some full-width overlay.
A truncated/overlapping expander (the HEL-772 failure) would drop below 43.75
and go red.

**9. AC6 — surfaces enumerated, exclusions named.** Six surfaces named in the
spec header and per-test comments (nav sheet/command bar, preferences swatch
row, toast dismiss, empty-state CTA, ui-select option list, panel-list zoom/add),
with out-of-scope items named explicitly rather than omitted: desktop-only
surfaces/breakpoints, third-party chart internals, surfaces unreachable without
pre-populated data. Surface 6 additionally uses `assertHiddenAtWidth` for the
zoom widget at 430px (genuinely hidden, not merely small) while still requiring
a real non-zero floored match from `.panel-list__add` — the exact HEL-781
vacuity trap, handled correctly.

**10. AC7 — runs in CI, verified live, not just claimed.**
`gh pr checks 430`: `e2e pass 3m42s`, `frontend pass`, `backend pass`.
`gh run view 32903271467` confirms the e2e job green, and the committed
`evidence/ci-run-32903271467.txt` matches the real GitHub log line-for-line
(12 tests, 12 passed, both `[hel813] exempt:` lines present). The `e2e` job in
`.github/workflows/ci.yml` invokes the steady-state spec by explicit path; the
regression harness is excluded from it by `playwright.config.ts`'s
`testIgnore: ["**/*.regression.spec.ts"]` plus its own `HEL813_REGRESSION`
skip — two genuinely independent layers (the override config clears only
`testIgnore`, and is referenced by nothing but the README).

**11. I re-ran the steady-state guard myself** against this worktree's live
servers (`DEV_PORT=6245`): `12 passed (37.3s)`, matching the committed
`steady-state-pass.txt` and the CI log.

**12. Failing default code-scanning checks are environmental, and I checked the
orchestrator's framing rather than accepting it.** The orchestrator's claim that
"Analyze (actions) also fails on main's tip cc0cfe16" is **false** —
`gh api repos/matto00/helio/commits/cc0cfe16/check-runs` shows
`Analyze (actions) success` on main. However, the actual root cause is still
unambiguously environmental and unrelated to this diff: the job's own log
(`gh run view --job=97983015648 --log-failed`) shows it died in **Set up job**,
before analyzing anything —
`Failed to download action 'https://internal-api.service.iad.github.net/repos/github/codeql-action/tarball/...'. Error: Name or service not known`,
three attempts, all DNS. Its sibling `Analyze (javascript-typescript)` passed on
the same commit; `CodeQL` is `skipping`, not failing. Not a defect in this
change, and not a blocker. (Flagging the incorrect justification as a
non-blocking note — the conclusion survives, the stated reason did not.)

**13. HEL-818 filed, and the guard does not silently sweep past the finding.**
Read the Linear issue directly: HEL-818 exists (Backlog, Medium, parent HEL-346,
v1.7 project), records both measurements (43.5650634765625px @430, 43.5648193359375px
@768) against a computed 44px, states the cause is undetermined rather than
assumed, and its AC4 explicitly requires `.ui-select__trigger` to be added to
this guard's sweep once resolved. Surface 5 sweeps `.ui-select__option` (a real,
visible, non-exempt, floored population — non-vacuous, and `sweepSurface`'s
non-zero assertion would fail if the option list didn't render), and the
exclusion of the trigger is documented in a prominent in-file comment at the
call site, not buried. Neither vacuous-pass nor vacuous-fail.

**14. No UI/design surface to judge.** The shipped diff adds test/CI/docs only —
no component, CSS, or token changes reach the running app. DESIGN.md conformance
review (tokens, light/dark parity, shared-component reuse) is not applicable to
this change. The design standard *is* the subject under test here, and the guard
enforces its §5/§8 clauses (including the `::after` epsilon) as written.

### Verdict: CONFIRM

Every acceptance criterion traces to evidence I produced myself. The two
demonstrated-RED cases reproduce on my machine with numbers identical to the
captured evidence, the guard is structurally incapable of passing vacuously on a
zero-match surface (verified red, not merely read), the `::after` bisection
measures a real 28px box's ~44px hit extent rather than a box or an overlay, and
the CI job is genuinely green on PR #430.

### Non-blocking notes

- The orchestrator's stated justification for the `Analyze (actions)` failure
  ("also fails on main's tip") is factually wrong — main's tip is green on that
  check. The failure is nonetheless a real DNS failure during action download,
  verified from the job log. Worth correcting the narrative so a future reader
  doesn't inherit a false precedent.
- `.app-command-bar .ui-icon-btn` bisects to exactly 43.75px — precisely the
  `44 - samplingStep` threshold, i.e. zero margin. This is the DESIGN.md-mandated
  threshold and correct as specified, but it means any future sampling-step
  change or sub-pixel layout shift on that control flips the guard red with no
  slack. Worth knowing when triaging a future failure there.
- `openspec/changes/mobile-touch-target-guard/evaluation-1.md` is untracked at
  HEAD (the only unclean entry in `git status --porcelain`). Cosmetic; the
  orchestrator may want it committed with the change record.
- The CI `e2e` job covers only this one spec; the pre-existing `e2e/` specs
  remain un-gated. The workflow comment names this explicitly as a deliberate
  follow-up rather than an oversight, which is the right call for this ticket's
  scope — but it is a real gap someone should pick up.
