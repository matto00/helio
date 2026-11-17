## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD d60b1f799d78291e165bcc1226b4a3c625c66fa0 (= origin/main). Change dir is untracked (planning artifacts only).

### What I verified (with evidence)

- Spawn-cwd guard: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/panel-card-skeleton-reads/HEL-1723`.
- Hit count: `git grep -n "panel-grid-card" HEAD -- e2e | wc -l` = 72; `git grep -c` lists 20 files. Matches design.md. No hit in `hel1685-draft-polish.spec.ts`.
- hel1575-dashboard-tabs hits are at :132, :196, :896 as claimed; HEL-1644 (d60b1f799) touched that file (35 lines).
- hel1681 :332 and :343 are bare `.panel-grid-card.first()).toBeVisible()` reads, both in 1280 px (desktop) tests.
- hel1028:310 is `.panel-grid-card__handle` count 0 straight after `goto` at 430 px; :311 is `.react-grid-item` count 0. Seed creates 2 markdown panels (:39 loop), so `waitForPanelStack(page, 2)` is the right anchor.
- Skeleton classes: `PanelCardSkeleton.tsx:14` is `div.panel-grid-card` (aria-hidden) with `__top`, `__title-area`, `__body-skeleton`, `__footer`; `MobilePanelStackSkeleton.tsx:41` is `div.panel-grid-card.mobile-panel-stack__item` with `mobile-panel-stack__header` + `__body-skeleton`. `PanelGridSkeleton.tsx:30` is `.panel-grid-shell[aria-label="Loading panels"]`. `Skeleton.tsx` renders an empty aria-hidden `<span>` (no text). No stub carries `__handle` or `__title`. All design claims hold.
- Real cards: `PanelCard.tsx:188-189` `article.panel-grid-card`; `MobilePanelStack.tsx:256-257` `article.panel-grid-card.mobile-panel-stack__item` with `h3.panel-grid-card__title`; handle only in `PanelCardHeader.tsx:179` (desktop card). So the D3 mutation (handle span added to the real phone card) is a genuine way to make the new assertion fail, and the old spec should pass it vacuously.
- `e2e/support/panelGridReady.ts` exports `LIVE_GRID_ITEMS`, `waitForPanelGrid`, `LIVE_STACK_ITEMS`, `waitForPanelStack` as claimed.
- AC coverage: AC1 -> tasks 1.1, 1.2, 2.1-2.4 with D2 verdict taxonomy; AC2 -> tasks 3.1, 3.2 with D3. No scope drift; no API/schema contract affected (`skip_specs: true` is right).
- `playwright.config.ts:8-18`: `DEV_PORT` unset falls back to 5173 with only a console warning; `baseURL` is `http://localhost:${DEV_PORT}` (:184). The worktree's pinned ports are DEV_PORT 7155 / BACKEND_PORT 10062 (workflow-state.md).

### Verdict: REFUTE

### Change Requests

1. **design.md D5 / tasks.md 4.1 prescribe a run command that targets the wrong server.** `nice -n 19 npx playwright test <files> ...` has no `DEV_PORT`, so `playwright.config.ts:8` falls back to `localhost:5173`. That is the main checkout's or another lane's dev server (CON-165), not this worktree's 7155. This matters most for D3: the red-first mutation proof would run against a server that never loaded the mutated `MobilePanelStack.tsx`. A "RED" would then be meaningless and a "GREEN" would hide the vacuity. Revise D5 and task 4.1 to pin the run explicitly: `DEV_PORT=7155 BACKEND_PORT=10062 nice -n 19 npx playwright test ...`, or the workflow-state values by name. Also require each transcript in `sweep.md` / `mutation-hel1028.md` to show that the `[playwright.config] DEV_PORT is unset` warning is absent. For D3, also require recorded evidence that the dev server served the mutated module, for example a mutated-run failure message showing a handle count of 2. A count-0 failure that never reached the wait does not qualify.
2. **tasks.md ends with an empty `## Standing Constraints` heading.** Either fill it with the lane's standing constraints (hel1685 not edited; hel1681 only at :332/:343; mutation reverted before commit; no `.env` reads; quoted heredocs only) or remove it. An empty section is a placeholder.

### Non-blocking notes

- D4 says "or `waitForPanelStack` if the viewport is phone". Both hel1681 hits are in 1280 px tests, so only the desktop path (`LIVE_GRID_ITEMS` scope or `waitForPanelGrid`) applies. Tightening the wording would remove a branch the executor could misread.
- D2 "OK-settled" requires a "positive real-content anchor" before `Loading panels` = 0. HEL-1633's own sweep (archive sweep.md:111) accepted hel1028 `openDashboard`'s pattern, where the anchor is a `.react-grid-item` count that the skeleton can satisfy. That pattern is sound, because a mounted skeleton proves loading started. Say explicitly whether it qualifies, so the classification stays consistent with HEL-1633's sweep.
- D3 cites "the seed creates the panels at :40"; the loop is at :39. Trivial.
- hel1681:330-331 (`.mobile-panel-stack` count 0 right after goto) is equally vacuous, because it runs before any anchor and stays so after the :332 conversion. It is not a `.panel-grid-card` hit, so it is correctly out of scope. Leave it as is given the HEL-1692 overlap; it could be a follow-up.
