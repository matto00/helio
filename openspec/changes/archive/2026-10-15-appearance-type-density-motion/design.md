## Context

HEL-1571 (DESIGN.md v3) made sans + mono the default and defined `--font-heading` as the single heading switch and the
§10 motion contract (`data-motion="full|subtle|off"`, owned by this ticket). HEL-1574 added
`PATCH /api/users/me/preferences`, which merges validated keys into the `users.preferences` JSON text column
(`UserPreferenceRepository.mergePrefs`, jsonb `||`), and returns preferences on every user-returning auth response.
Accent is persisted separately via `PATCH /api/users/me/update` and applied by `ThemeProvider`.

Today: `frontend/app.html` has no pre-paint script (only `index.html`, the landing page, does); `ThemeProvider` applies
`data-theme` and accent in effects. The panel grid gutter is a JS constant (`panelGridConfig.margin = [18, 18]`) passed
to react-grid-layout. The global `@media (prefers-reduced-motion: reduce)` rule in `theme.css` is unscoped, and there
are component-level reduced-motion rules (`Skeleton.css`, `toast.css`, `RefinementChatDrawer.css`, `StreamingText.css`)
and a script check (`utils/prefersReducedMotion.ts`, used by chart options).

Design reference (precedence: ticket AC + owner rulings, DESIGN.md v3, HANDOFF.md, the board):
`.concertino/design/HEL-1570/screenshots/Appearance.png`. Its orange accent and hex values are illustration only.

## Goals / Non-Goals

**Goals:** the five AC; owner rulings; no new table; HEL-1573 can build on `data-motion` and the motion tokens.
**Non-goals:** themes; motion primitives (HEL-1573); DataGrid's own `density` prop; accent behaviour changes.

## Decisions

### D1. Persistence: three optional keys in `users.preferences` (no migration)
`typeStyle: "sans"|"mono"|"serif"`, `density: "comfortable"|"compact"`, `motion: "full"|"subtle"|"off"`. Each is
`Option` in `UserPreferencesData`/`UserPreferences` (absent = never set; invalid stored value dropped on read, same as
`contextListWidth`). `PATCH` validates each against its enum; `motion: null` (request schema only; the stored-preferences schema never carries null) removes the key (jsonb `- 'motion'` in the
same single UPDATE as the merge) so the user returns to following the OS. Values are lowercase tokens, not labels, so
copy can change without a data migration. **Field names avoid HEL-1575's `dashboardTabs`.** If #1032 merges first,
resolve the conflict in `UserPreferences` (jsonFormatN), `AllowedFields`, the two schemas, the repository and the
`user-ui-preferences` delta by union — never drop a field. Alternative rejected: a nested `appearance` object — it
would make PATCH partial-merge semantics two-level and diverge from HEL-1574's flat keys.

### D2. Root attributes, set in one place
`data-type-style` and `data-density` are always set (defaults `sans`/`comfortable`); `data-motion` is set only when a
motion choice is saved (DESIGN.md §10: absence = follow OS). A small `theme/appearancePrefs.ts` module owns: the enum
types and defaults, `applyAppearanceAttributes(prefs)` (writes the three attributes), the localStorage cache
(`helio-appearance`, JSON `{typeStyle, density, motion}`), and `effectiveMotion()` (attribute, else OS media query).
`ThemeProvider` remains the sole writer of root appearance state: it takes `preferredAppearance` from the auth user
(as it already does for accent) and applies it in a `useLayoutEffect` so a server value lands before paint of the
same commit. Setters update local state + DOM + cache immediately and PATCH via a new `saveAppearancePreferences` thunk
(fire-and-forget like `saveShellPreferences`; the response is not written back over newer local state).

### D3. Type style switches font tokens only (owner ruling Q2, 2026-10-15: Mono = whole UI)
- Sans + mono (default): no attribute override; `--font-heading: var(--font-sans)` as today.
- Serif headings: `:root[data-type-style="serif"] { --font-heading: var(--font-display); }` — headings and brand
  moments only.
- Mono: `:root[data-type-style="mono"] { --font-sans: var(--font-mono); }` — the WHOLE UI (body, controls, headings,
  data) renders in JetBrains Mono. Because `--font-heading` defaults to `var(--font-sans)` on `:root`, headings follow
  automatically; no component branches. The executor must confirm no component hardcodes a family that escapes the
  override (DESIGN.md §3 already bans that; record the grep).
**Raw face tokens.** Because Mono rebinds `--font-sans`, anything that must show a specific face regardless of the
active style (the three Type-style preview cards) cannot use `--font-sans`. `theme.css` therefore declares raw,
never-rebound face tokens — `--font-face-sans` (the Schibsted Grotesk stack), `--font-face-mono`, `--font-face-serif`
— and defines `--font-sans: var(--font-face-sans)`, `--font-mono: var(--font-face-mono)`,
`--font-display: var(--font-face-serif)`. Only the preview cards read `--font-face-*`, and only as the value of an inline `--font-heading`
override, never in a `font-family:` declaration (a documented exception in DESIGN.md §3); a test asserts the Sans card resolves to the sans face while `data-type-style="mono"` is set.
**Non-CSS consumers.** ECharts reads `--font-sans` once per option build (`chartAppearance.ts` `resolveChartTheme`,
used by `buildChartOption`/`referenceMarksOption`), and chart options also read `prefersReducedMotion()`.
`useChartOption.ts` and `UsageChart.tsx` recompute only on theme/accent today, so a live switch would leave charts
stale. `ThemeProvider`'s context exposes `typeStyle` and the effective motion, and both are added to those recompute
triggers. The jsdom tests do not rely on `theme.css` (jsdom never loads it): they set `--font-sans` inline on
`document.documentElement`, change it together with the context's `typeStyle`, and assert the rebuilt option's
global `textStyle.fontFamily` (`chartAppearance.ts` resolveChartTheme) changes; a motion switch is asserted on the
option's `animation` flag. Axis labels are already mono under every style and are not the signal.
**Font weights.** `app.html`'s Google Fonts link (both copies: the `media="print"` link and the `<noscript>` link)
loads JetBrains Mono at 400/500/600 only; add 700 to both so
`--weight-bold` sites are not synthesized under Mono.
Mono's wider metrics are the main risk. Required checks in both themes at 1280/820/768/375: no clipped or overflowing
labels in the shell rail/context list, tabs, buttons, form controls, BottomNav and overview tables; tabular numbers and
data-table columns still align; the touch-target (44px) and HEL-774 bottom-nav guards and the HEL-866
state-surface-contrast guard pass. These are checked under Mono (and each other style) by mechanism, never by a blanket box-size test:
- **Touch targets:** the existing HEL-813 specs (`e2e/hel813-mobile-touch-target-floor.spec.ts` and its
  `.regression` twin) are parametrized to also run with `data-type-style="mono"` (seeded via the appearance cache
  before load). Their own mechanism-aware assertions apply unchanged: box height for full-width rows, tabs and inputs;
  `bisectHitExtent` hit-area bisection for compact buttons whose painted box stays under 44px by design
  (`tapTarget.css`). The HEL-774 bottom-nav guards are jsdom CSS tests and font-independent, so they are not re-run.
- **Clipping:** "clipped" means an element whose computed `text-overflow` is NOT `ellipsis` and whose
  `scrollWidth > clientWidth + 1`. Intentionally ellipsized text (ContextList, command bar) is excluded by that
  definition. Checked at 375 on bottom-nav tab labels, command-bar buttons and every Appearance control; at
  768/820/1280 on rail labels, tab labels, overview-table header cells and Appearance controls. The sweep measures
  block/inline-block/flex containers (buttons, labels, cells), not bare inline spans. BottomNav tabs are icon-only, so
  at narrow widths the sweep covers the command bar and Appearance controls. The HEL-813 specs keep their own widths
  (430/768); the spec scenario says "phone-width". Fixture names are
  pinned in the spec (a 24-character dashboard name and the seeded section items) so the result does not depend on
  ambient data. Mutation proof: the spec must fail when a deliberately fixed-width (`width: 3ch`) label is injected.
- **Tabular alignment:** overview tables and `DataGrid` are real `<table>`s, so column alignment is structural and
  not re-checked. `.mono` is always JetBrains Mono, so a width check there cannot fail (measured at design gate r5).
  The failable check runs on a sans-inheriting `tabular-nums` site, `.run-history-modal__row-duration`
  (`RunHistoryModal.css`): equal-digit-count values ("1111", "8888") render at equal width (±0.5px) under every
  style; mutation proof: removing its `tabular-nums` fails the Sans + mono run. Plus a recorded grep that no
  `tabular-nums` site reads `--font-heading`.
- **Mono is actually on:** every Mono run first asserts `data-type-style="mono"` on `<html>` and a computed
  `font-family` on `body` that starts with "JetBrains Mono"; otherwise the run fails.
- **Contrast:** the HEL-866 `state-surface-contrast-guard` spec is also run with Mono set, both themes.
**Appearance page tap targets (every style).** `AccentPicker`'s swatches are 20×20 with an 8px gap and no expander,
which already misses the floor. The new layout (the board shows larger swatches) makes them 28px circles with a
`--space-4` (16px) gap and a `tapTarget.css`-pattern `::after` expander sized EXPLICITLY 44×44px (width too, not
height only), so expanders touch and never overlap; the hover `scale(1.15)` is moved off the swatch element onto an
inner painted circle so the expander never scales;
selection/behaviour unchanged (reversible overnight-class UI change, listed in the PR). Type-style cards are ≥ 88px
tall by content. Density/Motion segments are full-height buttons whose painted box is `--control-h` on desktop and
take the `tapTarget.css` expander on coarse pointers, the same mechanism as other compact buttons, verified by
`bisectHitExtent`.
Where a fixed-width control truncates under Mono, fix it with the existing
truncation/flex patterns, never by a Mono-specific branch. DESIGN.md §3: the "mono never for a title" rule gets an
explicit exception for the opt-in Mono style; Fraunces is already loaded by `app.html`.

### D4. Density token set (owner ruling Q1, 2026-10-15)
Comfortable is the desktop default gutter for everyone: **12px**, introduced by HEL-1576 as `GRID_GUTTER_PX = 12`
in `panelGridConfig.ts` (its branch is unmerged; main still has 18). Compact is 8px with row-height compensation.

| token / value              | Comfortable (default)        | Compact                                   |
| -------------------------- | ---------------------------- | ----------------------------------------- |
| `--density-grid-gap`       | 12px (`--space-3`, = `GRID_GUTTER_PX`) | 8px (`--space-2`)                 |
| grid `rowHeight` (JS only) | 52                           | 56 = 52 + (12 − 8)                        |
| `--density-row-pad-y`      | `--space-2` (8px, today's row padding) | `--space-1` (4px)               |

react-grid-layout panel height is `h·rowHeight + (h−1)·margin` and a panel top is `y·(rowHeight + margin)`. The row
step is 64 in both sets, so panel tops never move and shared dashboards look the same to every viewer; each panel is
exactly 4px taller in Compact (h=5: 308 → 312). Compensation is derived, not hard-coded:
`compactRowHeight = rowHeight + (GRID_GUTTER_PX − COMPACT_GRID_GUTTER_PX)`, so it stays correct whatever the default
gutter is. **Ordering with HEL-1576:** whichever lands first, the other merges it. If HEL-1576 lands first we adopt
its `GRID_GUTTER_PX`. If this lands first, this change introduces the same constant name `GRID_GUTTER_PX` at today's
value (18; Compact rowHeight then derives to 62) and the CSS Comfortable token at 18px; HEL-1576's change to 12 then
conflicts only on that one value, and the TS↔CSS sync guard fails until the CSS token is updated too, so the two
cannot drift. Horizontal row padding is not a density token. Applied to the desktop panel grid only
(`DesktopPanelGrid`, `DesktopPanelGridSkeleton`; the phone stack is unaffected), the section overview list tables
(once in the shared table component where the tables share one; the executor enumerates with a recorded grep) and
the shell `ContextList` rows. Panel internals and `DataGrid` are unchanged. Density is read in JS through a
`useDensity()` hook. Touch layouts keep the 44px minimum. DESIGN.md "Spacing" gains this table.

### D5. Motion precedence and the exact Off contract (HEL-1573 builds on this)
"Reduced motion in effect" = saved `off`, or no saved choice and OS `reduce`. In `theme.css`:
- the existing global rule becomes `@media (prefers-reduced-motion: reduce) { :root:not([data-motion]) *, … }` with
  the same `!important` declarations, plus an identical unconditional `:root[data-motion="off"] *, …` block;
- `:root[data-motion="off"]` sets exactly: `--motion-duration-quick`, `--motion-duration-standard`,
  `--motion-duration-emphasized`, `--motion-duration-highlight` = `0.01ms`; `--motion-stagger` = `0ms`;
  `--app-transition` = `0.01ms ease`; `--transition-slow` = `0.01ms cubic-bezier(0.3, 0.9, 0.4, 1)`. Near-zero, not
  `0s`, matching the global rule, so `transitionend`/`animationend` still fire for HEL-1573 primitives that wait on
  them. `--toast-exit-duration` (toast.css) is also set to `0.01ms`. Loop tokens (`--app-skeleton-shimmer`, `--app-spin-duration`) are left to the blanket rule and the component
  rules, as today. The same values apply to the OS-scoped no-preference case via the media block.
- `:root[data-motion="subtle"] { --motion-ease-overshoot: var(--motion-ease-out); }`. That is all Subtle does in
  this ticket: the sheet, drawer and toast keep their translate entrances under Subtle until HEL-1573 implements the
  per-primitive Subtle rules (DESIGN.md §10 says Subtle has no translate; the gap is stated in DESIGN.md and the PR).
Component rules get the same two-selector shape (OS-scoped `:root:not([data-motion])` + `:root[data-motion="off"]`):
`Skeleton.css`, `toast.css`, `RefinementChatDrawer.css`, `StreamingText.css`, `MobileNavSheet.css`, `BottomNav.css`
(whose `transition: none` relies on the global rule; its spec requires a cleared transition property).
`utils/prefersReducedMotion.ts` (used by `chartAppearance.ts`) returns reduced-motion-in-effect with that precedence,
and a reactive `useReducedMotion()` hook sits alongside `effectiveMotion()`. A guard test asserts every
`prefers-reduced-motion` media block under `frontend/src` (excluding `frontend/src/landing/`) scopes its selectors
with `:root:not([data-motion])` and has an `[data-motion="off"]` twin; mutation-checked. **The landing page
(`landing/landing.css`, `build.ts`, `reel.ts`) is excluded and left unscoped:** it is served from `index.html`, never
carries `data-motion` (no signed-in preferences there), so the OS setting is the only signal and today's behaviour is
correct. Specs whose reduced-motion wording changes get MODIFIED deltas: `shared-skeleton`, `mobile-dashboard-sheet`,
`mobile-bottom-nav`, `echarts-chart-panel`.

### D6. No flash: inline pre-paint script in `app.html`
A tiny inline script in `<head>` reads `helio-appearance` and sets the three attributes (validated enum sets; any
parse error → no-op). `ThemeProvider` keeps the cache in sync with server values. Sign-out clears the cache and resets the root attributes to defaults from the
logout path/ThemeProvider (not inside the `clearAuth` reducer, which must stay pure). New device: `ProtectedRoute`
renders a spinner until auth status is `authenticated` (verified at design gate), and the server value is applied in a
`useLayoutEffect` in the commit that renders the shell, so the first authenticated heading paint is already in the
saved face. A pick updates the stored user preferences in Redux optimistically, then PATCHes. Verified in a real
browser (Playwright): a `MutationObserver` installed via `addInitScript` records the computed `font-family` of the
first heading at insertion, on both the cached-reload and no-cache (new device) paths; the check is shown to FAIL
with the pre-paint script disabled. Serif users may briefly see the Georgia fallback before Fraunces loads — still
the serif style, not a flash of the default; noted in the PR.

### D7. Settings → Appearance layout
Matches the board: heading "Appearance" with the subtitle "Make Helio yours. Changes apply instantly and follow you
across devices."; mono eyebrow labels in a left column, controls right. Rows in order: Accent (`AccentPicker`
unchanged), **Mode** (the existing light/dark toggle — required in Appearance by `frontend-theme-system`; placed
second, directly under Accent; overnight reversible placement), Type style, Density, Motion, Theme. Type style: three
radio cards (`role="radiogroup"`) each previewing "Markets & Business" + a mono number in that style's heading face
via an inline `--font-heading` override set to that style's raw face token (`--font-face-sans|mono|serif`, D3), so
each card shows its own face whatever style is active. Density/Motion: segmented
radio groups from existing control tokens (reuse a `shared/ui` component if one fits). Theme row: dashed placeholder
"Stone (default). Themes bundle accent, type style, surfaces and texture in one pick." with a "Later" `StatusChip`, no
control. Under Motion, when a choice is saved, a text button "Use system setting" clears it (reversible overnight UI
decision, listed in the PR). Accent-agnostic: selection states use `--app-accent*` tokens only. Mobile (375): labels
stack above controls; type cards stack vertically.

## Risks / Trade-offs

- Density touches every list/grid page and typography touches every page → the full Playwright suite (≤2 workers,
  `nice -n 19`) and the contrast guards (HEL-866 state-surface-contrast-guard) must pass in both themes on the final
  head. Screenshots at 1280/820/768/375, both themes, each type style and density.
- Scoping reduced-motion rules is security-of-comfort sensitive: a missed rule means OS reduce-motion users with no
  saved choice see motion. The guard test in D5 is the mitigation.
- HEL-1575 merge conflict — resolved by union (D1).
- `users` has no RLS (V88): isolation is proven by a backend test against the non-superuser app role.

## Owner rulings (escalation HEL-1572-1792056001350-38c965, answered 2026-10-15 via chat)

1. Q1 `recommended` with the gap override above: Comfortable = 12px default gutter (HEL-1576), Compact = 8px with
   compensated rowHeight 56; list/context-list row padding 8→4px; panel internals, DataGrid, phone stack unchanged.
2. Q2 `whole-ui-mono`: Mono switches the whole UI to JetBrains Mono (D3), with legibility/contrast/alignment and
   touch-target/HEL-774 checks.
3. Q3 `recommended`: keys `typeStyle`/`density`/`motion`; attributes `data-type-style`/`data-density`/`data-motion`;
   tokens `--density-grid-gap`/`--density-row-pad-y`.

Context recorded with the escalation: the Mode (light/dark) row sits second in Appearance (required by
`frontend-theme-system`, reversible); under this ticket Subtle only drops the overshoot curve (translate entrances stay
until HEL-1573); Off pins motion tokens to 0.01ms, never 0s.
