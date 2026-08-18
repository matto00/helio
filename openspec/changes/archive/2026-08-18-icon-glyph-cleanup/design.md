## Context

Three isolated icon/styling fixes reported from live UI feedback (screenshots of the collapsed
sidebar rail and the dashboard toolbar). All three are glyph swaps or a CSS-class change within
existing, already-shared mechanisms (`sections.ts`'s nav registry, `App.css`'s `cmd-btn` recipe) —
no new component, no new dependency, no data-model or contract change. Confirmed via codebase search
that HEL-718's `IconButton` primitive has not landed (no `IconButton` component exists anywhere under
`frontend/src`), so item 2 below falls back to the existing `cmd-btn cmd-btn--icon` recipe per the
ticket's own instruction.

## Goals / Non-Goals

**Goals:**
- Make the Assistant and Metrics sidebar icons visually distinct from their neighbors (Data Types,
  and a generic clock/history read, respectively).
- Bring "Customize dashboard" onto the same icon-button visual language as its command-bar
  neighbors, without changing its behavior, `aria-label`, or popover semantics.
- Make "Refine with AI"'s icon visually distinct from "Open assistant"'s icon.

**Non-Goals:**
- No change to the sidebar collapse mechanism, chat-surface unification, or a broader
  lucide/FontAwesome consistency pass (see proposal.md Non-goals).
- No new shared `IconButton` primitive — reuse the existing `cmd-btn cmd-btn--icon` recipe as-is.

## Decisions

- **Assistant icon: `MessageSquare` → `MessageCircle`** (not `Bot`). `MessageCircle` keeps the
  glyph within the same "chat bubble" semantic family the route already communicates (label
  "Assistant", route `/chat`) while being a rounded circle instead of `BookOpen`'s rounded rectangle
  — clearly distinct at 16px. `Bot` was the ticket's other suggestion but changes the *semantic*
  register (robot vs. chat), which is a bigger visual/meaning shift than this ticket's "fix a glyph
  collision" scope calls for; `MessageCircle` is the minimal fix. Self-approved (Planner Notes).
- **Metrics icon: `Gauge` → `ChartNoAxesColumn`** (not `TrendingUp`). A column/bar-chart glyph is the
  more literal, unambiguous "metrics" signifier and matches how other data-oriented nav destinations
  in this registry already read (e.g. `Workflow` for pipelines). `TrendingUp` (a line-trend arrow)
  more strongly implies "growth/trend" specifically rather than "metrics" generally. Self-approved.
- **"Customize dashboard" trigger: reclass onto `cmd-btn cmd-btn--icon`, drop the bespoke
  `popover__trigger` base.** The button already lives inside `CommandBar.tsx`'s right-hand toolbar,
  directly beside two other `cmd-btn cmd-btn--icon` buttons ("Refine with AI", "Open assistant") —
  matching their class makes it visually consistent with its actual immediate neighbors, which is
  what the ticket asks for, rather than the generic `popover__trigger` styling `ActionsMenu.tsx`
  uses elsewhere for popovers that are *not* command-bar-adjacent. The existing
  `dashboard-appearance-editor__trigger` CSS override (padded pill radius, added specifically to
  approximate the square `cmd-btn` corner language — see its own code comment) becomes redundant
  once the button is a real `cmd-btn` and is removed rather than left as dead CSS. `triggerRef`/
  `aria-expanded`/`onClick`/`aria-label` are unchanged — `usePortalPopover` positions off the ref,
  not the class name (confirmed: no CSS-class-based query in the hook or `Popover.css`'s positioning
  logic). Icon: `faSliders` (proposed in the ticket) — matches "adjust settings" semantics used
  elsewhere for tuning/preference triggers. **The trigger's current visible content is a
  `<span className="dashboard-appearance-editor__trigger-copy">Customize dashboard</span>` text
  label — its only content today, since the button currently has no icon at all.** `cmd-btn--icon`
  is a fixed 28×28px, `padding: 0`, `justify-content: center` icon-only recipe (`App.css:163-171`)
  with no room for an icon plus that text, and the ticket's own framing ("the only text button among
  the icon-only cluster... move it onto the shared icon-only recipe") calls for icon-only content
  matching its `cmd-btn cmd-btn--icon` siblings. So this change removes the `__trigger-copy` span
  from the JSX entirely (icon-only, `aria-label` + `title` carry the accessible/hover text instead)
  and removes the now-orphaned `.dashboard-appearance-editor__trigger-copy` CSS rule alongside the
  `__trigger` override.
- **"Refine with AI" icon: `faCommentDots` → `faWandMagicSparkles`.** Directly per the ticket's
  explicit ask; a wand/sparkle glyph reads as "AI-assisted transformation" and is visually
  unambiguous next to `faComments` (Open assistant), unlike the two near-identical speech-bubble
  variants today.
- All four replacement icons confirmed present in the already-installed package versions
  (`lucide-react@^1.11.0`, `@fortawesome/free-solid-svg-icons@^7.2.0`) — no dependency bump needed.

## Risks / Trade-offs

- [Icon choice is inherently subjective — a reviewer may prefer different glyphs] → Rationale
  recorded above for each; all four are drop-in swaps within already-approved icon families, so a
  later glyph-only revision (if requested) is a one-line change per icon, not a structural one.
- [Removing the `dashboard-appearance-editor__trigger` CSS override could affect unrelated states
  (hover/focus) inherited from `popover__trigger`] → `cmd-btn`/`cmd-btn--icon` already define their
  own hover/disabled states (`App.css`); verify visually in the browser (evaluator's UI-review
  phase) that no other component still depends on `.popover.dashboard-appearance-editor
  .popover__trigger`-scoped selectors before deleting the override (grep confirms none of the
  file's own CSS or any sibling file scopes off that combination beyond the block being edited).

## Planner Notes

Self-approved: exact replacement-glyph choices (`MessageCircle` over `Bot`; `ChartNoAxesColumn` over
`TrendingUp`) — both are within the ticket's own suggested option sets and are low-risk, reversible
cosmetic choices, not architectural decisions. No external dependency, breaking change, or
scope-beyond-ticket concern; nothing here rises to a Planning `ESCALATION`.
