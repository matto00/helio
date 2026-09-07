## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold reviewer. Every conclusion below is derived from a command I ran myself in
this worktree. Nothing is carried over from the executor's, evaluator's, or
round 1's narrative except where explicitly marked "re-confirmed cheaply".

Note on base state: the brief named five commits. During this review the
executor committed a sixth, `cd22b0b5` ("State the a11y-tree win and the
latent-locator finding plainly in proposal.md"), which is the previously
uncommitted `proposal.md` edit. HEAD is `cd22b0b5`; working tree is clean. My
findings are against `cd22b0b5`.

### What I verified (with evidence)

**1. Rig freshness — functional, not a health probe (CON-155).**
`curl -s http://localhost:6435/src/features/dashboards/ui/DashboardList.css?direct`
returns the **fixed** rule body (`position: absolute; width: 1px; height: 1px;
margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0)`), not `display: none`.
The dev server is serving this branch's binary, not a stale one.

**2. Full e2e suite — re-run, not taken on report.**
`DEV_PORT=6435 BACKEND_PORT=9342 npx playwright test --workers=1` →
**`42 passed (2.6m)`**, exit 0. The executor's 42 figure reproduces.

**3. Isolation claim — verified myself, both arms.** This is the check that
distinguishes "a loose locator collided with a correct fix" from "a second
defect wearing the same symptom".
- **Arm A** (revert *only* `hel910:187`'s `exact: true`; CSS untouched):
  `1 failed, 1 passed` —
  `strict mode violation: getByRole('button', { name: 'Dashboard actions' })
  resolved to 2 elements`. Reproduces the exact round-1 symptom.
- **Arm B** (locator still reverted, **and** CSS reverted to
  `574b7774~1`): `2 passed`. The collision disappears with the CSS.

Together these establish causality in both directions: the strict-mode
violation is caused by the CSS's accessibility-tree shift, and `exact: true` is
the correct disambiguation — not a mask over a second defect. The executor's
isolation claim is accurate.

**4. `exact: true` selects the intended element at all four sites.**
`grep -rn '"Dashboard actions"' frontend/src --include=*.tsx` (excluding tests)
returns exactly one production site: `CommandBar.tsx:292`,
`<ActionsMenu label="Dashboard actions" …>`. Row triggers are labelled
`` `${name} actions` `` (`DashboardList.tsx:397`, `SidebarItemList.tsx:437`), so a
dashboard named "HEL-910 Flow Dashboard" produces "HEL-910 Flow Dashboard
actions" — a substring match, which is the collision. `exact: true` therefore
narrows each of the four locators to the CommandBar trigger, which is precisely
what all four call-site comments say they intend ("the command bar's
dashboard-actions kebab", "the single Add-panel entry point"). Not a
narrowing-to-nothing and not a narrowing-to-the-wrong-element. The
"latently broken before this change" framing is also correct: the substring
collision was always latent and only masked by the trigger's absence from the
a11y tree.

**5. Blast radius — checked directly against the live DOM, not from the doc.**
`grep -rn "dashboard-list__item-row"` finds three carriers:
`DashboardList.tsx:343`, `SidebarItemList.tsx:361`, `SidebarRowsSkeleton.tsx:35`.
`SidebarItemList.tsx:8` does import `DashboardList.css`. I then measured it
live at `/sources` (1440x900): 92 `.dashboard-list__item-row` nodes, each with a
`.popover.actions-menu` computing to `position: absolute`, `1x1`,
`clip: rect(0px, 0px, 0px, 0px)` — i.e. `SidebarItemList` rows really do carry
the new resting treatment. The executor's corrected, wider blast-radius
statement is **true**, and I confirmed it independently rather than accepting it.
The other `ActionsMenu` consumers do not carry the class: `grep -l` across
`PanelCard.tsx`, `CommandBar.tsx`, `PipelineDetailHeader.tsx`,
`PipelineDetailFooter.tsx`, `MobileShell.tsx` returned nothing. (The proposal
names three of these; `PipelineDetailFooter` and `MobileShell` are also
consumers and also unaffected — see non-blocking notes.)
`grep -rn "actions" e2e/ | grep "name:"` finds no remaining non-exact
`ActionsMenu` role locator anywhere in `e2e/`.

**6. CSS unchanged since round 1.** `git diff 574b7774 HEAD --name-only`
lists no `frontend/` path at all. Round 1's pixel-identity screenshot finding
therefore still holds without re-derivation.

**7. Core measurements re-confirmed at 1440x900** by re-running
`e2e/hel1003-actions-menu-keyboard-reach.spec.ts` (all four green in the full
suite: resting row button 210–220px, revealed trigger 24x24, wrapper
`position: relative`, `clip: auto`, `height > 1`, row button 183–191px).

**8. Red arm re-derived myself, not read.** With the CSS reverted to
`574b7774~1`, the guard spec reported:
`✘ 2 … resting trigger is a real focus target` with
`{"isTrigger":false,"isBody":true,"tag":"BODY","className":""}` — the exact
`document.activeElement === document.body` sentinel. Tests 1, 3 and 4 stayed
green under the same reverted CSS, which independently confirms test 4 is
genuinely non-discriminating and is correctly labelled a no-regression check
rather than the proof. Both arms shown.

**9. UI / design judgment (my domain).** Screenshots taken and looked at at
1440x900, on the surface the blast radius newly covers (`SidebarItemList` /
Data Sources), which round 1 did not visually inspect:
- Dashboards sidebar at rest (dark): rows fill full width, no kebab, no stray
  1px artifact, no layout shift. Indistinguishable from the old `display: none`
  presentation, as intended.
- Data Sources sidebar at rest (dark): same — 92 rows, clean truncation.
- Data Sources row hovered, **dark** and **light**: kebab reveals at full
  24x24 inside the row's hover pill, row label re-truncates to make room,
  spacing rhythm and the trigger's borderless in-row treatment match the
  dashboards rows exactly. Light/dark parity holds; no token or hardcoded-value
  divergence (the resting rule is pure geometry mirroring `theme.css`'s
  `.sr-only`, correctly cited in the comment, and introduces no colour value).
- `browser_console_messages` level=error: **0 errors, 0 warnings**.
I have no design objection. The visual result is a no-op, which is the correct
outcome for this fix.

**10. Frontend gates.** `npm run format:check` → "All matched files use
Prettier code style!", exit 0. `npm test` → `261 suites passed, 2676 tests
passed`, exit 0.

**11. Scope discipline.** `git diff 8231b191...HEAD --name-only` shows no
`MobileNavSheet.tsx`, no migration, and no `App.css`. Neither REFUTED claim
(a keyboard defect at 430px; the `:focus-within` rule being new) appears as a
live assertion in the artifacts. Confirmed.

### The one finding

The delivered artifacts state, as measurement, that the three
`hel909-output-picker-panel-sheet.spec.ts` locator fixes were exercised by the
green run. **They were not, and cannot be.** That file is on the quarantine
register:

`playwright.config.ts` → `testIgnore` contains
`"**/hel909-output-picker-panel-sheet.spec.ts"`, with the comment:
> Quarantine (HEL-951) — hel909-output-picker-panel-sheet.spec.ts: a panel
> placed via the OutputPicker never becomes visible in the grid / mobile
> stack; **all four tests in the file fail the same way.** Follow-up: HEL-963.

Ground truth: `npx playwright test --list | grep -c hel909` → **0**. And the
42 tests I watched run account for themselves entirely without it
(auth-cookie 8, hel1003 4, hel773 11, hel813 14, hel908 3, hel910 2 = 42).
Zero hel909 call sites were exercised, in my run or the executor's.

Two statements are therefore false:
- `files-modified.md:70-72` — "**42 passed** … including … **all 3
  `hel909-output-picker-panel-sheet.spec.ts` call sites now exercised with the
  disambiguated locator**."
- `files-modified.md:51-55` — "**These passed** only by accident of dashboard
  naming in their fixtures." They did not pass; they are a known-red,
  quarantined spec (HEL-963) that has not run in this suite or in CI.

I want to be precise about what this is and is not. The **code** is sound: the
CSS fix, the guard, and all four `exact: true` edits are correct, and the hel909
edits are the right change to make even though they are unverifiable today. The
defect is that a delivered artifact asserts a measurement that the measurement
did not produce — the exact class of failure this ticket's six-round design gate
existed to stamp out, now reproduced one level up in the evidence record. A
future reader would reasonably conclude those three locators are covered by a
green run. They are not, and the file they live in is red for unrelated reasons.

This is cheap to fix (one artifact edit, no code change) and I am not
manufacturing it to demonstrate rigour — it is a fabricated measurement claim of
the same species as the two the design gate caught.

### Verdict: REFUTE

### Change Requests

1. **Correct the false coverage claim in `files-modified.md`.** At lines 70–72,
   the "42 passed" bullet must not claim the hel909 call sites were exercised.
   State the measured truth: the 42-passed run covers the `hel910` fix; the
   three `hel909` sites were **not** exercised because
   `hel909-output-picker-panel-sheet.spec.ts` is on `playwright.config.ts`'s
   `testIgnore` quarantine register (HEL-951, follow-up HEL-963) and does not
   run in this suite or in CI. Likewise fix lines 51–55: replace "These passed
   only by accident of dashboard naming in their fixtures" with the fact that
   the file is quarantined red for an unrelated reason (a panel placed via the
   OutputPicker never becomes visible), so the `exact: true` edits there are a
   correct-but-currently-unverifiable pre-emptive fix. Add one sentence noting
   that the hel909 edits are nonetheless right — the same substring collision
   applies there — and that they will be verified whenever HEL-963
   un-quarantines the file. Mirror the same correction in `proposal.md`
   (line 139's parenthetical currently leans on that measurement).

That is the only blocker. Nothing else in this change needs to move.

### Non-blocking notes

- `proposal.md` enumerates the unaffected `ActionsMenu` consumers as
  `PanelCard`, `CommandBar`, `PipelineDetailHeader`. Two more exist —
  `PipelineDetailFooter.tsx` and `MobileShell.tsx`. I verified both are
  likewise unaffected (neither carries `dashboard-list__item-row`), so the
  conclusion is right; the list is just not exhaustive. Worth completing while
  editing for CR1, since the surrounding text is explicitly framed as
  "bounded explicitly, not merely asserted".
- `SidebarRowsSkeleton.tsx:35` also renders `.dashboard-list__item-row`, but
  contains no `ActionsMenu`, so the selector matches nothing inside it. No
  action needed; recorded so the next reader of the blast radius does not have
  to re-derive it.
- Test 3 (geometry) passes with the CSS reverted, because `.popover` already
  supplies `position: relative` on the base. Its real job — catching the three
  green-but-broken reveal variants round 1 probed — is unaffected, and the
  spec does not claim otherwise. No change requested.
- Environment left as found: both files I reverted for the isolation arms were
  restored (`git checkout --`), and both the worktree and the main checkout are
  clean. Five stray `skeptic2-*.png` screenshots the Playwright MCP wrote to
  the repo root were deleted. As in round 1, `hel1003-*` test accounts were
  left in the shared Postgres rather than cascade-deleted.
