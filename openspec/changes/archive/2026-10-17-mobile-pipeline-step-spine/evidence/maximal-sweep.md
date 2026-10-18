# Maximal sweep (HEL-1582, final gate, skeptic round 3)

One deliberately widest fixture, swept with the C8 two-axis `elementFromPoint` hit-area bisection (every control,
selects, inputs and labels included), at 375x812, 390x844 and 768x1024, in both themes. The e2e is `MAXIMAL sweep (C8,
both axes)` in `e2e/hel1582-mobile-pipeline.spec.ts`.

**Fixture:** a source with 17 columns (14 extra, long names) and a long source name; a long pipeline name; every step
kind the server accepts (27 steps, including a branch lane off Compute and an Analyze with AI step with 8 long-named
output fields); three Outputs with long names; a Partial last run with an 8-digit count (12,345,678 rows); a paused cron
schedule; a failed run with a ~350-character error in the run history.

**Surfaces swept per size and theme:** header; tabs; the Steps list; the pills; the Pipeline actions, Source actions and
Output card menus (opened); the Preview tab (the step chooser, its opened listbox, the "N fields" disclosure and its
opened panel); the Runs tab, with the failed run's log expanded; every step row's editor and preview in the open sheet
(27 sheets). Horizontal page overflow is also asserted on each surface.

**Result after the fixes:** 0 failures and no horizontal overflow, in all 6 size-theme cells. AC1's 3-step fit at 375x812
is unchanged (the existing AC1 tests pass).

## Findings (AC4 misses), control, surface, before to after

| # | Control | Surface | Before | After |
|---|---|---|---|---|
| 1 | "N fields" disclosure trigger (`.output-schema-disclosure__trigger`) | Preview tab and the step sheet's preview header | hit height 17.75px (no expander) on the Preview tab; about 35px in the sheet, where the sheet's `::after` was clipped by `.step-preview { overflow: hidden }` | invisible 44px `::after` under the touch gate; the header takes `padding-block: var(--space-4)` when it holds the trigger, so the expander stays inside the clip. Hit height 44 at 375, 390 and 768 |
| 2 | Schema filter field (`.schema-field-viewer__filter`) inside the disclosure panel | Preview tab, opened disclosure panel | painted 28px tall (bisected below 43.75) | `min-height: 44px` under the touch gate |
| 3 | The disclosure panel itself, and so its filter field | Preview tab at 390x844, trigger far right of a wrapped header | the panel opened at the trigger's left edge, 350px wide: its right edge at x=626 on a 390px viewport, so the filter field was entirely off screen and not tappable | the open position is clamped horizontally to the viewport (8px margin). That alone did not make the panel reliably usable: see finding 5 |
| 5 | The disclosure panel (skeptic round 4) | Inside the open step sheet, and a trigger high on the screen | the panel was portalled to `document.body`, so inside the modal sheet it rendered beneath the dialog (its centre hit-tested to the editor under it), and it always opened upward, so a trigger near the top put the panel's top edge above the viewport | it portals into `trigger.closest("dialog[open]") ?? document.body` (the ActionsMenu and Select pattern), opens below when above has less room, and its height is capped to the room on the chosen side; the maximal sweep now also opens it inside a sheet |
| 4 | Harness only | the sweeps | a 44px expander at the very edge of a scroll viewport is cut by the viewport | `sweepFloor` scrolls each control to the centre of its scroller before bisecting (scrolling, not a tap-target defect) |

## Not AC4 or AC-level, not fixed

- The skeptic's earlier notes (the "Static" repeat, the "off Compute column" wording, sticky touch hover on tabs, the
  `PipelineRiverSkeleton` naming) are unchanged.
