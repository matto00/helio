## Context

See proposal.md (Why) and ticket.md (Owner Rulings Q1–Q4). Ground truth:
- `PayloadOptIn` (domain/history) validates `config.historyPayloads` (bool | null | absent). `PipelineRunService` links
  a payload only to opted-in Outputs of a node, and `NodePayloadHistoryRepository.writeAction` stores nothing unless
  the PIPELINE OWNER's tier `PayloadTierLimit.allowsPayloads` (`pipelines.owner_id` → `users.tier`).
- `PayloadHistoryConfig.fromEnv()` is already built in `Main` and `ApiRoutes` (defaults 1000 rows, 1 MiB, free 0,
  beta 10 runs / 7 d, owner 30 runs / 30 d; prod sets no override).
- `OutputRoutes` builds every REST Output response via `OutputProtocol.outputResponseFrom` at 5 sites (list-by-pipeline,
  create, get, patch, list-all). Patch-set apply/preview also call it; they are out of scope (D2).
- `PATCH /api/outputs/:id` shallow-merges config, so today's editor Save (`buildOutputConfig`, which never emits
  `historyPayloads`) preserves an API-set value.
- `OutputEditorSheet.tsx` is 686 lines, already over CONTRIBUTING's ~400-line budget, so new UI goes in its own file.
- Shared `Toggle` (`shared/ui/Toggle.tsx`, `role="switch"`, `disabled`, `ariaDescribedBy`) exists.
- Settings has no deep-link to `BetaAccessSection`; the precedent upsell
  (`ActiveConversationPanel`, "Request access in Settings") navigates to `/settings`.
- `users` carries NO RLS (`V88__user_tier.sql:9-10`), and a pipeline grantee can read the pipeline row under RLS
  (`V39` `pipelines_select`). RLS is therefore not the reason for D1's pool choice (skeptic-design-1 CR1).

## Goals / Non-Goals

Goals: the owner-ruled toggle/copy/gating; a correct cross-tier flag; documented MCP path; tests on both paths.
Non-goals: see proposal.md. Also no change to how payloads are written or retained.

## Decisions

**D1 — Availability is computed on the privileged pool, after authorization.** Add a batched
`payloadsAvailableFor(pipelineIds: Set[String], config: PayloadHistoryConfig): Future[Map[String, Boolean]]` to
`NodePayloadHistoryRepository` (the class that already owns `ownerLimit` and the privileged pool). It runs one
`SELECT p.id, u.tier FROM pipelines p JOIN users u ON u.id = p.owner_id WHERE p.id IN (...)` and maps through
`config.limitFor(tier).allowsPayloads`. An unknown pipeline or tier maps to `false`. Safety property: it is called
only with pipeline ids of Outputs the service has already authorized and returned to this caller. Authorization
happens before the lookup, so nothing leaks. It runs on the privileged pool (`ctx.withSystemContext`) for three
reasons:
- it matches `ownerLimit` and this repository's privileged-only class contract;
- it reads the same `pipelines`→`users` join the payload writer reads, so the flag and the writer cannot disagree;
- it stays correct for an Output the caller owns on a pipeline whose grant was later revoked (`GET /api/outputs`
  lists owned Outputs).

Alternative rejected: a per-Output lookup (N queries on list routes).

**D2 — Field shape and scope.** `OutputResponse` gains `historyPayloadsAvailable: Option[Boolean] = None` (spray omits
None). The 5 `OutputRoutes` sites populate it as `Some(...)`. Patch-set `resultingState` sites keep `None`. Those are
agent-diff projections, not the editor's read path, and threading the repo there is scope growth. `output.schema.json`
adds an optional, read-only boolean property.
`OutputRoutes` gains a constructor parameter
`payloadAvailability: Option[(NodePayloadHistoryRepository, PayloadHistoryConfig)] = None`, next to the existing
`historyService: Option[OutputHistoryService] = None`. `ApiRoutes` (the `new OutputRoutes(...)` site, ~line 940)
passes `Some((resolvedNodePayloadHistoryRepo, payloadHistoryConfig))`, both already held there. It must never pass
the nullable `nodePayloadHistoryRepo` constructor param, which is `null` in ApiRoutes-built test fixtures. A bare test fixture
without it omits the field. A production-wired test (built through `ApiRoutes`) asserts the key at all 5 sites, so a
missed wiring cannot silently fail the frontend closed. The 6 patch-set sites (`PatchSetPreviewProjection`,
`PatchSetApplyRollback`, `PatchSetApplyForward`, and 3 in `PatchSetApplyResolvers`) are deliberately unchanged.

**D3 — Frontend gating reads the response flag only.** `Output.historyPayloadsAvailable?: boolean`. The toggle is
enabled iff `=== true`. Absent or false renders the disabled state (fail closed, matching Q1). `User.tier` is never
consulted (Q3).

**D4 — Edit-only.** The History section renders only for an existing Output. In create mode there is no Output
response yet, so availability is unknown. A create-mode toggle would either guess from the viewer's tier (rejected by
Q3) or need a pipeline-level flag (scope growth). The create flow stays unchanged and leaves `historyPayloads` absent.

**D5 — Component and save path.** The new `outputEditor/HistoryPayloadsField.tsx` renders the shared `Toggle` with
label "Keep each run's rows" and the exact Q2/Q4 copy, and a disabled state with the Q1 note and link. The sheet holds
`historyPayloads` state, seeded from `config.historyPayloads === true` and re-seeded on `output?.id` like the other
fields. On an edit Save, `historyPayloads` is added to the PATCH config only when the toggle is enabled
(`historyPayloadsAvailable === true`) AND its state differs from the seeded value. In that case the user's explicit
`true`/`false` is sent. Otherwise the key is omitted, and `OutputService.mergeConfig`'s top-level shallow merge
preserves whatever is stored (absent, `null` or a stale `true`) byte-for-byte (skeptic-design-1 CR2). The logic sits
in the sheet's update call, not in `buildOutputConfig`, which is shared with create.

**D6 — Upsell link.** The upsell is a react-router `Link` to `/settings#beta-access`. The anchor
`id="beta-access"` goes on the `<section>` in `SettingsPage.tsx` that wraps the "Beta access" `<h2>` and
`<BetaAccessSection />`, so the heading lands in view. The sections above it render loading placeholders and then
content, which shifts layout. So `SettingsPage` calls `scrollIntoView({block: "start"})` when
`location.hash === "#beta-access"`. It fires once on mount and again when each page-level loading flag (Preferences, Agent memory, PATs) settles. A
`wheel`/`touchmove`/`keydown` listener sets a ref that stops any further auto-scroll once the user has interacted.
The audit section's internal fetch is not tracked; e2e waits for it. e2e acceptance: after clicking
the link and `waitForSettingsAuditTable` (`e2e/support/settingsReady.ts`), the "Beta access" heading is in the
viewport. Plain `/settings` was rejected because it lands on Appearance with Beta access below the fold.

**D7 — Copy constants.** The copy lives as string constants in `HistoryPayloadsField.tsx`, including the exact Q4
sentence "Turning this off stops storing rows; rows already kept expire on the normal schedule.", with a comment tying the
numbers to `PayloadHistoryConfig.Defaults`. An env override would make the copy stale; this is accepted (Risks).

**D8 — MCP.** `update_output` keeps its generic `config` record (it already passes `historyPayloads`). Add a
`HISTORY_PAYLOADS_CONFIG_DOC` constant, appended to the description like `COMPARE_CONFIG_DOC`. Add handler and
registration tests: the PATCH body carries `historyPayloads: true`, and the description mentions the key, both caps
and `historyPayloadsAvailable`.

## Risks / Trade-offs

- [Prod env overrides the caps → copy is stale] → none are set today. The doc comment points at the defaults.
  Follow-up only if an override is ever introduced.
- [Flag computed from a different source than the writer uses] → D1 reads the same join on the same pool as
  `ownerLimit`. A route test covers the cross-tier editor-grantee case through the production wiring.
- [A beta viewer editing their own Output on a free-owned shared pipeline sees the free upsell, and the link lands on
  "You have Beta access."] → this follows from rulings Q1/Q3. A unit test pins it so nobody "fixes" it back to
  `User.tier` (C1).
- [Stored `true` on a free-owned pipeline (set via API before)] → the disabled switch shows it on. Save preserves it.
  The backend still stores nothing. Acceptable, and it becomes effective on upgrade.

## Planner Notes

Self-approved, not owner-ruled: edit-only placement (D4), the `#beta-access` deep link (D6), the hardcoded copy
numbers (D7), and omitting the field on patch-set projections (D2). The Q4 sentence in the spec is the ruling's own
example wording, made final.
