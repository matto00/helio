## Context

Three popover components already render via `createPortal` to `document.body` with position from
`getBoundingClientRect()`: `ActionsMenu`, `DashboardAppearanceEditor`, and `Select`. Each implements
the same ~15 lines of trigger-ref + open/close + position-state logic inline. `UserMenu` is the
remaining straggler: its `user-menu__popover` uses `position: absolute` inside a
`position: relative` container, which clips against parent overflow contexts.

## Goals / Non-Goals

**Goals:**
- Introduce `usePortalPopover` hook that encapsulates the shared pattern
- Port `UserMenu` to the portal pattern (the only fix that eliminates clipping)
- Have `ActionsMenu`, `DashboardAppearanceEditor`, and `Select` adopt the hook (behavior-preserving)

**Non-Goals:**
- Changing visual design, animation, or interaction model of any popover
- Abstracting away component-specific portal targets (Select's dialog-aware target stays local)

## Decisions

**Hook API — return trigger ref + position state + open/close handlers**
The hook returns `{ triggerRef, isOpen, panelPos, handleOpen, close }`. Callers attach `triggerRef`
to the trigger element and spread or destructure the rest. Positioning shape is
`{ top: number; right?: number; left?: number; width?: number }` — a superset that all callers can
subset. Alternative considered: a render-prop component — rejected because hook composition is
simpler and avoids JSX nesting.

**Portal target — `document.body` default, dialog-aware override**
The hook defaults to `document.body`. `Select` needs to portal into the nearest open `<dialog>` so
the listbox renders above the modal backdrop; it will keep its own `portalTarget` resolution and
pass it to `createPortal` directly. The hook does not own portal target — callers do.

**Position calculation — `rect.bottom + offset` for top, `right` or `left` per caller**
ActionsMenu and DashboardAppearanceEditor anchor right-aligned; Select anchors left-aligned with
width. The hook exposes a `computePosition(rect)` callback pattern so callers provide their own
transform — this avoids baking alignment into the hook itself.

**UserMenu — adopt hook, remove `.user-menu { position: relative }` and absolute panel rule**
The `.user-menu__popover` CSS block (`position: absolute; top: calc(100%+8px); right: 0`) will be
removed. The portal panel uses `position: fixed` via inline style (matching existing components).
The keyboard / click-outside handlers in UserMenu stay component-local (they are menu-specific).

## Risks / Trade-offs

[UserMenu Escape key] UserMenu manages its own Escape handler via `onKeyDown` on the container div.
After portal render the panel is outside the container, so keyboard events on the panel won't
bubble through it. Mitigation: add a `keydown` listener on `document` when the menu is open (same
pattern as the existing `mousedown` listener), or keep the scrim + Escape on `document` level.

[Select dialog-aware target] Select's `portalTarget` logic stays inline. If it adopts the hook
later for that too, the hook will need an optional `resolveTarget` param. Deferred to follow-on.

## Migration Plan

1. Create `frontend/src/hooks/usePortalPopover.ts`
2. Port `UserMenu` (the fix) — verify no visual regression
3. Refactor `ActionsMenu`, `DashboardAppearanceEditor`, `Select` to use hook (behavior-preserving)
4. Remove now-dead CSS rules in `UserMenu.css`

No backend migration needed. Rollback: revert the hook file and component changes independently.

## Planner Notes

Self-approved: pure frontend refactor + one CSS positioning fix. No new external dependencies.
No breaking API changes. No schema changes. Scope matches ticket exactly.
