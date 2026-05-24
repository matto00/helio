# HEL-129 — Dashboard/panel background tint — refine opacity and blend behaviour

## Description

The dot-grid overlay was moved into `.app-shell::before` at `z-index: 5` to ensure it renders above background overrides. Panel surface alpha floor was set to 0.9 to preserve glass effect at transparency=0.

## Remaining items

- Verify the dot-grid is visible across all theme/background combinations in both light and dark mode
- Consider exposing tint strength (currently hardcoded at 0.22 for dashboard, 0.24 for panels) as a user control
- The `resolveDashboardGridBackground` alpha values (0.94 dark / 0.97 light) may need tuning
- Panel transparency slider range (0.9 → 0.18 alpha) should be user-tested for feel

## Acceptance Criteria

1. Dot-grid overlay is visible across all theme/background combinations (light and dark mode).
2. Tint strength values (0.22 for dashboard, 0.24 for panels) are evaluated and either tuned or exposed as user controls.
3. `resolveDashboardGridBackground` alpha values (0.94 dark / 0.97 light) are reviewed and tuned if needed.
4. Panel transparency slider range (0.9 → 0.18 alpha) is verified to feel smooth and usable.
5. All changes are verified through lint, format, and test gates.

## Context

This ticket is part of the v1.3.1 UI-polish batch. Prior batch changes already present:
- HEL-128: menu/handle sizing
- HEL-284: PanelCard.tsx extraction + memoization
- HEL-258: zoom controls moved to floating bottom-right widget, dashboard header simplified
