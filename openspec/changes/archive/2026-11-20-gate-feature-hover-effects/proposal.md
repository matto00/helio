## Why

HEL-1668 gated the pipeline page's hover rules and HEL-1675 gated every stylesheet under `frontend/src/shared/`, each
with a guard. The remaining feature stylesheets (app shell, dashboards, panels, sources, settings, home, onboarding,
landing, the pipelines list, ...) still hold about 174 ungated `:hover` rules in 62 files (measured on main 894a72c56),
so a touch tap leaves those fills, borders and colours stuck until the next tap lands elsewhere. DESIGN.md already
states the rule and names this gap (HEL-1735).

## What Changes

- Every ungated `:hover` rule in a stylesheet under `frontend/src/` that neither guard covers today is wrapped in place
  in `@media (hover: hover)`; mixed selector lists are split so focus/active/selected/pressed members stay ungated.
- Hover REVEALS (a control reachable only through hover) stay ungated and are named, with a reason, in the new guard's
  allowlist; each one's touch path is recorded.
- A third guard covers every stylesheet under `frontend/src/` outside `shared/` and the pipeline guard's files,
  discovered by walking the tree, so a new feature stylesheet is covered with no list to update.
- DESIGN.md §5's hover paragraph names the new guard and drops "Other feature stylesheets are not yet covered".
- Evidence: the scripted inventory, a structural before/after equivalence check, a touch e2e (red first) and a
  desktop computed-style comparison.

## Capabilities

### New Capabilities
- `feature-stylesheet-hover-gating`: hover effects in feature stylesheets apply only on hover-capable pointers, with a
  guard over every non-shared, non-pipeline-page stylesheet and a named reveal allowlist.

### Modified Capabilities

## Non-goals

- No visual change on hover-capable devices; no change to any focus, active, selected, pressed or disabled state.
- `shared/` and the pipeline page's guarded files (already gated by HEL-1675/HEL-1668) are not re-touched.
- No new hover affordances for touch, no redesign of any reveal.

## Impact

Frontend CSS across ~62 feature stylesheets, a new jest guard, a small export from `frontend/src/test/cssHoverGating.ts`,
DESIGN.md, and a new e2e spec. No backend, schema or migration change.
