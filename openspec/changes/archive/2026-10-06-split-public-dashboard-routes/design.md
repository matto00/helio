## Context

See proposal.md (Why). Current file: `backend/src/main/scala/com/helio/api/routes/dashboards/PublicDashboardRoutes.scala`,
500 lines at b2a0d8088. One `routes` val: `pathPrefix("dashboards" / Segment / "panels") { dashboardId => ... }` with
seven `~` alternatives in this order: `rows`, `filter-capabilities`, `distinct-values`, `output-meta`, `history`,
`provenance`, then the panel list (`pathEndOrSingleSlash`). Every alternative is `GET` and gates on
`aclDirective.authorizeResourceWithSharing("dashboard", dashboardId, userOpt, "Dashboard not found", token)`.
Constructed in exactly one production place (`ApiRoutes.scala:817`) and directly by seven specs
(`PublicDashboardRoutesSpec`, `OutputHistoryPublicRoutesSpec`, `OutputHistoryPayloadPublicRoutesSpec`,
`PublicProvenanceRoutesSpec`, `PublicRouteOwnerIdLeakSpec`, `ShareTokenPublicAccessSpec`,
`pipelines/OutputHistoryQueryCountSpec`), plus others via `ApiRoutes`.

Hard constraint found at the design gate (skeptic-design-1 CR1): `ExistenceNotLeakedRoutesSpec` ("name every source
file that calls a shared access helper in at least one table row", lines 315-321, scan at 478-486) requires every
`src/main/scala` file whose code calls `authorizeResourceWithSharing(` to be named in a table row's `sites`; the public
rows (388-393) name only `PublicDashboardRoutes.scala`. Moving any ACL call to a new file fails that guard unless the
test is edited, which the AC forbids (and the public `/history` route has no row to attach to honestly).

## Goals / Non-Goals

Goals: concern-focused modules; identical route tree; zero test-source diff; the access-helper guard stays truthful
(ACL calls stay where its rows say they are). Non-goals: see proposal.md.

## Decisions

**D1 — Entry point keeps name, package and constructor.** `PublicDashboardRoutes(panelRepo, aclDirective, userOpt,
outputRepo, pipelineRepoOpt = None, nodeSnapshotRepoOpt = None, provenanceServiceOpt = None, historyServiceOpt = None)`
is unchanged, including defaults, so `ApiRoutes` and every spec compile untouched. Alternative (change callers to
build modules) rejected: forces test edits, which the AC forbids.

**D2 — The directive tree stays in the entry point; per-concern logic moves out.** `PublicDashboardRoutes.scala`
keeps the whole `val routes` directive tree — every path, method, `parameters(...)`, request validation
(`offsetRaw < 0`, `math.min`, sort/filter/history query parsing), every literal `authorizeResourceWithSharing(...)`
call, and every `ServiceResponse.run(...)(mapper)` / `onSuccess(...)` — in the original order. It becomes "the
existing entry point that composes the modules": it instantiates them and delegates each route's work to them. The
concern modules (same package, `final class`es mixing in what they need, built by the entry point from its own
constructor params, so instance cardinality — one per entry-point instance, i.e. per request — is unchanged):
- `PublicPanelOutputResolver` — `resolvePanelOutput` (verbatim), shared by controls/meta/provenance/history.
- `PublicPanelListResolver` — `outputControlsValidator`, `resolveDataAsOf`, `resolveOrphanedControlIds`, and the
  panel-list `resultF` body (the `findAllByDashboardId → per-panel resolve → PanelResponse.fromDomain` computation,
  incl. the `ownerView` rule) moved verbatim into one method taking `(dashboardId, page, access)`; the entry point keeps
  `onSuccess(resultF) { result => complete(result) }`.
- `PublicPanelRowsResolver` — `resolveRows`, `resolveFilterCapabilities`, `resolveDistinctValues` (row-query
  surfaces scoped by `PublicOutputControlScope`).
- `PublicPanelOutputMetaResolver` — `resolveOutputMeta`, `resolveProvenance`.
- `PublicPanelHistoryResolver` — `resolveHistory` (D8 summary-only projection via `OutputHistoryResponses.public`).
Names are self-approved; the executor may adjust naming but not the boundaries, and MUST NOT move or wrap any
`authorizeResourceWithSharing` call (no indirection that hides an ACL call from the guard's source scan either).
Alternative (directives + ACL calls in modules) rejected: fails `ExistenceNotLeakedRoutesSpec` without a test edit.

**D3 — Route order.** Untouched by construction: the `~` chain stays textually in place in the entry point. Only
resolver call receivers change (e.g. `resolveRows(...)` → `rows.resolveRows(...)`).

**D4 — Code moves verbatim.** Resolver bodies and their doc comments move unchanged. Only positional words in comments
("above"/"below"/"this class") may be adjusted where a move makes them false. The class doc (lines 22-39) stays on the
entry point.

**D5 — Route-tree equality evidence (mechanical, failable).** In `route-tree-evidence.md` in this change dir:
(a) Skeleton: before editing, extract an ordered skeleton of the `val routes` tree from the original file (every
`pathPrefix`/`path`/`pathEndOrSingleSlash`/method directive, `parameters(...)` arg list, `authorizeResourceWithSharing`
args, `ServiceResponse.run` target + mapper, composition order); after editing, extract the same from the entry point;
diff (expected empty apart from the documented receiver renames, listed). Plus an endpoint table
(method, path template, query params, auth gate) for all seven endpoints.
(b) Red run: show the extractor produces a non-empty diff on a scratch copy with two alternatives swapped and one
`parameters(...)` argument dropped.
(c) Verbatim move: `git diff --color-moved=plain --color-moved-ws=allow-indentation-change` (or a whitespace-normalized
block diff of each moved body against the original); list every non-moved changed line and justify it (class/def
scaffolding, imports, receiver renames, D4 positional comment words only).
(d) Guard scan: replicate `filesCallingAccessHelpers` on the post-split tree; it must report exactly the same set as
before (`PublicDashboardRoutes.scala` present, no new file).
The extraction scripts live in the scratchpad, not the repo.

**D6 — Test count evidence.** Baseline `nice -n 19 sbt testFull` on the unmodified worktree (b2a0d8088) records the
total "Tests: succeeded N" line plus per-suite counts for the related suites (the seven above plus
`ExistenceNotLeakedRoutesSpec`, `DashboardPanelAclSpec`, `ApiRoutesSpec`, `PublicPathRlsSmokeSpec`); the same run after
the change must match exactly and pass. `git diff <base>...HEAD -- backend/src/test` must be empty. Recorded in
`test-count-evidence.md` in this change dir.

## Risks / Trade-offs

- [Implicit resolution changes when code moves] → resolver modules need `ExecutionContext` (from the same
  `system.executionContext`) and whatever JSON formats their bodies use; `ServiceResponse.run` marshallers stay at the
  call site in the entry point (unchanged). Compile + full suite + D5(c) catch drift.
- [Entry file near the 250-line soft budget] → the soft limit is a warning only (`check-scala-quality.mjs`); the
  directive tree is ~190 lines and must stay together for the guard. Accepted.
- [Extra DB lookups if a body is altered] → `OutputHistoryQueryCountSpec` counts queries; D5(c) proves verbatim moves.

## Planner Notes

- Self-approved: module names and boundaries (D2), keeping the directive tree in the entry point (skeptic CR1).
- Premise check: ticket's "506 lines" is 500 after HEL-1337; HEL-1276 added no route to this file (its spec asserts
  the public tree has no payload path; the 401 comes from full `ApiRoutes`). Nothing payload-related to move.
- Spinoffs noted, not fixed (refactor discipline): (1) `ExistenceNotLeakedRoutesSpec` has no row for public
  `GET /api/dashboards/:id/panels/:panelId/history`; (2) the stale "authenticated dashboard viewing ... funnel through
  here" comment (original line ~59) is moved verbatim.
