# HEL-1656: Mobile dashboards: pull-to-refresh (split from HEL-1584 item 8)

## Description

origin_kind: followup, origin_ticket: HEL-1584 (owner ruling `split-to-followups`, 2026-10-17). Parent: HEL-1570.

HEL-1584 item 8b. A pull-to-refresh gesture on the mobile dashboard (HEL-1583's layout, merged) that triggers the existing panel refresh.

- It follows the finger, with a token-driven release. Under Subtle / Off / OS reduced motion it snaps with no movement.
- Reuse, don't duplicate: HEL-1582 (mobile pipeline page) built a shared swipe-to-dismiss sheet with gesture handling in `shared/motion`. Build on that. Item 8a (sheets that follow the finger and swipe to dismiss) stays on HEL-565, which should reuse the same primitive.
- Must not fight native browser overscroll or pull-to-refresh, or page scroll. Test on real touch emulation at 375 and 390.
- The refresh respects the existing request limits (no burst of panel refetches beyond what the refresh button does).

## Owner ruling (2026-10-18, escalation HEL-1656-1792342312594-d28750, answer `suppress-on-phone-dashboard`)

- At 768px and below, contain overscroll on the phone dashboard scroller only (this turns off the browser's own overscroll glow/bounce and native pull-to-refresh there, so the two never both fire).
- The gesture engages only on a downward pull while the dashboard scroller is at scrollTop 0.
- On release past the threshold, each output-bound panel refreshes once, behind its existing in-flight guard. Never run pipelines.
- Subtle, Off and OS reduced motion snap with no movement.
- Desktop is unchanged.
- Premise corrections that stand: only the settle and velocity helpers of `useSheetSwipe` carry over (its pointer-capture approach needs a non-scrolling surface); there is no dashboard-level refresh, so the pull fans out to each panel's own `usePanelData.refresh`.

## Acceptance Criteria

1. On the authenticated phone dashboard (viewport <= 768px, `MobilePanelStack` mounted), a touch pull-down that starts while `.app-content` is at scrollTop 0 shows a pull indicator; under Full motion the panel list follows the finger (damped), and releasing past the threshold triggers a refresh, releasing short of it settles back with no refresh.
2. The refresh calls each output-bound panel's existing `usePanelData.refresh` exactly once (non-output panels: nothing); a panel already in flight is not re-requested (existing guard). No pipeline run is triggered. The indicator shows a busy state until those refreshes settle, then returns to rest.
3. A pull that starts while `.app-content` is scrolled (scrollTop > 0), an upward or mostly-horizontal drag, a drag inside a nested scroller that is not at its own top, a mouse/pen drag, or a multi-touch never engages the gesture and never blocks ordinary page scroll.
4. While the phone dashboard is mounted at <= 768px, `.app-content` has `overscroll-behavior-y: contain`; nowhere else (other pages, desktop widths, after unmount) does it.
5. Under Subtle, Off, and OS reduced motion nothing translates: the indicator snaps between states (no transition, no follow), and the refresh still triggers on a qualifying release.
6. Motion timing comes only from DESIGN.md §10 tokens (no literal durations; `motionPrimitiveLiterals.test.ts` stays green).
7. Desktop (> 768px) dashboard markup and behavior unchanged.
8. Verified in Playwright with touch emulation (hasTouch, isMobile) at 375 and 390 (and 430), light and dark; screenshots persisted to scratch. Existing gates (including HEL-1668's hover-gating jest guard and `e2e/shard-weights.tsv`) stay green.
