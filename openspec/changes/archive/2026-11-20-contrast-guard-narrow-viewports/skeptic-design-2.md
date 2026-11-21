## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed against the live tree at HEAD 4f101209bd50fed23f5534a8f4be3cc310051d63 (change dir untracked, no code yet).
Static review: CSS/TSX with line numbers cited. I did not run the app.

### What I verified (with evidence)

**Round-1 CR1 (1100 population): addressed.**
- D2 now uses `/home` and `/connectors` at 1100 and no longer has `pipeline-detail` or `/dashboards` there.
  `HomePage.css:885` is `@media (max-width: 1100px)`. `ConnectorsPage.css:304` is `@media (max-width: 1100px),
  (pointer: coarse)`. `ConnectorsPage.tsx:43,117` sets `TEST_CONNECTION_MENU_BREAKPOINT_PX = 1100` and reads it
  through `useIsNarrowerThan`.
- tasks.md 1.3 and the spec give the same cell count (2x2 + 4x2x2 = 20).
- The Risks fallback that would have dropped `/home` is gone.
- Connector seeding is conditional, with a stated fallback. That is acceptable.

**Round-1 CR3 (narrow readiness): addressed.**
- D3 drops the `.context-list` gate and view at 768 and below.
- It replaces the selected-row and focused-editor asserts with a phone-layout marker. The phone layout has real
  markers: `features/pipelines/ui/mobile/PipelineMobileLayout.tsx:186` (`mobile-body`, `role="tabpanel"`).
- It waits for the button `Refresh sample of HEL-866 Guard Source` to be visible and enabled.
  `SourceSampleLabel.tsx:60` builds that aria-label as `` `Refresh sample of ${sourceName}` ``, and
  `SOURCE_NAME = "HEL-866 Guard Source"` (guard `:512`).
- M1 must show the button's line, and the 1440 result is recorded too.

**D6 M1 claim ("red in dark only"): correct.** `PipelineSpine.css:441-451` has a light override (`--app-surface-soft`)
and a dark override (`--app-surface-strong`). If both are deleted, the button falls back to
`IconButton.css:63` `.ui-icon-btn--ghost:hover` = `--app-surface-soft`. Light ends up the same as its fixed value.
Dark goes back to the 1.03 rung.

**Round-1 CR2 (bottom nav, M2 target): only partly addressed. This is the REFUTE.**
- The D2a bottom-nav decision is reasonable taken alone. DESIGN.md:184/199 carves the glass capsule out as its own
  design surface. The exemption mechanism works:
  - `finishCell`'s `isExempt` is hover-only (`r.forced === "hover"`, guard `:708-712`) and keyed on the
    `[class]` identity token.
  - `.bottom-nav__tab:focus-visible` exists (`BottomNav.css:162`), so focus stays asserted.
  - `[bottom-nav__tab]` renders at 768 and below only, so the 1440 cells are unaffected.
- D2a's premise is that the bottom nav is the one foreseeable failure and that anything else is unforeseen. The
  live tree contradicts that. At least two more narrow-only controls in D2's own population have **no hover rule
  in any stylesheet**:
  - `.dashboard-chip`, the phone dashboard chip row on `/dashboards`. It is rendered by `PanelList.tsx:349-351`
    only when `isPhoneShell`. `DashboardChipRow.css` has no `:hover` selector. The same class is reused by
    `DataSectionLinks` on `/connectors` (`DataSectionTabs.tsx:24`,
    `className="dashboard-chip data-section-tabs__link…"`).
    `grep -rn "dashboard-chip\|data-section-tabs" --include=*.css frontend/src | grep -i hover` returns nothing.
  - `.app-command-bar__mobile-title`, the phone section switcher. It is `display: none` above 768 and
    `inline-flex` at 768 and below (`App.css:358`, `:454`). It renders whenever `pickerId !== "other"`
    (`CommandBar.tsx:121,185`), so it appears on `/dashboards` and `pipeline-detail` in D2's population. Its only
    state rule is `:focus-visible` (`App.css:391`). The grep for `mobile-title.*hover` in CSS returns nothing.
- The guard matches all of these. `INTERACTIVE_SELECTOR` includes `a` and `button` (`stateContrastProbe.ts:31`).
  `classifyState` returns `fail` with `ratio: null` when no background, border, outline or shadow changes
  (`stateContrast.mjs:200-218`).
- Under D2a's own rule these are not one-token fixes: there is no existing `(hover: hover)` rule to edit. So the
  plan sends each of them to an ESCALATION mid-execution. That is the round-1 CR2 failure again: a predictable
  finding left for execution instead of being decided in the design.
- D2a's reason for not adding a hover state ("a design-language call inside the DESIGN.md glass carve-out") also
  does not apply to these two:
  - neither is glass;
  - the chip is a hairline-bordered pill, which is DESIGN.md §5's Secondary recipe, and that recipe *has* a hover
    (`DESIGN.md:495-497`);
  - the mobile title is a borderless text button, which is the Ghost recipe (`:499`).
- **D6 M2 candidate list is partly wrong.**
  - It names "a `DataSectionLinks` link" and "a dashboard chip", but neither has a hover rule, so neither can be
    flattened.
  - "The mobile nav sheet trigger" is `.app-command-bar__mobile-title`, which also has no hover rule.
  - The MobileNavSheet hover rules (`MobileNavSheet.css:178,258,289`) are inside a sheet that is closed in the
    default DOM.
  - A valid M2 target does exist: `.app-command-bar__logo` is phone-only (`CommandBar.tsx:139`,
    `{isPhoneShell && …}`) and has gated hover rules (`App.css:128-131`, dark `:138-141`). Others also qualify,
    for example `.mobile-header__back:hover` (`PipelineMobile.css:43-44`). The plan just does not name one.

### Verdict: REFUTE

D2a reaches a sound decision on the one control it looked at. Its general rule then routes at least two more
foreseeable no-hover failures (dashboard chip / section links, phone section title) to an execution-time
escalation. The design gives no reason for treating them differently from the bottom nav, and §5 points the other
way. Fix this in the artifacts now. It should not reach the executor as a surprise.

### Change Requests

1. **Enumerate the foreseeable narrow-only D4a absences and decide each in design.md D2a.** Do the same
   `:hover`-rule check D2a did for `.bottom-nav__tab` on every control rendered only at 768 and below in D2's
   population: the command-bar logo, mobile title and New-chat button, `.dashboard-chip`,
   `.data-section-tabs__link`, the PipelineMobileLayout header/tab/body controls, and the phone `/home` controls
   (`PipelineRunsCard` is phone-gated). List each with its hover rule, or "none". At minimum,
   `.dashboard-chip` (`/dashboards`, `/connectors`) and `.app-command-bar__mobile-title` (`/dashboards`,
   `pipeline-detail`) need a decision. Pick one policy and state it:
   - **(a)** Add the DESIGN.md §5 recipe hover in scope, inside `@media (hover: hover)`, with before/after
     ratios. The chip gets Secondary: `--app-border-strong` + `--app-surface-soft`, and the active chip needs a
     state that still differs. The title gets Ghost: `--app-surface-soft`. Correct proposal.md "No app code
     expected" and the Impact list to match.
   - **(b)** Add a hover-only reviewed exemption per class, each with a written reason. This needs a reason that
     covers non-glass §5 controls, and one follow-up ticket per class.
   - **(c)** Raise the owner question now, as a planning-time ESCALATION, not mid-execution.

   Mixing policies is fine if each choice has its own reason. The "anything else → ESCALATION" clause should
   only cover findings the enumeration could not have predicted.
2. **Name M2's exact target in design.md D6 and tasks.md 2.2.** Remove the invalid candidates: `DataSectionLinks`,
   the dashboard chip, and the "mobile nav sheet trigger" (no hover rule, unless CR1 option (a) adds one). Name a
   phone-only control in the default DOM that already has a `(hover: hover)` rule, for example
   `.app-command-bar__logo` (`App.css:128-141`, rendered only when `isPhoneShell`). Name the exact rule(s) to
   flatten in each theme. Its light and dark hovers are separate rules (`--app-surface-soft` vs
   `--app-surface-strong`), so say which theme(s) M2 is expected to turn red, as D6 already does for M1.
3. **Make the spec consistent with the exemption policy.** The spec requirement says the guard measures hover on
   "bottom navigation tabs … dashboard chip row". If any of those controls stays exempt, its hover is not
   measured, so the requirement as written is false. Reword it (for example "measures focus, and hover except
   reviewed exemptions, on …"), or add a scenario that says an exempted narrow control's focus is still
   asserted.

### Non-blocking notes

- The proposal's "Why" still lists "tablet rail" and "phone-header refresh … found by hand". The phone-header
  refresh no longer exists (ticket premise notes, HEL-1582). Reword it as a historical note so a reader does not
  look for it.
- D2's 1100 `/connectors` cell: say explicitly in the guard header whether the Test-connection menu rendered,
  either way.
- Chrome partition credit in the current route cells uses `collectCandidates(…, MAX_ELEMENTS_PER_VIEW, …)`, which
  samples. D2 now *probes* narrow chrome as its own view. Keep the 24-element cap in mind: the phone command bar,
  bottom nav and section links together stay under it on these routes as far as I can see, but log the count.
