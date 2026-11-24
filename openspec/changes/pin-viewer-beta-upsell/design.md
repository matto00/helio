## Context

See proposal.md (Why). Static read of main fe07492b6:

- The link in question is `HistoryPayloadsField.tsx`'s upsell, rendered by `OutputEditorSheet.tsx` (History card) only
  for a saved Output (`!isCreate`) whose kind is not `insight`, and only while `output.historyPayloadsAvailable !== true`
  (the PIPELINE OWNER's tier is free; a missing flag fails closed to "unavailable"). There is no role gate.
- For a viewer the sheet wraps its fields in `<fieldset disabled>` (`readOnlyFence`, HEL-1794). A fieldset disables
  form controls, not an `<a>`, so the link stays live.
- HEL-1839 made `readOnly` default to `true` (fail-closed). That only fences the fields; it does not touch the link.
- Two other "Request Beta access" links exist near the sheet and are NOT this ticket's link:
  - `InsightKindFields.tsx` (insight Outputs): `showUpsell: isPipelineOwner && tier === "free"`, so owner-only by
    design (HEL-1744: renders are charged to the pipeline owner). Editors do not see it either; unchanged.
  - `AskUpsell` in the sheet's "Ask about this Output" disclosure: keyed on the signed-in user's OWN tier; not
    role-gated; unchanged and out of scope here.

## Goals / Non-Goals

**Goals:**
- Confirm live, before any test, that a viewer sees the History card link (light and dark), and name the conditions.
- Pin the History card link for viewer and editor (jest + e2e), mutation-proven.

**Non-Goals:**
- Any production code change (the ruling keeps today's behaviour). If live verification shows the link is NOT shown
  to a viewer, stop and escalate; do not "fix" anything first.
- The insight-kind upsell and the Ask upsell (different links, different rules, unchanged).
- The pipeline page's schedule controls (sibling HEL-1837) and anything backend (sibling HEL-1852).

## Decisions

D1. Jest at the sheet level, three roles. In a new file `OutputEditorSheet.viewerUpsell.test.tsx` (same harness shape
as `OutputEditorSheet.history.test.tsx`), on a metric Output with `historyPayloadsAvailable: false`:
viewer (`readOnly` true, `isPipelineOwner` false), editor (`readOnly` false, `isPipelineOwner` false), and the
fail-closed default (no `readOnly` prop) each find, scoped to the History card, an enabled link named exactly
"Request Beta access (opens in a new tab)" with `href` `/settings#beta-access`, plus the note text. For the viewer,
also assert the link is inside the disabled fieldset and is not itself disabled (no `aria-disabled`), so the test
pins "live link in a read-only sheet". Alternative considered: extending the history test file only; rejected to
keep the role matrix in one named place. Owner tests stay where they are, unchanged.

D2. e2e on real roles. A new spec `e2e/hel1838-viewer-beta-upsell.spec.ts` reusing `e2e/support/hel1661Fixture.ts`
(`seedSharedPipeline`, `collaborator`, `openPipeline`): a free-tier owner shares a pipeline with a viewer and an
editor; each opens the fixture's Output sheet (desktop, light and dark theme) and asserts the History card's link is
visible, enabled, has the exact name and href. The executor confirms the owner is free tier (so the Output's
`historyPayloadsAvailable` is false) from the real Output response rather than assuming it. The locator is scoped to
the History card (not page-wide), because the Ask panel's upsell has the same accessible name. Playwright 2 workers.

D3. Mutation proof (red), recorded and committed as `.txt` before the final test commit: (a) gate the link on read-only
(e.g. pass `readOnly` into `HistoryPayloadsField` and render the link only when not read-only) -> the jest viewer and
default tests and the e2e viewer test go red while the editor ones stay green; (b) gate it on pipeline ownership
(`isPipelineOwner`) -> the editor tests go red too. Mutations are reverted; no mutation ships.

D4. Live verification first (task 1): before writing tests, start lane servers on the lane DB from the unmodified
worktree (== main fe07492b6), and as a real viewer grantee on a free-owned shared pipeline open a saved non-insight
Output's sheet in light and dark. Record what is shown and which conditions show it (owner tier free; saved Output;
kind not insight; viewer's own tier irrelevant). Screenshots + notes go to the run evidence. If the link is absent
or intermittent, the executor stops and returns ESCALATION with the evidence.

D5. Fix the hel1794 allow-list comment so it names both the Ask panel upsell and the History card upsell for the
"Request Beta access (opens in a new tab)" entry. Comment-only.

## Risks / Trade-offs

- [The e2e fixture's owner might not be free tier] -> asserted from the real Output response (D2), not assumed.
- [Same accessible name as the Ask upsell masks a missing History link] -> every locator is scoped to the History
  card (D1/D2) and the mutation (D3) proves it.
- [Shared Playwright MCP browser with other lanes] -> live check uses the lane's own dev port only, checks for open
  dialogs, never navigates another lane's page.
