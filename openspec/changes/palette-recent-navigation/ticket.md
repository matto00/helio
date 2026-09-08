# HEL-519: Recent / frequent navigation in the command palette

## Description

When the command palette opens with an empty query it currently shows a static default list. A more useful default is the user's recently and frequently visited resources, so the common "jump back to where I was" case is one keystroke.

## Premise corrections (Setup, CON-136 — verdict `material-drift`, owner-ruled `proceed-with-restated-scope`)

The ticket's enumeration was invalidated against the live tree. **All of the following are binding.**

1. **SCOPE IS THREE KINDS: dashboard, source, pipeline.** Not five.
   - **`type` is DROPPED as a CORRECTION, not a scope reduction.** It is a dead resource kind — retired by the HEL-903/904 pipelines-and-outputs remodel; `/api/types` 404s and zero references remain in frontend or backend. Removing a reference to something that does not exist required no ruling.
   - **`panel` is DEFERRED to HEL-1038**, deliberately and by owner ruling — **not** because it is hard, but because recording panel visits requires **infrastructure that does not exist**: a selected-panel concept in `panelsSlice` (which holds only `panelCreationModalOpen`) AND a global panel registry to give pruning a source of truth. A panel opens inside a dashboard canvas with **no route change, no URL id, and no Redux action**, so it is unobservable by any central seam. Building that would silently decide that panels should have selection state — an owner call. Do NOT absorb it.

2. **THERE IS NO CENTRAL SEAM. Instrument each kind explicitly, at three obvious call sites.** The kinds genuinely differ:
   - **dashboards** — Redux-selected via `setSelectedDashboardId` (`dashboardsSlice.ts:201`); **the URL carries no dashboard id at all** (route is `/`).
   - **sources / pipelines** — route-param-driven only (`usePickerSelection.ts:75-76` derives from `pathname.split("/")[2]`); no selection action exists.
   A `listenerMiddleware` exists (`store/store.ts:19,60`) but **only observes the dashboards case**. **Do NOT build a clever abstraction that pretends the three are uniform.** An abstraction here would hide which kinds are actually wired; three obvious call sites are auditable, one seam covering two of three kinds is a silent gap shaped like completeness. Say in `design.md` that they were instrumented separately and why.

3. **`ThemeProvider` is NOT the precedent the ticket claims.** `theme.ts:65-73` guards SSR and validates on read, but `ThemeProvider.tsx:73-77` has **no try/catch on write**, and theme values are **raw strings — there is no JSON precedent**. A structured MRU needs `JSON.parse`/`stringify` safety the stated model does not supply, plus a correct empty render on every failure path (absent, malformed, quota-exceeded, private window, cleared data, another device). Say this explicitly in `design.md`.

4. **Pruning must never run against an unresolved slice.** `state.sources.items` and `state.pipelines.items` load **lazily**, not at boot, so a naive prune at palette-open would delete valid entries before the fetch resolves. **An MRU that quietly deletes your history on a cold load is worse than one that shows a stale entry.**

5. **The sequencing is BACKWARDS in the ticket text.** HEL-519 says it reuses HEL-503's navigation helpers; HEL-503 is scheduled AFTER this ticket and no `navigate-to-resource-by-kind+id` helper exists. **HEL-519 authors that interface and HEL-503 inherits it.** Design it as the interface it will become — **the dashboards branch, which changes no URL, is the hardest corner and must be designed FIRST**, with sources/pipelines fitting the shape it requires. Do not design for the two easy kinds and bolt dashboards on. Write a note into HEL-503 recording that HEL-519 owns it and where it lives.

## Acceptance criteria

* Opening the palette with an empty query shows recent resources; selecting one navigates correctly.
* History persists across reloads, is capped, updates on navigation from **every** entry point, and drops stale/deleted resources.
* **Recording must be proven to actually fire, for every kind, on every path into it** — including arriving by direct URL, by browser back/forward, and via the palette itself. **A recents feature that records nothing is indistinguishable from one with an empty history.** A fixture-fed list proves ordering logic and nothing about whether the app observes the events.
* Empty history falls back to the static default list; no crash on first run, on malformed storage, or when storage is unavailable.
* Rows use tokens + `.eyebrow` section labels; correct in light/dark.
* Unit tests for the recency/frequency store + pruning; `npm run lint` / `npm test` pass, zero new warnings.

## Out of scope

* Server-side/cross-device history.
* Search ranking changes (HEL-503).
* **Panel recents — HEL-1038** (verified live and open at filing; re-verify before the PR).

## Motion guard (HEL-441, just merged — read before writing CSS)

`frontend/src/theme/motionTokenGuard.css.test.ts` **fails the build** on any literal duration in a `transition:`/`animation:` declaration outside its allowlist. Any recents-list reveal/reorder/hover animation must use `var(--app-transition)` (0.16s) or `var(--transition-slow)` (0.28s). No new literal, no ad hoc token.

## Evidence discipline (binding on executor, evaluator, skeptic)

1. **A green gate is not evidence until you check what it scans.** Root `npm test` is `jest --passWithNoTests && npm --prefix frontend test` — in a worktree root jest finds zero tests and turns silence into a pass. **Run gates from `frontend/`.**
2. **Hand-built fixtures find nothing; real data finds real defects.** Especially here: verify against genuine navigation history, not seeded fixtures.
3. **jsdom proves nothing about focus, visibility, or computed style** (HEL-1005). Prove behavior in a real browser.
4. **A deferral is only real if it names a task that exists and a ticket that owns it.**
5. **"No wire impact" != "no downstream impact"** — HEL-503 inherits the dispatcher authored here.

**CONTENT SELF-AUTHENTICATION before any visual observation.** Playwright can silently land on another lane's dev server (Vite auto-increments when a port is taken, so the collision is symmetric — either lane can land on the other's). A port or URL check is not sufficient; it does not survive proxying, redirects, or a stale tab. **`curl` this branch's dev server (5951) for a string that exists ONLY on this branch and confirm it is served.** This matters acutely here: recents are **per-user state**, so another lane's palette would show another lane's recents and look exactly like a working feature — and an empty or wrong list is indistinguishable from a bug in our own code.

**Two-axes question for this ticket:** what does no source text carry (i.e. what can no grep or static check see), and what path did the gates not exercise?

**For every guard, state what it PROVES and what it CANNOT.** A guard must be failable by mutation; a check that structurally cannot fail must not be added — say so instead.

**Screenshots go to `.concertino/runs/HEL-519/evidence/` ONLY** — never `openspec/**`, never `git add -f`.

## Binding standards

`CONTRIBUTING.md`, `DESIGN.md` (frontend work), `.concertino/laws/`.
