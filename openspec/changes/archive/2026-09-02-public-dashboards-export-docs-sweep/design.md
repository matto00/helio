## Context

See proposal.md - Why. Verified against the live tree (not docs): `PublicDashboardRoutes`
(mounted under `optionalAuthenticate`, `ApiRoutes.scala:630-632`) already resolves each
output-kind panel's `dataAsOf` via `panel.outputId → output → pipeline.lastRunAt` (HEL-906
cycle 6) — the panel *metadata* path is done. But panel *row data* is fetched by the frontend
exclusively via `usePanelData.ts` → `GET /api/outputs/:id/rows`, whose route
(`OutputRoutes.topLevelRoutes`, `ApiRoutes.scala:732`) is constructed with a required
`AuthenticatedUser` and mounted only under the authenticated tree. An unauthenticated viewer of a
shared dashboard therefore has no way to fetch row data today — every output-kind panel on a
public dashboard renders empty. This is the concrete gap "finish the public path (rows via
node_snapshots)" refers to; it is a real defect on `main`, not a formality.

`RlsPolicyGuardSpec` currently covers `outputs`/`node_snapshots` for the authenticated,
sharing-aware ACL (V39 `helio_can_access_pipeline`) per HEL-904/HEL-906, but has no test proving
the *public/anonymous* read path is denied for a non-shared dashboard under a real non-superuser
role — that's the RLS-smoke gap this ticket closes.

## Goals / Non-Goals

Goals: anonymous/optional-auth row reads for shared-dashboard output panels (API + RLS only, no
viewer UI); import-time `outputId` existence validation; HEL-940 fold-in; docs; sweep; E2E.

Non-goals: any change to the authenticated `/api/outputs/:id/rows` route's own ACL; any new
sharing/visibility model (dashboard sharing ACL is unchanged, just newly reachable for rows);
Phase 2 branching concerns; **building a public-dashboard viewer page or share-dialog UI** — no
such surface exists today, and building one is out of scope for this ticket (filed as a
follow-up, see Decision 3).

## Decisions

1. **New route, not relaxing `OutputRoutes`.** Add
   `GET /dashboards/:dashboardId/panels/:panelId/rows` to `PublicDashboardRoutes`
   (mounted under the same `optionalAuthenticate` + `authorizeResourceWithSharing("dashboard", ...)`
   directive the panel-list route already uses), rather than making `outputId` in `OutputRoutes`
   optionally authenticated. Rationale: the dashboard's sharing ACL is the actual authority here
   ("can this caller see this dashboard") — keying the public route off `dashboardId` + `panelId`
   means the ACL check is the same one already proven for the panel list, with no new grant model.
   Making `/api/outputs/:id/rows` itself optional-auth would require re-deriving "is this Output
   reachable from a dashboard visible to this caller" independently per Output, duplicating the
   ACL logic and widening what an anonymous caller can probe (any `outputId`, not just ones on a
   dashboard they can already see).
2. **Service reuse.** The new route delegates to the same `OutputService.rows(outputId, page,
   *)` used by the authenticated route, but resolves `outputId` from `panelId` first via
   `panelRepo.findAllByDashboardId` — the same repo call the panel-list route already uses, no new
   repo surface — and calls an *unauthenticated-safe* internal variant of `OutputService.rows`,
   mirroring the existing `outputRepo.findByIdInternal`/`pipelineRepo.findByIdInternal` convention
   this file already uses for `resolveDataAsOf`. No new ACL surface: the dashboard-level
   `authorizeResourceWithSharing` gate is what makes this safe, exactly as it already is for the
   panel list.
3. **Scope §1 to API + RLS only; file a follow-up for the viewer UI.** Since no public-dashboard
   frontend view exists (see Context above), this ticket delivers and verifies the new route at
   the HTTP level (route spec / curl-equivalent test / RLS smoke) only — it does **not** build a
   public dashboard page or share dialog. AC "renders every panel... anonymously" is restated as
   an HTTP-level contract (see the `public-dashboards` spec delta). A follow-up ticket is filed
   during Execution for the actual public-dashboard viewer page + share affordance, blocked by
   this row, so the now-real API isn't stranded without a consumer indefinitely.
4. **RLS smoke test** follows the existing `RlsPolicyGuardSpec`/dedicated-role pattern (spec
   Testing strategy / Authorization & RLS): `SET ROLE` to a non-superuser, non-`BYPASSRLS` role
   created by the test, assert cross-tenant denial on `outputs`/`node_snapshots` via the public
   path, and prove the test itself red by dropping the relevant policy first (Iron Law: red before
   trusted).
5. **Export/import — no reshape, no version bump; two real, verified gaps to close (skeptic
   round 2 CR5/CR6, round 3 corrected the dependency shapes for both).** The v2 snapshot is
   already `(snapshotId, id, title, type, appearance, config: JsValue)`
   (`DashboardSnapshotPanelEntry`), and an output-kind panel's binding already lives at
   `config.outputId` — no `typeId`/`fieldMapping`, no version bump needed.
   - **Gap A — outputId existence check.** `DashboardService` currently has **no
     `OutputRepository`** (`DashboardService(dashboardRepo, accessChecker, auditService = null)`,
     `DashboardService.scala:35-41` — round-2's claim that the two services "already depend on"
     the same repo was false). Add `outputRepo: OutputRepository = null` as a new trailing
     defaulted constructor parameter, following this file's own existing nullable-optional
     convention for `auditService`. This touches all 17 `new DashboardService(...)` sites
     (`grep -rn "new DashboardService(" backend/src`): the 1 production site
     (`ApiRoutes.scala:242`) is updated to pass the real `outputRepo`; the 16 test-fixture sites
     keep compiling unchanged with the default `null`. **The `null` default is an explicit,
     documented decision, not an oversight**: a `null` `outputRepo` makes the new import check a
     no-op (mirrors `PanelService.rejectMissingOutput`'s own existing `null`-skips convention) —
     this is acceptable because none of the 16 existing fixtures exercise import's `outputId`
     validation today; the test written for task 2.1 (a new or existing import-focused spec) MUST
     construct its `DashboardService` with a real, non-null `outputRepo` so the check under test
     is not vacuous. In `importSnapshot`, for each output-kind panel entry, call
     `outputRepo.findByIdOwned(outputId, user)` directly (not `PanelService`'s private
     `rejectMissingOutput` — cross-class private access is impossible; this is the identical
     repository-level check, just invoked directly) and map a `None` result to
     `ServiceError.BadRequest("outputId <id> not found")`.
   - **Gap B — appearance/cross-field validation (absorbs HEL-628, the ticket's actual title:
     "Dashboard import bypasses panel appearance and cross-field validation").**
     `DashboardServiceValidation.scala:39-50` documents in-code that import deliberately skips
     general cross-field/appearance validation today. Round 2's proposed fix (route construction
     through `PanelService.buildForCreate`) does not integrate: `buildForCreate` takes a
     `CreatePanelRequest`, not a `DashboardSnapshotPanelEntry`, `DashboardService` holds no
     `PanelService`, and `DashboardSnapshotRepository.importSnapshot` (not `DashboardService`)
     is what actually constructs panels and mints the `snapshotId → PanelId` `idMap` the layout
     remap depends on — routing through `buildForCreate` would require a repository signature
     change no task names. Instead: **validate at the service layer, before the repo call, using
     only pure/stateless domain functions that already exist independent of `PanelService`** —
     `PanelConfigCodec.decodeCreateConfig(entry.type, Some(entry.config))` (config decode) and the
     constructed panel's own `.validateConfig` (a method on every `Panel` subtype, e.g.
     `OutputPanel.validateConfig`, `PanelService.scala:190`'s own call site is this same method,
     not a `PanelService`-only capability) plus the existing appearance-payload decode/validate
     path `PanelAppearancePayload` already uses. `DashboardService.importSnapshot` iterates
     `payload.panels`, runs this decode+validate for each entry, and returns
     `ServiceError.BadRequest` on the first failure *before* calling `dashboardRepo.importSnapshot`
     — so the repository's existing construction/id-minting logic is untouched, and no new
     `PanelService` dependency is introduced.
6. **HEL-940 fold-in — fix the class, not the instance (lesson 4); sweep allowlist decided
   explicitly (skeptic round 2 CR1/CR2/CR3/CR4).** Ground-truth counts (skeptic round 2,
   `grep -c`, excluding `db/migration`): `dataTypeId` = 195 `backend/src` + 21 `frontend/src` +
   **40** `helio-mcp/src` (not round 1's cited 216, and not round-1-refuted's "10" for
   helio-mcp — corrected here a second time; cite the live `grep` command in the PR rather than a
   hardcoded number, since it will keep moving as the executor works). `DataTypeId` = 124
   `backend/src`, 40 `frontend/src`, 11 `openspec/specs`, 8 `helio-mcp/src`, 6 `schemas/`;
   `metricId` = 47 `backend/src`, 40 `openspec/specs`, 5 `helio-mcp/src`, 3 `schemas/`,
   2 `frontend/src`; `type_id` = 67 `backend/src`, 13 `openspec/specs`.

   **Sweep allowlist (governs both §3's rename scope and ticket AC 6 / task 7.2's exit
   condition — ticket.md AC 6 and task 7.2 both point HERE rather than restating a narrower rule,
   closing round-3 CR3):** the zero-hit requirement applies to every pattern in ticket.md's Final
   Sweep list, across every directory it names, **except**:
   (i) `backend/src/main/resources/db/migration/` (ticket's own stated exception);
   (ii) `openspec/changes/**` archived change documents — historical records of already-merged
   changes, not live contracts, never touched by this or any other row;
   (iii) a code comment or a JSON Schema `description` string whose text is prefixed with a
   `HEL-NNN` ticket reference describing a historical removal (the existing HEL-849 comment
   standard, e.g. `TextPanel.scala`'s "HEL-904 task 4.1: ... are removed outright", and identically
   for a schema `description` field such as `schemas/panels/panel.schema.json:113`'s and
   `schemas/pipelines/pipeline-analyze-proposal-response.schema.json:5`'s HEL-NNN-prefixed prose —
   round 3 found the original wording of this clause covered only "comments," not JSON
   `description` strings, which are the same kind of historical record in a different file type;
   (iv) **a test that asserts the retired route/identifier/field is *absent*** — e.g.
   `frontend/src/shared/chrome/sections.test.ts:110-114`'s
   `expect(sections.some((s) => s.path === "/metrics")).toBe(false)`, or
   `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:3427-3428`'s
   `Get("/api/metrics") ~> ... NotFound` — these are the regression guards *proving* the sweep's
   own claim; deleting them to make the grep clean would remove exactly the evidence the sweep
   exists to preserve. The executor MUST NOT delete or weaken these to pass §7.2 — they stay, and
   the sweep script/PR-pasted output notes them as allowlisted-by-design, not as leftover work.
   Incidental prose that isn't a comment, description, or test assertion (e.g.
   `frontend/src/shared/ui/StatusChip.tsx:19`'s "pipelines/metrics/panels") is judged case by case
   against clause (iii)'s spirit at execution time — rewrite it if it's trivial to reword, note it
   in the PR if it isn't.
   Everything else — **including live `openspec/specs/**` capability files and `schemas/**` JSON
   Schemas**, which are current contracts, not archives — is in scope and must be renamed, not
   allowlisted. This closes CR1 (schemas/openspec previously had no owning task) and CR3 (§3
   previously covered only the literal string `dataTypeId`, not `DataTypeId`, `outputDataTypeId`/
   `leftDataTypeId`/`rightDataTypeId` on `WorkspaceContextProtocol`, `metricId`, or `type_id`).

   Enumerate by axis before touching code: (a) wire protocols (`DashboardProposalProtocol`,
   `AssistantProposalToolSchemas`, `WorkspaceContextProtocol` — including its
   `leftDataTypeId`/`rightDataTypeId`/`outputDataTypeId` fields, not just the literal string
   `dataTypeId`), (b) service-layer readers/writers of those wire fields (`ProposalPanelSupport`,
   `CombinedProposalService`, `WorkspaceContextComputations`, `PatchSet*` resolvers), (c) frontend
   proposal/patch-set review surfaces and their tests, (d) `helio-mcp/src` (40 `dataTypeId` + 8
   `DataTypeId` + 5 `metricId` hits — triage each: fix a live tool schema, allowlist a historical
   comment per the rule above; nothing may be left over per ticket AC 6), (e) `schemas/**` — re-`grep -rln "dataTypeId\|DataTypeId\|metricId" schemas/` rather than
   trusting a hardcoded count (5 files as of design time:
   `schemas/authoring/combined-proposal.schema.json`,
   `schemas/dashboards/dashboard-proposal.schema.json`,
   **`schemas/workspace/workspace-context.schema.json`** — carries the live *required* wire
   fields `leftDataTypeId`/`rightDataTypeId`/`outputDataTypeId` that §3.2 already renames on
   `WorkspaceContextProtocol`; omitting this file guarantees a schema/protocol drift failure —,
   `schemas/panels/panel.schema.json`, `schemas/pipelines/pipeline-analyze-proposal-response.schema.json`
   — triage the last two against allowlist clause (iii) first: if their only hit is a HEL-NNN
   description string, no rename is needed there, just confirmation), (f) live `openspec/specs/**` capability
   specs (19 files, 47 `dataTypeId` occurrences, including `patch-set-apply`, `patch-set-preview`,
   `pipeline-proposal-contract`, `mcp-panel-composition-tools`, `mcp-edit-in-place-tools`,
   `assistant-conversation-loop` — each needs a `MODIFIED Requirements` delta in this change, not
   a silent edit, since these are normative capability contracts). Rename `dataTypeId` →
   `outputId` (and the equivalent for `DataTypeId`/`metricId`/`type_id` occurrences that are live
   wire/schema fields rather than allowlisted comments/archives) end-to-end per axis, not
   file-by-file discovery.
7. **Rebuild scripts** are out-of-repo edits (sibling `~/Development/helio-news`), done and
   committed there directly, with the sibling PR link pasted into this PR — no change to this
   repo's build beyond what's needed to run `create_pipeline`/`place_outputs` against dev.
8. **E2E** adds one Playwright spec asserting interaction counts (clicks + Enter, typing
   excluded) via a single shared click-counting test helper (wraps `page.click`/`page.keyboard.press("Enter")`
   and increments a counter; a `<select>`/combobox open-then-choose counts as the number of
   underlying click/Enter events it actually dispatches through that helper, not a hand-counted
   "logical action" — so two implementers reading the same helper's output can't disagree) around
   the existing pipeline/dashboard flows — reuses the P1.5/P1.6 UI, no new frontend surface.
   Existing flaky spec (`hel813-mobile-touch-target-floor.spec.ts`) is left alone unless directly
   touched; if the executor touches it, fix the documented poll-then-walk race at
   `e2e/support/touchTargetProbe.ts:100-115` per the ticket brief, otherwise file a follow-up.

## Risks / Trade-offs

- [New public row-read route widens anonymous-readable surface] → Mitigated by reusing the
  dashboard's existing sharing ACL gate exactly as the panel-list route already does; no new
  grant semantics; RLS smoke proves cross-tenant denial under a real non-superuser role.
- [Import validation reuse could diverge from `POST /api/panels`'s validator if that validator
  changes shape later] → Call the same shared validator function rather than re-implementing it,
  so the two paths cannot drift silently.
- [HEL-940 rename touches proposal/patch-set machinery used by the in-app assistant] → Full
  `sbt test` + `npm test`/`typecheck` gate, plus existing proposal/patch-set Playwright coverage,
  before merge; this is exactly the kind of change decision 11 says must not ship half-renamed.
- [Sibling repo script updates are outside this repo's own CI] → Run once against dev manually,
  commit in the sibling repo, link the PR — documented explicitly in this PR's description per
  the ticket's own AC, not silently skipped.

## Migration Plan

No schema migration, no wire-shape or version change. Deploy is the ordinary PR merge → (later)
`v0.7.8` tag cut, per decision 17 ("no `v*` tag until P1.7 is green"). No rollback beyond the
ordinary revert-the-PR path — nothing here is destructive: the import-time `outputId` check only
*rejects* payloads that were already broken (an unresolvable Output), it does not change what a
valid payload does.

## Gate-Chain Implications Checklist

N/A — this change does not touch `.husky/**` or any script a pre-commit hook invokes.
