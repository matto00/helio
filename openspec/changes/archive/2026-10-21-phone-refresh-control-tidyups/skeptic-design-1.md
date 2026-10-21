## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD edd3a028fa070f126d36993eba7fb8afa27c7d37 (= origin/main; change dir untracked). Artifacts: ticket.md, proposal.md, design.md, tasks.md, specs/mobile-dashboard-pull-refresh/spec.md.

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/phone-refresh-control-tidyups/HEL-1681`.
- **AC coverage.** Item 1 maps to D1-D4 and D9, with a red-first e2e in task 1.1 that fails on base because the button does not exist yet. Items 2-4 map to D7, D6 and D5, and item 5 maps to D8. Each item has a "fixed or measured" path. Scope stays within the ticket: the Table `touch-action` bug and threshold changes are listed as non-goals. No placeholders or TBDs that block implementation.
- **Design's current-state claims, checked against the tree:**
  - `MobilePanelStack.tsx:169-199,276`: the registry is held in `useState`. The busy subscription sets "Refreshing"/"Refreshed" in an always-mounted `role=status` region. The indicator renders on `pull.active || busy`. Matches the design.
  - `pullRefreshRegistry.ts`: `start()` returns false when busy or with no entries. There is no entry-count observable today, so D2 is needed.
  - `usePullToRefresh.ts:27` has `PULL_HOLD_PX = 48`. `MobilePanelStack.css:219` has `--pull-indicator-height: 48px`. The settle effect (`:262-279`) runs only when `holdingRef` is set and sets phase `idle`. `PullRefreshIndicator.tsx` maps non-busy, non-ready to "Pull to refresh". So item 4's mechanism is as described.
  - `usePullToRefresh.ts:163`: engagement is gated on `!busyRef.current`, so a pull during a button round never engages. This is consistent with the spec's busy scenario. Holding/settling only follows a pull-started hold, so a button round cannot trigger a settle jump. D4 holds.
  - `DashboardRefreshLine.tsx`: the slot is reserved for pipeline-fed dashboards via `feedingOutputIds` (the `panel.type === "output"` set of `config.outputId`). That is the same predicate as `getOutputId(panel) !== null`, which gates `usePullRefreshRegistration` (`panelNarrowing.ts:33`). So "output-bound ⇒ slot already reserved from first paint" is true, and the button appearing in the slot cannot shift cards.
  - Spec delta: ADDED requirements fit the existing `openspec/specs/mobile-dashboard-pull-refresh/spec.md`, and nothing in it is contradicted.
- **Problems found (below):** `PanelList.tsx:314-318` vs `:405-432` (zoom container), `DashboardMetaRow.css:92-104`, `PanelList.css:108`, `DashboardChipRow.css:8-11,62-69`, `tapTargetTestUtils.ts:63-77`, and DESIGN.md §3 (lines 302-357) and §5 (lines 513-546).

### Verdict: REFUTE

### Change Requests

1. **D1: say exactly where the provider sits, so the grid's zoom container is never remounted.**
   - **Where things are:** the refreshed line and chip row are a conditional fragment (`PanelList.tsx:314-318`). The grid is not part of that fragment. It renders inside `.panel-list__zoom-container`, which is deliberately "a SINGLE, ALWAYS-MOUNTED element".
   - **Why it matters:** the comment at `PanelList.tsx:405-428` records that remounting it orphaned `useContainerWidth`'s one-shot `ResizeObserver`, and `gridContainerWidth` went to `0`. D1 says only that the provider "wraps the phone content in `PanelList` (refreshed line, chip row and grid)". Read literally, that is an `isPhoneShell ? <Provider>…zoom container…</Provider> : …zoom container…` wrapper. That changes the zoom container's tree position on every phone/desktop crossing and brings back that regression.
   - **Required revision:** the provider (or its context) must be mounted unconditionally, with the same element type at every width, around both the phone fragment and the zoom container. Alternatively, the design must name another placement that provably leaves the zoom container's position unchanged.
   - Say which owner calls `registry.dispose()`. Today it is the stack's unmount effect, at `MobilePanelStack.tsx:178-181`.
   - Drop the "(or stays owned by)" either/or for the status region. Pick one owner.
   - Add a check: crossing 768px both ways keeps the same zoom-container DOM node, and `gridContainerWidth` stays non-zero. Either a jest node-identity assertion or an e2e width probe.

2. **D3: the planned hit expander would be clipped, and the planned guard cannot see it.**
   - **The clip:** `.dashboard-refresh-line` has `overflow: hidden` and a fixed height of `calc(var(--text-xs) * 1.6)` = 19.2px (`DashboardMetaRow.css:97-99`). A `::after` expander inside it is clipped to 19.2px, and clipped area is not hit-testable.
   - **Why the guard misses it:** `expectTapExpander()` (`tapTargetTestUtils.ts:63-77`) only regex-checks the CSS text, so it passes on a clipped expander. DESIGN.md §3 names this exact failure as "invisible to screenshots and unit tests".
   - **The geometry also rules out a centred expander:**
     - Above the line is the phone `.panel-list` top padding, `--space-5` = 20px (`PanelList.css:108`).
     - Below it is an 8px margin, then the chip row. The chip row is 44px, and its chips' 44px `::after` fills the row from its top edge (`DashboardChipRow.css:8-11,62-69`).
     - So a centred 44px expander overlaps the chip row's hit band by about 4.4px.
     - There are about 47px of free block extent (20 + 19.2 + 8), so a 44px target fits only if it is anchored upward.
   - **Required revision, D3 must say:**
     - (a) How the expander escapes the clip. For example, `overflow: hidden` moves from the line to the fact element, or the button is placed outside the clipped box. Keep the fact's truncation at 320px intact.
     - (b) The expander's block placement: offset upward so it ends at or above the chip row's top. Check that the command bar's expanders do not reach into that 20px band.
     - (c) Replace "shrink the expander's block extent … within the rule" with an explicit 44px floor, which is §3 [mechanical]. A sub-44px target is not an allowed fallback. If 44px cannot be had without overlap, stop and escalate the placement, because the 44px floor cannot be traded away.
   - **Task 2.4** must bisect the button's real hit extent in **both** axes with `elementFromPoint`, per §3 and Appendix A.4, at 375 and 430 with touch emulation. Record the numbers. The CSS-text guard alone is not evidence.

3. **D3: settle `IconButton` versus a hand-rolled button.** DESIGN.md §5 requires the shared `IconButton` for icon-only controls. It allows a hand-rolled `<button>` only for a "genuine, documented reason", for example a size below 24px. D3 specifies a raw `<button>` "per §5 icon-only button rules" but never invokes that exception. `IconButton`'s smallest size (`xs`, 24px) is taller than the 19.2px fixed line, so it would break the line's height and shift the cards. The implementer has to choose between breaking the line height and breaking §5, and the design picks neither explicitly.
   - **Required revision:** state that this is the documented §5 exception (a sub-24px painted control inside a 19.2px fixed-height caption). Give the painted box size and the glyph size (an `ICON_SIZE` token). Keep both `aria-label` and `title`, as already planned. Have the code comment carry the exception rationale.

### Non-blocking notes

- proposal.md "Modified Capabilities" says the phone chart card "renders its marks after first load under every Motion level", but there is no spec delta for that. D7 allows a "measured, not fixed" outcome, so a SHALL would be wrong. Drop that clause from the proposal, or add the requirement only if item 2 is actually fixed.
- D3 changes the line's markup: `aria-hidden` moves from the `<p>` to an inner placeholder. `DashboardRefreshLine.test.tsx`'s reserved-slot assertions will need updating. Keep their intent (slot height identical when empty, reserved or filled; no shift) and do not delete them.
- D5's glyph choice of `Check` and the button's placement are reversible UI decisions, correctly marked for the PR's "UI decisions taken overnight". Nothing here needs owner escalation.
