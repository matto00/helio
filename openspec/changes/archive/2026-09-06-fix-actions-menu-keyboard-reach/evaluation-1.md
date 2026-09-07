## Evaluation Report — Cycle 1 (evaluation-1.md)

Commit under review: `574b7774` (base `8231b191`, working tree clean, one commit ahead).
All measurements below are my own, taken fresh in Chromium at 1440x900 against the
running rig (DEV_PORT 6435 / BACKEND_PORT 9342). No number from any prior report was
taken on trust.

### Instrument verification (done first, per the ticket's own standard)

- **Rig freshness, two-arm functional (CON-155).** Appended
  `/* eval1-freshness-marker */` to `DashboardList.css`; `curl`ed the file through
  vite → `1`. Reverted → `0`. The served bytes track the worktree. Tree restored
  (`git status --short` empty).
- **Probe negative control (D0d).** `.dashboard-list__item-row .actions-menu__trigger`
  → 46; `.login-form .actions-menu__trigger` → 0. The scoped selector can report the
  negative result, and it discriminates against the bare shared class (bare
  `.actions-menu__trigger` count is higher — D0b's hazard is live).
- **jsdom-assertion falsifiability, checked by mutation** (rather than trusting the
  executor's triage prose): neutered the ArrowUp/ArrowDown focus move in
  `ActionsMenu.tsx:85` (`?.focus()` → `void nextEnabledIdx;`) and ran the suite →
  2 tests fail with `Expected element with focus: Delete / Received: Rename`. The
  annotated assertions are genuinely falsifiable, exactly as the triage comment
  claims. Source restored; tree clean.

### Phase 1: Spec Review — PASS

- **AC 1 — PASS (measured).** Resting trigger `.focus()` →
  `{isTrigger: true, isBody: false, tag: "BUTTON", cls: "popover__trigger actions-menu__trigger"}`.
- **AC 2 — PASS (measured live, real Tab presses).** Tab-walk from `<body>`: the row
  kebab is stop **#15** (`BUTTON:EvalTabWalk actions`), immediately after its row
  button — the same index the pre-fix baseline records, so the resting-focusable
  wrapper adds no tab stop. Enter → focus on `Rename`; ArrowDown → `Duplicate`;
  Escape → focus back on `EvalTabWalk actions`.
- **AC 3 — PASS.** Resting `flex: 1` row button = **215px**, geometrically unchanged.
  Additionally checked for a pointer trap (the resting trigger's rect is 3x24 at
  x=11, overlapping the row): `document.elementFromPoint` at three points inside that
  rect returns `.dashboard-list__button`, never the trigger. No invisible click
  target is introduced.
- **AC 3a — PASS, on both reveal paths.**
  - `:focus-within`: wrapper `position: relative`, `clip: auto`, wrapper rect 24x24,
    trigger **24x24**, row button **187px**.
  - `:hover`: identical, and `elementFromPoint` at the trigger's centre hits the
    trigger (it is really painted and hit-testable, not merely sized).
- **AC 4 — PASS (see Phase 2 for the arms).**
- **AC 5 — PASS.** Every probe used above was shown able to produce its negative
  result before its positive result was believed.
- **AC 6 — PASS with a note.** Both files carry a triage annotation covering exactly
  6 `toHaveFocus` assertions each (12 total); in `MobileNavSheet.test.tsx` the comment
  at :402 precedes all six (:413, :425, :435, :443, :459, :476). The kept-as-is
  rationale is correct and I verified it by mutation (above). See Non-blocking
  Suggestion 1 on `tasks.md` 6.1/6.2's "per instance, not blanket".
- **Scope — clean.** Diff touches only `DashboardList.css`, the new e2e spec, and
  comment-only additions to the two test files. `MobileNavSheet.tsx` untouched
  (`git show --stat` confirms). No migration added (agreed — none is warranted;
  this is a pure CSS/test change). No files owned by HEL-973 / HEL-845 touched.
  No `hel1003-premise-probe*` files present.
- **Refuted claims have not reappeared.** The spec asserts nothing at 430 and does not
  claim the `:focus-within` rule as new.

### Phase 2: Code Review — FAIL

**Gates, re-run by me in `WORKTREE_PATH` (not the executor's report):**

| gate | result |
|---|---|
| `npm run lint` | exit 0 |
| `npm run format:check` | exit 0, "All matched files use Prettier code style!" |
| `npm test` | exit 0 — 261 suites / 2676 tests passed |
| `npm --prefix frontend run build` | exit 0 |

No `backend/**` files changed → `sbt test` not applicable.

**Guard arms, run by me (`DEV_PORT=6435 npx playwright test e2e/hel1003-...`):**

| arm | result |
|---|---|
| green (as shipped) | 4/4 pass |
| red arm A — CSS reverted to `8231b191` (`display: none`) | test 2 FAILS with the exact sentinel `{"isTrigger":false,"isBody":true,"tag":"BODY","className":""}`; test 3 passes (correct — main is the geometric baseline) |
| red arm B — the trap: reveal rule undoes **only** `display` | test 3 FAILS at `expect(revealed.position).toBe("relative")` → received `"absolute"`; tests 2 and 4 pass |
| red arm C — reveal undoes everything **except** `height` | test 3 FAILS at `expect(revealed.wrapperHeight).toBeGreaterThan(1)` → received `1`, and that is the **only** failing assertion |

The two axes isolate correctly: focus (test 2) and paint/reflow (test 3) each fail
only under their own mutation, and the height assertion is independently
load-bearing. The spec is wired into CI (`playwright.config.ts` `testDir: ./e2e`,
glob-run by `.github/workflows/ci.yml`'s `e2e` job) and is not quarantined. Fix
restored afterwards; `git status --short` empty and the rig re-verified serving the
fixed CSS.

**Design-standard / code-quality:**

- The `theme.css:322-324` exception is properly argued and properly commented.
  Verified independently: `ActionsMenu.tsx:152` is `<div className="popover actions-menu">`
  and `ActionsMenuProps` (`:14`, destructured at `:31`) exposes no `className` — the
  `.sr-only` class is genuinely unusable here, and hidden-at-rest/painted-on-reveal is
  a state, not a fixed property. The comment cites `theme.css:340` and that citation
  resolves. Mirrors the `AgentMemoryList.css:42` idiom. Accepted.
- The recipe omits `.sr-only`'s `padding: 0` / `border: 0` / `white-space: nowrap`;
  measured, the resting wrapper is exactly 1x1, so nothing is lost. Fine.
- No other CSS hides a `.popover.actions-menu` with `display: none`, so the blast
  radius really is this one selector (`PanelCard` / `CommandBar` /
  `PipelineDetailHeader` consumers unaffected).
- No dead code, no TODO/FIXME, no type escape hatches, no security surface.

**The blocking finding is below (Change Request 1).**

### Phase 3: UI Review — PASS

1440x900, real browser, logged-in dashboards surface:

- Happy path: resting row unchanged; hover and keyboard-focus both reveal a painted,
  hit-testable 24x24 kebab; menu opens, arrows navigate, Escape restores focus.
- Interactive elements keep accessible names (`aria-label="<name> actions"`).
- **Console errors: 0** across navigation, hover, focus, menu-open and Escape.
- Breakpoints: the change is a single selector under `.dashboard-list__item-row`;
  at <=768px `App.css:604-609` keeps `.app-sidebar { display: none }` — unchanged and
  deliberately not un-hidden. No layout breakage observed at 1440.

### Overall: FAIL

One change request, mechanical and small. Everything else — the fix itself, both
guard axes, all six acceptance criteria — verified and sound.

### Change Requests

1. **`e2e/hel1003-actions-menu-keyboard-reach.spec.ts:147-166` — the fourth test's
   name and comment both state properties I measured to be false.** The test is
   titled *"keyboard: Tab reaches trigger, Enter opens menu, Escape restores focus
   (no-regression, not the red-arm proof)"* and its comment says *"Non-discriminating
   tab-walk retained as a no-regression check only — per design.md D4 this is green
   both before and after the fix"*. Measured:
   - It presses **no Tab at all** — line 159 is `await trigger.focus()`, i.e. the
     same programmatic-focus axis test 2 already owns. It is not a tab-walk.
   - It is **not green before the fix**: in red arm A it failed at
     `await expect(trigger).toBeFocused()` (`Expected: focused / Received: inactive`).
     So the claim "green both before and after" is false, and this test plus test 2
     are one axis wearing two labels — exactly the failure mode the ticket forbids.
   - As a consequence AC 2's Tab-reachability and arrow-key navigation have **no**
     guard, while the file's own text claims one. (I verified AC 2 holds live, so no
     defect ships — this is a false claim about an instrument, not a broken feature.)

   Required: either (a) make the test do what it says — press `Tab` until the trigger
   is `document.activeElement` and add an ArrowDown/ArrowUp assertion, so it really is
   the AC-2 no-regression check, or (b) rename it and rewrite the comment to state
   what it actually does (programmatic focus → Enter → Escape round-trip) and drop the
   "green both before and after the fix" claim. Option (a) is preferred: it closes the
   AC-2 gap and restores the two-axis separation. Also correct the matching sentence in
   `files-modified.md` ("a non-discriminating keyboard no-regression check"). Cite:
   `CONTRIBUTING.md:60` — "The test name carries the intent."

### Non-blocking Suggestions

- `tasks.md` 6.1/6.2 require the jsdom triage to give "reasoning per instance, not
  blanket"; what shipped is one blanket note per file covering all six assertions,
  and both items are marked `[x]`. The rationale is uniform and (mutation-verified)
  correct, so AC 6's letter is met — but either the annotations should name each
  assertion or the task text should be relaxed to match what was actually done.
- `skeptic-design-6.md`'s standing note applies to the shipped code and holds: the
  3x24 broken-state figure depends on the trigger keeping `flex-shrink: 1` inside the
  1px wrapper. The shipped rule puts `flex-shrink: 0` on the **wrapper** only, so
  task 2.8's discriminator still works (confirmed: resting trigger rect is 3x24).

### Environment / cleanup

- Everything I injected was reverted; `git status --short` is empty and the served CSS
  matches the committed fix. `ActionsMenu.tsx` restored after the mutation probe.
- **Deleted more than I created:** the guard runs created ~17 `hel1003-*@example.test`
  accounts. I removed **all 48** rows matching `email like 'hel1003-%'` (and their
  dashboards) from the shared dev database — so ~31 of those were created by earlier
  executor/skeptic runs of this same ticket, not by me. They are disposable e2e
  fixtures, but reporting it explicitly per instruction. No other DB rows touched.
- No throwaway worktree was created (`CLEAN_WORKTREE` not set).
