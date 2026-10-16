## Why

Helio's motion is a scattering of one-off transitions; the owner's top complaint is a "general lack of motion".
HEL-1572 shipped the Motion setting and DESIGN.md §10 tokens, but nothing consumes them as a system: there are no
shared primitives, Subtle only swaps one easing curve, the panel grid still runs at 180/100/200ms (HEL-1032), and
charts enter at echarts' 1000ms default and replay it on every option change (HEL-1034). HEL-1584 (motion pass)
is blocked on a stable primitive API.

## What Changes

- One effective-motion reader for React (`useMotion()` -> full|subtle|off) built on the existing
  `ThemeProvider` `effectiveMotion` context and `appearancePrefs.effectiveMotion()`; `useReducedMotion` and
  `prefersReducedMotion` become thin derivations of it. No second reader.
- Two motion-role tokens in `theme.css` that make Subtle real for primitives: a movement duration (zeroed under
  Subtle and Off) and a rise distance (0 under Subtle and Off). A JS helper reads token durations from the cascade.
- Five shared, unit-tested primitives, each with at least one real consumer: staggered entrance (dashboard list),
  layout slide (dashboard list FLIP), value tween (metric panel value), crossfade (panel body skeleton to
  content), indicator slide (app rail + segmented radio group).
- Panel grid: item, placeholder and container transitions all use one token duration and the ease-out curve
  (CSS-only; closes HEL-1032). The motion guard's HEL-1032 literal exception is removed.
- Charts: entrance runs at a token duration once per chart mount and is not replayed by option changes; Subtle and
  Off render without entrance animation (closes HEL-1034).
- Subtle made real for the existing translate entrances DESIGN.md names (toast, mobile nav sheet, refinement chat
  drawer): opacity-only under Subtle. `--app-transition`/`--transition-slow` documented as permanent token aliases.
- DESIGN.md §10 documents the primitive APIs, the new role tokens and the Subtle rules as implemented.

## Capabilities

### New Capabilities
- `motion-primitives`: shared motion primitives, their Motion-setting behaviour, and panel-grid layout timing.

### Modified Capabilities
- `appearance-preferences`: Subtle drops translation, scale, overshoot, layout slide and value tweens for primitives.
- `echarts-chart-panel`: chart entrance timing and no replay on option change.

## Impact

Frontend only: `theme/`, `shared/motion/` (new), `app/shell/AppRail`, `shared/ui/SegmentedRadioGroup`,
`features/dashboards/ui/DashboardList`, `features/panels/ui/{PanelContent,renderers/MetricRenderer,ChartPanel}`,
`features/adminUsage/ui/UsageChart`, `features/panels/ui/grid/PanelGrid.css`, toast/MobileNavSheet/RefinementChatDrawer CSS, `utils/chartAppearance.ts`, DESIGN.md,
e2e spec for real-browser reduced-motion verification. No backend, schema or API change.

## Non-goals

- Rewriting the ~290 existing `--app-transition` / `--transition-slow` consumers: the shorthands become documented
  aliases of the motion tokens and already obey Off; applying primitives to more surfaces is HEL-1584.
- The dashboard tab strip indicator (HEL-1575 owns the tab strip) and any `PanelGrid.tsx`/`DesktopPanelGrid.tsx`
  logic change, including a staggered entrance inside the panel grid (HEL-1584, after HEL-1575 lands).
