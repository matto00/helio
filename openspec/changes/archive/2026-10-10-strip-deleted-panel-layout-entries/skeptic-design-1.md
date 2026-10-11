## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD dae4bc4516791452ad5b3e27e871d39771bbd5a6 (artifacts untracked in the change dir). Spawn-cwd guard: READY.

### What I verified (with evidence)

**Q1: D1 trigger on the dashboard-delete cascade path, and whether a transition table is allowed on `panels`.** I tested this
myself on a throwaway cluster (system PG 18.4, plus the embedded PG 14.10 binary the sbt specs use under
`/tmp/embedded-pg`), not by reading. The setup: a non-superuser migration role `mig` owns the tables, `dashboards` is
ENABLE+FORCE RLS with an owner-only UPDATE policy, `panels` has `dashboard_id ... ON DELETE CASCADE` and `output_id ...
ON DELETE CASCADE`, and the D1 function is a `SECURITY DEFINER`, `search_path` pinned, `row_security = off`, statement-level
`AFTER DELETE ... REFERENCING OLD TABLE` trigger, re-owned to a BYPASSRLS `helio_privileged` with the V100 bracket. Results
were the same on PG14 and PG18:
- Single delete: the item is removed from every array breakpoint, other items keep their order, and a non-array key
  (`"xs":"weird"`) is left alone.
- Dashboard delete cascade (both superuser and the app role): **no error, a silent skip.** The plpgsql
  `SELECT ... FOR UPDATE` runs on a fresh snapshot and does not see the dashboard row this transaction already deleted, so
  it updates nothing. I got no "tuple already modified" error. The `panels` table is a plain table (no
  `PARTITION`/`INHERITS` in any panels migration), so a transition table is allowed. V99 is a statement-level
  `AFTER DELETE ... REFERENCING OLD TABLE` trigger on `pipeline_roots` that already runs under FK cascades, so the repo
  has a precedent for this.
- Output-delete FK cascade run as the app role with `app.uid=alice`, touching her dashboard d1 and bob's d2 (which she
  cannot UPDATE under RLS): **both stripped.**
- Mutation (function left owned by `mig`, not re-owned): every path, including the dashboard delete, fails loudly with
  `42501 query would be affected by row-level security policy for table "dashboards"`. That is the D2 tripwire.

**Q2: D2 RLS bracket.** V100's bracket (`GRANT CREATE ON SCHEMA public` / `ALTER FUNCTION ... OWNER TO helio_privileged` /
`REVOKE CREATE`) works as written. `helio_privileged` already holds UPDATE on `dashboards` through V38:19
(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES ... TO helio_privileged`, and `dashboards` predates V38), so D2's
explicit grant only adds redundancy. Sound.

**Q3: D3 lock order.** **Refuted, and the failure reproduces.** See CR1.

**Q4: D5 filter placement and pending loop.** The filter cannot cause a new 400. `LayoutPolicy.violations` only validates
changed breakpoints for bounds and overlap (`LayoutPolicy.scala`), with no completeness check, and a subset of a valid
breakpoint is still valid. Pending does not loop: `updateDashboardLayout.fulfilled` (`dashboardsSlice.ts:336-350`) adopts
the server layout whenever the store still equals `sentLayout`, which re-baselines (class 4). **However, D5 is never
reached in its own target scenario.** See CR2. The text is also self-contradictory. See CR3.

**Q5: missed delete paths.** `DashboardContentsOps.replaceContents` (`DashboardContentsOps.scala:46-75`, behind the
`DashboardContentsRoutes` PUT contents route) deletes every panel on a dashboard and is missing from design.md's
enumeration. See CR4. Every other `.delete` on `panels` I found (grep over `infrastructure/persistence`) is in the list.

**V-number collision.** No other worktree has `V122`/`V123` today. V121 is the latest on this branch.

### Verdict: REFUTE

### Change Requests

1. **D3's pre-lock causes a deadlock that a trigger-only design does not have. Its "no lock-order inversion" claim is
   false.** D3 makes `PanelRepository.delete` and `deleteByOutputIdInternal` take dashboard `FOR UPDATE` before the panel
   DELETE. Every path D3 does not cover takes the locks the other way round: panel rows first, then the dashboard, from
   inside the trigger. That covers every FK cascade (Output / step / pipeline / root / data-source deletes) and
   `replaceContents`. When two of these delete the same panel rows at the same time, they deadlock.
   - **Reproduced:** transaction A pre-locks `dashboards d1,d2 FOR UPDATE`, then runs `DELETE FROM panels WHERE
     output_id='o1'`. Transaction B runs `DELETE FROM outputs WHERE id='o1'` (FK cascade). Result: `ERROR: deadlock
     detected ... while deleting tuple (0,2) in relation "panels"`.
   - **Control:** the same pair without A's pre-lock (trigger only) ran 3 out of 3 times with no deadlock. B blocks on the
     panel rows, then finds nothing to delete.
   - A realistic case is `OutputService` delete (D3 path) racing a pipeline delete that cascades the same Output's
     panels. Another is a UI panel delete racing a PUT-contents.
   - I found nothing that requires D3. A create takes dashboard `FOR UPDATE` and then inserts a new row. It never waits on
     an existing panel row, so a trigger-only delete (panel row, then dashboard) cannot form a cycle with it. The trigger's
     own `FOR UPDATE` is "the same locking as `PanelLayoutPlacement`" (same lock, same row). Its UPDATE re-reads the
     latest committed layout under EvalPlanQual, so no strip is lost to a committed create.
   - **Required:** either drop D3 and let the trigger's `FOR UPDATE` satisfy the AC (state that interpretation of "same
     locking" explicitly), or keep D3 and add this deadlock to Risks along with how it surfaces (40P01, then a 500?) and
     why it is accepted. Task 3.8 should then also cover D3-path vs cascade on the same panel, not only create vs delete.
     Correct D6's "only serializes deletes with creates/other deletes (previously unordered)" to match.

2. **D5 does not prevent its own scenario: after a UI delete, the filter is switched off.** The `deletePanel` thunk
   (`panelThunks.ts:157-168`) dispatches `markDashboardPanelsStale`. That sets `panels.status = "idle"`
   (`panelsSlice.ts:174-183`) and schedules **no** refetch (`PanelList.tsx:90-113`, which calls this "the TERMINAL state —
   no fetch coming"). The grid stays mounted (`PanelList.tsx:403-411`, since `items.length > 0`). `DesktopPanelGrid.tsx:188`
   passes `panelsLoaded: panelsStatus === "succeeded"`, which is now `false`, so `useLayoutSave.ts:197` passes
   `resolved = null`. D5 keeps behaviour unchanged when `resolved` is null, so the undo-to-pre-delete PATCH in the same
   session sends the ghost unfiltered. The spec scenario "Undo to a pre-delete layout does not write a ghost back" fails
   in the most common sequence: delete, then undo a drag that predates it. `layoutHistorySlice` does not clear history on
   delete, so that undo is reachable. D5's "No change to the `deletePanel` thunk is required for correctness" is therefore
   wrong.
   - **Required:** redesign D5 so it works in the post-delete idle state. For example, have `deletePanel` strip the
     deleted id from the store's dashboard layout and the layout-history stacks. Another option is to gate the filter on
     a known-deleted-id set or on `items` (which `deletePanel.fulfilled` keeps accurate) rather than on
     `status === "succeeded"`. If you change the store layout, prove the `useLayoutSave` classification still holds:
     a store strip of a ghost is neither an interaction commit nor a traversal, so it re-baselines (class 4) and discards
     any pending drag. State that or avoid it.
   - Task 3.9 must exercise the real post-delete state (`status: "idle"`, `staleDashboardId === dashboardId`), not a
     `succeeded` fixture. `DesktopPanelGrid.layoutPatch.test.tsx:88`'s `setup("succeeded")` default is exactly the fixture
     that would hide this.

3. **D5 contradicts itself on ghost-only diffs.** It says the filter is applied "after the changed-vs-baseline comparison
   so a breakpoint whose only difference is a ghost is not sent". Filtering after the comparison means a ghost-only diff
   **is** detected as changed and **is** sent (filtered). Not sending it requires comparing filtered next against filtered
   baseline. Tasks.md 2.1 repeats "after". Pick one.
   - If it is "not sent": `buildLayoutPatch` can now return `{}` for a non-equal layout (`persistLayout`'s equality guard
     at `useLayoutSave.ts:180` runs on unfiltered layouts). Specify what happens: skip the PATCH, or send an empty patch
     and say what the server does with it.
   - Either way, name the expected PATCH body in the 3.9 test.

4. **Add `DashboardContentsOps.replaceContents` to the delete-path enumeration and say how it interacts.** It reads the
   dashboard without a lock, deletes all of its panels (the trigger fires: it locks the dashboard and strips), inserts the
   new panels, then overwrites `layout` with the caller's value (`DashboardContentsService.scala:98` always passes
   `Some(layout)`). The trigger's strip is therefore always overwritten, which is harmless. It is still a panel-delete path
   the design says it enumerated, and it is the other side of the CR1 deadlock. Name it in Context, and either add it to
   test 3.5 ("PUT contents still succeeds and stores the supplied layout") or state why no test is needed.

### Non-blocking notes

- D6's last clause, "D5 removes the web client's ways to do so", overclaims. `DashboardWrites` merges the patch into an
  unlocked earlier read of `existing.layout` (`DashboardWrites.scala:50,90`) and writes back the full layout. A PATCH
  that read before a delete committed therefore restores the ghost into breakpoints the client did **not** send, whatever
  the request body. That is HEL-1457 and out of scope, but word it as "removes the client body as a source; the
  server-side stale read-merge remains (HEL-1457)".
- Trigger SQL trap: `jsonb_agg` over zero rows is `NULL`. Deleting the last panel must leave `[]`, not `null`, or every
  layout read of that dashboard may fail to parse. My probe used `COALESCE(..., '[]')`. Add a "delete the only panel"
  case to 3.2.
- V123 (D4): if the "live panels" read is ever RLS-filtered to empty while the dashboards UPDATE is admitted, the repair
  wipes every item. That is a silent destructive failure, worse than a no-op. Task 3.7's "live items byte-identical as a
  non-BYPASSRLS role" covers it. Keep that assertion against a dashboard with more than one live panel, and keep
  `row_security = off` on any helper.
- Shared dev DB (MISTAKES.md "Every worktree shares one Postgres database"): once V122 is applied to the shared dev DB,
  the trigger fires for every lane's panel deletes. Do not edit V122 after its first dev-server boot (the design already
  says this), and mention it to the driver.
- Probe artifacts (scratch clusters) were deleted after use because `/tmp` is RAM. The SQL I used is summarized above,
  and the executor's 3.6 RLS proof should reproduce the same three states (re-owned strips, not re-owned gives 42501,
  dashboard-delete cascade gives a silent skip).
