## Why

HEL-1773 hid "Ask about this dashboard" from every non-owner, although the ask route already admits named-grant
grantees. Grantees of a shared dashboard (viewers and editors) cannot ask about it. Re-opening the entry is not only a
visibility flip: an answer's citation chips open provenance through `GET /api/outputs/:id/provenance`, a route prod
row-level security refuses to a dashboard-only grantee, so the answer card would show broken provenance there.

## What Changes

- Show the Ask entry (meta-row button, meta-row kebab item, command-bar kebab item) on a dashboard the caller holds a
  viewer or editor grant on, not only on owned dashboards.
- On a dashboard the caller does not own, an answer's citation chips open provenance through the dashboard-scoped
  per-panel route (`/api/dashboards/:id/panels/:panelId/provenance`) of a panel on that dashboard bound to the cited
  Output. The ask flow on a non-owned dashboard sends no request to `/api/outputs/*` or `/api/pipelines/*`.
- Cited Outputs stay listed by plain name, never as a link.
- No pin action is shown when the server returns `pin: null`. New server-side proof: a dashboard editor with no grant
  on the cited pipeline gets `pin: null` on the seam (the dashboard-only viewer case already exists; it gains a mutation
  proof).
- A server spec on the NOBYPASSRLS app pool proves a dashboard-only viewer's real ask reads rows and history through
  the scope-checked loop, is never offered `get_history_rows`, and gets `pin: null`.
- Free-tier grantees see the existing upsell; no request is sent.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ask-ui`: adds a requirement for Ask on a shared dashboard (entry offered to grantees, per-panel provenance for
  chips, no Output or pipeline route requests, no pin when `pin` is null, upsell for free-tier grantees).
- `ask-your-data`: adds a requirement that a dashboard grantee's ask works under row-level security through the
  scope-checked loop, with `pin: null` for a dashboard editor without a pipeline grant.
- `dashboard-grantee-access`: adds Ask to what a grantee's shell offers.

## Non-goals

- Pinning for grantees who lack an edit grant on the cited pipeline (server rule unchanged).
- Output-scope ask (`POST /api/outputs/:id/ask`) for grantees; the Output sheet stays owner/pipeline-grant only.
- Any change to the ask route's admission, tier gate, billing or tool set.
- HEL-1784's form-panel files; no migration.

## Impact

- Frontend: `DashboardMetaRow.tsx`, `CommandBar.tsx`, `AskAnswerCard.tsx` (chip source), possibly `CitationChip.tsx`;
  their unit tests; a new e2e spec.
- Backend tests only (expected): `AskSeamSpec`, a new RLS spec on `TwoUserRlsApiFixture`. Server code changes only if
  the RLS spec exposes a defect.
- No contract or schema change; `shared-test-fixtures/ask/` reused.
