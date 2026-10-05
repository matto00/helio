# HEL-1154: Preview path appends "(previewed)" to a title on every invocation instead of once

## Description

Original report: a dev-DB panel and its output are both titled
`Total Revenue by Region (previewed) (previewed) (previewed) (previewed) (previewed)` — the suffix appears five times,
suggesting a title re-derived from the already-suffixed title on each preview.

**Premise validation (2026-10-04, owner ruled `proceed-with-restated-scope`):**

- The ONLY writer of "(previewed)" anywhere (backend, frontend, helio-mcp, e2e) is the DEV-only demo fixture
  `synthesizeDemoPatchSet` in `frontend/src/features/patchSets/ui/PatchSetReviewPage.tsx` (HEL-408). Pipeline step
  preview, apply-proposal and MCP `preview_outputs` are not involved.
- Preview persists nothing (`PatchSetPreviewService` performs no repository writes); the suffix persists only when the
  demo patch set is Accepted (applied) — it is the demo's intended rename payload, not a presentation-only marker.
- Unbounded growth was already fixed by F-002 (c0fbb56a, 2026-08-17): `baseTitle` strips ONE trailing marker before
  re-appending one.
- The output shares the title because V94 (HEL-904) copied `panels.title` into `outputs.name` once.
- Residual defect: `baseTitle` strips only one marker, so an already-compounded title (e.g. 5x) never converges to one.
- Dev DB: 1 panel (`93f894fc-4335-4403-9e2a-c8fbcddd0f21`, 5x) + 1 output (`hel904-output-93f894fc-…`, 5x). Left as is.

## Acceptance Criteria (restated scope)

- `baseTitle` strips ALL trailing " (previewed)" markers, so the demo-built title carries exactly one marker for any
  starting title (clean or already compounded N times), i.e. repeated demo applies converge to exactly one marker.
- A Jest probe demonstrates the defect RED on unmodified code (a compounded title yields more than one marker in the
  demo patch set) before the fix, GREEN after, and a mutation (reverting to single-strip) turns it red again.
- The existing single-strip test (`"Revenue (previewed) (previewed)" -> "Revenue (previewed)"`) is updated to the new
  contract.
- Frontend only; no backend, migration, or helio-mcp change; no stored-data fix (the 5x dev row is left as evidence).
