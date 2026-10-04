## Orchestrator report — Delivery CI failure (PR #756, head a0a64ddd)

Overall: FAIL (change requests below; cycle 2)

CI run 37243460676, job `e2e` failed, so `ci-complete` failed too. Two tests failed in
`e2e/hel1023-breakpoint-layout-derivation.spec.ts:377`, "<state>: no overlap, inside the container, no PATCH on view, at
every width":
- `C_lg_coords_everywhere light @1500 (md) reading order` — P3 Chart moved ahead of P1/P2.
- `D_md_overlap light @400 (stack)` — P1/P2 order swapped.

Orchestrator's diagnosis (a CLAIM to verify; probe it before you fix anything):
1. The spec first PATCHes a VALID layout to the server.
2. `injectStoredLayout` then rewrites the GET response so the client sees a stored-bad layout the server does not hold.
3. As the owner, the client sends the HEL-1233 repair POST. The server finds its stored breakpoint already valid,
   returns a 200 no-op with its stored dashboard, and `repairDashboardLayout.fulfilled` adopts that server truth.
4. The displayed layout therefore stops being the render-time resolution of the injected layout that the test asserts.

Change requests:
1. Confirm the root cause with a probe, for example by capturing the repair POST and its response in that spec.
2. Keep the HEL-1023 e2e meaningful: it tests render-time repair of a layout the server never stored. Make that
   explicit, for example by having the spec `page.route` the `/layout/repair` POST to an abort/4xx or a
   documented stub, so the repair path is inert, and by explaining in a comment why.
   - Do NOT weaken its assertions.
   - If the probe shows a different cause, fix the real cause instead.
3. Grep every other `e2e/*.spec.ts` that injects or rewrites dashboard layouts in a GET (e.g. hel1028, hel1230), or
   that asserts the exact request set on dashboard open. Fix any that the owner repair POST would perturb. The repo-root
   `e2e/` suite was missed at design time; list what you checked.
4. Run the affected e2e specs locally on this worktree's servers and record the output.
   - DEV_PORT must be 6675, NOT 6665 (6665 is a Chromium unsafe port). Use backend 9572.
   - Check `playwright.config.ts` for how `DEV_PORT` is read.
   - Record a red (the spec without your fix) and a green.
5. Commit on top of the branch (do not re-squash). The change is already archived under
   `openspec/changes/archive/2026-10-04-repair-stored-bad-layout-breakpoints/`. Note any change there, and append to
   `files-modified.md` if you recreate it.
