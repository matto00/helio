// HEL-866 — the mechanical population selector shared by
// state-surface-contrast-guard.spec.ts (design.md D4.1). No file list, no
// component list — just interactive-role conventions. Kept in its own
// module (rather than inlined in the spec) so it is the single, obviously
// reusable definition rather than a constant buried in a large spec file.
//
// evaluation-1.md CR3: this file previously ALSO declared
// `collectBackdropLayers`/`probeElement` (an ancestor-walk + snapshot
// implementation) that nothing imported — the spec re-implements the same
// logic inline as `readBackdrop`/`readSnapshot`. Two copies of the guard's
// most safety-critical logic, one of them dead and carrying authoritative-
// looking design.md D4.2 commentary that never actually ran, is exactly the
// divergence hazard this ticket exists to prevent. Deleted rather than
// wired in: the spec's inline versions are the ones proven correct by the
// mutation proof (files-modified.md), and duplicating them here would
// immediately re-create the same hazard the next time either copy changes.
// evaluation-2.md cycle 3 — `tbody tr` added. `[role=row]` only matches an
// EXPLICIT `role` attribute; a native `<table>`'s `<tr>` gets "row" as its
// IMPLICIT computed ARIA role, which no CSS attribute selector can see —
// confirmed live: `SourceListTable.tsx`'s `<tr className="source-list-
// table__row">` (the exact call site evaluation-2.md CR6 measured
// regressing) has no `role` attribute at all and was therefore NEVER in
// this guard's population, in any cycle, regardless of data seeding
// (CR7). Every table-row family this ticket names (`AuditEventTable`,
// `ConnectorsPage`, `PipelinesPage`, `SourceListTable`, `ApiTokensSection`)
// uses plain semantic `<table>`/`<tr>`, not an ARIA grid with explicit
// `role="row"`. Scoped to `tbody tr` (not bare `tr`) — a `<thead>` header
// row is not meant to convey a hover state at all, and including it would
// score every table's header as a D4a "nothing changed" failure, which is
// noise this guard's own population enumeration should not introduce.
export const INTERACTIVE_SELECTOR =
  "a, button, tbody tr, [role=option], [role=menuitem], [role=row], [tabindex]:not([tabindex='-1'])";
