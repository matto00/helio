## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: HEAD 84d8913e7db234bc0b38d09bc23a6b292ec19f0a (= origin/main; change dir untracked). Spawn-cwd guard: READY.

### What I verified (with evidence)

- **Ticket claims vs source.** `DashboardRepository.update` (:164-175) writes `(name, last_updated, appearance, layout)`
  from a caller-built `Dashboard` with no WHERE beyond id: confirmed. Callers: `DashboardWrites.writeUpdate` (:80, :92)
  and `AutoLayoutService.applyAutoLayout` (:99), confirmed by grep (no other callers). `updateLayoutIfUnchanged`
  (:190-201) is layout-equality CAS: confirmed. `PanelLayoutPlacement.insertAndAppend` (:47) takes `FOR UPDATE` on the
  dashboard row before the panel insert and writes only `(layout, last_updated)`: confirmed. HEL-1485 deferral comment
  in `AutoLayoutService.scala:85-89`: confirmed.
- **Design claim "DashboardContentsOps already avoids the lost update" is false.** `replaceContents`
  (`DashboardContentsOps.scala:55-72`) reads the row with a plain SELECT (no lock) and, when `layout` is None, writes
  `existingDash.layout` back. A layout write committed between that read and its UPDATE is overwritten. It is
  layout-only (does not clobber name), which is all it avoids. Out of the ticket's scope, but the Context paragraph
  should not claim it (see note).
- **(1) Trigger vs V122 / RLS.** V122 (`hel1456_strip_deleted_panel_layout_items`) is SECURITY DEFINER, owned by
  `helio_privileged`, `row_security = off`, and its `UPDATE dashboards ... WHERE d.layout IS DISTINCT FROM
  r.new_layout` fires row-level BEFORE UPDATE triggers on `dashboards`, so a `WHEN (NEW.layout IS DISTINCT FROM
  OLD.layout)` bump trigger WILL bump on a strip, and will not on a no-op strip. A BEFORE trigger that only assigns
  `NEW.layout_version` touches no table, so RLS/FORCE RLS does not apply to it; EXECUTE is PUBLIC by default and no
  migration revokes function EXECUTE (V38's ALTER DEFAULT PRIVILEGES only grants table/sequence privileges). No other
  trigger exists on `dashboards` (grep of migrations for `ON dashboards` + TRIGGER: only V122's body). `layout` is
  jsonb (V33:27), so `IS DISTINCT FROM` is semantic equality. Lock interaction: the CAS UPDATE takes FOR NO KEY UPDATE
  on the dashboard row, same as today's `update`; it does not conflict with the panel FK's KEY SHARE, and under READ
  COMMITTED a CAS blocked behind a placement/strip re-evaluates `layout_version = ?` against the committed row
  (EvalPlanQual) and matches 0 rows. Sound. No `session_replication_role` use in backend code.
- **Server-side version monotonicity.** The trigger only increments; no `insertOrUpdate` on dashboards; so a client
  token can only be <= the stored version, and a server read inside the request is always >= the token the client
  sent before the request. CAS on the client's token is therefore safe even though the server composes the unsent
  breakpoints from its own (possibly newer) read: if read > token, the CAS fails. Sound.
- **(2) Client version pairing (D7) — REFUTED, see CR1.** Read `useLayoutSave.ts` in full and the reducers in
  `dashboardsSlice.ts:336-360`. `updateDashboardLayout.fulfilled` and `repairDashboardLayout.fulfilled` keep a newer
  local layout BY REFERENCE and adopt every other field of the payload (`{ ...action.payload, layout:
  dashboard.layout }`), and `persistLayout`'s `.then` (:203-212) sets `persistedLayoutRef` to the RESPONSE layout
  while `latestLayoutRef` keeps the local edit. In the plain (no-409) path this is safe only because the response
  layout equals base+patch exactly (CAS guarantees it), so the local edit was derived from it. D7's rebase-and-retry
  breaks that invariant: the retry's response is the REBASED layout (contains the other writer's items), which the
  local in-flight edit was never derived from. Concrete trace:
    1. Tab at V0, user drags (L1), flush sends lg with V0. An agent created panel P at V1 meanwhile.
    2. While the 409 -> refetch -> rebase -> retry round trip runs, the user drags again (L2, derived from L1, no P).
    3. Retry succeeds at V2 (lg includes P). Reducer: store != sentLayout, so local L2 is kept by reference.
       `.then`: persisted := rebased layout (has P), version := V2.
    4. Next flush: `buildLayoutPatch(L2, rebased)` -> lg differs -> sends L2.lg (no P) with V2 -> CAS passes ->
       P's lg item is dropped. That is the exact lost update this ticket exists to close, reintroduced, and it
       contradicts the change's own spec line "send the version of the server layout its unsaved changes were made
       against".
  The same mechanism makes the store's `layoutVersion` run ahead of the store's layout whenever a keep-local-by-
  reference branch fires (both reducers above), and the hook's mount-time `useRef(layout)` baseline reads the store,
  so D7's "set exactly where persistedLayoutRef is set from server data" is not achievable as written: the mount
  baseline is not always server data. Tasks 4.2/4.3 list no test for an edit during the 409 round trip.
- **(3) Optional wire precondition (D4) as the AC reading.** Every write becomes an internal CAS (token = read
  version), so the mid-request window is closed for every caller; the wire precondition is what closes the
  stale-read window, and the web client (the ticket's repro actor, "tab A") always sends it. Making it required
  would break helio-mcp, patch-set apply/rollback/undo and any old client in one step and is hard to reverse;
  optional-now/required-later is the reversible order. I judge D4 a sound default for an OWNER REVIEW park, with the
  residual (a stale no-precondition caller still replaces whole supplied breakpoints, e.g. an MCP agent clobbering a
  user's drag) correctly named. The follow-up must actually be filed (note).
- **(4) Can the planned tests be red on main?** `UpdateDashboardRequest` is `jsonFormat3` (DashboardProtocol.scala:236),
  which ignores unknown JSON keys, so a ROUTE-level test that sends raw JSON with `expectedLayoutVersion: 0` compiles
  and is red on main (field ignored, 200, placement lost) and green after (409). A SERVICE-level test cannot reference
  the new field on main. Task 1.1 as written (lock in conn2, start a PATCH, commit placement/rename) is genuinely red
  on main for both assertions only if the PATCH has read before conn2 commits; and after the fix the "placement kept"
  assertion is only green if the PATCH carries the precondition — a no-precondition PATCH that supplies the placed
  breakpoint still replaces it wholesale on retry (the proposal's own non-goal). 1.1 does not say which, so one
  reading yields a test that can never go green. See CR2.
- **AC coverage.** AC1 (precondition + 409 + client refetch/reapply-or-inform): D2/D4/D5/D7, tasks 3.3-3.5, 4.3.
  AC2 (no name/appearance rewrite): D3/D5, tasks 3.2-3.4. AC3 (tests): 5.1 bullets map to both named cases.
  Driver constraints: V126 is free on origin/main (latest V125); C1-C4 carried into tasks.md. No placeholders/TBDs.
- **Wire surface.** `/update` passes `request.dashboard` (an `UpdateDashboardRequest`) to the same service, ignoring
  `fields`, so a nested `expectedLayoutVersion` works there unchanged. `GET /api/dashboards` is owner-only and paged
  (default 200), the same refetch source HEL-1071's catch path already uses.

### Verdict: REFUTE

### Change Requests

1. **D7 / spec "Web client resolves a layout conflict" / task 4.2-4.3: specify the version invariant and close the
   in-flight-edit hole.** State the invariant explicitly: the version sent with a save must be the version of the
   server layout that `latestLayoutRef` was derived from, never newer. Then specify mechanisms that keep it under the
   existing keep-local-by-reference reducers, at minimum:
   (a) after a 409-rebase retry succeeds while the store holds a newer local edit (store != the original
   `sentLayout`), do NOT advance the hook's baseline/version to the rebased response (e.g. leave the old pair so the
   next flush takes another 409 + rebase), or rebase the local layout onto the response before adopting it — pick
   one and write it down;
   (b) `updateDashboardLayout.fulfilled` / `repairDashboardLayout.fulfilled`'s keep-local branches must not leave the
   store's `layoutVersion` newer than the local layout it is paired with (keep the old version in that branch), or
   the hook must never read the store version at mount / class-4 re-baseline when the store layout is not
   server-landed;
   (c) add a jest test (task 4.3) for: drag, flush, 409 + successful rebase retry, with a second drag made during
   the round trip; then the next flush must not drop the other writer's item (it either 409s and rebases again, or
   sends a breakpoint containing it).
2. **Task 1.1 / 5.1: make the red-first test unambiguous and failable.** Specify that (a) the PATCH is driven through
   the HTTP route with a raw JSON body carrying `expectedLayoutVersion` (ignored by main's `jsonFormat3` -> red;
   honored after -> 409), for the "placement kept" assertion; (b) the second connection commits only after the PATCH's
   backend is observed blocked on the row lock (e.g. poll `pg_stat_activity.wait_event_type = 'Lock'` for it), so the
   PATCH's read provably precedes the commit and the test cannot pass vacuously on main; (c) the no-precondition
   variant asserts only what D4 promises (rename/appearance kept, unsent breakpoints kept, placement in an UNSENT
   breakpoint kept), not "placement kept" in a breakpoint the PATCH supplied.

### Non-blocking notes

- design.md Context: drop "DashboardContentsOps ... already avoid the lost update" — `replaceContents` reads unlocked
  and writes `existingDash.layout` back when `layout` is None; it only avoids clobbering name. Record it as a known
  residual (or follow-up) instead.
- Spec "Matching version saves -> greater layoutVersion" holds only if the saved layout differs from the stored one
  (the trigger's WHEN is false on an identical write); say "a valid, changed layout".
- `dashboard-layout-validation/spec.md:62` says a rejected layout save SHALL be shown to the user; the new capability
  says a 409 resolved by rebase shows no error. Consider a MODIFIED delta (or a sentence) so the two don't read as
  contradictory.
- After a successful rebase that brought in another writer's panel, the tab's panel list is still stale; consider
  refetching panels so the agent's panel actually appears (not required by the AC).
- A 409 body carrying the current `DashboardResponse` would avoid the owner-only, page-limited list refetch; optional.
- Mirror V122's `ENABLE ALWAYS` and `SET search_path` on the new trigger/function for consistency.
- File the helio-mcp precondition follow-up (and the "return version on placement responses" one) as real tickets at
  delivery, linked to HEL-1457, so the OWNER REVIEW residual has an owner.
