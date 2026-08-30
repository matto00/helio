## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

Re-derived every round-1 finding from ground truth in the worktree, not from the round-2 summary.

- **CR1 (recipe count) — FIXED.** `grep -rn "page__loading\|page__error" --include=*.css frontend/src` returns exactly four files: `ChatPage.css`, `MetricDetailPage.css`, `MetricsPage.css`, `SettingsPage.css`. `proposal.md:16-21`, `design.md:8-11` and `design.md` Decision 5 now state this inventory and name the two in-scope files (`ChatPage.css`, `SettingsPage.css`). Tasks 3.2/3.3/5.1 match.
- **CR2 (TypeDetailPage) — FIXED.** `frontend/src/features/dataTypes/ui/TypeDetailPage.tsx` exists; `proposal.md:60-66` and `design.md:16-20,43-44` now exclude it by directive, not by claimed absence.
- **CR3 (SettingsPage contradiction) — FIXED and consistent with code.** `design.md` Decision 3a + `spec.md:80-84` + `tasks.md:3.3` all specify three independent `PageStatus` instances. Verified against `SettingsPage.tsx:39-41` (three status flags) and `SettingsPage.tsx:75/80/92/97/122/127` (exactly three loading/error `<p>` pairs); no other component references `.settings-page__loading|__error`, so deleting `SettingsPage.css:17-25` after migrating those three is achievable.
- **CR4 (review-route header) — FIXED.** `spec.md:63,69-70` now scopes `PageHeader` to routes that already have a title and adds a "Review routes render no PageHeader" scenario. Verified header-less: grep for `h1|page-title|header` in all four review files returns nothing.
- **CR6 (all four review routes) — FIXED.** All four exist (`features/dashboards/ui/ProposalReviewPage.tsx`, `features/patchSets/ui/PatchSetReviewPage.tsx`, `features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx`, `features/proposals/ui/CombinedProposalReviewPage.tsx`) and each has a task (4.1–4.4).
- **CR7 (scope ruling) — FIXED and independently confirmed.** `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` line 168 lists `TypeRegistryPage`/`TypeDetailPage`, `MetricsPage`/`MetricDetailPage`/`CreateMetricModal`/`MetricEditorForm` among pages "Removed"; decision 11 states "No deprecation… deleted wholesale in the ticket that replaces them." Decision 0, the corrected AC section, and the tracked handoff (tasks.md 5.4) are all present and mutually consistent.
- **CR5 (route count) — NOT fixed** (see below). Enumerated in-scope routes: Sources, Pipelines, PipelineDetail, Chat, Settings (5 with headers) + 4 review routes = **9**.

### Verdict: REFUTE

### Change Requests

1. **The route count is still off — "9" was replaced by "7", but the enumerated set is nine.** `spec.md:63` is titled "The **seven** listed routes render through PageShell/PageStatus…" and then enumerates nine route names on lines 64-66. The same wrong figure propagates to `proposal.md:44` ("the 7 listed surviving routes"), `proposal.md:80` (implicitly, "all 5 listed routes that render one" is correct, but pairs with the 7), `design.md:3` ("Seven top-level routes each hand-roll a container div, a header…" — which is also wrong on its face, since four of the listed routes have no header), `design.md:136-138` (Risks: "Visual regression surface (7 routes…)" and "must actually visit each of the 7 routes' loaded, loading … states"), and `tasks.md:5.3` ("Manually drive each of the **7** migrated routes' loaded/loading/error states"). This is not cosmetic: 5.3 and the Risks note are the executor's and the UI gate's verification target, and as written they license checking seven of the nine modified routes, with the two least-covered ones (`PipelineProposalReviewPage`, `CombinedProposalReviewPage`) the natural casualties. Replace every occurrence with **9** (or, better, "all nine listed routes — 5 with headers, 4 review routes"), and fix `design.md:3` so it does not claim all seven/nine hand-roll a header.

### Non-blocking notes

- `SettingsPage`'s current per-section states carry accessibility affordances the new primitive must not silently drop: `aria-label="Loading preferences"` etc. (`SettingsPage.tsx:75,92,122`) and `role="alert"` (`:80,97,127`). Three identical unlabeled `PageStatus` spinners on one page is a genuine a11y regression risk; worth a line in tasks 3.3 that `PageStatus` accepts/forwards an accessible label and preserves an alert role on the failed branch.
- `SettingsPage`'s title moves from `.settings-page__title` to `.page-title` — already correctly flagged in tasks.md 3.3 as expected, good.
- `design.md` Decision 3 (PageStatus supplies the slot, not a fixed skeleton shape) remains sound and correctly avoids colliding with `shared-skeleton`'s per-row geometry requirement.
