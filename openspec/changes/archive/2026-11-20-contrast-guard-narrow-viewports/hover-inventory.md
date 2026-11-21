# Hover inventory (HEL-1649, owner rulings C1 and C2)

Empirical inventory: the full narrow spec (`e2e/state-surface-contrast-guard-narrow.spec.ts`, 20 cells, 2 workers) run on
unchanged app CSS (main), with only the guard extension and the `[bottom-nav__tab]` hover-only exemption applied.
Log: `evidence/01-red-on-main-narrow-full.log.txt` (committed BEFORE any app CSS change). 16 of 20 cells red; the 4 green
cells are `/home` and `/connectors` @1100px and `pipeline-detail` @768 and @390 minus its command-bar title (see below).

Every failing line is `ratio=n/a`: nothing the guard tracks changes on hover (no hover rule exists at all). Hover only
(focus passes everywhere). Before-ratio is therefore "none (1.000)".

## Controls that fail (narrow-only, no hover)

| Control (class)                                                       | Where (route @ width, both themes)                                                  | Resting recipe                                                          | Before         |
| --------------------------------------------------------------------- | ----------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | -------------- |
| `.dashboard-chip` (button, non-active)                                | /dashboards @768, @390                                                              | transparent + `--app-border-subtle` hairline pill                       | n/a (no hover) |
| `.dashboard-chip.dashboard-chip--active` (button, ink fill)           | /dashboards @768, @390 (the NEWER dashboard B is active)                            | `--app-text` fill + border, `--app-surface` text                        | n/a (no hover) |
| `.dashboard-chip.data-section-tabs__link` (links, `Sources`, `Connectors`) | /connectors @768, @390 (`Connectors` is the active, ink-filled one)           | same pill as above (active = ink)                                       | n/a (no hover) |
| `.app-command-bar__mobile-title` (switcher title)                     | chrome@768 and @390 on /dashboards ("Switch dashboards ...") and pipeline-detail ("Switch data pipelines ...") | borderless, transparent, `padding: 0`, text `--app-text` | n/a (no hover) |
| `.tl-disc__head` (runs disclosure head)                               | /home @768, @390                                                                    | borderless, transparent, full-width row, `padding: space-3 0`           | n/a (no hover) |

Exempt (hover only, written reason, owner ruling C1, deferred to HEL-1801): `.bottom-nav__tab` (5 tabs, every cell at
768 and 390). Glass is a DESIGN.md section 0.2 carve-out and the bar is touch-first. Its focus is still asserted (green).

Passing on main (measured, no change needed): `.app-command-bar__logo` (gated hover rules, M2's target), the spine-card
sample-refresh button at 768 and 390 (probed, see the log line `[HEL-1649 guard] "Refresh sample of ..." probed`;
M1 turns it red), every other control in the 20 cells.

## Not inventoried, and why

The plan's task 1.1/D2 allowed a seeded connector at 1100px so the `/connectors` row actions render. A first run with
one seeded (`POST /api/connectors`, HTTP 201) failed three controls at 1100px (`.connectors-page__row` hover,
`.connectors-page__btn` "Test connection" hover, `.popover__trigger` row-actions) at ratio 1.057 dark / 1.054 light.
They are not narrow-only: the row hover and the actions trigger are plain unconditional rules, rendered at every width
(only the `Test connection` standalone button vs. menu item differs by width, and the menu item exists only while the
row ActionsMenu popover is open, which no stamp or probe opens). So a seeded connector adds no 1100-only control
the guard can measure, and it would add pre-existing, width-independent failures that are out of this ticket's scope.
The seed was dropped; `/connectors` @1100 measures the page without a row (the tap-target layout). Spinoff
candidate: connector row / actions / Test connection hover is 1.05 against the 1.10 floor at every width (this
ticket did not measure it at 1440, where no connector row is seeded).

## Per-view visible / sampled counts (D3, skeptic-design-4 note 2)

Every narrow view is fully sampled (visible == sampled, max 14 <= MAX_ELEMENTS_PER_VIEW 24), so no view needed
splitting. This is now ENFORCED in the guard (`fullySampled` in `support/state-surface-contrast-guard-narrow.ts` fails a
cell whose view is under-sampled), not just recorded. From the red run's log:

```
view "chrome@1100" (dark): 11 visible, sampled 11
view "chrome@1100" (light): 11 visible, sampled 11
view "chrome@390" (dark): 10 visible, sampled 10
view "chrome@390" (dark): 8 visible, sampled 8
view "chrome@390" (dark): 9 visible, sampled 9
view "chrome@390" (light): 10 visible, sampled 10
view "chrome@390" (light): 8 visible, sampled 8
view "chrome@390" (light): 9 visible, sampled 9
view "chrome@768" (dark): 10 visible, sampled 10
view "chrome@768" (dark): 8 visible, sampled 8
view "chrome@768" (dark): 9 visible, sampled 9
view "chrome@768" (light): 10 visible, sampled 10
view "chrome@768" (light): 8 visible, sampled 8
view "chrome@768" (light): 9 visible, sampled 9
view "/connectors@1100" (dark): 1 visible, sampled 1
view "/connectors@1100" (light): 1 visible, sampled 1
view "/connectors@1100:sidebar-rail" (dark): 0 visible, sampled 0
view "/connectors@1100:sidebar-rail" (light): 0 visible, sampled 0
view "/connectors@390" (dark): 3 visible, sampled 3
view "/connectors@390" (light): 3 visible, sampled 3
view "/connectors@768" (dark): 3 visible, sampled 3
view "/connectors@768" (light): 3 visible, sampled 3
view "/dashboards@390" (dark): 3 visible, sampled 3
view "/dashboards@390" (light): 3 visible, sampled 3
view "/dashboards@768" (dark): 3 visible, sampled 3
view "/dashboards@768" (light): 3 visible, sampled 3
view "/home@1100" (dark): 8 visible, sampled 8
view "/home@1100" (light): 8 visible, sampled 8
view "/home@1100:sidebar-rail" (dark): 0 visible, sampled 0
view "/home@1100:sidebar-rail" (light): 0 visible, sampled 0
view "/home@390" (dark): 7 visible, sampled 7
view "/home@390" (light): 7 visible, sampled 7
view "/home@768" (dark): 7 visible, sampled 7
view "/home@768" (light): 7 visible, sampled 7
view "/pipelines/:id@390" (dark): 14 visible, sampled 14
view "/pipelines/:id@390" (light): 14 visible, sampled 14
view "/pipelines/:id@768" (dark): 14 visible, sampled 14
view "/pipelines/:id@768" (light): 14 visible, sampled 14
```

## After: hover added (task 1.4b), measured ratios

Run: `evidence/03-green-narrow-full-ratios.log.txt` (full narrow spec, `HEL_GUARD_LOG_RATIOS=1`, 20 passed). The ratio is
the guard's: the composited hover colour against the control's resolved backdrop, floor 1.10. Before = no hover at all.
`evidence/02-css-try1-two-controls-still-red.log.txt` is the first CSS attempt: the section 5 tokens measured under 1.10
on two backdrops and were moved to the section 3 state-rung for that backdrop (below).

| Control                                            | Hover added (all in `@media (hover: hover)`)                                                                 | Dark ratio | Light ratio |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ---------- | ----------- |
| `.dashboard-chip` inactive (/dashboards, Sources link) | Secondary: `--app-border-strong` + `--app-surface-raised` (try 1: `--app-surface-soft` = 1.057 dark / 1.054 light on the `--app-bg` canvas, under floor) | 1.187      | 1.119       |
| `.dashboard-chip--active` (active chip, active section link) | ink fill steps one rung to `--app-text-muted` (fill + border), `--app-surface` text kept; no section 5 recipe paints an ink fill | 7.805      | 5.727       |
| `.app-command-bar__mobile-title`                   | Ghost: soft light / strong dark (the logo's measured split, same `--app-surface` backdrop); padding + negative margin + radius so it paints a button without moving | 1.133      | 1.150       |
| `.tl-disc__head`                                   | Ghost: `--app-surface-soft` light / `--app-surface-strong` dark (try 1: soft = 1.030 dark); padding + negative margin + radius | 1.133      | 1.150       |
| `.bottom-nav__tab`                                 | none: hover exempt (glass, HEL-1801); focus still asserted                                                   | exempt     | exempt      |

Note on the active chip: its ratio is hover-fill vs backdrop (the guard's definition); the step the user sees is
ink (`--app-text`) to `--app-text-muted`.
