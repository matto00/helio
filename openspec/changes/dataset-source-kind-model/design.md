## Context

HEL-1074 (Migration A, merged 730b42d8) moved `StaticSource` row/column storage into the new
`dataset_rows` table and rewrote `data_sources.source_type` to `'dataset'` in the DB, but explicitly
deferred the domain-model rename and connector registration to this ticket (see `DataSource.scala`'s
scaladoc: "the Scala ADT member here stays named `StaticSource` — renaming it is HEL-1073's scope").
Today: the ADT member is `StaticSource` with `kind = "static"`; `ConnectorRegistry` registers
`kind = "static"`; `DataSourceKind.All` (registry-derived, HEL-484) contains `"static"`, not
`"dataset"`; and the API still accepts and returns `type: "static"` for these sources even though the
DB has already moved to `"dataset"` underneath (`DataSourceRepository.rowToDomain` currently maps the
stored `"dataset"` string back onto `StaticSource.kind = "static"`, i.e. today's live behavior already
silently disagrees with the DB column).

The v0.8 design spec (`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`) states
static is *migrated to* dataset, not duplicated as two coexisting kinds.

## Goals / Non-Goals

**Goals:**
- One ADT member and one registered connector kind for this connector, named/keyed `dataset`, not
  two coexisting kinds for the same underlying storage.
- `"static"` continues to work as a wire-level alias on write for one minor release (per ticket AC).
- Reads (`GET`/list/preview) return the canonical `"dataset"` value, matching the DB's actual stored
  `source_type` and the AC's "type: static ... resolves to dataset" wording.
- No behavior change to row storage, RLS, or migrations (HEL-1074/1075 already shipped that).

**Non-Goals:**
- No new migration (verified no schema change is needed for this ticket — pure Scala/TS rename plus
  one wire-parsing alias).
- No repo-wide `StaticSource`-scaladoc sweep (HEL-1118's scope, dispatched separately by the driver).
- No change to `dataset_rows` storage shape, RLS policy, or the `/refresh`/`/preview` row-storage
  mechanics themselves — only the type/kind naming and discriminator value they're keyed on.

## Decisions

### Decision 1: Rename `StaticSource` -> `DatasetSource`; do not add a sibling ADT member
Adding a second ADT case (`DatasetSource` alongside a surviving `StaticSource`) for the exact same
stored `source_type` would immediately create an unreachable/ambiguous pattern-match branch (the DB
only ever stores `"dataset"` after HEL-1074's backfill — no row is ever `"static"` at rest) and
directly contradicts the "migrated to" framing of the v0.8 spec. Renaming keeps exactly one ADT
member, `kind = "dataset"`, with `"static"` demoted to a wire-only, write-side alias resolved before
it ever reaches the domain layer. This matches Decision 6/7 in the archived Migration A design
(`openspec/changes/archive/2026-09-10-migration-a-dataset-rows/design.md`), which already treats
`"static"` as a legacy/wire-only name post-migration.

### Decision 2 (revised after design-gate round 1): alias resolution is a dedicated helper called at
every real entry point, not assumed to flow through `parseKind`
`DataSourceKind.parseKind` is called in exactly two places in the live tree
(`ConnectorCompletionService.scala:51`, `ConnectorEntityService.scala:75`) — it is NOT on the
`POST /api/data-sources` write path (which never validates `type` at all; any non-csv/text/pdf/image
value falls through to `createStatic` today) and NOT on any of the other entry points that branch on
the literal `"static"`. Fixing `parseKind` alone leaves every one of these on the old literal:

- `PipelineService.scala:759`, `:1588` — inline pipeline source creation, matches `DataSourceKind.Static`
- `PipelineProposalProtocol.scala:198` — `case Some("static")`
- `PipelineProposalService.scala:195`, `:330`, `:374`, `:384`, `:557` — `Set(Csv, RestApi, Sql, Static)`
  allow-list
- `PatchSetApplyResolvers.scala:425-428` — rejects `type != DataSourceKind.Static`
- `AssistantProposalToolSchemas.scala:118` — LLM tool schema enum `["csv","rest_api","sql","static"]`

**Decision:** add `DataSourceKind.canonicalize(s: String): String`, defined as
`if (s == "static") "dataset" else s` (a pure string normalizer, independent of `parseKind`'s
Either/validation concern). Every one of the six call sites above is updated to canonicalize its
input before comparing against `DataSourceKind.Dataset`/matching the allow-list, so both `"static"`
and `"dataset"` are accepted and always resolve internally to `"dataset"`. `parseKind` itself calls
`canonicalize` first, so its two existing callers get the alias for free as before — the earlier
design's premise that `parseKind` alone was sufficient is now understood to be false.
**Final, single answer on `DataSourceKind.Static`'s fate (design-gate round 2):** the constant is
kept, public, as the one named literal for the wire alias string `"static"` — used only inside
`canonicalize` and in the one JSON-discriminator match arm below that must still recognize an
incoming `"static"` payload. No other production code path may compare `kind == DataSourceKind.Static`
after this change; every such comparison is replaced by `canonicalize(kind) == DataSourceKind.Dataset`.
`DataSourceKind.Dataset = "dataset"` is the new canonical constant used everywhere a response/stored
value is constructed.

**Named, not "confirm/adjust": the two `DataSourceProtocol.scala` sites that implement AC2
(round 2 finding).**
- `DataSourceProtocol.scala:89` (`def \`type\`: String = DataSourceKind.Static`) — this is what makes
  every read response report `"static"` today. Change to `DataSourceKind.Dataset`.
- `DataSourceProtocol.scala:502` (`case Some(JsString(DataSourceKind.Static)) => staticSourceResponseFormat.read(json)`)
  — this is the JSON-discriminator match that parses an incoming request; it must accept both
  `DataSourceKind.Static` and `DataSourceKind.Dataset` as alternate patterns
  (`case Some(JsString(DataSourceKind.Static | DataSourceKind.Dataset)) => ...`), since a request may
  legitimately arrive with either value.

`SparkJobSubmitter.scala:206`'s error string ("Only 'static' and 'csv'") is updated to say "dataset"
as part of this same sweep.

### Decision 3: The API surface's `type` field is `"dataset"` on read, `"dataset"|"static"` on write
This is what "resolves to dataset" in the AC means operationally: a client that creates with
`type: "static"` gets back `type: "dataset"` in the 201 response and on every subsequent read. This
is a real (if narrow) behavioral/wire change beyond pure backend plumbing — every frontend/e2e/MCP
call site that reads `source.type` and branches on the literal `"static"` needs its read-side branch
to also (or instead) match `"dataset"`. Write-side call sites (e2e specs' `POST` bodies) are
unaffected — they keep sending `type: "static"` or migrate to `"dataset"`, both still accepted.

**Consumer inventory (revised after design-gate round 1 — complete, not partial):**
- `frontend/src/features/sources/types/dataSource.ts` — `DataSourceKind` union, `StaticSource` type,
  `isStaticSource` predicate
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx`, `SourceListTable.tsx`,
  `labelForKind.ts` — read-side badge/label branches
- `frontend/src/features/sources/ui/SourceTypeToggle.tsx` — `SourceType` union (`:20`),
  `FALLBACK_CONNECTORS` (`:43`, still `kind: "static"`) — **read from the registry's `kind`, which
  becomes `"dataset"`; this is NOT cosmetically inert** (see Decision 4)
- `frontend/src/features/sources/ui/AddSourceModal.tsx` — `SourceType` union (`:41`), the
  `sourceType === "static"` branches at `:324` and `:379` that render the Manual-entry form —
  **these must switch to `"dataset"` or the Manual tab stops rendering entirely**; the modal's create
  request itself switches to sending `type: "dataset"` (the natural choice now that it's the
  canonical/registered kind)
- `frontend/src/features/sources/services/dataSourceService.ts:113`
- `frontend/src/features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx:148`
- `frontend/src/features/proposals/ui/CombinedProposalReviewPage.tsx:150`
- `helio-mcp/src/helioApi.ts` (`CSV_LIKE_TYPES`), `helio-mcp/src/tools/pipelinesHandlers.ts`
  (`case "static"`)
- `helio-mcp/src/tools/pipelines.ts:48` and `helio-mcp/src/tools/pipelineProposal.ts:60` — zod enums;
  both gain `"dataset"` alongside the existing `"static"` (write-side, both remain accepted) so they
  don't reject the new value once the JSON schemas below accept it

- This is judged **in-scope, not scope creep**: CLAUDE.md requires client/server changes that share a
  wire contract to ship together, and leaving frontend consumers matching only `"static"` would
  silently break source-type badges/icons/detail panels — and, per the design-gate finding, the
  entire Manual-entry tab — the moment the backend starts returning `"dataset"`. Shipping the backend
  half alone would ship a regression, not a smaller diff.
- Scope boundary actually held to: rename the discriminator value everywhere it's read/created,
  without touching unrelated UI/behavior (no redesign of `AddSourceModal`/`SourceTypeToggle`
  copy/ordering, or connector metadata's `displayName`/fields — those stay "Manual"/unchanged).
- `schemas/pipelines/pipeline-proposal.schema.json` and `create-pipeline-request.schema.json`'s
  `enum: [..., "static"]` gain `"dataset"` as an additional accepted value (both are write-side
  request schemas — `"static"` is not removed from them, matching the write-side alias).
- `openspec/specs/frontend-data-sources-page/spec.md` (badge requirement, lines 113-116) and
  `openspec/specs/pipeline-proposal-analyze-api/spec.md` (inline root `type: "static"`, line 58) both
  need delta coverage — see the new spec deltas added alongside this design.

### Decision 4 (revised after design-gate round 1): `ConnectorRegistry`'s registered kind changes to
`"dataset"`; `displayName` unchanged; frontend Manual-tab branches MUST be updated, not merely
"confirmed unaffected"
`staticMetadata` (renamed `datasetMetadata`) keeps `displayName = "Manual"`, `authKind = "none"`, and
its `requiredFields`; only its `kind` field and its position in `ConnectorRegistry.all` (unchanged —
still third in `SourceTypeToggle`'s pre-registry order, per that file's own comment) change.

The earlier draft of this design incorrectly assumed the frontend renders off the registry's `kind`
generically enough to need no changes. It does not: `SourceTypeToggle.tsx` passes the registry's
`kind` straight through `onChange` into `AddSourceModal`'s `sourceType` state, and `AddSourceModal.tsx`
branches on the literal `sourceType === "static"` (`:324`, `:379`) to decide whether to render the
Manual-entry form at all. Once the registry returns `"dataset"`, clicking "Manual" renders nothing
without this fix. **Decision:** `AddSourceModal.tsx`'s `SourceType` union and both branches, and
`SourceTypeToggle.tsx`'s `SourceType` union and `FALLBACK_CONNECTORS` entry, are updated to
`"dataset"`. `e2e/hel910-pipeline-to-dashboard-flow.spec.ts` (which exercises this exact flow) is the
acceptance signal that must still pass.

### Decision 5 (new after design-gate round 1): every non-`/api/data-sources` write path that branches
on `"static"` needs an explicit alias round-trip test
`POST /api/data-sources` itself never validates `type` (any unrecognized value already falls through
to `createStatic` today — a pre-existing gap, out of scope to fix here, but the executor must not
assume a 400 path exists for unknown types). The paths that DO gate on the literal `"static"` are the
inline-source branch of pipeline creation (`PipelineService.scala:759`/`:1588`), pipeline-proposal
validate/apply (`PipelineProposalProtocol.scala:198`, `PipelineProposalService.scala` — several
lines), and patch-set dataSource create (`PatchSetApplyResolvers.scala:425-428`). Each of these must
accept both `"static"` and `"dataset"` (via `DataSourceKind.canonicalize`, Decision 2) and a stored
proposal/patch-set that already carries `"static"` from before this change must still apply
correctly after it ships — add an explicit backward-compatibility test for that case, not just a new
alias-acceptance test.

## Risks / Trade-offs

- **Wide blast radius for a "domain model" ticket.** The literal call-site count (~35+ files touching
  the string `"static"`) is much larger than the ticket's one-paragraph description suggests. Mitigated
  by Decision 3's scope boundary (read-side discriminator only, no unrelated UI changes) and by
  `ConnectorRegistrySpec`'s drift test plus existing frontend/e2e coverage catching any missed site.
- **Risk of silently breaking a read-side check that isn't covered by a fast test** (e.g. an e2e spec
  asserting a badge/icon keyed off `"static"`). Mitigated by grepping every `"static"` occurrence
  before considering Execution done, and by running the full frontend test suite + a targeted e2e
  subset, not just `ConnectorRegistrySpec`.
- **HEL-1118 overlap.** If this ticket's rename also happens to touch the exact stale-scaladoc lines
  HEL-1118 was filed against, that's an acceptable natural consequence (the class is being renamed
  regardless) — not an attempt to pre-empt HEL-1118's broader repo-wide sweep.
