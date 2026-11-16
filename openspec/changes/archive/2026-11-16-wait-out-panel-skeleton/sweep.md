# HEL-1633 sweep: `.react-grid-item` hits in e2e/

Run on the pristine base (HEAD fd7064f7d, before this change's edits), so line numbers below are base line numbers.

Command: `git grep -n "react-grid-item" HEAD -- e2e` (equivalent to `grep -rn "react-grid-item" e2e`). 74 hits.

Verdict key (design D2): FIX | OK-filtered | OK-settled | OK-not-a-load | OK-already-waits. FIX hits were converted to
`waitForPanelGrid` (e2e/support/panelGridReady.ts). Each FIX spec was run once after conversion (all green).

Premise facts checked against the tree: the skeleton's desktop grid root is `className="panel-grid"`
(DesktopPanelGridSkeleton.tsx:58) and its stubs are `.react-grid-item`s, so `.panel-grid > .react-grid-item` does NOT
exclude the stubs either. Only the live-layer selector `.crossfade__layer:not(.crossfade__skeleton) ...` does.

## Raw output

```
e2e/hel1023-breakpoint-layout-derivation.spec.ts:15:// `.react-grid-item` rects (never the store). Mixed kinds: markdown, image, chart (output panel
e2e/hel1023-breakpoint-layout-derivation.spec.ts:231:    const sel = grid ? ".react-grid-item" : ".mobile-panel-stack__item";
e2e/hel1023-breakpoint-layout-derivation.spec.ts:245:  await expect(page.locator(".react-grid-item, .mobile-panel-stack__item")).toHaveCount(
e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:73:  await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:74:  // The loading skeleton also renders one `.react-grid-item` per saved layout entry (PanelGridSkeleton, HEL-528
e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:79:  await expect(page.locator(".react-grid-item")).toHaveCount(2);
e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:83:  const box = await page.locator(".react-grid-item").nth(index).boundingBox();
e2e/hel1028-layout-undo-redo-visual-revert.spec.ts:311:      await expect(page.locator(".react-grid-item")).toHaveCount(0);
e2e/hel1065-pin-toggle-css-fixes.spec.ts:127:  await expect(page.locator(".react-grid-item")).toHaveCount(1);
e2e/hel1085-form-field-renderers-keyboard.spec.ts:129:      await expect(page.locator(".react-grid-item")).toHaveCount(1);
e2e/hel1189-output-panel-controls-live.spec.ts:87:  const panelCard = page.locator(".react-grid-item", { hasText: "Orders" });
e2e/hel1230-drag-then-create-persists.spec.ts:80:    await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1230-drag-then-create-persists.spec.ts:107:    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
e2e/hel1260-orphan-owner-repair.spec.ts:36:  const item = page.locator(".react-grid-item").first();
e2e/hel1260-orphan-owner-repair.spec.ts:103:      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1260-orphan-owner-repair.spec.ts:122:      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1260-orphan-owner-repair.spec.ts:168:      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1260-orphan-owner-repair.spec.ts:176:      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1275-metric-delta-sparkline.spec.ts:211:      const card = page.locator(".react-grid-item", { hasText: "HEL-1275 Revenue" });
e2e/hel1275-metric-delta-sparkline.spec.ts:249:      const filtered = page.locator(".react-grid-item", { hasText: "HEL-1275 Filtered" });
e2e/hel1275-metric-delta-sparkline.spec.ts:292:      const switched = page.locator(".react-grid-item", { hasText: "HEL-1275 Revenue" });
e2e/hel1277-output-history-scrubber.spec.ts:303:      const card = page.locator(".react-grid-item", { hasText: "HEL-1277 Trend" });
e2e/hel1304-output-charttype-render.spec.ts:189:      const card = (title: string) => page.locator(".react-grid-item", { hasText: title });
e2e/hel1307-conditional-formatting.spec.ts:250:      const card = (title: string) => page.locator(".react-grid-item", { hasText: title });
e2e/hel1350-chart-compare-picker.spec.ts:206:      const card = page.locator(".react-grid-item", { hasText: "HEL-1350 Trend" });
e2e/hel1351-aggregated-chart-overlay.spec.ts:231:      const tallCard = page.locator(".react-grid-item", { hasText: "HEL-1351 Tall" });
e2e/hel1351-aggregated-chart-overlay.spec.ts:270:      await expect(page.locator(".react-grid-item")).toHaveCount(0, { timeout: 15_000 });
e2e/hel1392-remount-request-burst.spec.ts:73:    await expect(page.locator(".react-grid-item")).toHaveCount(8, { timeout: 15_000 });
e2e/hel1392-remount-request-burst.spec.ts:85:  await expect(page.locator(".react-grid-item")).toHaveCount(8, { timeout: 20_000 });
e2e/hel1392-remount-staleness.spec.ts:59:  else await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
e2e/hel1398-chart-narrow-footnotes.spec.ts:159:  return page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" }).evaluate((card) => {
e2e/hel1398-chart-narrow-footnotes.spec.ts:255:        const card = page.locator(".react-grid-item", { hasText: title });
e2e/hel1398-chart-narrow-footnotes.spec.ts:263:          cardWidth: el.closest(".react-grid-item")!.getBoundingClientRect().width,
e2e/hel1398-chart-narrow-footnotes.spec.ts:302:          const card = page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" });
e2e/hel1398-chart-narrow-footnotes.spec.ts:396:        const card = page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" });
e2e/hel1398-chart-narrow-footnotes.spec.ts:401:        const m = await measure(page, "HEL-1398 narrow", ".react-grid-item");
e2e/hel1398-chart-narrow-footnotes.spec.ts:476:        const card = page.locator(".react-grid-item", { hasText: "HEL-1398 narrow" });
e2e/hel1444-footnoted-chart-canvas.spec.ts:370:    const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
e2e/hel1444-footnoted-chart-canvas.spec.ts:401:          const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
e2e/hel1444-footnoted-chart-canvas.spec.ts:595:          .locator(".react-grid-item", { hasText: titleOf(v) })
e2e/hel1444-footnoted-chart-canvas.spec.ts:601:      const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
e2e/hel1444-footnoted-chart-canvas.spec.ts:651:      const card = page.locator(".react-grid-item", { hasText: titleOf(v) });
e2e/hel1457-stale-tab-layout-save.spec.ts:41:    await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1457-stale-tab-layout-save.spec.ts:42:    // The loading skeleton also renders `.react-grid-item`s, and the meta row's "Edit layout" button mounts only
e2e/hel1457-stale-tab-layout-save.spec.ts:83:    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
e2e/hel1457-stale-tab-layout-save.spec.ts:87:    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
e2e/hel1457-stale-tab-layout-save.spec.ts:117:    await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1457-stale-tab-layout-save.spec.ts:118:    // The loading skeleton also renders `.react-grid-item`s, and the meta row's "Edit layout" button mounts only
e2e/hel1457-stale-tab-layout-save.spec.ts:128:        .locator(".react-grid-item", { hasText: "HEL-1457 A" })
e2e/hel1457-stale-tab-layout-save.spec.ts:185:    await expect(page.locator(".react-grid-item")).toHaveCount(2, { timeout: 15_000 });
e2e/hel1457-stale-tab-layout-save.spec.ts:187:    await expect(page.locator(".react-grid-item", { hasText: "HEL-1457 B" })).toBeVisible();
e2e/hel1572-appearance-preferences.spec.ts:338:   *  `.react-grid-item`s of its own, so the items are taken from the live crossfade layer only. */
e2e/hel1572-appearance-preferences.spec.ts:339:  const GRID_ITEMS = ".crossfade__layer:not(.crossfade__skeleton) .react-grid-item";
e2e/hel1573-motion-grid-chart.spec.ts:37:        const item = grid.querySelector(":scope > .react-grid-item") as HTMLElement;
e2e/hel1573-motion-grid-chart.spec.ts:53:        placeholder.className = "react-grid-item react-grid-placeholder cssTransforms";
e2e/hel1573-motion-grid-chart.spec.ts:288:    const items = page.locator(".panel-grid > .react-grid-item");
e2e/hel1573-motion-grid-chart.spec.ts:361:      (r) => r.target.includes("react-grid-item") && r.name === "transform",
e2e/hel1573-motion-primitives.spec.ts:37:  /dashboard-list__item|motion-indicator|react-grid-item|react-grid-layout|panel-grid|crossfade/;
e2e/hel1573-motion-primitives.spec.ts:218:        (x) => x.target.includes("react-grid-item") && x.name === "transform",
e2e/hel1575-delayed-restore-no-update-loop.spec.ts:67:    await expect(page.locator(".react-grid-item")).toHaveCount(1);
e2e/hel1575-delayed-restore-no-update-loop.spec.ts:76:    await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1575-reload-after-edit.spec.ts:44:      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1575-reload-after-edit.spec.ts:47:      await expect(page.locator(".react-grid-item")).toHaveCount(1, { timeout: 15_000 });
e2e/hel1584-motion-perf.spec.ts:217:  const item = page.locator(".panel-grid > .react-grid-item").first();
e2e/hel1584-motion-surfaces.spec.ts:110:  const items = page.locator(".panel-grid > .react-grid-item");
e2e/hel1584-motion-surfaces.spec.ts:399:      .locator(".panel-grid > .react-grid-item")
e2e/hel1584-motion-surfaces.spec.ts:420:      .locator('.panel-grid > .react-grid-item[data-entrance="pop"] > .panel-grid-card')
e2e/hel1584-motion-surfaces.spec.ts:612:        .locator(".panel-grid > .react-grid-item")
e2e/hel909-output-picker-panel-sheet.spec.ts:124:    const panelCard = page.locator(".react-grid-item", { hasText: "Untitled Panel" });
e2e/hel909-output-picker-panel-sheet.spec.ts:198:        page.locator(".mobile-panel-stack, .react-grid-item", { hasText: "Untitled Panel" }),
e2e/hel909-output-picker-panel-sheet.spec.ts:267:    const panelCard = page.locator(".react-grid-item", { hasText: "Untitled Panel" });
e2e/hel910-pipeline-to-dashboard-flow.spec.ts:193:    await expect(page.locator(".react-grid-item")).toHaveCount(3);
e2e/hel910-pipeline-to-dashboard-flow.spec.ts:260:    await expect(page.locator(".react-grid-item")).toHaveCount(1);
e2e/hel968-multi-root-editor-flow.spec.ts:165:    await expect(page.locator(".react-grid-item")).toHaveCount(1);
```

## Verdicts (one per hit; file:line = base line)

FIX (converted, in the same spec, to `waitForPanelGrid(page, N)`):
- hel1085-form-field-renderers-keyboard.spec.ts:129 - bare count right after `goto("/dashboards")` (:125). FIX.
- hel1065-pin-toggle-css-fixes.spec.ts:127 - bare count right after `goto("/dashboards")` (:125), shared setup that later measures. FIX.
- hel1230-drag-then-create-persists.spec.ts:80 - bare count right after `goto` (:79), then drag from `.first()` handle. FIX.
- hel1260-orphan-owner-repair.spec.ts:103 - bare count after `goto` (:101). FIX (cheap; the repair POST is the real subject).
- hel1260-orphan-owner-repair.spec.ts:122 - bare count after `page.reload()` (:121), then `settledGridItemBox` reads `.react-grid-item` `.first()` (:36), which can be a stub. FIX.
- hel1260-orphan-owner-repair.spec.ts:176 - same shape as :122 after reload (:175). FIX.
- hel1260-orphan-owner-repair.spec.ts:36 - `.first()` box read in `settledGridItemBox`, called right after :122 / :176 (now gated by the helper) and after :168 (a UI add, not a load). OK-settled via the helper at its two post-load callers.
- hel1392-remount-request-burst.spec.ts:85 - bare count after `goto` (:84) in `openDashboard`. FIX (timeout 20 s kept).
- hel1457-stale-tab-layout-save.spec.ts:87 - bare count after `page.reload()` (:86). FIX.
- hel1575-delayed-restore-no-update-loop.spec.ts:67 - bare count after `goto` (:66). FIX.
- hel1575-delayed-restore-no-update-loop.spec.ts:76 - bare count after `page.reload()` (:75) with a slow browser-store read. FIX.
- hel1572-appearance-preferences.spec.ts:338-339 - the live-layer selector (HEL-1584) was already used; the two post-`/dashboards` waits (:361, :386 now) were count-only and are now `waitForPanelGrid(page, 3)`. FIX (the ticket's subject).
- hel1575-reload-after-edit.spec.ts:47 - bare count after `page.reload()` (:46). FIX (named in the ticket). :44 is OK-not-a-load (after a UI "Add Text panel" click, no navigation).

OK-already-waits:
- hel1028-layout-undo-redo-visual-revert.spec.ts:73,79 - `Loading panels` count 0 at :78 follows the first count. :83 `.nth(index)` is read after `openDashboard`'s wait.
- hel1457-stale-tab-layout-save.spec.ts:41, :117 - `Loading panels` count 0 at :45 and :121.

OK-filtered (locator is filtered by the card's own text; stubs carry no titles or text, so they cannot match):
- hel1189-output-panel-controls-live.spec.ts:87 (`hasText: "Orders"`)
- hel1351-aggregated-chart-overlay.spec.ts:231 (`hasText: "HEL-1351 Tall"`)
- hel1275-metric-delta-sparkline.spec.ts:211, :249, :292 (`hasText: "HEL-1275 ..."`)
- hel1350-chart-compare-picker.spec.ts:206 (`hasText: "HEL-1350 Trend"`)
- hel1457-stale-tab-layout-save.spec.ts:128, :187 (`hasText: "HEL-1457 A"` / `"HEL-1457 B"`)
- hel1277-output-history-scrubber.spec.ts:303 (`hasText: "HEL-1277 Trend"`)
- hel1398-chart-narrow-footnotes.spec.ts:159, :255, :263 (the `closest` call runs on a text-filtered element), :302, :396, :401 (passed to `measure` with the title filter), :476
- hel1444-footnoted-chart-canvas.spec.ts:370, :401, :595, :601, :651 (`hasText: titleOf(v)`)
- hel1307-conditional-formatting.spec.ts:250 (`hasText: title`)
- hel909-output-picker-panel-sheet.spec.ts:124, :198, :267 (`hasText: "Untitled Panel"`; :198 mixes the phone stack)
- hel1304-output-charttype-render.spec.ts:189 (`hasText: title`)

OK-not-a-load (no navigation or reload precedes the use, or the use is not a locator read):
- hel910-pipeline-to-dashboard-flow.spec.ts:193, :260 - after Add-panel picker interactions on an already loaded dashboard (loads at :172, :241).
- hel968-multi-root-editor-flow.spec.ts:165 - after the Add-panel picker (:161-164).
- hel1230-drag-then-create-persists.spec.ts:107 - after a UI create via the picker.
- hel1457-stale-tab-layout-save.spec.ts:83, :185 - panel appears through the app (conflict handling), no load.
- hel1260-orphan-owner-repair.spec.ts:168 - after a UI add.
- hel1575-reload-after-edit.spec.ts:44 - after a UI add.
- hel1392-remount-request-burst.spec.ts:73 - after a viewport swap on a loaded page, with `.panel-grid` count 1 and RGL width waits; no load.
- hel1392-remount-staleness.spec.ts:59 - `setViewport` on a loaded page.
- hel1351-aggregated-chart-overlay.spec.ts:270 - asserts count 0 after a viewport change to phone width.
- hel1028-layout-undo-redo-visual-revert.spec.ts:311 - count 0 on an empty dashboard; a stub-free layout cannot be satisfied by the skeleton. Note: the preceding handle count 0 at :310 is itself satisfiable before anything mounts (absence assertions pass vacuously); out of scope here, candidate follow-up.
- hel1573-motion-primitives.spec.ts:37, :218 - a regex of class names and a transition-record filter, not locator reads.
- hel1573-motion-grid-chart.spec.ts:53, :361 - a synthetic placeholder element and a transition-record filter, not locator reads.
- hel1023-breakpoint-layout-derivation.spec.ts:15 - a comment.
- hel1572-appearance-preferences.spec.ts:338 - a comment.
- hel1028-layout-undo-redo-visual-revert.spec.ts:74 - a comment.
- hel1457-stale-tab-layout-save.spec.ts:42, :118 - comments.

Cycle-2 FIX (evaluation-1.md CR1, CR2):
- hel1023-breakpoint-layout-derivation.spec.ts:231, :245 - `settledRects` counts items of either shape and its width/stability waits are satisfiable by a static skeleton; `readRects` can even pick the skeleton's `.panel-grid` root (also `.panel-grid`). The only load is `openAt`'s `goto` at the first window (1900 px, desktop; later windows are `setViewportSize` resizes), so `waitForPanelGrid(page, 8, { timeout: 20_000 })` now follows that `goto`. FIX. (An earlier version of this file said the helper could not apply at phone widths; that was wrong.)
- hel1573-motion-grid-chart.spec.ts:37 - `goto("/dashboards")` then a `.panel-grid-card` count of 3 (stubs satisfy it), then an 800 ms wait, then a read of `.panel-grid > .react-grid-item`. Viewport is 1900 px. The count is now `waitForPanelGrid(page, 3)` (the 800 ms wait is kept for the entrance). FIX.

Motion specs that observe the crossfade/entrance (classified, deliberately NOT converted, per the ticket):
- hel1584-motion-surfaces.spec.ts:110, :399, :420, :612 - `.panel-grid > .react-grid-item` (matches stubs too) read after an "Edit layout" click (the button mounts only after loading) plus 600 ms; :110 and :612 are `hasText: "Metric"` filtered (OK-filtered); :399/:420 come after a duplicate (not a load) and :420 filters on `data-entrance="pop"`. These specs record the entrance and fade themselves, so they are not converted.
- hel1584-motion-perf.spec.ts:217 - `.first()` after an 800 ms wait following Edit layout; observes motion. OK-settled by timed wait.
- hel1573-motion-grid-chart.spec.ts:288 - `items.filter({ hasText: "M-drag Metric" })`. OK-filtered. (:37 is a cycle-2 FIX above.)

Every one of the 74 hits has a verdict above.

## Items the ticket asked to be checked

- HEL-1644 (hel1575-dashboard-tabs :593/:627): `grep react-grid-item e2e/hel1575-dashboard-tabs.spec.ts` has zero hits and no edit was made to that file. Not touched.
- hel1681-refresh-control.spec.ts:288: zero `react-grid-item` hits; the file has `.panel-grid-card` hits at :332 and :343 (secondary grep) only. Not edited.

## Secondary grep (design D3)

Command: `git grep -c "panel-grid-card" HEAD -- e2e` -> 73 hits in 20 files:
hel1023 (1), hel1028 (3), hel1094 (1), hel1096 (1), hel1230 (2), hel1392-remount-request-burst (2), hel1392-remount-staleness (2),
hel1398 (4), hel1444 (4), hel1457 (3), hel1573-motion-grid-chart (7), hel1573-motion-primitives (1), hel1575-dashboard-tabs (3),
hel1575-switch-measurement (3), hel1584-motion-perf (3), hel1584-motion-surfaces (17), hel1656 (1), hel1681 (2), hel572 (4), hel588 (9).

Hits in files this change edits (D3):
- hel1230:84 `.panel-grid-card__handle` `.first()` - run after `waitForPanelGrid` now; the handle class is real-card-only anyway (skeleton card root is `.panel-grid-card`, no `__handle`). OK-settled.
- hel1457:48, :130 - `__handle`; settled by the existing :45/:121 wait. hel1028:126, :310 - `__handle`, :310 an absence check. OK.
- hel1392-remount-request-burst:63 (`.panel-grid-shell .panel-grid-card`, a card-node identity capture) and :191 (`.panel-grid-card` locator): bare `.panel-grid-card`, skeleton-satisfiable. Not converted here (they run after the viewport swap / `openDashboard`'s helper wait). Follow-up candidate.

Other files (not edited): follow-up candidate. Bare `.panel-grid-card` counts and `.first()` reads are desktop AND phone exposed, since both skeletons render that class: hel1584-motion-surfaces, hel1573-motion-grid-chart (count 3 gates), hel588, hel572, hel1575-switch-measurement, hel1575-dashboard-tabs (:132, :863 are `hasText`-filtered), hel1681 (:332, :343 `.first()` visible), hel1656, hel1094, hel1096, hel1398 and hel1444 (text-filtered). None converted in this change.
