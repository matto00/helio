## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `31b11d02a23485937f7c4a013a19121697931bab`. It is a merge commit with two parents: `c37f3fa16` (this branch) and `015a49193` (HEL-1562).
- The review base resolved live to `015a49193`.
- `origin/main` was freshly fetched and is now at `273c0b0c9` (HEL-1580 spike). `git merge-tree HEAD origin/main` reports **no conflicts**.
- **V134 is still free** on the fetched `origin/main`: its newest migration is V133.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1574/evidence/openspec/changes/shell-rail-context-list/evidence/evaluation-2/`. The cycle-1 RLS proof (`…/evaluation-1/rls-proof.txt`) still stands, because the migration and repository are unchanged.

### Gates (my own runs)

| Gate | Result |
| --- | --- |
| lint, format:check, typecheck, check:schemas, check:tokens, check:scala-quality, check:openspec, check:spec-structure, check:e2e-types, check:e2e-user-cleanup, check:e2e-evidence-paths | PASS |
| `npm test` (3 workers, nice 19) | PASS: 7215/7215 (matches the executor's claim) |
| `npm --prefix frontend run build` + `check:landing-build` (HEL-1562's gate) | PASS |
| `sbt testFull` (full suite) | PASS: 8106 succeeded, 0 failed, 4 canceled (the same pre-existing perf cancels as cycle 1) |
| **Full Playwright suite** (2 workers) | PASS: **288 passed** in 13.2 min (matches the executor's claim) |

### Phase 1: Spec Review — PASS

- **Home now points at `/home`, the app home after HEL-1562.** This covers the Home alias, the rail logo, the phone command-bar logo and the BottomNav Home tab.
  - `isActiveDestination` now keys on `destination.end`, which only the dashboards entry (`/home`) sets.
  - DESIGN.md §9/§12, design D5 and the `app-shell-rail` / `nav-section-registry` deltas were updated to match.
  - `grep` finds no remaining `to="/"`, `to: "/"` or `navigate("/")` in `frontend/src` outside tests.
- Every acceptance criterion and owner ruling still holds.
- The resolution of cycle-1 change requests 1–4 is verified live under Phase 3. Change requests 5 and 6 are verified under Phase 2.

### Phase 2: Code Review — PASS

**Merge resolution (brief point 2).**
- `CommandBar.tsx` keeps HEL-1562's `/home` link and puts it inside this branch's `isPhoneShell` guard. Its diff against `015a49193` contains only HEL-1574's own hunks.
- I mechanically checked the files both lines touched (5 e2e specs, `UserMenu.tsx`/`.test.tsx`, `BottomNav.test.tsx`, `store.ts`): every line HEL-1562 added is still present (0 missing).
- No HEL-1562-only file was modified by the merge.
- The two guard-test file counts were reconciled correctly to 135 (133 from HEL-1562, minus `SidebarBody.css`, plus 3 new stylesheets).

**Change requests 5 and 6.**
- `UserPreferenceRepository.scala` now imports `scala.util.Try` at the top of the file, so there is no inline FQN.
- `UserPreferencesRoutes.scala` now logs the exception on failure (HEL-311 pattern) and does not echo it in the response.

**Change requests 1–3 in code, with tests added.**
- `ScheduledContextList.tsx`:
  - At most one row is current per list: Scheduled wins, otherwise Recent.
  - Recent rows are filtered and named from the loaded collection, with the recorded title as a fallback until the collection loads, and never a raw id.
- `contextListLayout.ts` adds a one-shot focus hand-off (`requestListFocus`/`takeListFocus`). `useContextListLayout.setCollapsed` sets it, and the mounting control takes focus through its ref.
- New tests:
  - Focus moves in both directions, including after Enter on the separator.
  - No focus is stolen on first render.
  - Exactly one current row when the open item is both recent and scheduled.
  - A deleted pipeline or source is dropped from Recent.

### Phase 3: UI Review — PASS

All checks below were done in the running app (owner-tier eval user, both themes) at 1280px and 375px.

1. **Change request 1: one active row.** On `/pipelines/<scheduled>` and `/sources/<scheduled source>`, where the item is both recent and scheduled, only the Scheduled row carries `aria-current="page"`. The rail's own item carries it separately. Evidence: `source-detail-1280-light-single-active.png`.
2. **Change request 2: deleted items leave Recent.**
   - After deleting `C2 Pipe Del` from its detail page, the Pipelines Recent group shows only `C2 Pipe Sched`.
   - After deleting `C2 Source Free`, the Sources Recent group no longer lists it, including after a full page reload.
   - No raw ids appeared.
3. **Change request 3: real keyboard focus.** I focused the separator and pressed the real Enter key each time.
   - Collapse: focus moved to "Expand list" (`:focus-visible` true).
   - Enter again expanded the list, and focus moved to "Collapse list" (`:focus-visible` true).
   - Enter again collapsed it, and focus moved back to "Expand list".
4. **Brief point 3: never lands on the marketing `/`.**
   - Rail logo href is `/home`, rail Home is `/home`, BottomNav Home is `/home`, and the phone command-bar logo is `/home`.
   - Clicking rail Home from `/pipelines` → `/home`. Clicking the rail logo from `/connectors` → `/home`. Tapping the phone Home tab from `/pipelines` → `/home` (`phone-375-light-home.png`).
   - No `<a href="/">` exists in the signed-in shell.
5. **Brief point 4: exactly one active item at `/home`.**
   - Rail (1280px): `aria-current` and the active class are on Dashboards only.
   - BottomNav (375px, owner, 7 tabs): `aria-current` and the active class are on Dashboards only. Home is not marked active. The tabs are 48px each, with no overflow.

Delete from the detail pages still works for pipelines and sources, as in cycle 1.

**Rate-limit 429s.** One burst of about 12 full page loads within a minute hit the existing per-user 429 rate limit (`RATE_LIMIT_REQUESTS_PER_WINDOW`, 120 per minute). That is my test cadence, not a regression I could attribute to this branch, and the app showed its error state ("Couldn't load sources", Retry) gracefully. No other console errors appeared beyond the expected 404 (no schedule).

### Overall: PASS

### Non-blocking Suggestions
- Carried from cycle 1, still open, all minor:
  - Stale `--app-surface` / `rgb(26,24,22)` backdrop comments in `DashboardList.css`.
  - The toggle on a saved-collapsed folder that holds the active dashboard does nothing.
  - "Loading…" and plain-`<p>` empty states in the Scheduled group (DESIGN §7 is [judgment]; the skeptic's call).
  - `as unknown as` casts in `pipelineScheduleListService.ts`.
  - No selftest case for `splitTopLevelCommas`.
- `evaluation-1.md` and its evidence files were committed into the change directory by the merge commit. That is fine for the archive, but `rls.sql` and the other evidence files under `evidence/` will ship with the change archive.
- `pendingFocus` in `contextListLayout.ts` is module-level state. It is only ever set from controls that exist alongside their counterpart, so it cannot leak today, but a comment saying so would help future callers.
