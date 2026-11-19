## Context

See proposal.md (Why). Current state, read from the tree at b2603ab79:

- Ask entry gating is client-only: `DashboardMetaRow.tsx` renders the Ask button only `isOwner && !shareInKebab` and the
  kebab item inside `if (isOwner)` (nested in `if (shareInKebab)`); `CommandBar.tsx` adds its kebab item `...(isOwner ? ...)`.
  `App.tsx` mounts `AskDrawer` for any selected dashboard (not gated).
- Server: `AskAccess.gate` admits the dashboard owner or a named grant row (`AccessChecker.requireAccess`).
  `AskPinBuilder` returns a pin only for `Owner`/`Editor` access on the one cited pipeline. `AskToolExecutor` re-resolves
  scope on every call; `get_history_rows` is offered/served only with a pipeline grant. `AskApiHarness` (base of
  `AskSeamSpec`/`AskRoutesSpec`) runs its app pool under `SET ROLE helio_app_test_output_history`, a NOSUPERUSER role
  (so NOBYPASSRLS unless granted); `AskSeamSpec` already has "explicit null pin for a dashboard viewer" (`viewer` holds
  only a dashboard viewer grant).
- `AskAnswerCard` renders each citation as `CitationChip` with `source={{ variant: "authenticated" }}`, so a chip's
  provenance fetch is `GET /api/outputs/:id/provenance` (`provenanceService.fetchOutputProvenance`). Prod RLS
  (`outputs_select`) refuses that to a dashboard-only grantee. Cited Outputs are listed as plain names.
- HEL-1780 pattern: on a non-owned dashboard `InsightPanelBody` uses the `public` source with the dashboard id and no
  token, so chips read `/api/dashboards/:id/panels/:panelId/provenance` (optional-auth, admits grantees).
  `CitationChip` already picks `citation.panelId ?? insightPanelId` as the per-panel id in that variant.

## Goals / Non-Goals

Goals: the specs in this change. Non-goals: proposal.md Non-goals; no change to the `/ask` contract, schemas or fixtures'
shape; no new route; no migration.

## Decisions

D1. **Entry visibility = "can read the dashboard", not "owns it".** Replace the `isOwner` condition on the three Ask
entries with "a dashboard is selected" (the dashboard list already contains only owned + named-grant dashboards, so a
selected dashboard is readable). Share stays owner-only: in the meta-row kebab, keep Share under `isOwner` and move the
Ask item out of that block. Alternative (a new `selectCanAskDashboard` selector keyed on `accessRole`) rejected: there
is no readable-but-not-askable role among list entries, and a public/share-token view never mounts this shell (ask-ui
already forbids Ask there; the executor must confirm the public viewer does not render `DashboardMetaRow`/`CommandBar`).

D2. **Chip provenance on a non-owned dashboard goes through the per-panel route.** In `AskAnswerCard`, when
`scope.kind === "dashboard"` and the caller is not the dashboard owner (`selectIsDashboardOwner`), pass
`source={{ variant: "public", dashboardId: scope.id }}` (no token) and set the citation's `panelId` to the first loaded
panel of that dashboard (panel order, `state.panels.items` when settled for that dashboard) whose `outputId` equals the
citation's `outputId`. When none matches, render the ordinal as plain text with no button (spec: no provenance action).
Match on `panel.config.outputId` of `type: "output"` panels (`outputId` is not a top-level panel field). The
unmatched fallback lives in `AskAnswerCard` (never render a `CitationChip` for it: `CitationChip` would fall back to
`insightPanelId` = `ask:dashboard:<id>` and request a 404). The `public` variant emits no `provenance_opened` telemetry
(same as HEL-1780 grantee chips); accepted, and no test may assume it fires. Owner path and Output-scope path unchanged
(`authenticated`). Alternative: server adds `panelId` to dashboard-scope
citations -- rejected, it changes the committed `/ask` contract and fixtures for information the client already holds.
Alternative: always route through per-panel even for owners -- rejected, changes owner behaviour without need.
The `public` variant is also what HEL-1780 uses for grantee insight chips, so popover content (no pipeline/Output
links) matches the grantee panel experience; the executor must check `useProvenancePopoverHost`/popover for any
`/api/outputs` or `/api/pipelines` fetch or link in that variant.

D3. **No pin = server's `pin`.** No client role logic for the pin; the card already renders the action iff `pin !== null`.
Server proof (seam, RLS role): (a) existing `AskSeamSpec` dashboard-viewer case stays, gains a recorded mutation run
that reaches the dashboard-only viewer's path: make `AskPinBuilder`'s access match fall through to `Some(...)` on any
result (`case _ => Some(...)`, so `Left(NotFound)` for a caller with no pipeline grant pins) -> that case goes red.
(Accepting `Right(Viewer)` would NOT go red here: the seam viewer has no pipeline grant row, so `requireAccess`
returns `Left(NotFound)`, never `Right(Viewer)`.) (b) new `AskSeamSpec` case: a beta user with an
`editor` grant on the board and no pipeline grant asks the cited answer -> 200 equal to `ask-200-no-pin.json`
(normalised exactly like the viewer case), with mutation (make `AskPinBuilder` decide on the caller's DASHBOARD access
-- `requireAccess("dashboard", ...)` of the asked board -- instead of the pipeline's -> the editor case goes red).

D4. **RLS proof inside the ask harness.** Add to `AskRoutesSpec` (or a new `AskGranteeRlsSpec` on `AskApiHarness`) a
labelled transcript `[HEL-1781 RLS]`: first assert the app pool's `current_user` and `rolbypassrls = false` (so the
proof is not vacuous); then a dashboard-only beta viewer asks with a scripted transport that calls `list_board_outputs`,
`get_output_rows` and `get_output_history` on an on-board Output with seeded rows and two history points; assert each
tool result carries data (rows / a compare or window, not an error), the request's offered tools exclude
`get_history_rows`, status 200, `pin` null; positive control: the owner's identical ask is offered `get_history_rows`.
If any read comes back empty or errors under the role, that is a real prod defect: fix it server-side (explicit-SQL
check then privileged read, the pattern `AskAccess`'s comment describes), never by loosening RLS. Also a direct check:
a scripted `get_history_rows` call with a real point id by that viewer returns the error tool result and the payload row
is never read (existing scenario in ask-your-data; confirm present, else add). Transcript saved to
`.concertino/scratch/HEL-1781/rls-ask.txt` and persisted.

D5. **Free tier.** `AskPanel` already shows `AskUpsell` when `currentUser.tier === "free"` before any request. Unit test
the grantee variant (free + viewer-role dashboard) and cover it in e2e.

D6. **Tests.** Unit (jest, full files): `DashboardMetaRow.roles.test.tsx` (viewer and editor see Ask in both tiers of the
row; Share still absent), `CommandBar.test.tsx` (Ask item for a grantee), `AskAnswerCard`/`AskDrawer.test.tsx` (non-owned:
chip fetches per-panel URL with the mapped panel id, never `/api/outputs`; unmatched citation renders no button; owner
unchanged; no pin with the no-pin fixture). e2e `e2e/hel1781-ask-shared-dashboard.spec.ts` (full file; HEL-1746
pattern: only the `/ask` response faked via `page.route` with the committed fixtures, ids substituted; everything else
real): viewer (desktop + phone) opens Ask, asks, sees answer and no pin, opens a chip's provenance (real per-panel
route), zero requests matching `/api/outputs` or `/api/pipelines` and no `/api/*` 4xx/5xx; editor without pipeline
grant: no pin; free-tier viewer: upsell, zero `/ask` requests; owner regression: chip still uses the Output route.
Grep `e2e/` for every selector/label the change touches (e.g. `hel1773-viewer-grantee-dashboard.spec.ts` may assert
Ask is ABSENT for grantees -- update it, it encodes the old behaviour).

## Risks / Trade-offs

- [hel1773 e2e/unit tests assert Ask hidden for non-owners] -> update them in this change; they encode child 1's
  temporary rule, which this ticket reverses by design.
- [Panels for the dashboard not loaded when the answer renders] -> answer renders after the user opened the drawer on a
  displayed dashboard; unmatched -> plain ordinal, never a broken fetch.
- [AskApiHarness role might have BYPASSRLS via grant] -> D4 asserts `rolbypassrls = false` first.
- [dev/CI DB is superuser] -> e2e network assertions prove the client never calls Output routes; RLS proof is D4.

## Migration Plan

None. Frontend + tests; server code only if D4 finds a defect.

## Planner Notes

- Self-approved: client-side panel mapping instead of a contract change (D2); entry gated on "dashboard selected" (D1).
- Product question checked against ticket: an editor grantee WITH an edit grant on the cited pipeline still gets a pin
  (existing server rule); ticket only requires no pin without that grant. Not escalated: unchanged behaviour.
- Lane rules for every sub-agent: no live model call (backend started with `ANTHROPIC_API_KEY` exported empty), lane DB
  `helio_hel1781`, avoid HEL-1784 files, no migration expected (V147 if ever needed, reported).
