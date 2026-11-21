## Context

The guard (`e2e/support/state-surface-contrast-guard.ts`, parts `e2e/state-surface-contrast-guard-*.spec.ts`)
runs in the default Playwright `dev` project viewport (1440x900, fine pointer). Each cell registers a fresh user,
seeds a dashboard, a static source and a pipeline with a `limit` step, visits a route, stamps every visible enabled
`INTERACTIVE_SELECTOR` match (`stampDocument`), probes views with a real mouse hover and CDP focus-visible
(`probeView`), asserts the stamped set is partitioned by the views (`assertPartitioned`) and fails any state under
1.10 (`finishCell`). Its header comment says "Single viewport (1440x900)... viewport is not a dimension this guard's
population varies over" -- no longer true since the redesign.

Width gates in the app: `PHONE_SHELL_QUERY = "(max-width: 768px)"` (`app/shell/useIsPhoneShell.ts`) picks the phone
shell; `PipelineMobile.css` uses `@media (max-width: 768px), (pointer: coarse)`; HEL-1735 wrapped feature hover rules
in `@media (hover: hover)`. The HEL-1628 pre-fix hover that survives is the spine card's sample-refresh rule pair in
`features/pipelines/ui/spine/PipelineSpine.css`; the phone-header refresh no longer exists (HEL-1582 deleted
`PipelineDetailHeader.css`; `SourceSampleLabel` is rendered by `SpineSourceCard` at every width).

## Goals / Non-Goals

**Goals:** narrow cells at 1100/768/390 x dark/light; deterministic mutation evidence at 768 and 390; measured,
stated CI cost. **Non-Goals:** see proposal.md; also no change to the 1440 cells' populations or titles.

## Decisions

**D1 -- Pointer: fine (hover-capable) at every width.** Narrow cells set only `viewport` (no `isMobile`/`hasTouch`).
Reasoning: (a) the layouts the ticket names are width-gated (`max-width: 768px`), so a fine-pointer 768/390 context
renders the phone shell and mobile pipeline; (b) under touch, `(hover: hover)` is false and HEL-1735's gated rules
never apply, so a hover probe there either reports D4a "nothing changed" for every control or measures nothing -- it
cannot express "this hover is invisible"; (c) touch's own hover contract (no sticky fill after a tap) is already
guarded by `hel1675-shared-hover` and `hel1735-feature-hover`. A narrow desktop window and a trackpad tablet are real
hover-capable narrow devices, so hover there must be visible. Alternative rejected: touch at 768/390 -- cannot fail
on an invisible hover, so it cannot satisfy the AC's mutation. Alternative rejected: `isMobile` with a forced
`(hover: hover)` media emulation -- Playwright has no such emulation, and it would model no real device.
Consequence (named, not hidden): layouts gated only on `(pointer: coarse)` above 768 px (touch tablet) are not
measured for focus by this guard; recorded as a scope note in the guard header.

**D2 -- Population (revised after skeptic-design-1 CR1).** Cells exist only where the layout actually changes:
- 1100 px: `/home` (`HomePage.css` `max-width: 1100px`) and `/connectors` (`ConnectorsPage.css:304` and
  `TEST_CONNECTION_MENU_BREAKPOINT_PX = 1100` in `ConnectorsPage.tsx`). `pipeline-detail` and `/dashboards` have no
  1100 gate (grep of `max-width: 1100px` and JS width gates), so they are not repeated at 1100. The `/connectors`
  1100-only control (Test-connection menu) needs a connector row; the executor seeds one over the API if the API
  allows it without live credentials, otherwise records why the menu cannot render and the cell still measures the
  1100 tap-target layout.
- 768 and 390 px (phone shell, width-gated): `pipeline-detail` (mobile layout, phone spine), `/dashboards` (chip row),
  `/home` (phone home), `/connectors` (phone-only `DataSectionLinks`). `/sources` also carries `DataSectionLinks`;
  it is the same component, so covering it once on `/connectors` is enough and is stated in the guard header.
- Total: 2x2 + 4x2x2 = 20 cells. Chrome outside `<main>` (phone command bar, bottom nav, mobile nav sheet trigger) is
  probed in the same cell as its own view; the partition check runs over the whole document, so a narrow-only
  control no view names fails loudly. Chrome exclusion selectors are adjusted per width, never by exempting elements.

**D2a -- Phone-only controls with no hover rule (owner rulings C1 and C2, 2026-11-20).** Static reading kept missing
these (three design rounds), so the inventory is EMPIRICAL: the full narrow spec runs on main before any app CSS
change, its red log is committed, and `hover-inventory.md` lists every narrow-only control it fails (class, route,
width, theme, resting recipe, ratio before/after). Rule (C2): each such control gets the DESIGN.md §5 hover that
matches its resting recipe, inside `@media (hover: hover)`:
- hairline pill / transparent resting (`.dashboard-chip`, also the `DataSectionLinks` links): Secondary hover
  (`--app-border-strong` + `--app-surface-soft` + full text);
- borderless text button (`.app-command-bar__mobile-title`, `.tl-disc__head` if borderless): Ghost hover
  (`--app-surface-soft`) with `--app-radius-sm` and §5 inline padding so it paints a button shape;
- active ink-filled chip / section link (`.dashboard-chip--active`, background `--app-text`): a hover that stays
  within its own resting recipe's family (e.g. deepen/lighten the ink fill or its border by one rung); the exact
  token is measured to clear 1.10 both themes and recorded. If no §5 recipe fits a control, ESCALATION.
- If the §5 token measures below 1.10 against the real backdrop in a theme, use the theme split a neighbouring
  control already uses (`.app-command-bar__logo`: soft light / strong dark) and record both ratios.
Already known: `.app-command-bar__logo` has gated hover rules (measured as-is; M2's target). Only exemption:
`.bottom-nav__tab`, hover-only `isExempt` entry, reason = glass carve-out (DESIGN.md §0.2), touch-first, design
deferred to HEL-1801; its focus stays asserted. No other exemption. A narrow cell seeds a SECOND dashboard (narrow
cells only, so 1440 populations are unchanged) so a non-active chip exists on `/dashboards` and its hover is measured.

**D3 -- Narrow readiness and deterministic coverage of the mutated element (skeptic-design-1 CR3).**
- At <=768 there is no `.context-list` (`App.tsx` `showRail = !isPhoneShell`): drop the `sidebar-rail` view and the
  `seeded(sidebar, ...)` gate; `/dashboards` gates on `DASH_NAME` visible in the phone layout instead.
- Phone `pipeline-detail` has no default selected row or focused editor: replace those assertions with a phone-layout
  marker (the mobile layout's root/Steps tab) asserted present.
- `pipeline-detail` at every width waits for the button named `Refresh sample of HEL-866 Guard Source` to be visible
  AND enabled before `stampDocument` (it is absent until access resolves and `disabled` while the sample loads, and
  the stamp skips disabled elements).
- The M1 proof SHALL show that button's line in the failure output. If a view exceeds the 24-element cap so the
  button can fall out of the sample, split the view (spine vs. rest) rather than raise the cap globally.
- Record whether M1 also goes red in the existing 1440 `pipeline-detail` cell (viewport gap vs. sampling gap).

**D4 -- Code shape.** Parametrise the existing machinery: `registerRouteCells` (or a sibling) takes an optional
viewport `{ width, height }` and applies it via `test.use`/`page.setViewportSize` before the cell's first `goto`;
titles gain a width suffix only for the new cells (1440 titles unchanged). New cells live in one new part file
`e2e/state-surface-contrast-guard-narrow.spec.ts` (split into two parts only if one file's measured time exceeds the
heaviest existing part), `mode: "parallel"`, no hooks, same as HEL-1789's parts. Heights: 1100x900, 768x1024,
390x844. Readiness gates per route are reused; any width-specific readiness signal is a real DOM signal, never a
sleep.

**D5 -- Shard weights.** `e2e/README.md` requires `e2e/shard-weights.tsv` be regenerated only from CI artifacts,
never by hand; a new file is weighted at the median default and printed as `defaulted`. This change does not edit
the table. The PR states the new file's measured duration (local, 2 workers, and the PR's CI leg) and whether the
median default under-weights it; regeneration stays with HEL-1645 / the next weights pass.

**D6 -- Mutation evidence.** M1: delete the two `.spine-card .source-sample-label .ui-icon-btn:hover:not(:disabled)`
rule blocks in `PipelineSpine.css` (restores HEL-1628's pre-fix ghost hover) -> expected red at 768 and 390 (dark;
light's fixed and pre-fix colour are the same token). M2: `.app-command-bar__logo` -- set both `(hover: hover)` hover rules' backgrounds (light `--app-surface-soft`,
dark `--app-surface-strong`) to the command bar's own backdrop token -> expected red at 768 and 390 in both themes,
naming `[app-command-bar__logo]`. (Also proves a phone-chrome view is really probed.) Each mutation is applied in a
scratch copy of the edit, run, logged, and reverted; logs are committed as evidence before the final green run.
The red runs use the full narrow spec file, not a grep-filtered subset.

## Risks / Trade-offs

- [CI time: 20 cells at ~8-15 s, ~200-250 s serial; the new file defaults to the 62 s median weight] -> measure; split
  into two part files (by width) if one file exceeds the heaviest existing part (117 s); state the under-weighting.
- [Narrow cells find real existing failures] -> no exemption beyond C1's bottom-nav entry: a one-token fix inside an
  existing hover rule with before/after ratios, otherwise ESCALATION before proceeding.
- [Width-specific flake: layout settling after resize] -> viewport set before first `goto`; readiness gates reused.

## Planner Notes

- Self-approved: fine-pointer-only narrow cells (D1), route set (D2), D2a inventory (owner-ruled: Ghost/Secondary hovers added, bottom-nav hover exempt), not hand-editing shard weights (D5). These follow
  from repo facts (HEL-1735 gating, README procedure); no product decision is involved.
- Sibling lanes HEL-1637 (backend) and HEL-1697 (`features/pipelines` draft evaluator) -- do not touch their files;
  M1/M2 mutations are never committed.
