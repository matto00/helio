## Context

Icon-only buttons have already converged on the same recipe independently, at least three times:
`.cmd-btn.cmd-btn--icon` (`app/App.css`, used by the theme toggle, "Refine with AI", and the quick-
launcher trigger in `app/CommandBar.tsx`), `.ui-modal__close` (`shared/ui/Modal.css`), and
`.preferences-editor__icon-btn` (`features/settings/ui/PreferencesEditor.css`, remove-row buttons).
All three are `display:inline-flex` + `justify-content:center`, a `--control-sm`/`--control-md`
square, `--app-radius-sm`, transparent background, and a hover state drawn from DESIGN.md §5's
existing Ghost/Secondary/Danger button recipes — just never extracted into one component. A fourth,
independent near-duplicate was flagged and consolidated within `App.css` itself (`undo-redo-btn`,
see its comment). `App.css`'s `cmd-btn` block already pairs `aria-label` with a native `title` on
every icon-only instance — that pairing is the tooltip pattern this change documents and formalizes,
not a new invention. The archived `2026-08-18-icon-glyph-cleanup` change explicitly deferred to this
ticket for its "Customize dashboard" trigger, confirming `IconButton` does not exist yet.

## Goals / Non-Goals

**Goals:**
- One `IconButton` primitive in `shared/ui/` that formalizes the ghost/secondary/danger icon-button
  recipe, with `aria-label` required at the prop-type level (not `HTMLButtonElement`'s optional attr).
- A visible tooltip "for free": `title` defaults to the `aria-label` string unless a distinct `title`
  is passed (mirrors `CommandBar.tsx`'s Undo/theme-toggle buttons, which already pair a task-focused
  `aria-label` with a shorter/different `title`).
- Migrate the three converged call sites above plus any other icon-only control found missing either
  an accessible name or a visible tooltip, onto the new primitive.

**Non-Goals:**
- No floating/portal tooltip component — `title` is the native browser tooltip; `Popover` (already
  shared) remains the mechanism for anything needing richer floating content.
- Not rebuilding `ActionsMenu`'s trigger (`shared/chrome/ActionsMenu.tsx:153`) — it already renders
  `aria-label={label}` on a real `<button>`; adding `IconButton` under it is a pure internal refactor
  with no behavior change, lower priority than the buttons with an actual accessibility gap.
- Not the shared `Button` (labeled) primitive — DESIGN.md §5 already scopes that out until it exists.

## Decisions

1. **Props**: `{ icon: ReactNode; "aria-label": string; onClick; title?: string; variant?: "ghost" |
   "secondary" | "danger"; size?: "xs" | "sm" | "md"; disabled?; className?; type? }`. `aria-label` is
   a required, non-optional string — this is what makes a missing accessible name a compile error
   instead of a runtime gap, directly satisfying the ticket's "required at the type level" wording.
   `title` defaults to `aria-label`'s value; pass `title={undefined}` explicitly is not supported —
   passing an empty string is the escape hatch for the rare case a visible tooltip must be suppressed
   (none identified so far; documented as an edge case only).
2. **Sizing**: `size` maps to DESIGN.md §3's control-height tokens — `sm` → `--control-sm` (28px,
   default, matches `cmd-btn--icon`/`ui-modal__close`), `md` → `--control-md` (32px, matches
   `preferences-editor__icon-btn`), `xs` → the documented 24px dense-row exception. No new sizes.
3. **Variants**: `ghost` (borderless, matches `.ui-modal__close`) is the default; `secondary`
   (hairline border, matches `.cmd-btn--icon`) and `danger` (error-tinted hover, matches
   `.preferences-editor__icon-btn`) are explicit opt-ins — this is DESIGN.md §5's existing Ghost/
   Secondary/Danger recipe applied to icon-only sizing, not a new fourth style.
4. **DESIGN.md placement**: `IconButton`'s recipe + tooltip pattern goes in §5 (Buttons, alongside
   the existing prose recipes it formalizes) and its name is added to §6's shared-primitives list.
5. **Migration order**: converge the three known duplicate recipes first (`App.css` `cmd-btn--icon`
   call sites, `Modal.tsx`'s close button, `PreferencesEditor.tsx`'s two remove-row buttons) — these
   are drop-in, since `IconButton`'s three variants were derived from their exact CSS. Then grep the
   remaining ~15 files already found using an `icon-btn`/`icon-button`/bare-`<button>`+SVG pattern
   (`RefinementChatDrawer`, `PipelineDetailPage`, `PanelDetailModal.mobile`, `Toast`, `PipelineShare
   Dialog`, sidebar collapse in `SidebarBody`/`Sidebar.tsx`, `BottomNav`, etc.) for any icon-only
   control lacking either `aria-label` or a visible tooltip, and either migrate it onto `IconButton`
   or add the missing label directly if migrating it isn't warranted (e.g. it's inside a component
   with its own established, tested CSS and only needs the one missing attribute).

## Risks / Trade-offs

- [Risk] A wide app-wide migration touches many unrelated features in one change → could destabilize
  something outside this ticket's own testing. → Mitigation: migrate the three converged duplicates
  first (behavior-preserving by construction — same computed CSS), then treat each remaining file as
  an independent, individually-verified small edit; skip (and note) any file where migration risk
  looks disproportionate to the accessibility gap, in favor of the minimal missing-attribute fix.
- [Risk] Defaulting `title` to `aria-label` could produce an overly verbose native tooltip where the
  two were previously allowed to diverge (e.g. Undo's `aria-label="Undo layout change"` / `title=
  "Undo (Ctrl+Z)"`). → Mitigation: `title` is an independent optional prop, not derived text
  transform — call sites that want to diverge simply pass both.

## Planner Notes

- Self-approved: `IconButton` is additive (a new `shared/ui/` primitive) and its migration targets are
  either exact recipe consolidations (behavior-preserving) or additive `aria-label`/`title` fixes —
  neither is a breaking API/architectural change warranting a Planning `ESCALATION`.
- Self-approved: scoping the app-wide audit to "migrate or fix, whichever is proportionate" (Decision
  5 / Risk 1) rather than a hard 100%-migration mandate, since DESIGN.md's binding acceptance
  criterion is tooltip/label *coverage*, not exclusive use of the new component everywhere.
