# HEL-1574: Shell: icon rail + resizable, collapsible context list with dashboard folders

## Description

Today's sidebar does two jobs: section nav, plus a second copy of whatever list is on the page (Data Pipelines shows ~30 slugs that repeat the table beside them). It can't be resized, and collapsing it hides navigation entirely. The approved direction B splits it into an **icon rail** (always visible, so pages stay one click away) and a **context list** the user can resize and collapse.

## What

* **Desktop/tablet only (>=768px):** a 56px icon rail with Home, Dashboards, Data, Pipelines, Connectors, Assistant, then settings and avatar at the bottom. The active item uses an accent wash and slides between items via the indicator-slide motion primitive once the motion foundation lands. Before that, it's static.
* **Context list beside the rail,** with content per section: for Dashboards, filter plus **folders** (collapsible, counts, at least a pinned/"Daily"-style grouping). For pipelines and sources, a compact recent/pinned list instead of a copy of the full table.
* **Resizable** by dragging its edge (persisted width, min/max clamp, keyboard-resizable with an accessible separator). **Collapsible** to rail-only (double-click the edge or a button; state persisted).
* Usage moves out of the primary nav (into the avatar/settings menu).
* Mobile keeps the glass BottomNav (glass nav v2 is a separate ticket).
* Reference: "B2 · Dashboard" board on the epic's canvas (local copy: /home/matt/Development/helio/.concertino/design/HEL-1570/).

Related: HEL-726 (collapse to icon rail) is subsumed by this ticket. Close it when this ships.

## Acceptance criteria

- [ ] The rail is visible at >=768px with every top-level section reachable in one click, including when the context list is collapsed
- [ ] The context list resizes by pointer drag and by keyboard on a focusable separator, clamps to min/max, and its width and collapsed state persist across reloads
- [ ] The dashboard list supports folders (create, rename, collapse, move a dashboard between folders), persisted server-side with schema, OpenAPI and tests
- [ ] The Data Pipelines page no longer shows a sidebar list that duplicates its main table
- [ ] Phone width (<768px) is unchanged apart from removing the old sidebar code paths

## Owner rulings (2026-10-13, recorded under HEL-1571)

- Context list widths: min 200px / default 248px / max 400px.
- DESIGN.md §10 motion defaults are owner rulings (still labelled "driver default" in DESIGN.md; relabel if DESIGN.md is touched).
- `--app-surface` stays #1a1816.
- The glass BottomNav stays on phones (glass nav v2 is HEL-1583). Nothing hardcodes the accent or fonts.
- The rail's sliding active indicator waits for HEL-1573 (motion foundation, unshipped); static until then.

## Binding references

DESIGN.md v3 §0, §9 Shell, §10 Motion, §12 Mobile, Appendix A. MISTAKES.md (RLS: dev/CI run as superuser; any new table's policies must be proven in a non-BYPASSRLS session). Next free Flyway version: V134 (re-check before merge).

## Planning rulings from the owner (2026-10-13, this run's escalations; events.jsonl)

- Folders are per-user (`per-user`); groupings are user-created folders only, plus "Unfiled" (`user-folders-only`).
- The rail has a Home item that opens Dashboards (`/`) until HEL-1578 repoints it (`home-points-to-dashboards`).
- Usage moves to the avatar menu (`avatar-menu`).
- Non-dashboard context lists: "recent + scheduled items" (owner's words). Sources also list sources that feed a scheduled pipeline, showing the soonest run, in one request (`sources-feeding-scheduled`). Assistant keeps its list; Connectors has none (`assistant-list-connectors-none`).
- Context-list width and collapsed state persist **server-side per user**. Use a small per-user UI-preferences store that HEL-1572 will extend with new fields. No layout flash on load, and no request per drag frame.
- "home item should live in the phone bottom nav as well, since phone doesn't have a rail (and shouldn't)". The owner typed this directly; the coordinator relayed it. This amends AC5: phone gains a leading Home tab.
