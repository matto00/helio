## Context

The mobile PWA shell (HEL-300/301/302) and the v1.5 panel surfaces (HEL-245/255/248/247) are live;
HEL-304 (PR #234) made panel-content edits persist width-independently via `usePanelUpdatesFlush`.
`notes/mobile-pwa-handoff.md` is the binding spec for the shell. Known debt: MobileNavSheet rows sit
at `min-height: var(--control-lg)` (`MobileNavSheet.css:100`), under the 44px HIG minimum;
`mobilePanelHeights.ts` constants are documented "starting values, expected to change after device
testing"; the new `collection` kind has an intrinsic-height entry that has never been verified with
real multi-row data at phone width. This is a style-only pass — no behavior/backend changes.

## Goals / Non-Goals

**Goals:**

- Every MobileNavSheet row ≥44px at phone width, via the established mechanism.
- Honest edit affordances at <768px: reachable edit paths work end-to-end at ≥44px; desktop-only
  layout actions unreachable/unimplied.
- Per-kind height audit at 390×844 (light + dark), all panel kinds incl. collection and all four
  chart types; tune `mobilePanelHeights.ts` constants only where the audit shows a real problem.
- Token compliance in BottomNav/MobileNavSheet/PanelDetailModal; canonical breakpoints only.
- Keep the HEL-301/304 layout byte-identity guard green.

**Non-Goals:** behavior/backend changes; mobile editors for creation/pipelines/sources; new tokens,
breakpoints, or overlay mechanisms; fixing non-trivial bugs found by the audit (spinoff tickets);
the HEL-306 layout edge.

## Decisions

1. **44px mechanism — extend, don't reinvent.** Add `min-height: 44px` for
   `.mobile-nav-sheet__item` inside a `@media (max-width: 768px)` block, exactly mirroring the
   HEL-245/255/248 pattern in `PanelDetailModal.css:616+` (literal `44px`, not a `--control` token —
   that is the codebase convention, documented there and in `BottomNav.css`). Since MobileNavSheet
   only renders at phone width anyway, the media gate is arguably redundant — keep it regardless for
   consistency with the established pattern and so the rule reads as touch-target intent.
   Alternative rejected: raising `--control-lg` (would resize desktop controls globally).

2. **CSS-lock tests.** Add a `MobileNavSheet.css.test.ts` static lock in the style of
   `MobilePanelStack.css.test.ts` / `PanelDetailModal.css.test.ts` asserting the ≥44px rule exists
   for sheet rows. Extend, not reinvent: same read-file + `findRuleBody` scan approach.

3. **Edit-affordance audit is verify-then-fix, not redesign.** HEL-304 already makes content edits
   persist at any width; PanelDetailModal's editor controls already carry the 44px block. The audit
   walks every edit path reachable at 390px (open modal → edit content/config → save) and checks
   (a) it completes end-to-end, (b) targets ≥44px, (c) nothing implies layout drag/resize. Expected
   outcome: mostly confirmation; fixes are CSS-only (sizing/spacing/visibility). Anything requiring
   behavior change is a spinoff candidate reported to the orchestrator.

4. **Height tuning is evidence-gated.** Constants in `mobilePanelHeights.ts` change only with a
   390×844 screenshot showing the problem (whitespace, clipping, squash). Collection must be
   verified with real multi-row data (create via seeded pipeline data). If a tuned value leaves the
   band stated in `openspec/specs/mobile-panel-sizing/spec.md` (metric ~104–132px, chart
   clamp(200, w×0.62, 340)), the executor adds a `specs/mobile-panel-sizing/spec.md` delta to this
   change updating the stated band; within-band tuning needs no delta (the spec frames values as
   starting points). Update `mobilePanelHeights.test.ts` expectations alongside any constant change.

5. **Token sweep scope.** Grep the three shell files (+ MobilePanelStack.css) for raw hex/rgb
   colors, non-token px spacing, and non-canonical breakpoint values. Known sanctioned literals
   stay: `44px` tap minimum, hairline `1px`/`2px` outlines, structural px inside `calc()` with
   tokens, and the grabber's `36px/4px` (audit: replace with tokens only if a token fits exactly —
   do not invent tokens).

6. **Regression guard.** No changes to `MobilePanelStack.tsx` mount/save paths. The existing
   byte-identity tests (mobile-viewer-stack spec) must stay green; the evaluator re-verifies no
   `PATCH /api/dashboards/:id` fires while browsing at 390×844.

## Risks / Trade-offs

- [Sheet rows grow → fewer rows visible in the 70dvh sheet] → rows scroll (`__list` already has
  `overflow-y: auto`); acceptable.
- ["Looks right" is subjective] → evaluator + skeptic verify at 390×844 in both themes with
  `getBoundingClientRect` measurements, not eyeballing; height changes require screenshot evidence.
- [Audit finds a behavioral bug] → out of scope; report as spinoff candidate, never fix inline.
- [Tuning drifts outside spec bands silently] → Decision 4's delta rule makes the spec follow the
  tuned truth.

## Planner Notes (self-approved)

- No ESCALATION triggers: no new dependencies, no architecture or API changes, scope matches ticket.
- Branch type `task/` (polish/audit of existing behavior, no net-new behavior).
- The `mobile-panel-sizing` delta is conditional (Decision 4) — deliberately not scaffolded up
  front to avoid a no-op delta if tuning stays within stated bands.
