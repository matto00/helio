## Why

HEL-1745 shipped ask-your-data routes and HEL-1744 shipped citation chips, but no screen lets a user ask a question,
read a cited answer, or keep it as an insight. This leaf (L7 of HEL-921) is that surface.

## What Changes

- New `features/ask/`: an ask service and parser for `POST /api/dashboards/:id/ask` and `POST /api/outputs/:id/ask`, a
  question box, and an answer card whose `[cN]` markers render as HEL-1744's `CitationChip` through `InsightMarkdown`
  (reused, not forked).
- Dashboard: an "Ask about this dashboard" control in the meta row (icon-only secondary, into the kebab at narrow tiers;
  DESIGN.md §9 amended, tiers re-measured) and the command bar (phone and non-rail) opens a `BottomSheet` ask drawer (540 px on desktop via a new optional `size` passthrough on `BottomSheet`; phone
  unchanged; DESIGN.md §10 amended).
- Output sheet: an "Ask about this Output" section for an Output with a server row (not create mode, not a draft
  Output). Pin is disabled while a pipeline draft is open.
- "Pin as insight" shows only when the response's `pin` is non-null. The server sets `pin` only for an owner or editor
  of the one cited pipeline, so a viewer never sees it. Pinning POSTs the server-built body to
  `/api/pipelines/:id/outputs` and never sends answer text. On the dashboard, the owner also gets the new Output placed
  as a panel, which shows the not-yet-rendered state until HEL-1743.
- States: free tier sees an upsell (proactively, and on `403 TIER_FORBIDDEN`), `429 CHAT_LIMIT_REACHED` shows the daily
  limit, `422 ASK_ANSWER_TRUNCATED` asks for a narrower question, any other `422` shows "could not ground an answer", and other 4xx/5xx show a generic retryable error.
- Wire seam: committed fixtures under `shared-test-fixtures/ask/` that a backend seam spec proves equal what the real
  route writes. These are 200 with pin, 200 without pin, 422 ASK_UNGROUNDED, 422 ASK_ANSWER_TRUNCATED and 403 TIER_FORBIDDEN.
  New schemas cover both 422 bodies and the tier-error body, and a frontend contract test validates the same files with Ajv.

## Capabilities

### New Capabilities
- `ask-ui`: the ask surfaces, the answer card, pin as insight, and the quota and limit states.

### Modified Capabilities
- `ask-your-data`: the 422 ASK_UNGROUNDED / ASK_ANSWER_TRUNCATED and 403/429 tier-error bodies of the ask routes gain committed schemas,
  pinned by a seam spec.

## Non-goals

- Rendering an insight on pin (HEL-1743, parked), a render path, or a production seed.
- A model choice in ask, or any billing-weight copy (open owner questions).
- Any change to ask backend behaviour (HEL-1761 owns that), and any Flyway migration.
- Asking from a public or share-token view (the backend denies it).

## Impact

Frontend `features/ask/*`, `app/App.tsx`, `app/CommandBar.tsx`, `app/dashboardMeta/DashboardMetaRow.tsx`, `useMetaRowTier.ts`, `shared/motion/BottomSheet.tsx`, `DESIGN.md` (§9,
§10), `CLAUDE.md` (ask endpoint entry),
`OutputEditorSheet.tsx`; `schemas/ask/*`; `shared-test-fixtures/ask/*`; one backend test spec (test code only); and a new
Playwright spec.
