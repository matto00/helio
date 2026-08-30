## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

All checks run fresh against source in this worktree; no artifact narrative taken on faith.

1. **Header inventory (the round-3 REFUTE) — now correct.**
   `grep -rn "page-title|<h1|<h2|__header" --include=*.tsx frontend/src` over the nine in-scope routes returns
   only: `SourcesPage.tsx:83-84` (`<header className="sources-page__header">` + `<h1 className="page-title">`),
   `PipelinesPage.tsx:41-42` (same shape), `SettingsPage.tsx:45` (`<h1 className="settings-page__title">`).
   `ChatPage.tsx` and `PipelineDetailPage.tsx` return **no** heading/header match; the four review routes
   return none either. This exactly matches design.md Context's 3 / 2 / 4 split and Decision 4.

2. **Chat/PipelineDetail stay header-less — consistent everywhere.** design.md Non-Goals (l.62-65) and
   Decision 4 (l.123-138), tasks.md 3.1/3.2, spec.md's requirement + the "ChatPage and PipelineDetailPage
   render no PageHeader" scenario, and proposal.md's AC section all agree. No residual `backTo`/`PageHeader`
   instruction survives for either route (grepped tasks.md).

3. **Duplicated-CSS inventory.** `grep -rln "page__loading|page__error" --include=*.css` → exactly
   `SettingsPage.css`, `ChatPage.css`, `MetricsPage.css`, `MetricDetailPage.css` — the 4 claimed, of which 2
   are in scope. Verified the broader `__loading|__error` sweep too: no review-route stylesheet defines a
   loading/error rule (`proposal-review__loading` et al. have **no** CSS rules at all), so spec.md's
   "no listed route's own .css retains a loading/error rule" is satisfiable as written.

4. **SettingsPage F-047 gating.** `SettingsPage.tsx:39-41` defines exactly three independent gates
   (`preferencesLoading`, `agentMemoryLoading`, `apiTokensLoading`), each with its own
   `.settings-page__loading` / `.settings-page__error` branch (l.75-131). Decision 3a's "three independent
   `PageStatus` instances" matches ground truth; `SettingsPage.css:17-25` holds the rules to delete.

5. **Referenced components exist.** `PipelineDetailSkeleton` (`features/pipelines/ui/PipelineDetailSkeleton.tsx:11`,
   imported at `PipelineDetailPage.tsx:11`) and `PageContentSkeleton` (used by `SourcesPage.tsx:88`,
   `PipelinesPage.tsx:46`) are real, so tasks 2.1/2.2/3.1's `variant="skeleton"` plan is grounded.

6. **Cross-round consistency pass (ticket/proposal/design/tasks/spec).** Decision 0 (Metrics/Types exclusion,
   round-1 human ruling) is stated identically in ticket.md's resolution note, proposal.md, design.md,
   tasks.md §2 note + 5.4, and spec.md's requirement. AC corrections are traceable in both directions.
   Every spec scenario maps to a task (1.5 covers the primitive scenarios; 3.3/4.x/5.1 cover the route ones).
   No `TODO`/`TBD`/unspecified-type placeholders found. No contradiction remaining between the ticket's
   stale Scope list and the remodel-aware directive.

### Verdict: CONFIRM

The round-3 factual defect is fixed at the source-of-truth level, not just in prose, and the fix propagated
consistently to all four artifacts. The design is implementable as written.

### Non-blocking notes

- The four review routes' loading branches today render an **empty, unstyled** div
  (`proposal-review__loading` etc. have no CSS rule; the surrounding comments call them unreachable
  type-narrowing guards). Routing them through `PageStatus` will make a spinner appear where nothing renders
  today — an improvement, but the executor should not be surprised, and the skeptic's final UI pass should
  not treat it as a regression.
- `SettingsPage`'s title moves from `.settings-page__title` to the shared `.page-title` (Fraunces). tasks.md
  3.3 already flags this as expected; the executor should also delete the now-dead `.settings-page__title`
  rule under task 5.1's sweep.
- proposal.md's Non-goals list has a bullet for the review routes but not for Chat/PipelineDetail (that
  exclusion lives in design.md's Non-Goals and proposal.md's AC section). Cosmetic only.
