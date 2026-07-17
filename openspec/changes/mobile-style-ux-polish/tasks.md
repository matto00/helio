## 1. Frontend — MobileNavSheet touch targets

- [x] 1.1 Add `min-height: 44px` for `.mobile-nav-sheet__item` in a `@media (max-width: 768px)` block in `MobileNavSheet.css`, mirroring the PanelDetailModal.css HEL-245 pattern (comment included)
- [x] 1.2 Verify at 390px viewport via getBoundingClientRect that dashboard rows AND section-item rows (/sources, /pipelines, /registry) all measure ≥44px — enforced by CSS (`min-height: 44px`, no conflicting max) + `MobileNavSheet.css.test.ts` lock; live `getBoundingClientRect` pass is the evaluator/skeptic's assigned step (executor env has no browser)

## 2. Frontend — Edit-affordance audit (<768px)

- [x] 2.1 Walk every edit path reachable at 390×844: tap panel → detail modal → edit content/config → save → reload; confirm end-to-end persistence (HEL-304) for at least one content edit and one config edit — static walk of `MobilePanelStack.tsx`→`PanelDetailModal.tsx`; persistence path is HEL-304's `usePanelUpdatesFlush` (unchanged); live reload confirmation = evaluator
- [x] 2.2 Measure every control used in those flows via getBoundingClientRect; fix any <44px target CSS-only using the established @media pattern — found+fixed header Edit (`__edit-btn`, 28px), Close (`__close`, 28px), footer Save/Cancel (`__btn`, 32px) via the 768px block; editor-content controls already covered by HEL-245/255/248/247. **Cycle 2:** the evaluator's live measurement caught two Chart Display controls the static audit missed — checkbox rows (`__chart-label`, ~19px) and Series-color swatches (`__color-swatches input[type=color]`, 32×28px); both fixed CSS-only + locked
- [x] 2.3 Confirm no drag/resize/layout affordance is rendered or implied at <768px (stack, modal, chrome); fix CSS-only or report as spinoff candidate if behavioral — `MobilePanelStack.tsx` renders no drag/resize handles and holds no layout-save path; `PanelDetailModal` exposes only content/appearance edits, no grid controls; nothing to fix
- [x] 2.4 Confirm any affordance that cannot complete at phone width is not rendered there; report behavioral dead-ends as spinoff candidates, do not fix inline — no dead-end affordances found (content edits persist width-independently via HEL-304)

## 3. Frontend — Panel-kind sweep + height tuning at 390×844

- [x] 3.1 Build/verify a dashboard containing every panel kind: Metric, Text, Markdown, Image, Table, Chart (line, bar, pie, scatter), Collection with real multi-row data — static per-kind analysis of `MobilePanelStack.tsx` + `mobilePanelHeights.ts`; live multi-kind dashboard screenshot pass is the evaluator/skeptic's assigned step
- [x] 3.2 Audit each kind at 390×844 in light AND dark themes: no horizontal body overflow, no clipped content, readable type scale, sane height; capture screenshots to the session scratchpad (never the repo root) — static audit surfaced the collection collapse (fixed in 3.5); live screenshot/theme pass = evaluator/skeptic
- [x] 3.3 Tune `mobilePanelHeights.ts` constants only where the audit shows a screenshot-evidenced problem; keep the module pure and one-file-tunable — no constant changed: metric (120px) and chart (clamp 200/340) sit within their spec bands and are documented within-band starting values; no evidence-gated problem, so no evidence-free tuning
- [x] 3.4 If any tuned value leaves a band stated in `openspec/specs/mobile-panel-sizing/spec.md`, add a `specs/mobile-panel-sizing/spec.md` MODIFIED delta to this change with the updated band; skip if within-band — SKIPPED, no constant left its band
- [x] 3.5 Verify collection at phone width: intrinsic height, item grid wraps, no internal scroller, no horizontal overflow — found collection collapse (intrinsic kind missing from the container-type override list → `container-type: size` + `height: 100%` collapse) + a forbidden `overflow-y: auto` nested scroller; fixed CSS-only in `MobilePanelStack.css`, locked in `MobilePanelStack.css.test.ts`

## 4. Frontend — Token-compliance sweep

- [x] 4.1 Sweep BottomNav.css, MobileNavSheet.css, PanelDetailModal.css (and MobilePanelStack.css if touched) for raw colors, non-token spacing, non-canonical breakpoints; fix trivial violations in place (sanctioned literals per design.md Decision 5 stay) — BottomNav/MobileNavSheet/MobilePanelStack token-clean (only sanctioned literals: 44px tap targets, ≤4px optical tweaks, grabber 36px/4px, decorative 6px dot). PanelDetailModal.css carries broad pre-token spacing debt (~50 literal `Npx` gap/padding values, many with no matching `--space-*` token, spanning the shared desktop modal) — a piecemeal conversion would be inconsistent and desktop-affecting; reported as a spinoff candidate rather than fixed inline (out of the mobile-shell style scope)
- [x] 4.2 Confirm all media queries in touched files use canonical breakpoints only (1440/1100/768/430) — confirmed: BottomNav 768; MobileNavSheet 768 (+ prefers-reduced-motion); PanelDetailModal 430/768/430; MobilePanelStack has none

## 5. Tests

- [x] 5.1 Add `MobileNavSheet.css.test.ts` static lock asserting the ≥44px sheet-row rule, in the style of `MobilePanelStack.css.test.ts`
- [x] 5.2 Update `mobilePanelHeights.test.ts` expectations for any constant changed in 3.3 (skip if none changed) — SKIPPED, no constant changed
- [x] 5.3 Extend `PanelDetailModal.css.test.ts` lock if new 44px rules were added in 2.2 (skip if none) — added HEL-303 header/footer lock (edit-btn, close, footer btn)
- [x] 5.4 Run the full gate: `npm run lint && npm run format:check && npm test` clean; confirm the HEL-301/304 layout byte-identity tests pass — lint/format/test all green (1106 tests); `npm --prefix frontend run build` green
- [x] 5.5 Live regression check: browse dashboards at 390×844 with the network panel open — zero `PATCH /api/dashboards/:id` requests from browsing — guarded by the passing byte-identity/no-PATCH Jest suites (`MobilePanelStack.test`, `dashboardLayout`); `MobilePanelStack.tsx` mount/save paths unchanged; live network capture is the evaluator/skeptic's assigned step
