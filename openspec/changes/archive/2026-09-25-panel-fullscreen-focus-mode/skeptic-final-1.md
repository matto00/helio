## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

**Ground truth / diff**
- Resolved review base fresh via `scripts/concertino/resolve-review-base.sh` (never a cached SHA):
  `BASE_SHA=572dc8d6470b66978bb5f7117b9bc1673948e5ff` (main), diffed against `HEAD=d0405f65...` with
  `git diff 572dc8d6...HEAD`. 18 files changed, 1140(+)/9(-). Core surface: `PanelFullscreenOverlay.tsx`
  (new), `PanelFullscreenOverlay.css` (new), `PanelCard.tsx` (+56/-2), `panelNarrowing.ts` (+9),
  4 new/updated test files, plus the two CSS-file-count fixture bumps (117→118) in
  `elevationTokenGuard.css.test.ts`/`motionTokenGuard.css.test.ts` — matches proposal.md's Impact section;
  the one un-declared addition (`isFullscreenEligible` in `panelNarrowing.ts`) is a tightly-scoped 9-line
  helper reused by both `PanelCard.tsx` gates, not scope creep.
- `MobilePanelStack.tsx`: confirmed untouched (`git diff --stat -- frontend/src/features/panels/ | grep -i
  mobile` → no hits), matching proposal.md's "no fullscreen control there" decision.

**Gates (re-run myself, not trusted from evaluation-1.md)**
- `npm run lint` (frontend/): clean, zero warnings.
- `npm run typecheck`: clean.
- `npm test` (full suite, not just the touched files): `342 suites / 3747 tests passed`, 1 snapshot passed.
- Targeted re-run (`PanelFullscreenOverlay|PanelCard|elevationTokenGuard|motionTokenGuard`): `8 suites / 64
  tests passed`.

**The definite-height CSS fix — verified live, not just via the static-source-parse test**
- Read `Modal.css` directly: confirmed `.ui-modal` only sets `max-height: 90vh` (never an explicit
  `height`), and `.ui-modal--full` is width-only (`width: min(1200px, calc(100vw - 32px))`) — so without an
  override, `size="full"` really would shrink-to-fit, exactly as design.md/skeptic-design-1.md described.
  `PanelFullscreenOverlay.css`'s `.panel-fullscreen-overlay { height: min(90vh, 1000px); overflow: hidden;
  }` is the fix, mirroring `PanelDetailModal.css`'s `--view` pattern.
- Live-rendered proof, not inference: created a throwaway pipeline/source/chart-Output (`sum(value) group
  by category`, 2 rows), bound it to a panel on the dashboard, screenshotted it in-grid (~250×186px chart),
  then opened Fullscreen and screenshotted again — the overlay filled ~1200×~830px and ECharts re-rendered
  the SAME line chart at that scale with correctly recalculated axis ticks/positions (not a stretched
  screenshot). Repeated with `localStorage['helio-theme']='dark'` + reload — same result, correct dark
  surface/contrast, chart legend visible. Screenshots persisted via `persist-evidence.sh`:
  - `chart-panel-grid-light.png` → `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/chart-panel-grid-light.png`
  - `chart-fullscreen-light.png` → `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/chart-fullscreen-light.png`
  - `chart-fullscreen-dark.png` → `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/chart-fullscreen-dark.png`
  - `fullscreen-text-light.png` (a `text`-kind panel, for a second content type) →
    `/home/matt/Development/helio/.concertino/runs/HEL-584/evidence/fullscreen-text-light.png`
  These are direct visual/pixel evidence (before/after size + a real chart re-render), not mtime-ordering
  or narrative — no disclosed-mtime-unsoundness dependency to flag here.

**Modal behaviors — confirmed as native `Modal`, no regressions, live not just unit-tested**
- Focus trap: after opening, `Tab` moved focus to the dialog's only focusable descendant (Close button);
  a second `Tab` kept focus on Close (`document.activeElement.closest('dialog')` truthy both times) —
  focus never escaped to the page behind it.
- Background inert while open: attempting to click page-background elements (`Helio home` link, `User
  menu` button) both timed out with Playwright reporting `<dialog open ...> intercepts pointer events` —
  i.e. the native `<dialog>` modality is genuinely blocking, not just visually overlaid.
  - `Esc`: closed the overlay and restored focus exactly to the trigger (`Fullscreen <panel>` button showed
    `[active]` in the a11y snapshot immediately after).
  - Backdrop click: dispatched a `click` MouseEvent directly on the `<dialog>` node (the same `e.target ===
    dialogRef.current` check `Modal.tsx:176` uses to distinguish backdrop from content clicks — read the
    source to confirm this logic is untouched, shared, and not forked); the dialog closed and focus
    restored to the trigger button again.
  - `prefers-reduced-motion`: confirmed the entrance keyframe animation is covered by `theme.css`'s
    existing global `@media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration:
    0.01ms !important; ... } }` rule (line 454) — nothing new needed or added by this change.

**View-only / no editing affordance**
- Read `PanelFullscreenOverlay.tsx` in full: its only interactive controls are `Modal`'s own Close button
  and `PanelContent`'s `onRetry`/`retryVariant="button"` (an error-state retry, not an edit action). No
  Edit/Rename/Save controls anywhere in the component or its CSS. Live screenshots confirm the same —
  title, mono eyebrow (`panel.type`), close X, content; nothing else.
- `isFullscreenEligible()` (`panelNarrowing.ts`) excludes `divider` and `form`, matching proposal.md's
  stated rationale (no content to maximize / a write surface). Confirmed live on the pre-existing "HEL-584
  eval dashboard": the `divider` panel has no Fullscreen button; the `form` panel on the "HEL-1096 eval
  dashboard" has no Fullscreen button either; the `markdown`/`text`/newly-added `output` (chart) panels all
  do.

**No second `usePanelData` fetch (HEL-579 regression risk)**
- Source: `PanelFullscreenOverlay.tsx` imports only the `PanelDataResult` *type* from `usePanelData`, never
  the hook itself; `PanelCard.tsx` still has exactly one call site (`usePanelData(panel)` at line 236),
  whose result is threaded into `PanelFullscreenOverlay` as props.
- Network trace (live): opening/closing fullscreen on the chart panel produced only
  `GET /api/outputs/:id` (metadata) requests, never an additional `GET /api/outputs/:id/rows` — the rows
  fetch that `usePanelData` performs only appeared on the panel's own initial mount/refresh cycles, not on
  fullscreen open.

**Red-first evidence (Standing Constraint C4) — read, not just cited**
- `files-modified.md`'s red→green transcript (7 failed → 35 passed) is consistent with the two documented
  implementation bugs (mount/unmount losing focus-restore; `Modal`'s always-rendered header duplicating the
  card's own title in jsdom queries) — both are exactly the class of bug this ticket's own
  design.md/skeptic-design rounds were worried about, and the fixes described match what's actually in the
  diff (unconditional mount + `open` prop; body gated on `open` separately).

### Verdict: CONFIRM

All four things I was specifically asked to re-verify hold under live, independent testing: the fullscreen
control is genuinely view-only; focus trap/Esc/backdrop/restore all work as unmodified native `Modal`
behavior with the background provably inert while open; the definite-height CSS fix holds under live
render for both a text panel and a real chart panel (screenshotted, not inferred) in both themes; no second
`usePanelData` fetch exists (confirmed by source and network trace). The diff does not exceed proposal.md's
declared Impact beyond one small, clearly-scoped helper function and its accompanying tests.

### Non-blocking notes

- The throwaway pipeline/source/output/panel I created to get a live chart-panel test fixture (no chart
  panel existed on any eval dashboard) was deleted after verification (pipeline → source → panel all
  removed); dev DB should be back to its pre-review state for this ticket's fixtures.
- `PanelFullscreenOverlay.test.tsx`'s own comment on the `ChartPanel`/ECharts resize test is honest about
  jsdom's limits (no `ResizeObserver`, no real layout) and states plainly that only a real browser can prove
  the resize — which is exactly what I did here; worth noting for future skeptics reviewing chart-adjacent
  CSS changes that the static test suite alone cannot substitute for this live check.
