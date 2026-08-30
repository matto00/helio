## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, `specs/page-shell-primitives/spec.md` in full.
- Route inventory: `frontend/src/app/AppRoutes.tsx:91-125` — all target pages exist; **`TypeDetailPage` exists and is routed** (`AppRoutes.tsx:98`, `<Route path="/registry/:id" element={<TypeDetailPage />} />`, file `frontend/src/features/dataTypes/ui/TypeDetailPage.tsx`).
- Review-route inventory: four review routes are registered — `/proposals/review` (`ProposalReviewPage`), `/patch-sets/review` (`PatchSetReviewPage`), `/pipeline-proposals/review` (`features/pipelines/ui/proposalReview/PipelineProposalReviewPage.tsx`), `/combined-proposals/review` (`features/proposals/ui/CombinedProposalReviewPage.tsx`) — all four files confirmed present.
- CSS recipe inventory (`grep -rn "page__loading\|page__error" --include=*.css frontend/src`) returns rules in exactly **four** files: `ChatPage.css:9-16`, `MetricsPage.css:20-27`, `MetricDetailPage.css:17-23`, `SettingsPage.css:17-24`. `SourcesPage.css`, `PipelinesPage.css`, `TypeRegistryPage.css` contain **no** loading/error rules (they use `PageContentSkeleton` + `EmptyState` already — `SourcesPage.tsx:13-14,88-107`).
- `SettingsPage.tsx:4,39-131` — F-047 per-section gating confirmed; the `.settings-page__loading`/`__error` rules are **per-section**, and its title is `<h1 className="settings-page__title">` (`SettingsPage.tsx:45`), not `.page-title`.
- Primitives referenced by tasks exist: `Spinner.tsx`, `PageContentSkeleton.tsx`, `PipelineDetailSkeleton.tsx:11`, `EmptyState` `intent="error"` + `cta.disabled` (`EmptyState.tsx:11-46`), `shared/ui/index.ts` export barrel.
- `DESIGN.md:402-416` — `.page-title`/`.eyebrow` utilities and the §6 "Section overview pages" geometry (`padding: var(--space-5) var(--space-6)`) cited by the spec are real and correctly quoted.

### Verdict: REFUTE

### Change Requests

1. **The "7 duplicated loading/error recipes" premise is false and makes AC #1 unverifiable.** Ground truth is **4** (`ChatPage.css`, `MetricsPage.css`, `MetricDetailPage.css`, `SettingsPage.css`); Sources/Pipelines/TypeRegistry have none. `proposal.md` ("7 near-identical recipes"), `design.md` ("deleting the 7 duplicated CSS recipes named in the ticket") and `tasks.md:5.1` ("Confirm the '7 duplicated recipes' … are all gone") all inherit the number without checking. Replace with the verified per-file inventory above and restate AC #1 against it, so task 5.1 has an achievable exit condition.

2. **`design.md` and `proposal.md` both assert `TypeDetailPage` "doesn't exist" — it does** (`AppRoutes.tsx:98`). Correct both Non-Goals sections: it is excluded because the ticket's own directive excludes it, not because it is absent. A false premise here is how a route silently gets migrated or missed later.

3. **Spec/design contradiction on `SettingsPage`.** `spec.md` requires "No listed route's own `.css` SHALL retain a loading or error style rule once migrated," but `design.md`'s Non-Goal and `tasks.md:3.4` deliberately preserve F-047 per-section gating, which keeps `.settings-page__loading`/`__error` (`SettingsPage.css:17-24`). As written, `SettingsPage` cannot satisfy the spec. Decide and write it down: either (a) scope the spec rule to *page-level* loading/error rules only and exempt per-section ones, or (b) have the sections render through `PageStatus` per-section. Do not leave the executor to pick.

4. **Spec/design contradiction on the review routes' header.** `spec.md`'s fourth requirement says all listed routes "SHALL render their top-level container and header through `PageShell`/`PageHeader`", while `design.md` decision 4 and `tasks.md:4.1/4.2` say `PatchSetReviewPage`/`ProposalReviewPage` render **no** `PageHeader`. Amend the spec requirement to make `PageHeader` conditional for header-less routes.

5. **Off-by-one in the spec.** The requirement is titled "The nine listed routes …" and then enumerates **ten**. Fix the count (and the same "9 routes" figure repeated in `design.md` Risks and `tasks.md:5.3`).

6. **"The review routes" resolution is under-justified.** Four review routes exist; the setup note silently narrowed it to two, excluding `PipelineProposalReviewPage` and `CombinedProposalReviewPage` with no stated reason. Either include them or record an explicit, verifiable reason for excluding them in `proposal.md` Non-goals — otherwise the AC "visually consistent across all listed routes" leaves two sibling review screens visibly off-pattern.

7. **Unresolved scope conflict inside the ticket itself — needs an explicit recorded decision.** `ticket.md`'s leading directive says "**do not migrate** `TypeRegistryPage`, `TypeDetailPage`, `MetricsPage`, or `MetricDetailPage` — they are deleted by HEL-909," while its own Scope list includes TypeRegistry/Metrics/MetricDetail. `proposal.md` resolves this by migrating them and claims it is "this ticket's own scope" without ever acknowledging the directive it overrides. This is not a free call: per finding 1, three of the four real CSS recipes live in `MetricsPage.css`/`MetricDetailPage.css`/`SettingsPage.css`, so excluding the metrics pages materially guts AC #1. Escalate to the orchestrator for a ruling and record it in `design.md` Decisions with the reasoning — do not proceed on the implementer's unilateral reading.

### Non-blocking notes

- `SettingsPage` currently titles with `.settings-page__title`, not `.page-title` (`SettingsPage.tsx:45`); adopting `PageHeader` will change its typography. That is presumably the point of the ticket, but it is a real visual change worth naming in `tasks.md:3.4` so it isn't reported as a regression at the UI gate.
- `MetricsPage` has no test file (unlike every other migrated route). Task 2.4 should say whether one is added or the migration there is covered only by the UI gate.
- `design.md` decision 3 is sound and worth keeping: `PageStatus` supplying the slot rather than a one-size skeleton correctly avoids colliding with `shared-skeleton`'s per-row geometry requirement.
