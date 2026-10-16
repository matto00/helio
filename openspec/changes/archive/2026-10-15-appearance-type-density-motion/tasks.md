## Standing Constraints

- [C1] Bash `timeout: 600000` on every gate. Local caps: jest ≤3 workers (`HELIO_JEST_MAX_WORKERS=3`), Playwright ≤2
  workers, `nice -n 19`, ≤3-4 parallel workers, `sbt testFull` in foreground shards. Never `pkill`/`pgrep`/`killall`;
  stop servers only via `scripts/concertino/stop-servers.sh`. Never edit rendered Concertino files.
- [C2] Every cited test run must show this worktree's paths and non-zero counts.
- [C3] Before Delivery: the FULL jest suite and the FULL Playwright e2e suite on the final head (≤2 workers, `nice -n 19`), with the contrast
  guards passing in both themes.

- [C4] Off (and no-pref + OS reduce) motion tokens are near-zero `0.01ms` (`--motion-stagger` `0ms`), never `0s`, so
  `transitionend`/`animationend` still fire (HEL-1573 contract).
- [C5] Comfortable density = the desktop default gutter (`GRID_GUTTER_PX`; 12px once HEL-1576 lands), rowHeight 52,
  `--space-2` row padding. Compact = 8px gutter, rowHeight derived as 52 + (GRID_GUTTER_PX − 8), `--space-1` rows
  (owner ruling Q1).
- [C6] Mono type style = whole UI in JetBrains Mono via font tokens only (owner ruling Q2); verify legibility,
  contrast (both themes), table/tabular alignment, touch targets and the HEL-774 guard under Mono.

## 1. Backend persistence

- [x] 1.1 Add `typeStyle`, `density`, `motion` (all `Option[String]`, validated enums) to `UserPreferencesData` and
  `UserPreferences` (+ jsonFormatN); read with invalid-value dropping in `getPreferences`.
- [x] 1.2 Extend `UserPreferencesRoutes` `AllowedFields` + validation (enums; `motion` also accepts `null`).
- [x] 1.3 Repository: one-statement merge that also removes `motion` when cleared.
- [x] 1.4 Route the new fields through every place that builds `UserPreferences` (PATCH response, auth responses).
- [x] 1.5 Tests: accumulate, enum rejections (400, nothing changes), null clears, accent/shell keys survive, auth/me
  carries the fields, cross-user isolation through the non-superuser app role.

## 2. Contracts and specs

- [x] 2.1 Update `schemas/auth/user-preferences.schema.json` and `update-user-preferences-request.schema.json`; keep
  schema-drift check green.
- [x] 2.2 Frontend `User`/`UserPreferences` types + `saveAppearancePreferences` thunk/service.

## 3. Frontend application of preferences

- [x] 3.1 `theme/appearancePrefs.ts`: enums, defaults, attribute writer, cache, `effectiveMotion()`; unit tests.
- [x] 3.2 `ThemeProvider`: `preferredAppearance` input, layout-effect application, setters (optimistic Redux update,
  then PATCH), cache sync; sign-out clears the cache from the logout path (not inside the `clearAuth` reducer).
- [x] 3.3 `app.html` inline pre-paint script (validated enums, try/catch); a test pins script ↔ module key/values.
- [x] 3.4 `theme.css`: type-style `--font-heading` switches; density tokens; motion off/subtle overrides; scoped
  reduced-motion rule.
- [x] 3.5 Panel grid gutter + derived compensated rowHeight from density (`useDensity()`, `GRID_GUTTER_PX` named as on
  HEL-1576's branch) in `DesktopPanelGrid` and `DesktopPanelGridSkeleton`, with a TS↔CSS sync guard test (Comfortable token vs `GRID_GUTTER_PX`, Compact token vs
  `COMPACT_GRID_GUTTER_PX`) and a test
  that panel tops are identical across densities.
- [x] 3.6 Overview list tables (shared table component where shared) and `ContextList` rows read `--density-row-pad-y`
  (Comfortable = today's `--space-2`); enumerate with a recorded grep.
- [x] 3.7 Scope component reduced-motion rules (`Skeleton`, `toast`, `RefinementChatDrawer`, `StreamingText`,
  `MobileNavSheet`, `BottomNav`) to OS-no-pref + `data-motion="off"`; `prefersReducedMotion.ts` precedence +
  `useReducedMotion()`; guard test (excluding `frontend/src/landing/`, stated reason) mutation-checked; exact Off
  token values per design D5.

- [x] 3.9 Raw face tokens `--font-face-sans|mono|serif` (D3); preview cards use them; test the Sans card stays sans
  under Mono.
- [x] 3.10 Charts: expose `typeStyle` + effective motion in ThemeContext; add both to `useChartOption.ts` and
  `UsageChart.tsx` recompute triggers; jsdom tests set `--font-sans` inline and assert `textStyle.fontFamily` /
  `animation` change on a live switch.
- [x] 3.11 `app.html`: load JetBrains Mono weight 700 in BOTH font links.
- [x] 3.12 Mono verification per design D3 (after 3.9–3.11): HEL-813 specs parametrized with Mono; clipping check with
  the defined ellipsis exclusion, pinned fixtures and a failing mutation; equal-digit-width check on
  `.run-history-modal__row-duration` with a tabular-nums mutation; a Mono-is-on precondition assertion; HEL-866 contrast guard under Mono in both themes; `:root[data-type-style="mono"] {
  --font-sans: var(--font-mono) }`; grep for hardcoded families; screenshots.
- [x] 3.13 AccentPicker new layout: 28px swatches, `--space-4` gap, explicit 44×44px expander (hover scale on an inner
  circle, not the swatch); segments take the
  expander on coarse pointers; verified by `bisectHitExtent`.

## 4. Settings → Appearance UI

- [x] 4.1 Rebuild the Appearance section per D7 (accent, type style cards, density, motion + "Use system setting",
  Theme "Later"); keyboard/radiogroup semantics; mobile stacking.
- [x] 4.2 Unit tests for the section (selection, save dispatch, effective motion display, Later row inert).
- [x] 4.3 Playwright spec: type style re-renders headings without reload and persists across a fresh browser context
  (another device); density changes grid gutter + row height; motion Off/Full vs emulated reduced-motion; no-flash
  first-paint probe.

## 5. Docs and verification

- [x] 5.1 DESIGN.md: §3 type styles (Mono exception), Spacing → Density table, §10 interim note replaced by the
  implemented precedence.
- [x] 5.2 Gates: lint, typecheck, format, jest (≤3 workers), `sbt testFull` (foreground shards), full Playwright suite
  (≤2 workers), contrast guards both themes; screenshots at 1280/820/768/375 × both themes × each type style/density.

## Execution notes (HEL-1572 executor)

- HEL-1576 had NOT merged at start (`git fetch origin`): `GRID_GUTTER_PX = 18` (today's value) is introduced in
  `panelGridConfig.ts`, the Comfortable CSS token is `18px`, Compact `rowHeight` derives to 62. HEL-1576's change to 12
  conflicts only on those two values and `theme/appearanceTokens.css.test.ts` fails until both agree.
  Re-baselined: HEL-1576 merged first (cycle 3), so the shipped values are `GRID_GUTTER_PX = 12`, Comfortable `--space-3` and Compact `rowHeight` 56; the 18px/62 above are the superseded plan.
- 3.6 enumeration (recorded grep; `rg "td\b|__td|context-list__row" ...`): the SortableTable consumers are
  `PipelinesPage.css` (`.pipeline-list-table__td`), `SourceListTable.css` (`.source-list-table td`) and
  `ConnectorsPage.css` (`.connectors-page__td`), plus `ContextList.css` (`.context-list__row`). Each reads
  `--density-row-pad-y` for its vertical padding. Settings tables (agent memory, API tokens) and the audit table are
  not section overview lists and are unchanged.
- 3.12 greps (recorded): no `font-family` outside `var(--font-*)`/`inherit` in `frontend/src` (excl. `landing/`); the
  only hardcoded families in TS are the SSR fallback constants in `utils/chartAppearance.ts`; no `tabular-nums` site
  reads `--font-heading` (13 sites, 0 hits).
- The HEL-813 `.regression` twin runs under `HEL1572_TYPE_STYLE=mono` on demand. Its Case B mutation is stale on main
  (`.mobile-nav-sheet__item-row .mobile-nav-sheet__item { flex: 1 }` defeats the injected `width: 20px`), identical in
  Sans; unrelated to this change.
