# HEL-548: Empty-state CTAs across sources / types / pipelines / dashboards

## Description

`DESIGN.md` §7 requires an `EmptyState` (never render nothing) for empty data-backed views; `main` variant titles are Fraunces (§6). The primitive is used in several places (`DashboardList`, `SourcesPage`, `PipelinesPage`, `PipelineEmptyState`, `TypeRegistryBrowser`, `PanelCreationModal`) but coverage and quality are uneven, and empty states rarely include a clear next-step CTA that respects the strict source→pipeline→type→panel model. This ticket makes every primary section's empty state consistent and action-oriented.

## Scope

* Audit the primary sections — Dashboards, Data Sources, Data Pipelines, Type Registry, and the dashboard panel area — for empty states and standardize on `EmptyState` (`main` variant, Fraunces title, tokenized body, one primary CTA per §5).
* Each empty state gets a purposeful CTA wired to the real action: Dashboards → New dashboard; Sources → Add source; Pipelines → Create pipeline; Type Registry (no pipeline-bound types) → guidance/CTA toward creating a pipeline (types only exist via pipelines — reflect that, don't offer a dead "create type"); empty dashboard (no panels) → New panel.
* Copy should teach the model briefly (e.g. Registry empty explains types come from pipelines). Icons from lucide (post-iconography standardization); no hardcoded colors/spacing/type.
* Distinguish "empty because nothing created yet" from "empty because a filter/search matched nothing" where a section has filtering, with appropriate copy.

## Acceptance criteria

* Every listed section renders `EmptyState` (main variant, Fraunces title) with a working primary CTA when it has no data; no section renders blank.
* Registry empty state guides toward pipelines rather than offering an invalid create-type path.
* Filter-empty vs no-data-empty are visually/wording-distinct where filtering exists.
* Empty states use tokens + §5 CTA; correct in light/dark; CTAs keyboard-accessible with names (§8). Tests assert the empty state + CTA render/behave; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* First-run guided onboarding tour (HEL-554) — but see the CTA-seam requirement below.
* Error and loading states (their own tickets: HEL-539, HEL-528) — except the one `PanelList` error surface absorbed from HEL-770 below.

## Absorbed scope — HEL-770 (folded into this change)

HEL-770 ("PanelList error EmptyState parity + remove the createDashboard toast/inline collision") is
absorbed into this change. Its own text states "HEL-548 owns this surface", and it edits the *same
conditional branch* of the same component that this ticket restructures (`PanelList`'s dashboards-empty
branch, which renders both the first-run "No dashboards yet" hero and, on failure, a create error).
Delivering them separately would mean two runs editing one branch.

Added acceptance criteria from HEL-770:

* A failed dashboard create from the `PanelList` empty state renders an error-intent, `role="alert"`
  `EmptyState` with an error **title** and error **icon** (parity with the five `intent="error"`
  surfaces HEL-539 shipped), carrying the **specific rejection message** rather than a hardcoded
  `"Failed to create dashboard."`.
* The ordinary "No dashboards yet" empty state (no failure present) still renders neutral, with no
  alert role — the intent is applied **conditionally** within that one branch.
* `createDashboard.rejected` emits no toast; the failure is reported exactly once on both dispatch
  paths (`DashboardList`'s `InlineError` and `PanelList`'s error `EmptyState`).

## Inherited gap — HEL-528 D11 (owned by this ticket)

HEL-528's `design.md` D11 records, verbatim, a §7 violation it deliberately left open for HEL-548:

> at `idle` with a dashboard selected and no items, **`PanelList` renders nothing at all** … The
> missing `EmptyState` on that terminal branch is a genuine §7 empty-state gap that predates this
> change and belongs to **HEL-548**

The reachable path: deleting a dashboard's last panel runs `markDashboardPanelsStale`, which returns
`panelsSlice.status` to `"idle"` and clears `loadedDashboardId`; `deletePanel.fulfilled` empties
`items`; nothing re-dispatches. The panel area then renders nothing at all, permanently.

Added acceptance criterion:

* After deleting a dashboard's last panel, the panel area renders the "no panels" `EmptyState` with a
  working **New panel** CTA — not a blank area. The fix must **not** re-create the flash HEL-528's
  D11/2.4b refused: it must not widen the skeleton gate to `idle`, and must not paint an empty state
  for a frame before the skeleton on a cold boot.

## Added requirement — a consumable CTA seam for HEL-554

HEL-554 (guided first-run onboarding) is the last leaf of this epic and will reuse these CTA flows.
The create-actions behind each CTA must **not** be buried inline in each component. Expose them in a
form HEL-554 can consume (a shared hook, an action registry, or whatever the design gate finds
cleanest) and record the decision in `design.md` so HEL-554 consumes it rather than re-deriving it.

## Dependencies / fences

Relates to HEL-421 (dashboard templates) — the empty-dashboard CTA should coexist with any
template-picker entry point. Sequenced after HEL-346 iconography standardization; `lucide-react` is
the single icon library.

**File-ownership fences (three runs live in parallel this session):**

* HEL-772 owns `.app-shell` / `.app-command-bar` in `App.css`, `index.html` meta tags, and a new
  `--app-safe-top` token in `theme.css`. **Do not edit.**
* HEL-774 owns `BottomNav.css` / `BottomNav.tsx`, **`DESIGN.md`**, and the content-clearance rule at
  `App.css:424`. **Do not edit — `DESIGN.md` is read-only for this change.**
* This change's territory: the feature-level empty-state render branches and
  `frontend/src/shared/ui/EmptyState.tsx`.
