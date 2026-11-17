## Context

See proposal.md (Why). The desktop grid (`frontend/src/features/panels/ui/grid/DesktopPanelGrid.tsx:184-205`) uses
the v2 `Responsive` API with `dragConfig={{ enabled: isEditingLayout, handle: ".panel-grid-card__handle" }}`,
`compactor={{ ...noCompactor, preventCollision: true }}`, `positionStrategy` = `createScaledStrategy(zoomLevel)`
only when zoom != 1 (else `undefined`), and drag/resize callbacks from `useGridLayoutInteraction.ts`.
The lockfile pins `react-grid-layout` 2.2.4 (`package.json` `^2.2.2`); 2.3.0 is the only newer release (published
2026-10-05) and moves `react-resizable` from `^3.1.3` to `^3.2.0`. hel1573:275 drives the drag with Playwright
`page.mouse`: `move` to the handle centre, `down`, `move(+40,+10, steps:4)` immediately, then three further moves of
6 steps with 60ms waits, and asserts `|moved - dx| < 30` at dx=120/260/420 (spec :320-327).

Playwright's `page.mouse` dispatches trusted CDP input events, so "synthetic" here means the *timing* of the
sequence (no rendered frame between `down` and the first moves), not untrusted events. That is exactly the window
2.3.0's #2291/#2292 ("end drag when mouseup arrives before drag start renders") touches, so it is the lead suspect,
but it is unproven until bisected.

## Goals / Non-Goals

**Goals:** a bisected, reproducible cause; a decision grounded in that cause plus a running-app check; hel1573:275
20/20 at 2 workers on the shipped version. **Non-Goals:** upstream filing; PR #926; resize/mobile changes beyond the
fix; grid refactors.

## Decisions

**D0. Install hygiene (applies to every measurement).** Every measurement records, in its log line,
`node -p "require('react-grid-layout/package.json').version"` and the resolved `react-resizable` version (run in
`frontend/`; MISTAKES.md "node_modules does not update itself"). Any experiment that edits `frontend/package.json`,
`package-lock.json` or adds `overrides` is undone with `git checkout -- frontend/package.json frontend/package-lock.json`
(then `git status` must show neither file modified) followed by `npm ci`, and the restored versions are re-recorded.
Between installs: `stop-servers.sh`, `rm -rf frontend/node_modules/.vite`, `start-servers.sh` (Vite pre-bundles deps
and its cache is not keyed on a package's `dist/` contents).

**D1. Red first, on this tree.** Measure hel1573:275 `--repeat-each 20 --workers 2` on (a) this branch as-is (2.2.4)
and (b) this branch with only `npm install react-grid-layout@2.3.0` in `frontend/`. Record both counts. If (b) is not
red, stop and escalate (premise refuted). Optional cheap narrowing first: diff the two published `dist/` trees already
unpacked in `.concertino/scratch/HEL-1728/pkgs/` and list the drag-path hunks as suspects (not a substitute for D3).

**D2. Isolate react-resizable (cheap).** Re-run (b) with `react-resizable` forced to 3.1.3 via a temporary
`overrides` entry (undone per D0). Green -> cause is react-resizable; bisect its 3.1.3..3.2.0 range instead with the
same D3 procedure. Red -> RGL. A crash/throw (2.3.0 may need 3.2-only API) is "inconclusive", recorded, and the
bisect proceeds on RGL. **The bisect base install is fixed for the whole bisect: the 2.3.0 install from (b) with its
react-resizable 3.2.x**, so only RGL's `dist/` varies between steps.

**D3. Bisect upstream RGL serially, in scratch.** Clone the repo named by the tarball's `repository.url`
(`STRML/react-grid-layout`, redirect accepted) into `.concertino/scratch/HEL-1728/rgl`; confirm both the `2.2.4` and
`2.3.0` tags exist (else use the release commits and say so). Build with its own `npm ci` + `make build` (prepare-hook
side effects stay in scratch). Every step, in this order: `stop-servers.sh`; `rm -rf frontend/node_modules/.vite`;
`rm -rf frontend/node_modules/react-grid-layout/dist` then copy the step's built `dist/` in (no stale hashed chunks);
`start-servers.sh`; **prove which build is served** by fetching the served pre-bundled module
(`/node_modules/.vite/deps/react-grid-layout*.js` from the dev server) and recording its sha256 plus a grep for a
commit-distinguishing string, in `bisect-log.md`; then run hel1573:275 `--repeat-each 3 --workers 2`.
Endpoint check (task 2.1) uses this exact procedure on the same base install and must show the 2.2.4 build green and
the 2.3.0 build red before any midpoint is trusted; also diff the built 2.3.0 `dist/*.mjs` against the tarball's
after normalizing chunk hashes. **Verdict rule:** good = 3/3 pass; bad = any run failing at the tracking assertion
(`item tracks the pointer`) — the 2.3.0 red is deterministic, so a flaky midpoint is a signal; a build that fails, a
crash, a resolve error (a midpoint's chunk/entry names not matching the base install's `exports`), or failure at
any other assertion = `git bisect skip` with a note. Log every step (commit, served sha256,
versions, counts, verdict). Restore per D0 afterwards and confirm the baseline (2.2.4) is green with `--repeat-each 3`.

**D4. Timing sweep decides "test vs library".** On 2.3.0 in the running app (headless Chromium is fine; CDP
`Input.dispatchMouseEvent` is trusted input either way — evidence states it stands in for a physical mouse), drag a
panel by its handle with a delay between `down` and the first move of {0, 8, 16, 33, 100} ms, subsequent moves at 8ms
intervals (a 125Hz mouse) over ~1s and ~400px, 5 repetitions per delay, measuring `|moved - dx|` at the end. Record
per-delay pass counts and the smallest delay that tracks 5/5. Also resize via the SE handle at 0 and 16ms. **Control row:** the test's exact sequence (down; no-wait
`move(+40,+10,{steps:4})`; back-to-back `steps:6` moves with 60ms waits), 5 reps. The sweep is a scratch spec run
through the repo's Playwright config against the pinned `DEV_PORT` (never a bare `npx playwright` with ambient
defaults, CON-165); the script is persisted with the evidence. Screenshots in light and dark. Write
`running-app-check.md`.

**D5. Library vs our config, measured.** Run the same pointer sequence and the D4 sweep against a **minimal page with
no app code**: a bare `Responsive` grid with `dragConfig={{ handle }}` in a scratch Vite page (or upstream's own dev
example) at the bisected commit and its parent. Minimal page reproduces -> library. Only the app reproduces -> our
usage: toggle our differences one at a time (`preventCollision` compactor, `positionStrategy`, drag callbacks,
re-render pattern) to name the trigger. Record in `minimal-repro.md`.

**D6. Choose the fix (decision table; anything outside it is an ESCALATION).**
- **Control row tracks 5/5 on 2.3.0** -> the sweep does not reproduce the red: ESCALATION (never fall through).
- **Adapt test** — allowed ONLY when every D4 delay >= 8ms tracks 5/5, failures are confined to the 0ms row and/or
  the control row, and the control row fails (proving the sweep reproduces the red). Then bump to `^2.3.0` and make
  hel1573:275 wait for drag start before the tracked moves (one `requestAnimationFrame` round-trip via `page.evaluate`,
  or the `react-draggable-dragging` class only after confirming 2.3.0 still applies it), with a comment naming the
  upstream commit; never weaken `< 30` or `transition: none`.
- Otherwise it is a user-visible regression:
  - **Adapt app** if D5 named an app-side trigger and a small local change (one component/hook, no fork or patch of
    the library) makes the whole D4 sweep track 5/5 on 2.3.0: bump to `^2.3.0` (package.json + lockfile), make that
    change with a comment naming the upstream commit.
  - **Pin + upstream draft** if the D5 minimal page reproduces (library regression): keep 2.2.4, add
    `- dependency-name: "react-grid-layout"` / `versions: [">=2.3.0"]` with a `HEL-1728` reason comment to the
    `/frontend` npm block's `ignore:` in `.github/dependabot.yml` next to the HEL-1725 rules, and write
    `upstream-issue-draft.md` (title, the D5 minimal repro, bisected commit, D4 sweep table) into
    `.concertino/runs/HEL-1728/evidence/` via `persist-evidence.sh`.
  - **Pin, no upstream draft** if D5 named an app-side trigger but no small local change fixes it: same ignore rule,
    whose reason comment names the app-side trigger; no upstream draft (it is not shown to be a library bug).
  - D5 reproduces in neither the minimal page nor via any toggled app difference -> ESCALATION.

**D7. Green proof on the shipped version.** hel1573:275 `--repeat-each 20 --workers 2` 20/20 on the final tree, plus
`hel1230-drag-then-create-persists` and `hel908-trunk-reorder-drag` once each, with versions recorded per D0. On an
Adapt path also frontend typecheck, lint and jest (maxWorkers 3), and desktop drag/resize in the running app in light
and dark.

## Risks / Trade-offs

- [Upstream build differs from the published tarball] -> diff the bisect's `2.3.0` build output against the npm
  tarball's `dist/` behavior by confirming the `2.3.0` endpoint reproduces the red before trusting midpoints.
- [Bisect commits that do not build] -> `git bisect skip`, recorded in the log.
- [Pinning blocks future fixes] -> the ignore rule's comment names HEL-1728 and the upstream draft, so it is removed
  when upstream fixes it.
- [Shared dev DB residue from e2e] -> registerAndLogin isolates users; delete any residue by exact id (C13).

## Planner Notes

- Self-approved: no new runtime dependency is introduced on any path (the bump is an existing dependency's minor).
- No `.husky/**` or pre-commit-invoked script is touched; no gate-chain checklist needed.
- `skip_specs: true`: behavior is unchanged (panel drag keeps tracking the pointer).
