## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Nothing below is taken from evaluation-1.md, evaluation-2.md,
files-modified.md, or any commit message; every claim is re-derived from the
files, the running app, and reproduced command output.

### 0. Rig freshness (CON-155) — both arms

`start-servers.sh` "already healthy" proves nothing, so the rig was verified
functionally before any measurement:

- appended `/* HEL1003-SKEPTIC-MARKER */` to `DashboardList.css`,
  `curl http://localhost:6435/src/features/dashboards/ui/DashboardList.css?direct | grep -c` → **1**
- `git checkout` the file, re-fetched → **0**

The dev server serves current disk content. Every CSS arm below was therefore a
real measurement, not a stale bundle.

### 1. What I verified (with evidence)

**The fix itself** — `frontend/src/features/dashboards/ui/DashboardList.css:249-274`.
Resting rule drops `display: none` for the `.sr-only` recipe (`position:absolute;
width:1px; height:1px; margin:-1px; overflow:hidden; clip:rect(0,0,0,0)`); reveal
rule resets `position/display/width/height/margin/overflow/clip`. Read against
`frontend/src/theme/theme.css:340` — the local copy omits only `padding: 0`,
`white-space: nowrap`, `border: 0`, none of which have a measurable effect here
(resting geometry is pixel-identical to base, §4).

**Full guard suite, fix in place:** `npx playwright test e2e/hel1003-...spec.ts`
→ **4 passed**, reproduced 3×. (A first run failed 2 tests at `page.goto("/login")`;
re-run 3× green — that was a transient dev-server hiccup immediately after my
marker edit/revert, not a stable failure. Per the reproduce-before-refuting rule
it is not counted as a finding.)

**Test 2 red arm (the proof).** Restored `DashboardList.css` from base `8231b191`:

```
1 failed  … resting trigger is a real focus target: .focus() lands on the trigger, not <body>
Error: {"isTrigger":false,"isBody":true,"tag":"BODY","className":""}
```

The design.md D4 sentinel (`document.activeElement === document.body`) fires
exactly as specified. Tests 1/3/4 passed in that same red arm — so test 2 is the
sole discriminator, as claimed.

**The green-but-broken traps.** I constructed three variants that follow the plan
yet ship broken, and each was caught by a *different* assertion:

| Variant (reveal rule) | Result |
|---|---|
| resets only `display` (the named trap) | RED — `position` `Expected "relative" / Received "absolute"` |
| resets everything except `height` (round-5 gap) | RED — `wrapperHeight` `Expected > 1 / Received 1` |
| resets everything except `width` (flex-shrink) | RED — `triggerWidth` `Expected 24 / Received 3` |

The **3x24** figure in the ticket is confirmed by direct measurement, and the
mechanism is flex shrink, not paint clipping — the round-4/round-5 corrections
hold up. Every geometry assertion in test 3 is load-bearing and non-duplicative;
none is a disguised copy of another.

**Test 4 (no-regression) — greenness, causality, and non-vacuity all checked.**
- Greenness with the fix reverted: measured **passed** (base CSS arm above).
- The *causal* claim (`:focus-within` at `DashboardList.css:244` is why) —
  negative control: base CSS with only the `:focus-within` selector line deleted
  → test 4 **fails**: `Error: trigger not reached by Tab within 40 presses`. The
  comment's stated cause is the actual cause, not a plausible story.
- Non-vacuity of the bounded loop: temporarily `maxTabs = 1` → **fails** with
  `trigger not reached by Tab within 1 presses`. The loop can report not-reached.
- The `:focus-within` rule does pre-date this change (present verbatim in
  `git show 8231b191:…DashboardList.css`), so the "already on main" claim is true.
- Name/comment accuracy: the test presses real `Tab` (line 175), asserts
  Enter→Rename, ArrowDown→Duplicate, Escape→trigger. It measures the axis its
  name claims. The defect fixed in `162eb1dc` is genuinely gone.

**AC 6 (jsdom triage) — claim negative-controlled, not just read.** Counts are
accurate: 6 `toHaveFocus` assertions in `ActionsMenu.test.tsx` and 6 in
`MobileNavSheet.test.tsx` = the 12 the AC names. The annotation asserts they are
*genuinely falsifiable*, which is itself a claim about an instrument, so I
mutated `ActionsMenu.tsx:51,85` (`?.focus()` → `?.blur()`): **3 failed, 8 passed**,
the failures landing on lines 46/58/68 `toHaveFocus`. The annotation is honest —
these assertions do track real focus-movement logic, and nothing under test is
hidden. Reverted; `npx jest ActionsMenu|MobileNavSheet` → **62 passed**.

**Scope.** `MobileNavSheet.tsx` untouched (diff touches only its `.test.tsx`).
`git diff --name-only 8231b191...HEAD -- backend/` → **0 files**; no migration.
Refuted claims verified as not-live: `App.css:604-609` does set
`.app-sidebar { display: none }` inside the `max-width: 768px` block, and
`MobileNavSheet.tsx` mentions `ActionsMenu` only in a comment at line 419. The
spec has no 430-width assertion.

**Gates.** `npm run lint` clean, `npm run typecheck` clean,
`npm run format:check` clean.

### 2. UI / design judgment

Screenshots at 1440x900, both themes, three states (rest / hover / real-Tab
keyboard focus), captured with a scratch spec and compared pixel-wise against the
same states rendered with base CSS.

- **Resting geometry unchanged:** rest, hover and keyboard-focus captures are
  byte-identical between base and fix in dark; in the one differing pair the
  `PIL.ImageChops` bbox is `(225, 70, 226, 71)` with extrema `(0,1)` — a single
  pixel differing by 1 in blue, inside the search input, i.e. antialiasing noise.
  There is no visual regression.
- **Light/dark parity:** kebab unpainted at rest, painted and vertically centred
  on hover, focus ring correct in both themes.
- **Design language:** no hardcoded values where a token exists; spacing rhythm
  and the row's 24x24 trigger match sibling rows.
- **The `theme.css:322-324` exception is sound.** I verified the load-bearing
  premise myself: `ActionsMenu.tsx:152` is literally
  `<div className="popover actions-menu">` with no `className` prop threaded, so
  `.sr-only` cannot be applied at the markup layer; and hidden-at-rest vs
  painted-on-reveal is a selector-driven state a static utility class cannot
  express. The comment names the canonical source and the rationale. Accepted.

### 3. The finding

Running the **whole** e2e suite (42 tests) against the fix surfaces one
deterministic failure that is *caused by this change*:

```
1 failed
  e2e/hel910-pipeline-to-dashboard-flow.spec.ts:90:7 › … 'pasted' table -> three table Outputs -> all placed on a dashboard
41 passed
```

```
Error: locator.click: strict mode violation:
getByRole('button', { name: 'Dashboard actions' }) resolved to 2 elements:
  1) <button … aria-label="Dashboard actions" class="popover__trigger actions-menu__trigger">
  2) <button … aria-label="HEL-910 Flow Dashboard actions" class="popover__trigger actions-menu__trigger">
```

Both arms, reproduced (this is not a single anomalous reading):

| CSS | `-g "pasted"` result |
|---|---|
| base `8231b191` | **passed** (×2) |
| branch HEAD | **failed**, identical strict-mode violation (×3) |

Root cause, derived: `display: none` removed the resting sidebar kebab from the
accessibility tree, so `getByRole` never saw it. The visually-hidden recipe
deliberately keeps it exposed — that is the point of the fix — so the sidebar
row's `"HEL-910 Flow Dashboard actions"` trigger now also matches the non-exact
name `"Dashboard actions"` at `hel910-pipeline-to-dashboard-flow.spec.ts:187`,
alongside the dashboard-header trigger it intends.

This is a genuine, CI-breaking consequence of a correct fix, not a flaw in the
fix's intent — but it ships red and must be resolved in this change. The three
sibling call sites in `hel909-output-picker-panel-sheet.spec.ts` (lines 111, 184,
220) use the same non-exact name and currently pass only because their dashboard
names do not end in `Dashboard`; they are latently exposed to the same collision.

The evaluator's PASS did not cover this: nothing in the change artifacts records
a full-suite run.

### Verdict: REFUTE

### Change Requests

1. **Fix the e2e regression at
   `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:187`.** Disambiguate the
   dashboard-header trigger — `getByRole("button", { name: "Dashboard actions",
   exact: true })` is the minimal correct change (Playwright's own suggestion in
   the error, and it selects exactly the intended element). Do not "fix" this by
   re-hiding the sidebar kebab; the extra match is the intended accessibility
   improvement. Re-run the **full** suite and record `42 passed`.
2. **Harden the three latent siblings** at
   `e2e/hel909-output-picker-panel-sheet.spec.ts:111,184,220` with the same
   `exact: true`. They pass today only by accident of dashboard naming, and this
   change is what makes the accident load-bearing.
3. **Record the full-suite measurement in the change artifacts.** The existing
   evaluation reports document only the new spec. Add the before/after full-suite
   run (`npx playwright test --workers=1`) to `files-modified.md`, since this
   change alters accessibility-tree exposure of a shared component and is
   therefore capable of affecting any spec that queries it by role.

### Non-blocking notes

- The accessibility-tree exposure change is a real, desirable semantic shift
  worth one sentence in `proposal.md`: every resting sidebar kebab is now
  announced to assistive tech, where previously none was. It is the intended
  outcome, but it is currently only implied.
- `frontend/src/theme/theme.css:322-324` says feature CSS "should use this shared
  class instead of redefining it locally". Consider a one-line back-reference
  there naming `DashboardList.css` as the sanctioned exception, so a future
  reader of the canonical comment finds the exception from the rule's side too.
- The local recipe omits `.sr-only`'s `padding: 0` / `white-space: nowrap` /
  `border: 0`. Measured to have no effect here; noting it only so a future edit
  that gives the wrapper padding does not silently reintroduce a width.

### Housekeeping

- Working tree left **clean** (`git status --short` empty); every CSS/TSX arm I
  constructed was reverted, and the scratch screenshot spec
  (`e2e/zzskeptic-shot.spec.ts`) was deleted.
- **Modified but not created:** none.
- **Created but not deleted:** `hel1003-*@example.test` accounts in the shared dev
  Postgres, from the guard spec's own `registerAndLogin` (its normal behaviour on
  every run) plus my `hel1003-shot-*` screenshot runs. I did **not** delete them:
  cascading user deletes in a Postgres instance shared with other live worktrees
  is a larger blast radius than the stale rows, and the spec creates such rows on
  every ordinary execution anyway. Reporting rather than acting.
