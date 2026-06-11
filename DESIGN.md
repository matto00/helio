# DESIGN.md

The canonical design language for the Helio frontend. This is the visual/UX
counterpart to `CONTRIBUTING.md`: **binding** for any agent or contributor
touching `frontend/`. Reviewers (and the Skeptic gate) judge UI changes against
this document — "consistent with existing patterns" means _consistent with what
is written here_, not inferred from scattered code.

> **Status:** v1 draft, seeded from a frontend survey and **verified against
> source** (`theme.css`, `panelGridConfig.ts`) on 2026-05-29. Token names,
> spacing/type scales, and breakpoints below are confirmed accurate. Sections
> marked **OPEN DECISION** are genuine choices not yet ratified — they need
> Matt's sign-off before becoming binding. Everything else reflects the de-facto
> standard already in the codebase and is binding now.

---

## How to use this doc

- **Before** writing or reviewing frontend code, read this file.
- Rules are tagged **[mechanical]** (deterministically checkable — greppable or
  lintable, enforced cheaply by the evaluator / a future lint rule) or
  **[judgment]** (requires looking at the rendered result — the Skeptic's domain).
- When a rule and a deadline conflict, follow the rule or escalate the conflict.
  Never silently diverge.

---

## 1. Styling approach

- Styling is **plain CSS, organized as co-located CSS Modules** (one `.css` file
  per component, e.g. `Modal.tsx` + `Modal.css`). Design tokens live centrally in
  `frontend/src/theme/theme.css`. No Tailwind, styled-components, CSS-in-JS, or
  SCSS. Do not introduce a new styling system.
- Apply styles via `className`. **[mechanical]** Inline `style={{}}` is allowed
  **only** for genuinely dynamic values that can't live in CSS — portal/popover
  positioning (`position: fixed; top/left`) and user-driven appearance overrides.
  A static style belongs in a `.css` file.
- Class naming is BEM-ish (`.panel-card`, `.panel-card__header`,
  `.panel-card--dragging`). Follow it for new styles.

## 2. Theme system

- Light/dark is driven by `ThemeProvider` (`src/theme/ThemeProvider.tsx`), which
  sets `data-theme` on `<html>` and persists choice to `localStorage`.
- Tokens are CSS custom properties in `src/theme/theme.css`, split into
  `:root[data-theme="dark"]` and `:root[data-theme="light"]` blocks.
- **Accent is user-customizable**: 8 presets (`src/theme/theme.ts`), applied
  dynamically via `applyAccentTokens()` (`src/theme/appearance.ts`) which rewrites
  the accent custom properties at runtime. **Do not hardcode the accent** — always
  read `--app-accent` (and its variants) so user accent selection keeps working.

## 3. Tokens are the source of truth

All visual values come from the custom properties in `theme.css`. **Never
hardcode a value a token exists for.** **[mechanical]**

### Color (themed; tokens are `--app-*`)

| Purpose              | Tokens                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Text                 | `--app-text`, `--app-text-muted`                                                                                                  |
| Background / surface | `--app-bg`, `--app-bg-accent`, `--app-bg-secondary`, `--app-surface`, `--app-surface-strong`, `--app-surface-soft`                |
| Accent (user-set)    | `--app-accent`, `--app-accent-strong`, `--app-accent-surface`, `--app-accent-dim`, `--app-accent-mid`                             |
| Border               | `--app-border-strong`, `--app-border-subtle`                                                                                      |
| Intent               | `--app-success` `#22c55e`, `--app-warning` `#f59e0b`, `--app-error` `#ef4444`, `--app-info` (→ accent) — **see OPEN DECISION #1** |

- **[mechanical]** No hardcoded hex/rgb/rgba in component CSS or TSX where a token
  applies. **Known offenders to migrate** (intent colors hardcoded instead of
  tokenized): `DashboardList.css` `#f87171`, `TypeDetailPanel.css` `#f87171`/
  `#4ade80` and `var(--app-danger, #e53e3e)`, `ActionsMenu.css` `#f87171`,
  `StatusMessage.css` `#ffb4b4`, `TypeRegistryPage.css` `#f87171`,
  `PanelContent.css` `var(--app-danger, #e05252)` / `var(--app-success, #3db87b)`,
  `MarkdownPanel.css` `var(--color-accent, #5a7ff2)` (wrong token name),
  `Modal.css` backdrop `rgba(0,0,0,0.55)` (see OPEN DECISION #4).
- **Documented exception:** the accent _preset swatches_ (`AccentPicker`) and
  user color-picker presets are **data**, not styling — literal colors are fine
  there.

### Spacing (theme-invariant; 4px base)

`--space-1` 4px, `--space-2` 8px, `--space-3` 12px, `--space-4` 16px,
`--space-5` 20px, `--space-6` 24px, `--space-7` 32px, `--space-8` 40px,
`--space-9` 48px, `--space-10` 64px.

- **[mechanical]** All margin/padding/gap use a `--space-*` token. Known
  off-scale offenders: `DashboardList.css` `padding: 16px` (→ `--space-4`),
  `Modal.css` `padding: 18px` (off-scale — pick `--space-4` or `--space-5`).

### Typography (theme-invariant)

- Families: `--font-sans` = **Space Grotesk** (UI/headers), `--font-mono` =
  **JetBrains Mono** (code/tabular). **[mechanical]** No ad-hoc `font-family`.
- Type scale: `--text-micro` 10px, `--text-xs` 12px, `--text-sm` 14px,
  `--text-base` 16px, `--text-lg` 18px, `--text-xl` 20px, `--text-2xl` 24px,
  `--text-3xl` 30px. Semantic: `--h1-size` (→ 3xl), `--eyebrow-size` (→ micro)
  with `--eyebrow-tracking` 0.1em / `--eyebrow-weight` 600.
- **[mechanical]** Every `font-size` uses a `--text-*`/semantic token — no literal
  px/rem. Known offenders hardcode `0.8rem` / `0.78rem` / `0.72rem`
  (`inputs.css`, `DashboardList.css`).
- Utility classes exist for common roles: `.eyebrow` (uppercase small label),
  `.wordmark` (brand text), `.mono` (tabular numerals). Reuse them.
- **Weights** are currently raw (`500/600/700`) with no tokens — see OPEN
  DECISION #2.

### Radius / Shadow / Transition

- Radius: `--app-radius-sm` 4px, `--app-radius-md` 6px, `--app-radius-lg` 10px,
  `--app-radius-pill` 9999px.
- Shadow: `--app-shadow-soft` (raised/overlay), `--app-shadow-card` (cards).
- Transition: `--app-transition` (0.2s ease) for theme/color transitions.
- **[mechanical]** Use these tokens; no ad-hoc radius/shadow/transition values.

## 4. Breakpoints — **OPEN DECISION (two systems diverge)**

- **React Grid Layout** (`panelGridConfig.ts`) — the panel grid:
  `lg`=1440, `md`=1100, `sm`=768, `xs`=0.
- **CSS media queries** — currently `max-width: 768px`, `600px`, `480px`
  (plus `@container panel-card` queries for panel-content density).

These only partly agree (CSS uses 600/480 that RGL doesn't). **Proposed:** adopt
the RGL set (**1440 / 1100 / 768**) as the canonical CSS breakpoints too and
document them in a `theme.css` comment banner; keep container queries for
panel-internal density. **[judgment]** all supported breakpoints render without
layout breakage. Container queries on `panel-card` are the right tool for
panel-content responsiveness — keep using them.

## 5. Shared components — reuse, don't reinvent

Canonical primitives in `frontend/src/shared/ui/`: **Modal** (sizes sm/md/lg via
native `<dialog>`), **TextField**, **Textarea**, **Select** (portal-based, avoids
native select styling), **EmptyState** (variants `main`/`sidebar`), **Toast**
(intents info/success/warning/error).
Chrome in `frontend/src/shared/chrome/`: **Popover**, **ActionsMenu**,
**SidebarItemList**, **StatusMessage**, **InlineError**, **SaveStateIndicator**,
**AccentPicker**.

Use these; do not hand-roll equivalents. **[mechanical]** (raw-element detection)
**+ [judgment]**

- **[judgment]** Empty states must use `EmptyState`, not a bespoke empty `<div>`.
  Known reinvention: `PanelList` custom `.panel-list__empty-*`.
- **Buttons — OPEN DECISION #5.** There is **no `Button` component** today; button
  styling is fragmented across `.dashboard-list__add`, `.panel-list__add`,
  `.cmd-btn`, `.ui-modal-btn`, `.empty-state__cta`, etc., with inconsistent
  padding and hover. Until a shared `Button` exists, **match the nearest existing
  button class** rather than inventing a new one, and surface a new button need as
  a consolidation candidate.

## 6. UI state patterns (loading / empty / error)

Every data-backed view handles all three, **consistently**:

- **Loading:** the established spinner pattern (`.panel-content__spinner`, rotating
  border) or a skeleton during a pending thunk — never a flash of empty content.
- **Empty:** render `EmptyState` — never render nothing.
- **Error:** render a visible, human-readable message (intent-error styling) —
  **never swallow a failed fetch.** **[judgment]** Silent fetch failure is a
  defect, not an edge case.
- **Toasts** (`Toast`) are for transient feedback (bottom-right, auto-dismiss ~4s,
  intent-typed) — not a substitute for inline error/empty states.

This is the contract the evaluator's "unhappy path" checks enforce.

## 7. Accessibility baseline

- Interactive elements have accessible names (ARIA/text). **[mechanical]**
- Keyboard operable; dialogs handle Enter/Escape; visible focus rings.
  **[judgment]** Focus uses `outline: 2px solid var(--app-accent)` — see OPEN
  DECISION #6 on standardizing `outline-offset`.
- Color is never the sole carrier of meaning (pair intent color with icon/text).

---

## Open decisions for Matt (curation queue)

Resolving these upgrades rules from proposed to enforced (and unlocks real
ESLint/stylelint rules):

1. **Centralize intent colors.** `--app-success/warning/error` live only in
   `toast.css`; other code uses `--app-danger` with conflicting hardcoded
   fallbacks (`#e53e3e`, `#e05252`, `#f87171`). Promote a canonical
   `--app-error / --app-success / --app-warning / --app-danger` set into
   `theme.css` (light + dark) and migrate offenders.
2. **Weight tokens.** Add `--weight-{normal,medium,semibold,bold}` (400/500/600/ 700) and require them — weights are currently raw literals.
3. **Breakpoints (§4).** Confirm 1440/1100/768 as canonical and mirror the CSS
   media queries to them (drop ad-hoc 600/480).
4. **Overlay/scrim token.** Modal backdrop is `rgba(0,0,0,0.55)` — add
   `--app-overlay` (light/dark)?
5. **Button component.** Consolidate the fragmented button classes into a shared
   `Button` with variants (primary/secondary/ghost/danger). Biggest consistency
   win; also standardizes hover/padding.
6. **Focus-ring offset.** Standardize `outline-offset` (currently varies
   1px/2px/3px/-2px across modals, lists, inline).

When settled, fold into the body above and drop the OPEN DECISION tags.
