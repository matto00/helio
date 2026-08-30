## 1. Build the primitives

- [x] 1.1 `frontend/src/shared/ui/PageShell.tsx` + `PageShell.css` — container with DESIGN.md §6
      section-overview padding/gap tokens, `children`, optional `className`.
- [x] 1.2 `frontend/src/shared/ui/PageHeader.tsx` + `PageHeader.css` — `title` (required, `.page-title`
      `<h1>`), optional `eyebrow` (`.eyebrow`), optional `actions` slot, optional `backTo`/`onBack`.
- [x] 1.3 `frontend/src/shared/ui/PageStatus.tsx` + `PageStatus.css` — `status: "loading" | "failed"`,
      `message`/`onRetry` for `"failed"`, `variant?: "spinner" | "skeleton"` (default `"spinner"`),
      composes `Spinner`/`EmptyState intent="error"` per design.md decision 3.
- [x] 1.4 Export all three from `frontend/src/shared/ui/index.ts`.
- [x] 1.5 Unit tests for each (`PageShell.test.tsx`, `PageHeader.test.tsx`, `PageStatus.test.tsx`) covering
      every scenario in `specs/page-shell-primitives/spec.md`.

## 2. Migrate routes already close to the target shape

- [x] 2.1 `SourcesPage.tsx` — swap header markup for `PageHeader`, container for `PageShell`, loading/error
      branch for `PageStatus` (`variant="skeleton"`, existing `PageContentSkeleton` as children); preserve
      retry-disabled/"Retrying…" semantics. `SourcesPage.css` has no loading/error rules to delete
      (verified) — this task is header/container-only.
- [x] 2.2 `PipelinesPage.tsx` — same treatment as 2.1 (`PipelinesPage.css` also has no loading/error rules).

**Out of scope (per human ruling, design.md Decision 0):** `TypeRegistryPage.tsx`, `MetricsPage.tsx`, and
`MetricDetailPage.tsx` (section 3) are **not** migrated in this ticket — they are dead code the moment
HEL-909 lands. See task 5.4 for the tracked handoff obligation.

## 3. Migrate detail/single-purpose routes

- [x] 3.1 `PipelineDetailPage.tsx` — `PageShell` and `PageStatus` (`variant="skeleton"` with existing
      `PipelineDetailSkeleton`) only. **No `PageHeader`** — this route has no title today (only the
      bespoke `PipelineDetailHeader` chip row), and adding one would be new UI with an unspecified
      title string and an unspecified stacking/merge relationship with `PipelineDetailHeader` (design.md
      Decision 4 / Non-Goals) — out of scope for this ticket.
- [x] 3.2 `ChatPage.tsx` — wrap in `PageShell`; replace the raw `<p>` loading/error markup with
      `PageStatus` (`variant="spinner"`); delete `.chat-page__loading`/`.chat-page__error` from
      `ChatPage.css` (1 of the 2 in-scope duplicated-CSS files). **No `PageHeader`** — this route has no
      title today (design.md Decision 4 / Non-Goals) — out of scope for this ticket.
- [x] 3.3 `SettingsPage.tsx` — adopt `PageShell`/`PageHeader` for the page chrome (note for the UI gate:
      this changes the title from `.settings-page__title` to the shared `.page-title` style — expected,
      not a regression). Use **three independent `PageStatus` instances**, one per section (preferences,
      agent memory, API tokens) — do NOT collapse them into one page-wide instance (design.md Decision 3a
      — preserves F-047). Delete `.settings-page__loading`/`.settings-page__error` (the 2nd of the 2
      in-scope duplicated-CSS files) once all three sections migrate.

## 4. Migrate review routes

- [x] 4.1 `PatchSetReviewPage.tsx` — wrap in `PageShell`; route its loading/error `EmptyState` branches
      through `PageStatus`; no `PageHeader` (matches today's header-less shape, per design.md decision 4).
- [x] 4.2 `ProposalReviewPage.tsx` — same treatment as 4.1, preserving the retry/demo-fixture logic
      untouched.
- [x] 4.3 `PipelineProposalReviewPage.tsx` (`features/pipelines/ui/proposalReview/`) — same treatment as
      4.1.
- [x] 4.4 `CombinedProposalReviewPage.tsx` (`features/proposals/ui/`) — same treatment as 4.1.

## 5. Verify and clean up

- [x] 5.1 Grep every migrated route's `.css` for leftover loading/error selectors; delete any that remain
      dead. Confirm both in-scope duplicated-recipe files (`ChatPage.css`, `SettingsPage.css`) have their
      loading/error rules removed.
- [x] 5.2 Run `npm run lint`, `npm run typecheck`, `npm test` in `frontend/`.
- [ ] 5.3 Manually drive each of the 9 migrated routes' loaded/loading/error states via the running dev
      app (Playwright, at evaluation/skeptic time) to confirm visual consistency per the corrected
      acceptance criteria in `proposal.md`.
- [x] 5.4 **HEL-909 handoff obligation — do not silently drop.** Note explicitly in the PR body that
      `MetricsPage.css`/`MetricDetailPage.css`'s loading/error rules are NOT deleted by this change (the
      pages themselves are excluded per Decision 0) and must be deleted by HEL-909 as part of removing
      `TypeRegistryPage`/`TypeDetailPage`/`MetricsPage`/`MetricDetailPage` outright, per the remodel spec's
      "no deprecation, deleted wholesale" rule.
