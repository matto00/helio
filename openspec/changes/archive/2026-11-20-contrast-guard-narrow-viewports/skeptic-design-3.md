## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed against the live tree at HEAD 4f101209bd50fed23f5534a8f4be3cc310051d63. The change dir is untracked and
there is no code yet. This is a static review of CSS/TSX with line numbers cited. I did not run the app.

### What I verified (with evidence)

**The owner ruling exists.** `.concertino/runs/HEL-1649/events.jsonl` contains an `escalation.answered` event from
`answer_source: "human"`, `resolution_channel: "chat"`. It says: "mix: add DESIGN.md §5 hovers (gated on hover:hover)
to .dashboard-chip (Secondary) and .app-command-bar__mobile-title (Ghost); exempt only glass .bottom-nav__tab hover
with a written reason and a follow-up ticket". C1 in tasks.md and workflow-state.md matches it. I did not re-litigate
it.

**Round-2 CR2 (M2 target): addressed.**
- D6 and tasks 2.2 name `.app-command-bar__logo`.
- It is phone-only (`CommandBar.tsx` `isPhoneShell`).
- It has both gated hover rules: `app/App.css:127-131` (light, `--app-surface-soft`) and `:137-141` (dark,
  `--app-surface-strong`).
- The command bar backdrop is `--app-surface` (`App.css:78`). Flattening both rules to it gives a ratio of 1.0 in both
  themes, so "red at 768 and 390 in both themes" is a sound prediction.
- The invalid candidates are gone.

**Round-2 CR3 (spec vs exemption): addressed.** The spec says "The only hover exemption at narrow widths is the glass
bottom-navigation tab ... its focus state SHALL still be measured". A new scenario requires a visible hover on the
chips, section links and section title.

**C1 implementation, as far as it goes, is sound.**
- Active-chip scoping works on both surfaces. `DashboardChipRow.tsx:129` and `DataSectionTabs.tsx:25` both use
  `dashboard-chip--active`, so `:not(.dashboard-chip--active)` keeps the ink fill on both.
- Gating on `(hover: hover)` follows DESIGN.md §5 and HEL-1675.
- The token fallback is correct. The logo's comment (`App.css:116-125`) records that `--app-surface-soft` on
  `--app-surface` collides in dark and that the logo uses strong in dark. D2a's "measure, then theme-split like the
  logo" rule therefore covers the Ghost title hover on the same `--app-surface` command-bar backdrop.
- The bottom-nav exemption is hover-only and keyed on the `[class]` identity. This matches the existing `isExempt`
  shape (`state-surface-contrast-guard.ts:706-710`).

**Round-2 CR1 (enumerate every foreseeable narrow-only absence): NOT fully addressed. This is the REFUTE.**
D2a lists four controls. The live tree has at least two more foreseeable D4a failures in D2's own population that the
plan does not decide. Both will hit D2a's "otherwise ESCALATION" clause mid-execution, which is the exact failure
round 2 refuted.

1. **The active dashboard chip and the active section link.**
   - The plan deliberately gives `.dashboard-chip--active` no hover ("keeps its rest paint").
   - The guard has no generic already-active handling. `classifyState` (`e2e/support/stateContrast.mjs:200-218`)
     returns `fail` with `ratio: null` whenever nothing changes on hover. The three existing exemptions are named
     per class. None of them covers chips.
   - On `/dashboards` the guard seeds exactly one dashboard (`DASH_NAME`, guard `:571`). On fetch,
     `dashboardsSlice.ts:468` selects the most recent dashboard. So the only chip in the 768/390 cell is the active
     one. Two things follow:
     - (a) It D4a-fails on the final, post-0.1 tree.
     - (b) The new `:not(--active)` hover is never exercised on `/dashboards` at all. That contradicts D2a's "Checked
       on both surfaces" and task 0.1's "verify ratios ... on /dashboards".
   - On `/connectors` the "Connectors" link carries `dashboard-chip--active` (`DataSectionTabs.tsx:22-25`), so it
     D4a-fails the same way.
   - The spec scenario "Phone-only pills ... show a hover a mouse user can see" applies to every chip, the active one
     included.
   - C1 forbids exempting anything but `.bottom-nav__tab`, so an exemption is not available without going back to
     the owner.
   - Round 2 CR1(a) already said "the active chip needs a state that still differs".
2. **`.tl-disc__head`, the phone `/home` run disclosure.**
   - `PipelineRunsCard.tsx` renders `RunDisclosureList` when `coarse || phone` (`:61-62`), so it appears at 768 and
     390 with a fine pointer.
   - The `/home` cell seeds runs (`seedHomeActivity: routeKey === "/home"`, guard `:784`; `seedPipelineRuns` `:616`),
     so the disclosure rows render.
   - `.tl-disc__head` (`RunDisclosureList.tsx:34-37`, a `<button>`) has a `:focus-visible` rule
     (`HomePage.css:429`) and no hover rule anywhere. `grep -rn "tl-disc__head\|dashboard-chip" --include=*.css
     frontend/src | grep -i hover` returns nothing (exit 1).
   - Round 2 CR1 named "the phone /home controls (PipelineRunsCard is phone-gated)" for enumeration. D2a's inventory
     omits them.

Other phone-only controls I checked are covered:
- `.mobile-header__back`, `.mobile-tabs__tab`, `.mobile-pill` and `.mobile-btn` all have gated hover rules
  (`PipelineMobile.css:43,235,454,187`). D2a's one-token-fix clause covers them if one measures low.
- `.app-command-bar__mobile-new-chat` renders only on `/chat` (`CommandBar.tsx:220`). That route is not in D2's
  population.

**Red-first ordering is internally contradictory.**
- tasks.md puts section 0 (task 0.1, the app CSS) before section 1.
- Task 1.4a then says to run the narrow spec "on main BEFORE task 0.1".
- An executor working top-down would do 0.1 first and destroy the red evidence. That evidence is the only proof that
  the guard catches the chip and title absences.

**Policy text contradicts itself on new findings.**
- design.md Risks says: "anything larger becomes a follow-up ticket and a reviewed exemption naming it".
- D2a ("Any OTHER narrow-only control that fails on main is not exempted ... otherwise ESCALATION"), the spec ("The
  only hover exemption at narrow widths is the glass bottom-navigation tab") and C1 all forbid that.
- The proposal's Non-goals ("larger findings become follow-up tickets") reads the same way as the Risks text.

### Verdict: REFUTE

The owner ruling is implemented correctly for the four controls it names. But the plan still leaves two foreseeable
narrow-only D4a failures for execution:
- the active chip/link, which the plan's own scoping creates on both chip surfaces;
- the phone `/home` disclosure head.

It also orders the red-first evidence after the fix it is meant to precede.

### Change Requests

1. **Decide the active chip and the active section link in D2a.** Pick one and state it:
   - **(a)** Add an active-state hover inside `@media (hover: hover)`:
     `.dashboard-chip--active:hover` with a visibly different ink fill (for example a `color-mix` of `--app-text`
     toward `--app-surface`, or the ink ramp's next rung), with the measured ratio against the backdrop recorded in
     both themes. This stays inside C1's "add hover" ruling.
   - **(b)** If an exemption is wanted, raise it as a planning-time ESCALATION now. C1 says "exempt ONLY
     .bottom-nav__tab", so the planner cannot add one.

   Also seed a **second** dashboard in the narrow `/dashboards` cells, or in all `/dashboards` cells if the 1440
   population is unaffected (it adds a sidebar row there, so check the 1440 `--list` and counts). Without it, the
   non-active Secondary hover is actually measured on `/dashboards` as task 0.1 and the spec claim. Update the
   readiness gate to match.
2. **Add `.tl-disc__head` (phone `/home`, `RunDisclosureList.tsx:34`, `HomePage.css:812`) to the D2a inventory and
   decide it.**
   - Either apply the same policy as the mobile title: a §5 Ghost hover, gated, theme-split per the token rule. The
     backdrop is the home card surface, not the command bar, so measure it.
   - Or escalate it now.
   - Re-run the enumeration over every phone-only branch on `/home` (`HomePage.css` `max-width: 768px` blocks and
     `useIsPhoneShell`/`coarse` branches) and list each control with its hover rule or "none". Do the same for any
     other route in D2 the inventory skipped. The "otherwise ESCALATION" clause should be left with only genuinely
     unpredictable findings.
3. **Fix the red-first ordering in tasks.md.** Move the app-CSS task after the red-first run: renumber 0.1 to sit
   after 1.4a's red run, or split 1.4a into "1.4a red run on main" then "0.1 app CSS" then "1.4b exemption +
   green". The red log must show the D4a lines for `.dashboard-chip`, `.data-section-tabs__link`,
   `.app-command-bar__mobile-title`, `.tl-disc__head` (if CR2 adds a hover) and `.bottom-nav__tab`.
4. **Reconcile the new-finding policy text.**
   - design.md Risks: drop "and a reviewed exemption naming it", because it contradicts D2a, the spec and C1.
   - proposal.md Non-goals: say that a larger finding is an ESCALATION, or a follow-up with the lane halted, never
     an exemption.

### Non-blocking notes

- tasks.md 2.2 has a garbled duplicate: "-> red at 768 and 390 naming it -> red at 390 naming it". Keep one.
- The mobile title has `padding: 0` and no radius (`App.css:358-370`), with `min-height: 44px` at 768 and below. A
  bare `--app-surface-soft` fill will paint a 44px-tall slab hugging the text with square corners. Specify
  `border-radius: var(--app-radius-sm)` in the hover rule (focus-visible already uses it). Also decide whether a
  small inline padding is acceptable, given the ellipsis layout comment at `:372-384`. The final-gate skeptic will
  judge this visually.
- The proposal's "Why" still cites the "phone-header" refresh and the "tablet rail" as live. This is carried over
  from round 2.
