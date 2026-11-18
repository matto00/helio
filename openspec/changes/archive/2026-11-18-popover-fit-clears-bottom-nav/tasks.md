## Standing Constraints

- [C1] The red-before proof must not weaken D4 checks (b) elementFromPoint or (c) elementsFromPoint-excludes-nav; record which went red.

## 1. Probe

- [x] 1.1 D0 probe at 390x844 and a short phone viewport on a lane-private DB (`helio_hel1762`): record popover rect, nav rect and `elementsFromPoint` stack at the provenance popover's last item in `.concertino/scratch/HEL-1762/probe.md`; verify the file exists with all three measurements (or return an ESCALATION per D0).

## 2. Shared fit

- [x] 2.1 Add `bottomInset` to `PanelFitOptions` / `fitPanelVertically` (D1) and `readBottomInset` (D2) in `frontend/src/shared/ui/panelFit.ts`; verify with new `panelFit.test.ts` cases, red under the D4 mutation and green after.
- [x] 2.2 `fitSelectPanel` gains `bottomInset`; verify with `selectPanelFit.test.ts`.

## 3. Callers

- [x] 3.1 Pass `readBottomInset(panel)` from provenance, ActionsMenu, Select and DashboardAppearanceEditor; switch `outputSchemaPanelPlacement.ts` to the shared reader (D3); verify existing unit tests for each stay green (`npm --prefix frontend test -- --testPathPatterns="panelFit|selectPanelFit|ActionsMenu|Select|DashboardAppearanceEditor|outputSchemaPanel|usePortalPopover|rovenance"`; confirm the matched suite count in jest output).
- [x] 3.2 Record caller 6 (UserMenu) finding and the HEL-1746 ask drawer / phone sheet dialog check in the PR notes; verify by stating the measured placement.

## 4. e2e

- [x] 4.1 Write `e2e/hel1762-popover-clears-bottom-nav.spec.ts` per D4 (provenance + one ActionsMenu case, 390x844 and short phone, light and dark); verify red under the mutation (saved output in scratch) and green after.
- [x] 4.2 Run the full `hel1750-actions-menu-viewport-fit`, `hel1756-popover-viewport-fit` and `hel1759-popover-keyboard-focus` spec files plus the new spec; verify all pass (Playwright 2 workers).

## 5. Gates

- [x] 5.1 `npm run lint`, `npm run typecheck`, `npm run format:check`, frontend jest (3 workers) green; commit.
