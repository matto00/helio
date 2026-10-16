# HEL-1572: Appearance settings: type style, density, and motion preferences per user

## Description

The owner wants serif headings to be a choice, not the default. The re-design adds a motion system that users need to
control. These preferences, plus the existing accent, are also the groundwork for future user "themes" (one pick that
bundles accent, type style, surfaces and texture).

Settings → Appearance (see the "Settings · Appearance" board on the epic's canvas,
`.concertino/design/HEL-1570/screenshots/Appearance.png`, `canvas/project/Appearance.dc.html`):

* **Accent:** the existing 8 presets (unchanged behaviour, new layout).
* **Type style:** Sans + mono (default) / Mono / Serif headings. Applied through tokens (e.g. `--font-heading`), not
  per-component branches.
* **Density:** Comfortable / Compact. Changes spacing tokens for panels and lists.
* **Motion:** Full / Subtle / Off. Defaults to following `prefers-reduced-motion`. Sets a root attribute the motion
  system reads.
* A "Theme — later" placeholder row, or none at all. Do not build themes.
* Preferences are saved per user server-side so they follow the user across devices, and applied before first paint
  where possible to avoid a flash.

Parent epic: HEL-1570 (v0.9 re-design). Blocked by HEL-1571 (DESIGN.md v3, merged). Blocks HEL-1573 (motion
foundation).

## Acceptance criteria

- [ ] Changing the type style re-renders headings app-wide with no reload, and the choice survives a reload on another
  device signed in as the same user
- [ ] Density switches the panel-grid gutters and list row heights between two documented token sets
- [ ] Motion set to "Off" disables every animation driven by the motion tokens. A user with no saved preference and OS
  reduced-motion on gets "Off"/"Subtle" behaviour
- [ ] Schema, OpenAPI and backend persist the new preference fields, with tests
- [ ] No flash of the default type style on load for a user with a non-default preference (verified in a real browser)

## Binding owner rulings (relayed by the driver; verified against DESIGN.md v3 §3/§10 and the HEL-1570 handoff)

- Sans + mono is the default. Fraunces is the optional "Serif headings" style via `--font-heading` (DESIGN.md §3).
- Motion is Full / Subtle / Off. No saved preference + OS reduce-motion = Off; an explicit saved choice beats the OS
  (DESIGN.md §10, owner ruling 2026-10-13). The global reduced-motion rule in theme.css must be scoped accordingly.
- Accent: existing presets, unchanged; accent-agnostic everywhere (README.md: the boards' orange is a sample).
- The future "themes" slot shows as "Later", per the board.
- Persist in the existing `users.preferences` JSON via `PATCH /api/users/me/preferences` (HEL-1574); extend it, no new
  table. `users` has no RLS by design (V88): prove per-user isolation through the app role.
- Density is Comfortable / Compact.

## Notes

- "OpenAPI" in the AC: this repo has no OpenAPI document; the API contract is `schemas/` (JSON Schema) plus the
  OpenSpec capability specs (CLAUDE.md "API Contract"). Both are updated.
- Overlap: HEL-1575 (PR #1032, open) also extends `users.preferences` with `dashboardTabs`. Field names here must not
  collide; any merge conflict is resolved by union.

## Owner rulings on the HEL-1572 escalation (2026-10-15)

- Q1: Comfortable = the 12px desktop default gutter (HEL-1576); Compact = 8px gutter with row-height compensation
  (panel tops don't move); overview-list and context-list row padding 8→4px; panel internals, DataGrid, phone stack
  unchanged.
- Q2: Mono = the whole UI in JetBrains Mono (not only headings); check legibility/contrast in both themes, tabular and
  table alignment, touch targets and HEL-774 guards.
- Q3: keys `typeStyle`/`density`/`motion`; attributes `data-type-style`/`data-density`/`data-motion`; tokens
  `--density-grid-gap`/`--density-row-pad-y`.
