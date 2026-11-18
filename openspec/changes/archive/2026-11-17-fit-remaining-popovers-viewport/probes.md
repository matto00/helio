# Probes (task 1)

Method: a throwaway Playwright spec (deleted before commit) against this lane's servers (DEV_PORT 7188; every record carries
`location.port` = 7188, 12 of 12 desktop/phone user-menu and editor records checked). Seeded: a dashboard with 6 table-Output
panels (filter, sort, assert steps, one run) and the throwaway user's rail. Sizes 1280x400, 1280x320 (desktop) and 390x500,
390x400 (phone), light and dark. Raw records: `.concertino/scratch/HEL-1756/probe.jsonl`.

## UserMenu: FITS (left unchanged)

| size | panel top-bottom (viewport) | last item (Sign out) top-bottom | last item inside | elementFromPoint |
| --- | --- | --- | --- | --- |
| rail 1280x400 | 230-388 | 352-383 | yes | the item |
| rail 1280x320 | 162-320 | 284-315 | yes | the item |
| nav 390x500 | 228-425 | 376-420 | yes | the item |
| nav 390x400 | 128-325 | 276-320 | yes | the item |

Identical in light and dark. The menu is 158px (free tier, 4 items) so it only clips below about 166px of window height, far
shorter than any real desktop or landscape-phone window; the owner tier's extra Usage item adds about 31px (still fits at
320). Decision: unchanged. (Rail panel bottom edge sits flush with the trigger bottom by design, D2 note; every item is
inside the viewport and hit-testable at every probed size.) The `bar` variant has no consumer (AppRail passes `rail`, BottomNav
`nav`), unchanged.

## DashboardAppearanceEditor: CAN CLIP (converted in cycle 2)

Cycle 1 probed only the freshly opened state and concluded "fits"; that was wrong (evaluation-1.md issue 1). The panel grows
after it opens: a preset that trips the contrast warning (in light the dark-surface presets Twilight, Forest, Plum, Ember,
Storm, Teal, Rose, Gold; in dark Paper, Mist, Sage, Blush) adds about 51px, and a failed save adds an InlineError of about
15px. Re-probed through Playwright on port 7188 (every record `location.port` 7188), light and dark, identical:

| state | size | form top-bottom | Save top-bottom | Save elementFromPoint |
| --- | --- | --- | --- | --- |
| just opened | 1280x400 | 94.5-383.5 | 334.5-366.5 | the button |
| just opened | 1280x320 | 35.5-324.5 (cycle-1 probe, seeded dashboard of 6 panels: trigger bottom 27.5) | 275.5-307.5 | the button |
| after a warning preset | 1280x400 (bare dashboard, trigger bottom 86.5) | 94.5-435.1 | 386.1-418.1 | NOT the button (cut off) |
| after a warning preset | 1280x320 (bare dashboard) | 94.5-435.1 | 386.1-418.1 | fully outside the 320px viewport |
| warning + failed save (evaluator) | 1280x400 | 94.5-450.1 | InlineError 418.1-433.1 | outside |

Note the form top depends on the page: on a bare dashboard the trigger sits at y 58.5 (form top 94.5, re-measured this cycle on port 7188: open 94.5-383.5 at 1280x400, and with the fix capped 94.5-312 at 1280x320); on the seeded 6-panel dashboard of the cycle-1 probe it sat higher (form top 35.5). The clipping conclusion holds for both.

The panel is `position: fixed`, so scrolling the page cannot bring Save into view. Phone: not rendered (App.css, 768px).
Decision: convert (D2, D7, D9, D11, D12): measured placement through `usePortalPopover({ place })` and `fitPanelVertically`, the
hook's `panelRef` on the form (new class `.dashboard-appearance-editor__panel` carries `overflow-y: auto`), hidden until placed,
`maxHeight`, and a ResizeObserver on an uncapped inner wrapper that calls `reposition()`. No focus-on-open is added (D13).
The form is `display: block` with no gap, so the inner wrapper is a plain block div and the layout is unchanged.

## Provenance popover: CAN CLIP (converted)

Probed after content loaded. Trigger = the card's info button. "inside" = the whole popover inside the viewport; the popover is
capped at 280px (70vh) in a 400px window and 224px at 320px.

| size | trigger top-bottom | popover top-bottom | inside | last-section hit |
| --- | --- | --- | --- | --- |
| 1280x400, first card | 331-355 | 43-323 | yes | yes |
| 1280x400, other cards (scrolled) | 236-260 | -52-228 | NO (top edge 52px above the viewport) | yes |
| 1280x320, first card | 192-216 | -40-184 | NO | yes |
| 1280x320, other cards | 137-161 | 169-393 | NO (73px below the 320px viewport) | NO |
| 390x500, first card | 170-194 | 202-552 | NO (52px below) | yes |
| 390x500, other cards | 232-256 | 264-614 | NO (114px below) | NO |
| 390x400, every card | 170-194 / 182-206 | 202-482 / 214-494 | NO | NO |

Identical in light and dark. The old heuristic (open above only when under 320px of room below and more room above) never
measured the popover, so a trigger mid-viewport pushed it past an edge. Decision: convert (D2, D6-D9, D11).

Expected, not jitter: a popover opened while loading ("Loading provenance...", about 60px) may open below and flip above
once its content arrives (D8).

## Conclusions

- UserMenu: fits (numbers above). Appearance editor: clips once its content grows (warning, save error), fixed in cycle 2. Provenance: clips, fixed.
- D2 (UserMenu rail variant a/b) is moot: UserMenu is not converted.
- D3/D12 apply to the provenance popover and the appearance editor: the hook's `panelRef` is now attached, so each closes when
  focus leaves the trigger and the panel together. Moving focus between its own controls does not close it (unit test), the Tab wrap holds
  (existing test), and focus-in on open is proven in a real browser (e2e).
- **Behavior change (D3, D14), appearance editor.** Before this change the editor had no `panelRef`, so the hook's close-on-
  focus-out never engaged: a keyboard user could open it with Enter and Tab on to the portalled form (awkwardly, but reachably).
  Attaching `panelRef` (needed for measured placement) opts it into that close, and with no focus-on-open the first Tab after a
  keyboard open left trigger and panel together and closed it (evaluation-2: `afterTab {open:false, active:"Open assistant"}`).
  Decision (D14, amends D13): once placed, focus moves to the selected preset (or the first control), keyed on `placed` like D6.
  Proven by a real-browser e2e (Enter on the trigger, focus inside the form, a real Tab keeps it open with focus inside), red
  first on d4969e8d9 (`red-editor-kbd.txt`), light and dark. Net effect: the editor is now reached by keyboard more directly than
  before, and mouse behavior is unchanged.
