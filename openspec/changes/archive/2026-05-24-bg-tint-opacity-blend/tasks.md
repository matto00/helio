## 1. Frontend — CSS

- [x] 1.1 Add `--dot-grid-opacity` CSS custom property to `:root` in App.css (or theme.css) with per-theme values; apply it in `.app-shell::before` so the dot intensity is independently tunable without touching the accent token.
- [x] 1.2 Verify dot-grid `::before` z-index (currently 5) remains above `.app-command-bar` (z-index 2) and `.app-sidebar` (z-index 4) so the overlay doesn't bleed into chrome elements — add `pointer-events: none` check if not present.

## 2. Frontend — appearance.ts constants

- [x] 2.1 Tune dashboard tint strength in `resolveDashboardBackground` (currently 0.22) based on visual inspection across dark/light themes; document final value in a comment.
- [x] 2.2 Tune grid background alpha values in `resolveDashboardGridBackground` (currently 0.94 dark / 0.97 light) for better grid-to-shell contrast; document final values.
- [x] 2.3 Verify panel alpha formula in `buildPanelSurface` (`0.9 - transparency * 0.72`) produces ~0.18 at transparency=1.0; adjust if the floor or slope needs correction.

## 3. Tests

- [x] 3.1 Add a concrete `buildPanelSurface` assertion: at transparency=0 alpha should be ~0.9; at transparency=1.0 alpha should be ~0.18.
- [x] 3.2 Add a `resolveDashboardGridBackground` assertion with a known hex: verify the returned rgba alpha matches the dark/light tuned constants.
- [x] 3.3 Ensure existing appearance tests still pass after constant changes (update snapshot values if needed).
