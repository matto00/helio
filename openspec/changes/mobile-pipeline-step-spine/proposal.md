## Why

At 375×812 today's phone pipeline page (the pre-HEL-1579 river view) gives steps 301px of 812: chrome takes 511px
(56 command bar, 145 header, 49 tabs, 193 footer region, 68 under the nav). Only step 1 shows without scrolling, and
38 of 46 visible controls are under 44px. HEL-1570's approved "Pipeline detail — mobile" board replaces it.

## What Changes

- At ≤768px (`useIsPhoneShell()`), `/pipelines/:id` renders a new phone layout built from HEL-1579's spine pieces:
  a compact header (back, mono truncated name, one status line, overflow menu), Steps / Preview / Runs tabs with a
  sliding indicator, a Steps tab of source card → numbered 60px+ step rows on a vertical line → "+ Add step" → output
  card(s), and floating Dry run / Run pipeline pills above the glass nav with measured bottom clearance.
- Tapping a step opens its focused editor (every step kind) in a full-height bottom sheet with a visible close
  control and swipe-down dismiss. The sheet is a new shared primitive (`shared/motion`), timed by motion tokens and
  obeying Full / Subtle / Off, for HEL-1584 and others to reuse.
- Preview tab: the preview table and schema chips of a chosen step (default: the last step). Runs tab: the run
  history list inline (shared with the desktop Run history modal).
- A named, empty slot in the floating action bar for HEL-1631's draft status / Discard / Save & run.
- **Removal:** the river view, the phone header/footer and the Outputs gallery tab become unreachable and are deleted
  with their unit tests; the phone e2e specs that drove them are ported.

## Capabilities

### New Capabilities
- `pipeline-detail-mobile-layout`: the phone pipeline detail page (header, tabs, step list, step sheet, pills,
  clearance, touch floor, HEL-1631 slot).

### Modified Capabilities
- `pipeline-detail-spine-layout`: the ≤768px branch no longer renders the river view.
- `motion-primitives`: adds the swipe-dismissable bottom sheet primitive.

## Impact

Frontend only: `features/pipelines/ui/**` (new `mobile/` folder, `PipelineDetailPage.tsx`, spine reuse, river
deletions), `features/pipelines/ui/RunHistoryModal.tsx` (list extraction), `shared/motion/**` (sheet), CSS guards' file
counts, e2e specs. No API, schema or backend change. No new dependency.

## Non-goals

- The glass BottomNav and phone shell (HEL-1583), and the 56px command bar.
- Draft mode, Discard, Save & run and live counts (HEL-1631) — only their slot.
- Rewriting the ~41 "Layout scope (HEL-1579) … phone river unchanged" paragraphs in other specs one by one
  (one requirement here keeps their non-layout obligations; full rewrite is follow-up candidate FU-1).
- Desktop (>768px) behaviour, and adopting the sheet in `MobileNavSheet` (HEL-565).
