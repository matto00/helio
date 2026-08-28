## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

1. **`Modal.tsx` primitives claim** — confirmed by reading `frontend/src/shared/ui/Modal.tsx`: native `<dialog>`
   + `showModal()`, Tab/Shift+Tab wrap-around trap (HEL-716, lines 122-161), `cancel` event routed through
   `onClose` (lines 109-120), backdrop-click close via `handleDialogClick` (lines 163-166). Native `<dialog>`
   `close()` restoring focus to the previously-focused element is standard HTML behavior, consistent with the
   design's claim. Design/tasks correctly plan to reuse `Modal` rather than hand-roll any of this (D1).

2. **`OverlayProvider`/`useOverlay()` contract** — confirmed by reading `OverlayProvider.tsx`: single-active-id
   mutual exclusion + global Escape handler, exactly as D2 describes. `QuickLauncherOverlay.tsx:6,28` confirms it
   already consumes `useOverlay()`, matching the "mirror `QuickLauncherOverlay`'s wiring" plan (task 4.3).

3. **`sections.ts` / `nav-section-registry` spec** — confirmed by reading both files. `isNavSection` type guard
   exists exactly as design.md/tasks.md (5.1) plan to consume it. `openspec/specs/nav-section-registry/spec.md`
   does forbid a second hardcoded route→label map, and the design's derivation approach satisfies it.

4. **`EmptyState`/`TextField` prop shapes** — confirmed by reading both components. `EmptyState` requires
   `icon`, `title`, `description`; `TextField` is a thin, ref-forwarding styled `<input>`. Both usages implied
   by tasks 4.1/4.4 are consistent with these actual shapes.

5. **`AppShell` is authenticated-only** — confirmed: `App.tsx` defines `AppShell` as the layout component
   rendered under the authenticated route tree (renders `<Outlet/>`, mounts `Sidebar`/`CommandBar`, etc.), and
   the existing Cmd/Ctrl+K quick-launcher handler lives inside it at lines 108-117 (the useEffect starting
   "Quick-launcher keyboard shortcut (design.md D7)"), matching the ticket's premise-notes citation exactly.
   The palette's planned mount point (task 5.4, inside `AppShell`) is correctly authenticated-only, so the
   `command-palette-shell` spec's "not reachable from unauthenticated routes" requirement is achievable as
   planned.

6. **`App.test.tsx:1099-1200` test migration target** — confirmed: the `describe("quick-launcher", ...)` block
   starts at line 1098 and its "opens the overlay via the Cmd/Ctrl+K keyboard shortcut" test (`fireEvent.keyDown`
   with `ctrlKey: true, key: "k"`) sits inside that range and is exactly the test task 6.6 must update to
   Cmd/Ctrl+J.

7. **`chat-quick-launcher` spec never names a key** — confirmed by reading `openspec/specs/chat-quick-launcher/spec.md`:
   its requirement says only "reachable by ... a keyboard shortcut," never Cmd/Ctrl+K specifically. The rebind
   is correctly assessed as an implementation-only change against this spec (no MODIFIED delta needed for
   `chat-quick-launcher` itself).

8. **DESIGN.md §3/6/7/8** — spot-checked headings and the "Shared components — reuse, don't reinvent" section;
   nothing in the artifacts contradicts token/opacity, shared-component-reuse, empty-state, or focus/keyboard
   guidance. The plan's explicit "no hardcoded values" language in both the spec delta and tasks (4.5) matches
   the standard.

### Verdict: REFUTE

The design is close and the ground-truth claims about the codebase all check out — this is a well-grounded
plan. But there is one load-bearing gap in the formal contract, and one clarity gap that matters specifically
because four dependent tickets will read these artifacts, not the ticket/design prose, when they build on top.

### Change Requests

1. **The Cmd/Ctrl+K↔Cmd/Ctrl+J rebind and the "Open assistant" seeded action are acceptance criteria and a
   human-resolved escalation outcome, but neither is captured as a spec Requirement anywhere.** I read all
   four spec deltas (`command-palette-shell`, `command-action-registry`, `command-palette-filtering`,
   `command-palette-navigation-actions`) in full — none of them states that the quick-launcher must rebind to
   Cmd/Ctrl+J, that both bindings must live in one enumerable module (`shortcuts.ts`), or that an "Open
   assistant" action must exist. `design.md` (Non-Goal D8) and `tasks.md` (1.1-1.3, 5.3) both encode this
   correctly, but tasks/design are not what HEL-510 will treat as the shortcut contract when it comes to
   "enumerate the app's bindings" — it will look at specs first. Required revision: add a Requirement (either
   a new one in `command-palette-shell/spec.md`, or a small `keyboard-shortcut-declarations` capability) that
   states: (a) the app's global keyboard bindings SHALL be declared in exactly one enumerable module; (b) the
   quick-launcher SHALL be bound to Cmd/Ctrl+J once the palette takes Cmd/Ctrl+K; (c) the palette SHALL seed
   an "Open assistant" action. Without this, a future spec-driven reader (including HEL-510's own author) has
   no formal signal that this constraint exists — only prose in a sibling ticket's file.

2. **`command-palette-navigation-actions/spec.md`'s "Built-in actions are grouped and discoverable by keyword"
   requirement and the theme-toggle requirement cover navigation + theme, but the "Open assistant" action
   (design.md D9, tasks 5.3) has no corresponding scenario in any spec delta at all** — it is planned in tasks
   and design only. Since this is the action that keeps Cmd/Ctrl+K's old destination reachable (the whole
   justification the human's resolution relies on for not being a regression), it deserves the same
   spec-level guarantee the nav and theme actions get, not just a task checkbox. Fold this into the same
   revision as #1, or add it explicitly to `command-palette-navigation-actions/spec.md`.

### Non-blocking notes

- The "duplicate id ... surfaced in development" requirement (`command-action-registry` req 3) is intentionally
  loose about the exact mechanism (console.warn is only in design.md, not spec) — fine, since "surfaced in
  development" is the right level of abstraction for a spec and D4's `console.warn` choice is an implementation
  detail the executor can still change without a spec conflict.
- Worth a task-list nit (non-blocking): task 1.3 says "verified by ... Cmd/Ctrl+K no longer opening it" but
  doesn't explicitly also require a positive assertion that Cmd/Ctrl+J *does* open it in the same task — that
  positive case is covered by 6.6, so this is just a phrasing gap, not a coverage gap.
