## Why

Live UI feedback flagged three shell-chrome icon issues: the Assistant and Data Types sidebar icons
render as near-identical "book" glyphs in the collapsed rail, the "Customize dashboard" trigger is
the only text-pill button among an otherwise icon-only command-bar cluster, and "Refine with AI"
shares a near-duplicate chat-bubble glyph with the unrelated "Open assistant" launcher. All three are
isolated icon/class fixes in adjacent files, low-risk to bundle into one change.

## What Changes

- Swap the Assistant sidebar icon (`sections.ts:103`, `MessageSquare` → `MessageCircle`) so it's no
  longer visually near-identical to the Data Types (`BookOpen`) icon at 16px in the collapsed rail.
  Flows through `Sidebar.tsx` and `BottomNav.tsx` automatically (shared registry).
- Swap the Metrics sidebar icon (`Gauge` → `ChartNoAxesColumn`) so it reads as "metrics" rather than a
  clock/history glyph.
- Restyle the "Customize dashboard" trigger (`DashboardAppearanceEditor.tsx`) from the bespoke
  `popover__trigger dashboard-appearance-editor__trigger` text-pill onto the shared `cmd-btn
  cmd-btn--icon` recipe already used by its `CommandBar.tsx` toolbar neighbors, with a `faSliders`
  icon. Preserves the existing `aria-label="Customize dashboard appearance"`; adds a `title` tooltip.
  (HEL-718's `IconButton` primitive has not landed yet — confirmed no such component exists in the
  codebase — so this uses the existing `cmd-btn cmd-btn--icon` recipe directly, per the ticket's own
  fallback instruction.)
- Swap "Refine with AI"'s icon (`CommandBar.tsx`, `faCommentDots` → `faWandMagicSparkles`) so it no
  longer reads as a near-duplicate of "Open assistant"'s `faComments` glyph.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `nav-section-registry`: add a testable requirement that adjacent registry icons (Assistant vs.
  Data Types; Metrics) are visually distinguishable at collapsed-rail size — see spec delta.

The "Customize dashboard" trigger restyle and the "Refine with AI" icon swap remain pure
markup/CSS-class/icon-import changes within the existing `cmd-btn cmd-btn--icon` and command-bar
mechanisms — neither is backed by an existing capability spec describing button styling, so no
spec delta is added for those two; behavior (click handlers, aria-labels, popover semantics) is
unchanged for both.

## Impact

- `frontend/src/shared/chrome/sections.ts` — icon imports/assignments only (Assistant, Metrics).
- `frontend/src/app/CommandBar.tsx` — "Refine with AI" icon swap.
- `frontend/src/features/dashboards/ui/DashboardAppearanceEditor.tsx` +
  `DashboardAppearanceEditor.css` — trigger markup/class + one new FontAwesome icon import.
- No API, schema, or route changes. No new dependencies (all icons already available in the
  installed `lucide-react` / `@fortawesome/free-solid-svg-icons` packages).

## Non-goals

- Not touching the sidebar icon-rail collapse mechanism (HEL-726).
- Not doing a cross-library (lucide/FontAwesome) iconography consistency pass (HEL-443).
- Not unifying the two chat surfaces/implementations (HEL-717) — only visually de-duplicating their
  icons.
- Not building the `IconButton` primitive (HEL-718) — reused if/when it lands separately.
