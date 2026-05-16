# Ticket Context — HEL-236 CS2c-3c

**Linear**: https://linear.app/helioapp/issue/HEL-236
**Parent ticket title**: Codebase refactor — modularity, DRY, and structural restructure
**Sub-PR**: CS2c-3c — the FINAL sub-PR of HEL-236

## Position in the HEL-236 chain

- CS1 (PR #146) — backend protocols split — merged
- CS2a (PR #147) — backend routes decompose — merged
- CS2b (PR #148) — backend service layer — merged
- CS2c-1 (PR #149) — domain ADT foundations (PipelineRunId + segments + repo ID narrowing) — merged
- CS2c-2 (PR #150) — DataSource ADT + wire-shape evolution + credential redaction — merged
- CS2c-3a (PR #151) — PipelineStep ADT + engine/service/route split + wire-shape evolution — merged
- CS2c-3b (PR #152) — Panel typed ADT (backend, **wire-shape preserved** by two pattern-matching adapters) — merged
- **CS2c-3c — THIS PR** — rewrites those two adapters; updates frontend, schemas, snapshot wire-break

## Goal

CS2c-3b merged the backend Panel ADT with wire shape PRESERVED by two pattern-matching adapters. CS2c-3c rewrites exactly those two adapters and updates everything downstream (frontend, schemas, snapshot wire-break).

## Backend rewrite surface (read path AND write path)

**Read path — 2 adapters + snapshot version bump:**

- `PanelResponse.fromDomain` (`backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala:78`) — currently pattern-matches Panel subtypes to wide-flat fields; rewrite to emit `type` discriminator + typed `config` payload per subtype
- `DashboardSnapshotPanelEntry.fromDomain` — same pattern, plus close the pre-existing Image/Divider data-loss bug (today missing `imageUrl`/`imageFit`/`dividerOrientation`/`dividerWeight`/`dividerColor`)
- Snapshot version bump (current → next) because wire shape breaks

**Write path — request types + custom RootJsonFormat + service dispatch (mirrors read path):**

- `CreatePanelRequest` (`PanelProtocol.scala:40`) — currently `jsonFormat5` over flat fields (`dashboardId`, `title`, `type`, `content`, `dataTypeId`); migrate to `type` discriminator + typed `config` payload
- `UpdatePanelRequest` (`PanelProtocol.scala:48`) — currently a custom `RootJsonFormat` (`PanelProtocol.scala:175`) reading 11 flat fields (`title`, `appearance`, `type`, `typeId`, `fieldMapping`, `content`, `imageUrl`, `imageFit`, `dividerOrientation`, `dividerWeight`, `dividerColor`); migrate to `type` + typed `config` with absent-vs-null distinction preserved per-config-field
- `PanelBatchItem` (`PanelProtocol.scala:61`) + `UpdatePanelsBatchRequest` (`PanelProtocol.scala:67`) — same migration where they currently surface flat fields
- `PanelService.create` / `PanelService.update` / batch-update — consume the new shapes, dispatch on `type` discriminator, preserve the cross-type PATCH 400 lock
- Companion request-side decoders per Panel subtype (under `backend/src/main/scala/com/helio/domain/panels/`) must round-trip and accept partial configs (`decode("{}")` succeeds with defaults — codec read-path tolerance rule)

## Frontend lockstep (bulk of the PR)

- `frontend/src/types/models.ts` (587L — approaching soft cap; design.md must address whether the discriminated union splits into per-subtype model files or stays in `models.ts`) — `Panel` discriminated union (7 subtypes: Metric, Chart, Table, Text, Markdown, Image, Divider) mirroring backend
- `frontend/src/components/PanelGrid.tsx` (597L — **over 400L BLOCKER cap already**; design.md must plan an extraction so the per-subtype renderer dispatch does not bloat further)
- `frontend/src/components/PanelDetailModal.tsx` (1021L — **far over 400L BLOCKER cap**; per-subtype config editor dispatch MUST land via extraction into per-subtype editor files, not by adding code)
- `frontend/src/features/panels/panelsSlice.ts` (439L — **over 400L BLOCKER cap**; narrowing helpers should land in a sibling file, thunks emit typed `config` payloads)
- ~21 consumer sites currently reading flat nullable fields — migrate to discriminated narrowing

**File-size note:** Three of these files already exceed the 400L BLOCKER cap. Design.md MUST plan extractions; the executor cannot add subtype-dispatch code to files that are already over budget without first extracting. This is a real risk to scope and should inform whether to split frontend lockstep into its own PR.

## Schemas

The panel-related JSON Schemas live at the flat `schemas/` root (there is no `schemas/panel/` folder):

- `schemas/panel.schema.json`
- `schemas/panel-appearance.schema.json`
- `schemas/panel-query.schema.json`
- `schemas/create-panel-request.schema.json`
- `schemas/update-panels-batch-request.schema.json`
- `schemas/update-panels-batch-response.schema.json`

**Default approach: evolve `panel.schema.json` in place** to a `oneOf` over `type` + per-subtype `config`. This matches the existing flat layout and minimizes the diff. Updating `create-panel-request.schema.json` and the batch request/response schemas in place follows the same shape. Splitting per-subtype into a new `schemas/panel/` folder is rejected unless design.md identifies a concrete reason (it adds a layout move on top of the wire-shape change and breaks the established flat convention).

## Patterns to inherit (locked in CS2c-2 / CS2c-3a / CS2c-3b)

- Wire shape: `type` discriminator + typed `config` payload via explicit `RootJsonFormat` dispatch
- Codec read-path tolerance: every subtype's `decode("{}")` must succeed with defaults; repo round-trip regression test for partial configs is the gate
- Cross-type PATCH locked at 400
- File-size budgets: routes ≤150 hard, services ≤300 soft, other src ≤250 soft, >400 BLOCKER
- No inline FQNs (pre-commit hook enforces — prefixes blocked: `com.helio.`, `spray.json.`, `org.apache.pekko.`, `org.postgresql.`, `java.util.UUID`, `java.util.Base64`, `java.util.concurrent.`, `java.nio.charset.`, `java.security.`, `scala.concurrent.`, `at.favre.lib.`, `slick.jdbc.`)
- Behavior-preserving structural refactor discipline
- Per-file polymorphic-method ADT pattern already in place for Panel (CS2c-3b)
- AuthService untouched (security-sensitive)

## Acceptance criteria (CS2c-3c specific)

1. `PanelResponse.fromDomain` emits discriminated wire (`type` + typed `config`); request-side decoder round-trips and accepts partial configs for every subtype.
2. `DashboardSnapshotPanelEntry.fromDomain` emits discriminated wire AND closes the Image/Divider data-loss bug; snapshot version bumped; export → import round trip preserves all subtype fields.
3. Frontend `Panel` type is a discriminated union; all ~21 consumer sites migrated to narrowing; no flat nullable subtype fields remain on the union itself.
4. Panel JSON Schemas (flat `schemas/*.json`) updated to discriminated-union shape — `panel.schema.json`, `create-panel-request.schema.json`, and the batch request/response schemas all gain `type` + per-subtype `config`. Default: in-place evolution of the existing flat files.
5. Snapshot wire break versioned; importer accepts both old and new format if the existing importer supports legacy versions, otherwise documents the break.
6. All gates pass: ESLint/Prettier/Jest, scalafmt/sbt test, pre-commit (no-inline-FQN hook), file-size budgets.
7. Playwright Phase 3 smoke:
   - Panel CRUD round-trip (create each of 7 subtypes, edit each, delete)
   - Dashboard snapshot export → import round-trip exercising the wire break (verify version bump, verify Image/Divider fields survive)
   - HEL-242 regression check (bound panel still renders DataType rows for owner)

## Out of scope (do NOT touch in this PR)

- HEL-242 (P0 panel-binding bug) stays DEFERRED. Root cause hypothesis: `PanelService.resolveBindingsForRead` cross-user clear + `usePanelData.ts` cache key confusion. CS2c-3c must not regress it, but must not attempt the fix.
- `useLegacyBoundPanel` hook (pre-Pipeline DataType binding) is load-bearing; preserve as-is. Removal is a CS3-era cleanup.
- `appearance.chart` migration into `ChartPanelConfig` is a spinoff, not in CS2c-3c.

## Process requirements

- Worktree at `.worktrees/HEL-236-cs2c-3c`
- Branch: `task/panel-wire-frontend/HEL-236`
- linear-executor and linear-evaluator at opus model
- File-size BLOCKER check (>400L hard fail unless explicitly negotiated)
- No-inline-FQN pre-commit hook is the gate
- STOP after evaluation passes; present PR and ask human before merging.

## Escalation policy

If scope explodes during cycle 1 (as it did in CS2c-3b), surface as ESCALATION with the option to split (e.g. backend wire + schemas in one PR, frontend lockstep in another).
