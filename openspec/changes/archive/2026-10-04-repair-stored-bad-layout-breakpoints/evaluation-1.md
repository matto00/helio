## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD 7de432103196a4941c46c9f9a29f658d640d407d.

### Phase 1: Spec Review — PASS
Issues: none. AC1-7 map to implemented code and tests (owner-only server-side 403/404, compare-and-set write
without lastUpdated bump, class-4 store write with no history/pending, import self-reflow, seam fixture both halves).
Deviations judged:
- `Dashboard.ownerId` optional on the TS type: acceptable. Absent resolves to `null`, which never equals the signed-in
  user id (hook short-circuits on `ownerId !== currentUserId`), so absent = non-owner (fail closed); server re-checks.
- No dedicated >200-panel test: design D4 asked for it as "pinned by a test". The behaviour is covered in substance
  (server 400 on a dropped live panel is tested; the client rejected-repair-no-retry/no-toast path is tested), so I
  treat it as non-blocking.
- ExistenceNotLeakedRoutesSpec pin bump 4 -> 5: legitimate (new Forbidden producer, new Row added for the route).

Vacuity review of the Scala cases lacking a recorded red: none found vacuous. "ignore-valid" would write the supplied
lg without D2 step 2 (stored lg valid, replacement differs, asserted unchanged); "second-call no-op" uses a different
valid xs that would overwrite without the step-2 filter; "stale entry"/"added panel" seed an overlapping stored xs
(deleted-panel at 0,0) so the breakpoint is genuinely stored-bad and the asserted ids differ from the stored ones;
"404 stranger" is seeded owned by another user on the RLS-enforced pool; "reordered-key CAS" asserts the write landed
(x changed) so a CAS mismatch would 409. 409 / rename-survives / RLS (a)(b)(c) have recorded reds or live in the RLS spec.

### Phase 2: Code Review — PASS
Own fresh gate runs in WORKTREE_PATH: `npm run lint` clean; `npm run format:check` clean; `npm run typecheck` clean;
`npm --prefix frontend run build` ok; `npm test` 415 suites / 4319 tests passed; `sbt testFull` 388 suites,
5620 tests, 0 failed (7m09s); `sbt --client shutdown` run separately. No flakes hit.
Code: small units, no inline FQNs, no dead code, ownership decided server-side, failure path silent/logged only.

### Phase 3: UI Review — PASS
Frontend served on UI_DEV_PORT=6675 (6665 is a Chromium unsafe port), backend 9572, via start-servers.sh. Seeded by raw
SQL: dashboard `hel1233-eval-dash` (owner matt@helio.dev), panels `hel1233-p1/p2` (dividers), lg valid, md/sm/xs overlapping.
- Owner, DARK: opened the board; network showed exactly one `POST /api/dashboards/hel1233-eval-dash/layout/repair` => 200,
  no PATCH; no "Unsaved changes" text. DB after: md/sm/xs repaired (p2 moved to y=2), lg byte-identical,
  last_updated unchanged (2025-12-31 16:00:00-08).
- Owner reopen (fresh load): no repair request, no PATCH; DB unchanged.
- Owner, LIGHT (DB reset to seed, XHR hook installed, client-side open): exactly one POST, body captured:
  `{"md":[...],"sm":[...],"xs":[...]}` -- only the bad breakpoints, no lg. No PATCH, Undo/Redo both disabled
  (no history entry), no "Unsaved changes". DB repaired as above, last_updated unchanged. Displayed panel rects
  (992x122 at y=72 and y=212) identical to the dark run; screenshot shows the two panels stacked without overlap.
- Non-owner, viewer grantee, logged in: authenticated `/dashboards/:id` => "Dashboard not found" (list owned-only), no write.
  Public path `/dashboards/:id/panels` without token => "This link isn't available".
- Non-owner via share token (viewer logged in), LIGHT and DARK: only GET .../panels?token=..., no repair/PATCH/POST;
  DB byte-identical to seed (diff against pre-capture).
Not separately captured: POST body in the dark run (same code path as light); dark reopen done on owner only.

Residue deleted by exact id (counts verified 0): dashboards `hel1233-eval-dash`; panels `hel1233-p1`, `hel1233-p2`;
share_tokens `3b41de75-9fb4-4d34-bf32-4bf83545c4ad`; viewer grant; user_sessions and users row
`b170c5e0-6efd-489a-811d-6df64f47e0f7` (hel1233-eval-viewer@example.test). Earlier attempt's user
`fddc1529-0601-4d65-8d59-874af893038f` also already deleted. Scratch seed/reset/layout/before files removed; servers
on 6675/9572 stopped. (Browser localStorage `helio-theme` left at dark.)

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- Add the design-promised >200-panel client test.
