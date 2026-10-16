# HEL-1576 measurements

All live numbers: this run's servers (7008/9915), headless Chromium via playwright-core, fonts ready before measuring, throwaway user, dark and light.

## Backend database

The shared dev database already carries another lane's migration V136 (applied 2026-10-15 00:23), so this branch's backend (up to V135) refused to start: `Detected resolved migration not applied to database: 135`. The lane ran its backend against a scratch database `helio_hel1576` on the same local Postgres server (created with `create database`, all migrations applied fresh, `DATABASE_URL` overridden for the start script). The shared `helio` database was never written (its `flyway_schema_history` still ends at 136). The scratch database should be dropped by whoever owns the machine when the lane finishes.

## Narrow-width ladder (design D3)

The tier is measured on the row's content box (`ResizeObserver` contentRect, i.e. the row minus its 40px of horizontal padding). Thresholds in `useMetaRowTier.ts`:

| tier | content width                | what changes                                               |
| ---- | ---------------------------- | ---------------------------------------------------------- |
| 0    | >= 820 (view), >= 970 (edit) | labelled controls, full facts                              |
| 1    | 640..819 / 790..969          | Undo, Redo, Tidy, Edit layout/Done and Share are icon-only |
| 2    | 520..639 / 670..789          | Share and the assistant move into the overflow menu        |
| 3    | < 520 / < 670                | facts collapse to the panel count                          |

Checked by sweeping the viewport from 1500 to 780 in 20-40px steps in view and edit mode (appearance editor and kebab always visible): the actions never wrap or clip and never overlap the facts (`overlap: false`, `actFits: true` at every step). Facts that do not fit drop whole, last first (sources, then the refresh state), never a truncated stub (the facts line is one clipped flex-wrap line; the full text is in `title`). Live states at 820 and 1280 with the context list at default (248), 400 and collapsed, in and out of edit mode: `screenshots/ladder-*.png`. At 820 with the list at default, 400 or collapsed the grid is the read-only stack, so Edit layout is not offered there (the meta row only offers it while the movable desktop grid is on screen).

Deviation from design D3(iii): the appearance editor trigger is an icon-only popover button in every tier and stays in the row; only Share and the assistant move into the kebab. Moving a popover trigger into a menu would need a second popover host for no width gain.

## Gutter

12px both axes measured from the DOM at 1500px (md): panels 328..896 then 908 (12), and 12px between rows (vertical); at 1280 (6-col sm breakpoint) the vertical gap is 12px. A 4-row panel is 244px, a 5-row panel 308px.

## Contrast and accent (both themes, default and Twilight/Paper dashboard background, default and blue accent)

The row is `--app-surface` chrome, so a dashboard background never reaches it (`contrast-accent.json`). Muted facts on the row: dark 7.17, light 6.25. Add panel ink on accent: 6.49 dark / 5.11 light with the default accent, 4.95 with the blue preset. Exactly one `.cmd-btn--primary` in the row at every combination. Done (pressed) uses the chrome wash pair `--app-surface-soft` (light) / `--app-surface-strong` (dark), the pair `.cmd-btn:hover` uses (soft on surface is only 1.030 in dark, strong 1.025 in light, per App.css), with `--app-text`.

## Minimum-height form panel overflow (follow-up input)

One 4-row form panel (two fields plus Submit) at 1280, `.panel-content--form` (`overflow-y: auto`), content height 210px in both cases:

| gutter        | panel height | visible box (`clientHeight`) | hidden |
| ------------- | ------------ | ---------------------------- | ------ |
| 18px (before) | 262px        | 159px                        | 51px   |
| 12px (after)  | 244px        | 141px                        | 69px   |

The overflow pre-exists (51px hidden at 18px); the gutter change makes it 18px worse. Screenshots: `screenshots/content-fit/{before,after}-form.png`.

## Short-card rhythm (found by the full e2e run)

The 18px lost by a minimum-height card put the chart canvas under the HEL-1398/HEL-1444 floors (84px measured against 96px; 12 failing specs in the first full run: hel1398 x6, hel1444 x4, plus two stale-margin/strict-mode specs). The floors are specs and are not loosened. Instead a card at the minimum height (`h <= 4`) takes a tighter vertical rhythm (`.react-grid-item[data-short-card] > .panel-grid-card`: block padding `--space-3`, gap `--space-2`, 24px returned), set by `DesktopPanelGrid` from the resolved layout. After it, hel1398, hel1444, hel1023 and hel910 pass (30 passed under the e2e lock, load 8.47 at start). The form-panel numbers above were measured BEFORE this change; the form box is now taller by the same 24px.
