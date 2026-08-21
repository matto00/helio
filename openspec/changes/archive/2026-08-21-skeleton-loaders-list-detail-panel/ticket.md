# HEL-528: Skeleton loaders across list / detail / panel surfaces

## Description

`DESIGN.md` §7 requires every data-backed view to handle loading with "the established spinner pattern (border-spinner in accent) or a skeleton — never a flash of empty content." Loading today is inconsistent: some views (`TypeRegistryPage`, `PipelineDetailPage`, `PanelContent`, `PanelList`) show spinners, others momentarily render nothing, and there is no shared skeleton primitive. This ticket adds a shared skeleton and applies it to the main list/detail/panel surfaces.

## Scope

* Add a shared `Skeleton` primitive to `frontend/src/shared/ui/` (block/line/circle variants) with a subtle shimmer using `--app-surface-soft`/`--app-surface-raised` and `--app-transition`/`--transition-slow`; respects `prefers-reduced-motion` (static, no shimmer). Export via `shared/ui/index.ts`.
* Apply skeletons on initial load for: the dashboard `PanelGrid`/`PanelList` (panel-card-shaped placeholders), sidebar resource lists (`SidebarItemList` consumers), `PipelineDetailPage`, `SourceDetailPanel`, and `PanelContent` while data fetches. Match the eventual content's shape/size so there is no layout shift on resolve.
* Keep the existing accent border-spinner for short in-place refreshes (e.g. panel data refetch); use skeletons for initial structural loads. Document the choice (skeleton = first load, spinner = refresh) in a short comment.
* Never render nothing during load; never flash empty content before the skeleton.

## Acceptance criteria

* Each listed surface shows a shape-matched skeleton on initial load with no layout shift when real content arrives.
* Skeleton uses tokens only (surfaces/motion); shimmer disabled under `prefers-reduced-motion`; correct in light/dark.
* Refresh-in-place paths still use the accent spinner (no regression to panel polling UX).
* `Skeleton` has a unit/render test; touched views have loading-state tests; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Error and empty states (error-state and empty-state CTA tickets).
* Backend/API changes.

## Dependencies

None. Complements the error-state and empty-state tickets (together they complete §7 coverage).

## Run-specific emphasis (relayed verbatim from the requester)

HEL-528 is a pure frontend/design ticket — a user-visible surface, not plumbing. Passing tests are necessary but nowhere near sufficient.

1. **`DESIGN.md` is binding, not advisory.** §7 (loading/empty/error state requirements) is the ticket's whole basis; §3 (motion) governs the shimmer; §8 (accessibility) governs `prefers-reduced-motion`. Cite the section when judging a deviation. `CONTRIBUTING.md` remains binding for code quality.
2. **Design-token discipline.** Zero hardcoded colors, spacing, or type sizes — surfaces from `--app-surface-soft`/`--app-surface-raised`, motion from `--app-transition`/`--transition-slow`. This repo carries open token-drift cleanup tickets (HEL-652, HEL-680, HEL-677) precisely because past work leaked literals. Do not add to it.
3. **Extend, don't compete.** Add one shared `Skeleton` primitive in `frontend/src/shared/ui/`, exported via `shared/ui/index.ts`. Per-view bespoke skeleton markup that bypasses the primitive is a REJECT.
4. **The no-layout-shift requirement is the hard part and the real acceptance test.** A skeleton that doesn't match the eventual content's shape and size has failed even if it looks fine in isolation. Verify by measuring — capture geometry before and after resolve and compare, the way HEL-539's skeptic did with `getBoundingClientRect()`. Do not eyeball this.
5. **Visual verification is mandatory at the evaluation and skeptic gates.** Drive the real app and watch actual loading transitions on every surface the ticket lists: `PanelGrid`/`PanelList`, `SidebarItemList` consumers, `PipelineDetailPage`, `SourceDetailPanel`, `PanelContent`. Both themes. 1440/768/430. Confirm the shimmer is genuinely disabled under `prefers-reduced-motion` rather than merely slowed.
6. **Never render nothing, never flash empty content before the skeleton.** Both are findings.
7. **Consistency across surfaces is the point.** If two views end up with visibly different loading treatments, the ticket failed its own premise even if each looks fine alone. Compare side by side.

Skeptic: you own subjective design judgement on this run. If it is technically correct but looks unpolished, janky, or cheap next to the rest of the app, say so plainly and fail the gate — the requester explicitly wants that bar applied.

## Inherited context from HEL-539 (merged as PR #406, squash commit `3d93e82a`)

HEL-539 is the sibling ticket immediately preceding this one in epic HEL-349. Its archived artifacts are at `openspec/changes/archive/2026-08-20-error-state-components/`. Read `skeptic-final-2.md` — it hands this ticket two things directly:

1. **A concrete first defect, already traced and deferred here.** A frame-by-frame trace of a failing retry on `/sources` shows the 331px error hero collapse to a 15px `<p>Loading sources…</p>` line and back. That reviewer explicitly declined to pull the fix forward, identifying it as HEL-528's scope. It is a real, reproduced instance of the flash-of-inadequate-loading-state this ticket exists to remove.
2. **A related dead-code finding.** `SourcesPage.tsx`, `PipelinesPage.tsx`, and `TypeRegistryPage.tsx` compute `isRetrying = status === "loading"` while gating their error branch on `status === "failed"` — mutually exclusive, so the in-flight "Retrying…" affordance never renders on those views. Relevant because this ticket's loading-state work touches the same `status` ladder. Understand it before changing that ladder; fixing it is not automatically in scope, but silently breaking it further would be a regression.

Also inherited: HEL-539 established the canonical error-state pattern on `StatusMessage`/`InlineError`/`EmptyState`. Skeletons must coexist with it cleanly — loading, empty, and error are three branches of one ladder, and this ticket owns exactly one of them.

## Scope fence

Keep to HEL-528's stated scope. Empty-state CTAs (HEL-548) and toast policy (HEL-535) are the next tickets in this epic — do not pull them forward. Error states belong to the just-merged HEL-539; leave those branches alone except where a skeleton must sit alongside them. Honor the ticket's explicit division: **skeleton = initial structural load, accent border-spinner = short in-place refresh** (e.g. panel data refetch). Do not regress panel-polling UX by replacing refresh spinners with skeletons.

## Known environment note

`check-openspec-hygiene.mjs` will false-positive "complete but not archived" on implementation commits, because archiving is a Phase 3 step and `tasks.md` hits 100% before then. This is tracked as HEL-657. Expect to need `git commit -n`; disclose the bypass and its reason in the commit body and PR body per `CONTRIBUTING.md`, and confirm lint/format/schemas passed in the same hook invocation before bypassing. Do not bypass for any other failing check.
