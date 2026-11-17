# Sweep of e2e/hel1681-refresh-control.spec.ts (design D5), line numbers as of the fixed file's pre-edit state

| Hit | Verdict | Reason |
| --- | --- | --- |
| openDashboard `.mobile-panel-stack` count 1 / `--output` count 3 | FIX | counted the skeleton layer too; now `waitForPanelStack(page, 4)` + `LIVE_STACK_ITEMS--output` x3 |
| openDashboard spinner count 0 | FIX (root cause of :129/:164) | passes with loads in flight; now also waits for all rows GETs to finish + 2 frames |
| `toHaveCSS("transform","none")` on `.mobile-panel-stack` (tap test) | SAFE | runs after `openDashboard`'s `waitForPanelStack`, so the skeleton stack is gone (a strict-mode double match is impossible) |
| shift test sampler `querySelector(".mobile-panel-stack")` + `querySelectorAll(".mobile-panel-stack__item").length >= 3` | FIX (hardening, not a reported flake) | during the fade both stacks are in the DOM; the skeleton's comes first and its stubs satisfy the `>= 3`. Now samples the stack that contains a `LIVE_STACK_ITEMS` item |
| "none" test `--markdown` count 1 | SAFE | skeleton stubs are `--metric`, never `--markdown` |
| Full-motion `.mobile-panel-stack__item` `.first().boundingBox()` | FIX | now `LIVE_STACK_ITEMS`, null box throws a clear error |
| 1280 test `.mobile-panel-stack` count 0 | FIX | moved after `waitForPanelGrid(page, 3)`; mutation proof in the report |
| crossing test `.mobile-panel-stack` count 1 (after `setViewportSize` 375) | SAFE | positive count anchor after `waitForPanelGrid(3)`; the stack is the only thing that can satisfy count 1 once the desktop grid is mounted |
| crossing test `.mobile-panel-stack` count 0 (back to 1280) | SAFE | preceded by the count-1 assertion above, so it asserts a real 1 -> 0 transition, not an unmounted page |
| `document.querySelectorAll(...)` elsewhere | none | only the sampler above |
