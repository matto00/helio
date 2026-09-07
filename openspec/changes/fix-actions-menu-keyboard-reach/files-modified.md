# Files modified

- `frontend/src/features/dashboards/ui/DashboardList.css` — replaces the row
  actions-menu wrapper's resting `display: none` with a visually-hidden
  treatment (`position: absolute`, 1x1, `margin: -1px`, `overflow: hidden`,
  `clip: rect(0,0,0,0)`, mirroring `theme.css:340`'s `.sr-only` recipe) so the
  trigger remains a real, programmatically-focusable DOM node at rest; extends
  the hover/`:focus-within`/`aria-expanded` reveal rule to undo every one of
  those declarations (not just `display`), which is what avoids the
  green-but-broken 1px-flex-shrink trap design.md D1 documents.
- `frontend/src/shared/chrome/ActionsMenu.test.tsx` — D5 triage: annotated the
  6 in-scope `toHaveFocus` assertions with why they remain genuinely
  falsifiable under jsdom (no layout-hidden element involved). No behavioural
  change.
- `frontend/src/shared/chrome/MobileNavSheet.test.tsx` — D5 triage: same
  annotation treatment for its 6 in-scope `toHaveFocus` assertions. No
  behavioural change; `MobileNavSheet.tsx` itself is untouched (D2).
- `e2e/hel1003-actions-menu-keyboard-reach.spec.ts` — new Playwright
  regression guard (desktop width only): negative control, programmatic-focus
  discriminating assertion (red arm sentinel `document.activeElement ===
  document.body`, confirmed red against the reverted fix), resting/revealed
  geometry assertions (215px resting, 187px reflow, 24x24 trigger, `position:
  relative`, `clip: auto`, revealed height > 1px), and a non-discriminating
  keyboard no-regression check driven by real `Tab` keypresses (cycle 2 fix,
  evaluation-1.md CR1 — the prior revision used `.focus()` here, which is the
  same axis as the programmatic-focus test under a different label).

  **Red/green-arm evidence recorded (cycle 2), CSS reverted to
  `574b7774~1:frontend/src/features/dashboards/ui/DashboardList.css`:**
  - "resting trigger is a real focus target" (programmatic-focus test):
    **RED** — `{"isTrigger":false,"isBody":true,"tag":"BODY","className":""}`.
  - "keyboard: Tab reaches trigger…" (real-Tab-keypress test): **GREEN** —
    passed unchanged, confirming it is genuinely non-discriminating (the
    `:focus-within` reveal at `DashboardList.css:244` already exposes the
    wrapper once the row button ahead of it in tab order is focused, both
    before and after the fix) and is therefore correctly labelled as a
    no-regression check, not proof of the defect fix.
  - CSS restored afterward; `git diff` against the committed fix showed no
    difference. All 4 tests green again post-restore, format/lint clean.
- `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` (line 187) — disambiguated
  `getByRole("button", { name: "Dashboard actions" })` with `exact: true`
  (final-gate skeptic CR1). This fix makes the resting sidebar kebab a real,
  programmatically-focusable node, which puts it back in the accessibility
  tree at rest — the non-exact locator's substring match then resolved to 2
  elements (the CommandBar's "Dashboard actions" trigger and a dashboard
  row's "`<name>` Dashboard actions" trigger). This is the fix working as
  intended colliding with a loose locator, not a second defect: reverting
  just this one line (CSS untouched) reproduces the exact strict-mode
  violation Playwright reports, naming both elements; re-applying `exact:
  true` resolves it.
- `e2e/hel909-output-picker-panel-sheet.spec.ts` (lines 111, 184, 220) — same
  substring-collision reasoning, same fix (`exact: true`), per the same
  final-gate CR2.

  **Correction (final-gate round 2, skeptic-final-2.md): this file's edits
  are correct by reasoning, not exercised.** An earlier revision of this
  document said these sites were "now exercised" by the 42-passed run and
  had previously "passed" — **both statements are false**, and were not
  verified before being written; that is the exact failure mode this
  ticket's design gate exists to catch. `hel909-output-picker-panel-sheet.
  spec.ts` is on `playwright.config.ts`'s quarantine register (**HEL-951**,
  follow-up **HEL-963** — "a panel placed via the OutputPicker never becomes
  visible in the grid / mobile stack; all four tests in the file fail the
  same way"), and does not run at all: re-verified by execution just now,
  `npx playwright test --list | grep -c hel909` → **0**. These three
  `exact: true` edits have never been run, before or after this change, and
  are not part of the 42-passed count below. They are almost certainly
  correct — identical substring-collision mechanism to the verified
  `hel910` fix, same trigger, same non-exact locator shape — but that is
  reasoning, not measurement. **Anyone unquarantining HEL-951/HEL-963 later
  needs to know these three sites were never actually run as part of this
  change** and should re-verify them then.

## Full-suite e2e measurement (final-gate CR3)

Command: `DEV_PORT=6435 BACKEND_PORT=9342 npx playwright test --workers=1`

- **Before** the `exact: true` fixes (CSS fix present, locator fixes reverted
  in `hel910-pipeline-to-dashboard-flow.spec.ts` only, isolating the cause):
  `e2e/hel910-pipeline-to-dashboard-flow.spec.ts:90` failed deterministically
  with `strict mode violation: getByRole('button', { name: 'Dashboard
  actions' }) resolved to 2 elements` — the CommandBar's "Dashboard actions"
  trigger (`aria-label="Dashboard actions"`) and a dashboard row's
  (`aria-label="HEL-910 Flow Dashboard actions"`), confirming the exact
  mechanism the final-gate skeptic reported.
- **After** applying `exact: true` at all 4 call sites (both specs): full
  suite — **42 passed**, re-verified fresh just now (round-2 correction run:
  `2.4m`, `--workers=1`; round-1 run was `2.9m`, same count both times). This
  includes both `hel910-pipeline-to-dashboard-flow.spec.ts` tests. **It does
  NOT include `hel909-output-picker-panel-sheet.spec.ts`** — that file is
  quarantined (HEL-951/HEL-963, see above) and contributes 0 tests to this
  count; its 3 `exact: true` edits are unexercised by this or any run.

This change alters accessibility-tree exposure everywhere the CSS selector
`.dashboard-list__item-row .popover.actions-menu` applies — not only
`DashboardList`'s own rows, but every `SidebarItemList` row too, since
`SidebarItemList.tsx` imports `DashboardList.css` and reuses the same
`dashboard-list__item-row` class for its Data Sources / Pipelines / Metrics /
Conversations rows. The trigger is now focusable/announced at rest on all of
those surfaces (not the dashboard-only surface this ticket's scope statement
names), so any spec querying an `ActionsMenu` trigger by role non-exactly on
any sidebar-row surface is a candidate for the same collision — this is
exactly what caused the hel910 failure (a dashboard-row trigger colliding
with the CommandBar's own, differently-scoped "Dashboard actions" trigger).
The other three `ActionsMenu` consumers (`PanelCard`, `CommandBar`,
`PipelineDetailHeader`) do not use this class and are unaffected. `grep -rn
'"Dashboard actions"' e2e/` found only the two specs above querying by role
non-exactly against this surface; both are now fixed.
