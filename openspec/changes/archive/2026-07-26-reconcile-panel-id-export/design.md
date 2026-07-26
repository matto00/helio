## Context

`DashboardSnapshotPanelEntry.fromDomain` (`backend/src/main/scala/com/helio/api/protocols/
DashboardProtocol.scala:158`) sets `snapshotId = panel.id.value` — i.e. it is *already* the
real panel id, just under a different wire key than `PanelResponse.id`. Verified this is one
identity, not two: `snapshotId` doubles as (a) the real id (accidentally, via `fromDomain`)
and (b) an opaque within-payload join key that the importer (`DashboardSnapshotRepository`
line 140/171, `DashboardServiceValidation` line 55/61/71-72) remaps to fresh UUIDs on import
via `idMap`. Layout entries reference `snapshotId` only within the same payload — the
importer never compares it against any persisted id. So collapsing the *names* does not
collapse two competing concepts; there was only ever one id, wearing two labels.

`get_dashboard` (`helio-mcp/src/helioApi.ts:159-173`) is a raw passthrough:
`{ ...record, panels: snapshot.panels }` — it does not remap or normalize panel fields. So a
backend-side additive `id` field on the export wire flows through to the MCP tool for free;
no MCP-side field-mapping logic is needed, only mirroring the type in
`helio-mcp/src/types.ts` and updating the tool description string.

`openspec/specs/dashboard-export-import/spec.md` currently states the snapshot "SHALL NOT
include server-assigned IDs." That line was written for dashboard/other resource ids
(portability of a downloaded export file); this change intentionally carves out an exception
for the panel `id` specifically, because the driving use case is a programmatic reader
(MCP-connected agent) that needs a stable per-panel handle, not a human re-importing a file
into a fresh workspace. Documented as an explicit MODIFIED requirement, not silently ignored.

## Goals / Non-Goals

**Goals:**
- Panels in the export snapshot carry a stable `id` (== the real panel id) alongside the
  unchanged `snapshotId` remap handle.
- Existing exported JSON files (pre-dating this change, lacking `id`) still import
  successfully — decode-tolerant, not a breaking wire change.
- `get_dashboard`'s panels expose `id` without further MCP-side logic changes.

**Non-Goals:**
- No new authenticated single-dashboard/panels GET endpoint.
- No change to `snapshotId`'s role or the import remap algorithm.
- No fix to `helio-mcp`'s repo-external sibling, `helio-news` (`~/Development/helio-news`) —
  filed as a spinoff; not part of this monorepo, not touched by this change.
- Does not address pre-existing spec/impl drift in `dashboard-export-import/spec.md` (it
  documents `typeId`/`fieldMapping` panel fields that CS2c-3c already replaced with
  `type`/`config`) — unrelated pre-existing staleness, out of scope for this ticket.

## Decisions

**D1 — Additive `id: Option[String]` on `DashboardSnapshotPanelEntry`, not a rename/replace.**
Confirmed via code (see Context) that `snapshotId` and the real panel id are the same value
today; the two names exist only because `fromDomain` never exposed the real id under its own
key. Renaming `snapshotId` → `id` would break the import remap contract's field name
(`DashboardSnapshotRepository`/`DashboardServiceValidation` both pattern-match on
`entry.snapshotId`); adding `id` alongside it is strictly additive and needs zero import-path
changes.

**D2 — `id` is `Option[String]`, not required, for decode-tolerance of old files.** The
export always populates `Some(panel.id.value)` going forward (`fromDomain`), so every new
export has it. But `DashboardSnapshotPanelEntry` is spray-json-decoded on import too
(`jsonFormatN` requires present fields unless `Option`), so a pre-existing exported file
(captured before this change, lacking the `id` key) must still decode. `Option[String]`
gives that for free — missing key → `None` — without a custom reader or versioned envelope.
Rejected: a required `id` (would 400 on old files — the exact "silently break a year-old
export" failure mode this ticket calls out to avoid); a versioned envelope (overkill for one
additive field, and `CurrentVersion` already exists for genuinely breaking shape changes).

**D3 — No `DashboardSnapshotPayload.CurrentVersion` bump.** The version was bumped 1→2 for
CS2c-3c's breaking flat-fields→typed-config collapse. This change removes nothing and adds
an optional field; existing readers of version-2 payloads that ignore unknown keys are
unaffected, and old exports (lacking `id`) remain valid version-2 payloads decode-wise (D2).
Bumping would force a rejection of otherwise-still-valid old files, working against the
compatibility goal.

**D4 — No `schemas/*.schema.json` addition.** Enumerated `schemas/`: no
`dashboard-snapshot`/`dashboard-export` schema exists today, and `check-schema-drift.mjs`
does not track `DashboardSnapshotPanelEntry` (no matching schema file to compare against).
Adding a new schema file for a class the drift tool doesn't check is scope creep beyond what
the ticket asks ("update schemas/... to reflect the added field" presumes one exists).

**D5 — MCP fix is "mirror the type," not "normalize in code."** Ticket offered two paths
(server additive vs. MCP-side normalization). Verified `getDashboard` in `helioApi.ts` is a
verbatim spread of `snapshot.panels` — once the backend emits `id`, the MCP tool exposes it
with only a type-mirror edit (`SnapshotPanelEntry.id?: string` in `helio-mcp/src/types.ts`)
and a tool-description update; no transformation logic needed. This makes the "Preferred"
and "Or" options non-competing — doing D1 satisfies both.

**D6 — `helio-news` change and MCP tool-description wording are the executor's to make
in-repo (helio-mcp is part of this monorepo, at `helio-mcp/`); `helio-news` is a separate
repo (`~/Development/helio-news`) outside this workspace's git tree — file a spinoff ticket
instead of attempting a cross-repo edit.**

## Risks / Trade-offs

- [Old export files re-imported still carry only `snapshotId`, no `id`] → Acceptable: import
  never needed `id`; it's a read-side convenience field only.
- [Frontend `DashboardSnapshotPanelEntry` type gains a field FE code never reads] → Low risk;
  FE snapshot handling is pure download/upload pass-through (verified: no FE logic branches
  on `id` vs `snapshotId`), so this is a type-accuracy update only, not a behavior change.
- [Spec text still calls out `typeId`/`fieldMapping`, pre-existing drift not fixed here] →
  Documented as explicitly out of scope (Non-Goals) rather than silently left inconsistent.

## Planner Notes

- Self-approved: scope of the spec delta narrows the "SHALL NOT include server-assigned IDs"
  sentence to explicitly except the new `id` field, rather than leaving a contradictory
  spec. This is documentation of an already-ticket-authorized wire change, not a new
  architectural decision.
- Self-approved: filing two spinoff tickets (helio-mcp is in-repo, already covered by this
  change — no spinoff needed there; the two spinoffs are (1) `helio-news` client
  simplification and (2) none else identified) rather than attempting cross-repo edits.
