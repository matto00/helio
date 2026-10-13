# HEL-1527: Layout save: invalid-breakpoint rebuild can drop an unloaded panel's item; raw-UUID 400 toast in the panel-refetch gap

## Description

Follow-up from HEL-1457 (PR matto00/helio#980). The owner triaged it as standalone. The final-gate skeptic found both
issues; neither is reachable as data loss today.

1. In `useLayoutSave`, `buildLayoutPatch` rebuilds a changed-but-invalid breakpoint from the loaded panels only. A jest
   test showed this drops the stored item of a panel the tab hasn't loaded, if the panel list counts as loaded but lacks
   that panel. That state was not reachable live, because during a refetch the list is not marked loaded. HEL-1457
   already keeps unloaded panels' stored items on the `DesktopPanelGrid` rebuild path; this path should do the same.
2. If the user drags a panel onto another writer's not-yet-loaded panel during the panel-refetch gap, the server
   correctly refuses the overlap with a 400, and nothing is lost. But the toast quotes raw panel UUIDs. The message
   should be friendly and follow DESIGN.md.

## Acceptance criteria

- `buildLayoutPatch` keeps the stored items of unloaded panels when it substitutes a breakpoint. A jest test fails
  without the fix.
- An overlap rejection caused by an unloaded panel shows user-facing copy with no raw ids.

## Driver context (claims, verified or to verify)

- Establish whether part 1 is reachable live. If it is not, pin it with a unit test; do not invent a live repro.
- HEL-1525 (#992) changed `useLayoutSave`/`dashboardsSlice` layoutVersion adoption. Invariant I1 must hold: a save never
  claims a newer layout version than its layout's source.
- Toast copy is user-facing; new wording is an assumed product call (overnight rules) unless DESIGN.md covers it.
- No migration expected (V131 reserved by #994; V132 if ever needed).

origin_kind: followup
origin_ticket: HEL-1457
