# HEL-725: Add shared PageShell/PageHeader + PageStatus (loading/error) primitives; migrate routes off hand-rolled containers

## Description

> **Row 0c of the Pipelines & Outputs remodel (HEL-903)** — parallel with 0a–P1.3. The rebuilt pipeline page (P1.5, HEL-908) and dashboard picker (P1.6, HEL-909) use these primitives; do not migrate `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, or `MetricDetailPage` — they are deleted by HEL-909.

From the beta UI/UX polish sweep (PR #382), majorProposal — also explicitly flagged as a follow-up during the sweep's own integration pass (a cross-package request for exactly this was declined mid-sweep as out of scope: "seven near-identical loading/error CSS recipes across assistant/dataTypes/metrics/settings/sources/pipelines Page.css files").

## Scope

Every top-level route hand-rolls its own container, header (or lack of one), and loading/error state, with drifting sizes/padding and near-identical-but-not-shared CSS. Build:

* `PageShell`/`PageHeader` — padding tokens, optional Fraunces title, eyebrow, actions slot, optional back link.
* `PageStatus` — the DESIGN.md §7 loading spinner / error pattern as one component.
  Migrate Sources, Pipelines, PipelineDetail, TypeRegistry, Metrics, MetricDetail, Chat, Settings, and the review routes onto both.

## Acceptance Criteria

* One shared loading/error implementation used by all listed routes; the 7 duplicated `Page.css` loading/error recipes are deleted.
* Page headers are visually consistent (title style, spacing, actions placement) across all listed routes.

## Notes from Setup (orchestrator)

- Design spec context: `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` — row 0c only references this ticket by table entry (line 207), no further detail.
- Premise validated against live main (2026-08-30): no PageShell/PageHeader/PageStatus exists yet.
- This is a frontend-only ticket. `DESIGN.md` is binding. The UI gate applies at evaluation/skeptic time — the skeptic must drive the running app via Playwright across the migrated routes, not just read code.

## Resolution of this ticket's internal scope conflict (design gate round 1, human ruling)

This ticket's own text contradicted itself: the leading note above says "do not migrate `TypeRegistryPage`,
`TypeDetailPage`, `MetricsPage`, or `MetricDetailPage` — they are deleted by HEL-909," but the Scope
section below lists TypeRegistry/Metrics/MetricDetail among the routes to migrate. **Ruling: exclude them
per the leading directive** (the remodel-aware text; the Scope list was stale pre-remodel wording). Per
the remodel spec (`docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md:168,40`, verified
directly), these four pages are removed outright by HEL-909 with no deprecation period — migrating them
onto new primitives now would be throwaway work. AC #1 is corrected (not gutted) accordingly — see
`proposal.md`'s "Acceptance Criteria (corrected from ticket)" section and `design.md` Decision 0.
Migrated routes in this change: Sources, Pipelines, PipelineDetail, Chat, Settings, and all four review
routes (ProposalReviewPage, PatchSetReviewPage, PipelineProposalReviewPage, CombinedProposalReviewPage).
