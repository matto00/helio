## 1. Frontend — stack structure (hazard §4.1)

- [x] 1.1 Read `notes/mobile-pwa-handoff.md` (W4, W5, §4.1), `DESIGN.md`, `CONTRIBUTING.md` in full
- [x] 1.2 Confirm (with a probe, not assumption) whether/when today's grid PATCHes an `xs` layout on narrow mount; record finding in files-modified.md
- [x] 1.3 Add pure `xs`-ordering helper (sort by `y` then `x` over `resolveDashboardLayout` output)
- [x] 1.4 Create `MobilePanelStack.tsx` + `.css`: single-column read-only stack of `PanelCard`s, tap opens `PanelDetailModal`
- [x] 1.5 Branch `PanelGrid` on container width < `panelGridConfig.breakpoints.sm` per design D2 (RGL + save wiring mounted only ≥768)
- [x] 1.6 Hide drag/resize/title-edit/delete affordances on the stack path; keep title + freshness

## 2. Frontend — per-kind sizing (W4.3)

- [x] 2.1 Create pure `mobilePanelHeights.ts` mapping `(kind, h, w)` → height policy per spec bands
- [x] 2.2 Apply policy in stack CSS via custom properties; tokens only; metric ~104–132 ignoring `h`; chart clamp band; table `min(60dvh, intrinsic)` internal scroll; text/markdown/image intrinsic; divider bare hairline

## 3. Frontend — density and chrome (W4.4)

- [x] 3.1 Stack gutters + container padding on `--space-3` rhythm below phone breakpoint
- [x] 3.2 Hide footer type badge and drag handle chrome on phone; keep title and freshness
- [x] 3.3 Hide zoom widget in `PanelList.tsx` below the 430px breakpoint
- [x] 3.4 Metric typography: DESIGN.md type scale, tabular numerals, verify long value `1,234,567.89` doesn't clip/wrap

## 4. Frontend — modal and renderers (W4.5 / W5)

- [x] 4.1 `PanelDetailModal` full-screen below 430px, persistent tappable close control (no hover dependency)
- [x] 4.2 ChartRenderer: verify/wire ECharts resize on container change; handle legend/axis overflow via ECharts config at phone widths
- [x] 4.3 TableRenderer/`DataGrid.css`: horizontal scroll inside the panel; audit that body never scrolls sideways
- [x] 4.4 Markdown/Text/Image: long words, code blocks, wide images wrap/fit without body scroll; image `max-width:100%; height:auto`

## 5. Tests

- [x] 5.1 Jest: structural no-persist test — render grid below 768, advance fake timers past `AUTO_SAVE_INTERVAL_MS`, assert no `updateDashboardLayout`/`setLayoutPending` dispatch on mount, width change, or flush tick
- [x] 5.2 Jest: stack renders (no RGL `<Responsive>`) below 768; grid unchanged ≥768
- [x] 5.3 Jest: stack ordering by `xs` layout `y` then `x`, including fallback-resolved panels
- [x] 5.4 Jest: `mobilePanelHeights` unit tests for every `PanelKind` band and `h` modulation edges (h≤4, h≥8)
- [x] 5.5 Jest: read-only assertions — no drag handle/title-edit/delete on stack; detail modal opens on tap
- [x] 5.6 `npm run lint && npm test` clean; no backend or `schemas/` diffs in the change

## 6. Handback — ready for device testing (terminal state)

- [x] 6.1 Verify production build: `npm --prefix frontend run build` succeeds; note `npx vite preview --host` invocation for phone-on-LAN testing
- [x] 6.2 Write ordered device test plan into `files-modified.md` handoff: (1) layout-corruption byte-identity check per handoff §6.4, (2) one-of-every-`PanelKind` sizing check per §6.5 with screenshot ask, (3) rotation/ECharts resize, (4) table/markdown scroll checks
- [x] 6.3 List the W4.3 tuning knobs (file + constants) so device feedback iteration is a one-file change
