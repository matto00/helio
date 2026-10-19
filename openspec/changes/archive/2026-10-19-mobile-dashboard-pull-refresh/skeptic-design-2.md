## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed tree: HEAD d0c600fbf216cf8ad9cef686dbbe07be0f43b96c; the only change is the untracked change dir (planning artifacts). Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/mobile-dashboard-pull-refresh/HEL-1656`.

### What I verified (with evidence)

**Round-1 change requests, checked against the revised artifacts and the tree**

- **CR1 (D5 busy tracking): resolved.** D5 now says: (a) a round snapshot `panelId -> seenTrue`, seeded from the current `isRefreshing` so an entry already in flight counts as seen; busy ends only when every round entry has `seenTrue` and now reports `false`, or has unmounted; (b) the child writes `isRefreshing` in an effect keyed on that value and notifies only when it changes, so there is no per-render loop; (c) `PULL_REFRESH_TIMEOUT_MS = 15000` is the fallback. D7 and task 3.4 add a held-open rows request test with a red mutation that ends busy on the first false read. I checked this against `usePanelData.ts:129-138` (`refresh` sets `replayFullQueryRef = true` and bumps `refreshToken`) and the effect (`if (!fullReplay) {...reuse/pending short-circuits...}` and then an unconditional `dispatch(fetchPanelPage)`). A refresh therefore always dispatches. So `pending` sets `isLoadingMore` true, the guard sees `seenTrue`, and `fulfilled` or `rejected` sets it false. The seen-true-then-false rule is sound.
- **CR2 (motion literal guard): resolved.** Task 1.0 registers `dragVelocity.ts`, `usePullToRefresh.ts` and `motionTransition.ts` (if created) in `PRIMITIVE_FILES`. I confirmed in `motionPrimitiveLiterals.test.ts:54-60` that the guard fails on any unlisted file. D5 and task 1.0 put the 15 s ceiling in `features/panels/ui/grid/pullRefreshRegistry.ts`, outside `shared/motion` and outside `PRIMITIVE_FILES`, so the `timer delay` regex (`set(?:Timeout|Interval)\([^)]*,\s*\d`) does not hit it. The other new numeric constants in `shared/motion` (`PULL_THRESHOLD_PX` 64, `PULL_MAX_PX` 112, `PULL_HOLD_PX` 48, damping 0.5, flick 0.5 px/ms) do not match any `LITERAL_TIMING` regex (`motionPrimitiveLiterals.test.ts:35-40`), provided they are not written with an `ms`/`s` unit suffix (see notes).
- **CR3 (indicator vs. status region): resolved.** D4 now separates two elements. The visual `PullRefreshIndicator` (`aria-hidden`) is not rendered at rest at either motion level (the "Rest state (both levels)" paragraph). The status region is an always-mounted, visually hidden `role="status"` `aria-live="polite"` element that announces "Refreshing" and then "Refreshed". The utility class exists: `.sr-only` at `theme/theme.css:638`. Task 3.2 and task 3.4 (announcement test) carry this through.

**Fresh review of the whole plan**

- **Owner ruling.** `ticket.md` matches the ruling summarised there: containment only on the phone dashboard scroller, top-only engagement, one refresh per output-bound panel behind its guard, no pipeline runs, snap under Subtle/Off/reduced, desktop unchanged. D6, D1, D5 and D3 implement each point in that order. I did not re-read `events.jsonl` this round; round 1 verified it.
- **Referenced primitives exist.**
  - `hooks/useIsNarrowerThan.ts`
  - `shared/ui/Spinner.tsx:20`
  - `ICON_SIZE.sm` at `shared/ui/iconSize.ts:4`
  - `sheetMotion.ts` and `useSheetSwipe.ts` (extraction targets)
  - `panelGridConfig.ts:38` (`sm: 768`, consistent with the D6 `@media (max-width: 768px)` and `useIsNarrowerThan(769)`)
  - HEL-1668 guard at `features/pipelines/ui/pipelineHoverGating.css.test.ts`
  - DESIGN.md §10 at line 1127 and §12 at line 1417
- **Containment scope.** The only `overscroll` rules in frontend CSS today are in `BottomSheet.css:20,51`, so the scoped `.app-content[data-pull-refresh]` rule cannot collide with anything.
- **AC coverage.**

  | AC | Covered by |
  |---|---|
  | AC1 | D1, D3, tasks 2.1 and 3.2, e2e |
  | AC2 | D5, tasks 3.1 and 3.4, e2e request count and zero `/runs` |
  | AC3 | D1, task 2.2 (every exclusion listed) |
  | AC4 | D6, e2e computed style on dashboard, Home and 1280 |
  | AC5 | D3, e2e Motion Off with no transform and refresh still firing |
  | AC6 | D2, task 1.0 |
  | AC7 | D6, e2e at 1280 |
  | AC8 | D7, tasks 5.1-5.3 |

  Every AC is traced to a task. Nothing is out of scope: public routes, sheet swipe and a visible refresh button are explicitly non-goals.
- **Contradictions and placeholders.** No TODO or TBD. The spec delta's five requirements are consistent with D1-D7. No API or schema change, so no contract delta is needed.

### Verdict: CONFIRM

### Non-blocking notes

1. **Mid-pull overlap under Full motion.** D3 puts the indicator at `top: -<height>` inside the translated wrapper, "revealed by the translate". While `pull < indicator height` it will draw over whatever sits above the stack in `.app-content`, unless something clips it. Clip it (an `overflow: clip` slot, or opacity tied to pull) or state that the overlap is intended. The final gate will judge this visually.
2. **Batching race.** With an instantly resolving mocked request, React could batch `pending` and `fulfilled` so that the child effect never observes `true`. Busy would then wait for the 15 s ceiling. Real network does not hit this, and D7's held-open test is the right shape. Do not build the registry test on an instantly resolving mock.
3. **Unit suffixes in `shared/motion`.** Do not write the flick velocity or any other constant in those files with an `ms` or `s` unit suffix in code (e.g. `0.5 /* px/ms */` is fine, a `100ms` literal is not). The `time unit` regex would flag it.
4. **Shard weights.** Task 5.1's "add its weight to `e2e/shard-weights.tsv` if the shard tooling requires it" resolves to **do not**. `scripts/e2e-shard.mjs:56-66` gives unknown specs the median weight, and the tsv header says "never hand-edit".
5. **Spec wording.** The spec scenario "Pull from the top engages: ... tracks the pull distance" reads as positional tracking. Under Off the indicator only snaps between states. The Motion requirement settles this, but the scenario wording could be tightened.
6. **Zero output-bound panels.** On a dashboard with no output-bound panels, a qualifying release makes an empty round, which ends busy at once (vacuously). The executor should make sure that path still announces correctly and does not flash.
7. **Task numbering.** Task 1.0 is listed after 1.1. This is cosmetic, but 1.0 has to land together with 1.1, because the guard fails as soon as `dragVelocity.ts` exists unregistered.
