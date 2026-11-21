## Standing Constraints

- [C1] Owner ruling: add DESIGN.md s5 hovers in @media (hover: hover) -- Secondary on .dashboard-chip (check /dashboards chips and /connectors DataSectionLinks, both themes), Ghost on .app-command-bar__mobile-title; exempt ONLY .bottom-nav__tab hover (hover-only isExempt, written reason, cites HEL-1801), focus stays asserted; M2 = .app-command-bar__logo
- [C2] Owner ruling (general-rule): commit the narrow-guard red run on main as the empirical inventory; give EVERY narrow-only no-hover control the DESIGN.md s5 hover matching its resting recipe inside @media (hover: hover), including the active chip and active section link; seed a second dashboard so the non-active chip hover is measured; exempt only the glass bottom nav (HEL-1801); list the inventory with before/after ratios in the PR; a control that fits no s5 recipe is escalated

## 1. Tests (guard extension)

- [x] 1.1 Create lane DB `helio_hel1649`, start servers with its DATABASE_URL (ANTHROPIC_API_KEY empty); verify `/health`
- [x] 1.2 Add the optional viewport parameter to the guard's cell registration; verify 1440 titles/populations unchanged (`--list` diff)
- [x] 1.2a Seed a second dashboard in the narrow cells only (1440 populations unchanged) so a non-active chip renders on /dashboards; verify two chips in the phone chip row
- [x] 1.3 Add `e2e/state-surface-contrast-guard-narrow.spec.ts` (1100: /home, /connectors; 768+390: pipeline-detail, /dashboards, /home, /connectors; both themes); verify `--list` shows 20 cells
- [x] 1.4 Per width, declare views, chrome scope and readiness (D3: no context-list <=768, phone-layout marker, refresh button visible+enabled) so `assertPartitioned` passes; verify per-view counts logged
- [x] 1.4a Red first (C2): run the full narrow spec on main BEFORE task 1.4b, commit the log, and write `hover-inventory.md` (every narrow-only control that fails, class, route/width/theme, resting recipe, ratio); add the `[bottom-nav__tab]` hover-only exemption (reason, HEL-1801)
- [x] 1.4b (ONLY after 1.4a's red log is committed) Give every inventoried control (C1, C2: incl. `.dashboard-chip`, active chip/section link, `.app-command-bar__mobile-title`, `.tl-disc__head`) its §5 hover in `@media (hover: hover)`; escalate any control fitting no §5 recipe; verify after-ratios >= 1.10 both themes, recorded in `hover-inventory.md`
- [x] 1.4c Phone /home readiness: at 768/390 the runs timeline is a `list` named "Pipeline runs, last 24 hours" (RunDisclosureList), not a `group`; gate on that role at narrow widths; verify the cell passes readiness
- [x] 1.4d Record each narrow view's visible/sampled counts in `hover-inventory.md`; split any narrow view where sampled < visible so the inventory is complete
- [x] 1.5 Confirm the spine-card sample-refresh button is probed at 768 and 390 (log line), splitting a view if sampling can drop it
- [x] 1.6 Update the guard header's "Single viewport" scope comment to the new matrix and the D1 pointer reasoning

## 2. Tests (evidence)

- [x] 2.1 M1 (remove the PipelineSpine.css sample-refresh hover rules) -> full narrow spec red at 768 and 390, naming the button; also record the 1440 pipeline-detail cell result; log saved; reverted; red evidence committed
- [x] 2.2 M2 (flatten both `.app-command-bar__logo` hover rules to the command bar backdrop) -> red at 768 and 390 naming it; log saved; reverted; committed
- [x] 2.3 Unmutated: full narrow spec green, both themes, plus the three existing guard parts green; logs saved
- [x] 2.4 Measure runtime (per cell and per file, 2 workers) and `node scripts/e2e-shard.mjs plan` placement; record in `ci-impact.md`
- [x] 2.5 Lint/format/typecheck on touched e2e files; verify zero warnings
