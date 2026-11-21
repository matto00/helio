## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed against the live tree at HEAD 4f101209bd50fed23f5534a8f4be3cc310051d63 (change dir untracked, no code yet).

### What I verified (with evidence)

- **Phone/tablet header refresh is gone (HEL-1582): TRUE.** `find frontend/src -name 'PipelineDetailHeader*'` returns nothing.
  `SourceSampleLabelView` is rendered only by `features/pipelines/ui/spine/SpineSourceCard.tsx:91`. The surviving
  pre-fix-hover rule pair is at `features/pipelines/ui/spine/PipelineSpine.css:442` and `:448`, both inside
  `@media (hover: hover)`.
- **A fine-pointer 768/390 context renders the phone shell and mobile pipeline: TRUE.** `PHONE_SHELL_QUERY =
  "(max-width: 768px)"` (`app/shell/useIsPhoneShell.ts`) is width-only. `PipelineDetailPage.tsx:86` picks
  `PipelineMobileLayout` on it. `PipelineMobileLayout.tsx:56` defaults the tab to `"steps"`, and `:202` renders
  `<PipelineSpine variant="phone">`, so the spine source card is in the default phone DOM.
- **The spine refresh button renders for the guard's seeded static source: CONDITIONALLY.** `SourceSampleLabel.tsx`
  renders the `IconButton` only when `canRefresh` (`access === "yes" && !waitingForSources`), and it is
  `disabled={loading}`. `stampDocument`/`collectCandidates` skip disabled elements. So the button exists for the
  owner once the sample has loaded. Before that it is missing or disabled. No readiness gate in the plan waits for
  it (see CR3).
- **Touch contexts cannot express an invisible hover after HEL-1735: TRUE for gated rules.** Feature and shared
  hover rules sit in `@media (hover: hover)`, for example `IconButton.css:63`, `AppRail.css`, `ContextList.css` and
  `MobileNavSheet.css`. D1's fine-pointer choice is sound.
- **Shard weights must not be hand-edited: TRUE.** `e2e/README.md:141` says "never a local run, never by hand", and
  `:136` says a new file gets the median and is printed as `defaulted`. I computed the median of the current table:
  62 s over n=147 rows. The existing guard parts weigh 117 s (dense, 8 cells) and 73 s (light, 8 cells), which is
  roughly 9-15 s per cell. At that rate 18 narrow cells come to about 200 s serial, against the 62 s the default
  would assign. D4's rule (split if one file is heavier than the heaviest existing part) and D5's statement in the
  PR are adequate.
- **1100 px layout gates (my own check).** `grep -rln "max-width: 1100px" --include=*.css frontend/src` returns only
  `landing/landing.css`, `features/home/ui/HomePage.css`, `features/adminUsage/ui/AdminUsagePage.css` and
  `features/connectors/ui/ConnectorsPage.css`. The only JS width gate besides the phone shell is
  `ConnectorsPage.tsx:43` (`TEST_CONNECTION_MENU_BREAKPOINT_PX = 1100`). Nothing in `features/pipelines`,
  `features/dashboards`, `features/panels` or `app/` changes at 1100.
- **Phone-only chrome hover (my own check).** `shared/chrome/BottomNav.css` has **no `:hover` rule of any kind**:
  its selectors are `.bottom-nav`, `__tab`, `__icon`, `__lozenge`, `__label`, `__tab--active` and
  `__tab:focus-visible`. No other stylesheet targets `.bottom-nav__tab`. `BottomNav` is rendered by
  `app/MobileShell.tsx:38`, outside `<main>`. `classifyState` (`e2e/support/stateContrast.mjs:214-218`) returns
  `fail` when nothing changes on hover ("D4a absence").
- **Narrow readiness (my own check).** At ≤768 `App.tsx:185` sets `showRail = !isPhoneShell`, so `.context-list` is
  not rendered. In the phone layout `open` starts as null, so `selectedStepId` is null and there is no
  `.step-focused`. The 1440 cell hard-asserts on these: `state-surface-contrast-guard.ts:836-838` for the selected
  row and focused editor, and `:798-813` for the `/dashboards` readiness `seeded(sidebar, DASH_NAME)` against
  `.context-list`.

### Verdict: REFUTE

The approach is sound: fine pointer, a new part file, parametrised cells, the partition check kept, and no edits to
the shard weights. Three planned specifics conflict with the live tree, though. They will either fail on main or
spend CI budget measuring nothing new.

### Change Requests

1. **The 1100 population measures layouts that do not change at 1100, and leaves out the one that does (design.md
   D2, Risks; proposal "What Changes"; tasks 1.3).** `pipeline-detail` and `/dashboards` have no 1100-gated CSS or
   JS (see the grep above), so those 4 cells repeat the 1440 cells at about 50 s of serial CI time. The Risks
   mitigation is also backwards: "drop `/home` at 1100 first (layout closest to 1440)" removes the only route in
   the population that does change at 1100 (`HomePage.css:885`). `/connectors` changes at 1100 in both CSS
   (`ConnectorsPage.css:304`) and JS (`ConnectorsPage.tsx:43`) and is not covered. Revise D2 so the 1100 cells are
   the routes that are actually 1100-gated: `/home`, and `/connectors` with whatever seeding makes its 1100-only
   control render (say whether a connector row is needed). Alternatively, give a measured reason for keeping each
   1100 cell. Fix the Risks fallback order, and update the cell count in tasks 1.3 and the spec.
2. **The unmutated narrow cells will fail on the bottom nav, and M2's target may have no hover to flatten
   (design.md D1, D2, D6 M2; proposal "No app code"; spec scenarios "phone-only control" and "unmutated passes").**
   D2 probes phone chrome as its own view, and D1 says hover must be visible on hover-capable narrow devices. But
   `.bottom-nav__tab` has no hover rule, so every bottom-nav tab will report `fail ratio=n/a (D4a absence)` at 768
   and 390 on all three routes. That is a predictable finding, not a hypothetical one, and it is not a "one-token
   fix". Decide it in the design now. Option (a): add a `@media (hover: hover)` hover state to `.bottom-nav__tab`
   in scope, check it against the glass carve-out in DESIGN.md, and correct the proposal's "No app code".
   Option (b): add a reviewed `isExempt` entry keyed on `[bottom-nav__tab]` with a written reason and a named
   follow-up ticket. Then name M2's exact target. It must be a phone-only control that already has a hover rule
   (check the phone `CommandBar` controls and `MobileNavSheet` trigger), and under option (b) it must not be the
   exempted class, or the mutation cannot go red.
3. **Narrow readiness is under-specified in a way that can let M1 pass vacuously (design.md D3/D4; tasks 1.4/1.5).**
   D4 says "readiness gates per route are reused". At ≤768 the reused gates fail outright:
   - `.context-list` is absent, so `/dashboards`' `seeded(sidebar, …)` and the `sidebar-rail` view break.
   - There is no default `.spine-row--selected` or `.step-focused` in the phone pipeline.

   More importantly, the M1 target is absent until the source access resolves and disabled while the sample loads,
   and `stampDocument` skips disabled elements. A stamp taken too early leaves the button unstamped. The partition
   check still passes and M1 stays green, which looks like a guard defect rather than a timing issue. Specify the
   narrow readiness per route and width:
   - drop or replace the `.context-list` gate and view at ≤768;
   - replace the selected-row/focused-editor assertions on the phone layout, for example with a phone-layout
     marker such as `.pipeline-detail-page--mobile`;
   - for pipeline-detail at every width, wait for `getByRole("button", { name: "Refresh sample of HEL-866 Guard
     Source" })` to be visible **and enabled** before stamping.

   This makes D3's "show the button was probed" deterministic instead of a matter of luck.

### Non-blocking notes

- The spec requirement lists "tablet rail" as narrow-only chrome. Above 768 the rail is the ordinary desktop rail,
  so there is no distinct tablet rail at 1100. Consider rewording.
- The phone-only `DataSectionLinks` (`shared/chrome/DataSectionTabs.tsx:12`) on `/sources` and `/connectors` is
  phone-only chrome the population does not reach. Name it as out of scope or add it.
- M1 at 1440: the same rule pair applies at 1440, so M1 may also go red in the existing 1440 cell, depending on
  whether the 24-element sample reaches the button. Record the 1440 result too. It tells the reader whether
  HEL-1628's miss was really a viewport gap or a sampling gap.
- I did not run the app. These findings rest on CSS and TSX with cited line numbers, not on a run.
