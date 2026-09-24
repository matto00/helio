## Context

`FormPanelView.tsx`'s `handleImmediateStep` (HEL-1087) already advances a local optimistic tally
before a counter's submit request resolves and reverts it on rejection/network failure. It never
reconciles the tally against anything server-side. `dataset_rows` (V106) stores each row's `data` as
a **positional JSONB array** aligned to `dataset_schema`'s declared column order (not object-keyed),
indexed by `(data_source_id, seq)`. `DataSourceRepository.listRows` shows the established
RLS-respecting read pattern: `ctx.withUserContext(user.id.value)(action)`, ACL via `findByIdOwned`
first. The existing SSE reconciliation path (`usePanelRunRefresh`/`pipelineRunFanout.ts`, HEL-1094)
resolves a pipeline via `useOutputMeta(outputId)` — it only applies to Output-bound panels; a form
panel binds a `dataSourceId` directly, and no route exposes "which pipeline(s) read this source" to
the frontend. See proposal.md for the full motivation, including the owner ruling this design
implements.

## Goals / Non-Goals

**Goals:**
- Reconcile a counter's optimistic value to a real, server-computed number after its own write
  succeeds, independent of any downstream pipeline.
- Never leave the pending state unresolved when there is no downstream pipeline, or the cost gate
  denies one.
- Preserve HEL-1087's existing submit-failure rollback behavior unchanged; only extend it.

**Non-Goals:**
- Observing downstream pipeline run outcomes at all for this reconciliation (Non-goals in proposal.md).
- A generic aggregate/rollup feature for arbitrary panel types — this is scoped to the counter's own
  reconciliation need.
- Raising the 500-row write cap (HEL-1133).

## Decisions

**D1 — Reinterpret "on run success" as "on write success" (owner ruling).** The AC's literal text
ties reconciliation to a pipeline run. Investigation during Planning found no aggregate concept and
no dataset→pipeline discovery endpoint anywhere in the codebase, and tying reconciliation to a
downstream run would leave the "no pipeline" / "gate denies" cases pending forever. The owner ruled:
authoritative value = the dataset's own aggregate, refetched right after the submit's own success.
This is stated in proposal.md and must be called out plainly in the PR body so no gate reads it as a
missed AC — it is a deliberate, owner-approved scope decision, not an oversight.

**D2 — New read endpoint, not a new table.** `GET /api/data-sources/:id/rows/aggregate?field=&op=sum`
computes `SUM` over `dataset_rows.data`'s positional value for the field's declared index, scoped by
`data_source_id`. Alternative (extend `GET .../rows` with an aggregate query param) was rejected — that
route's response shape (`RowListResponse`, paginated rows) conflates with a single scalar.

**D3 — ACL and RLS context match `listRows` exactly.** `findByIdOwned(id, user)` for the 404
existence-not-leaked check, then the aggregate query itself runs under `ctx.withUserContext
(user.id.value)(...)` — never `DbContext.withSystemContext`. This is the same two-step pattern
`DataSourceService.listRows`/`getDatasetSchema` already use; the new method should live alongside
them in `DataSourceService`/`DataSourceRepository`.

**D4 — No new index; the existing `idx_dataset_rows_data_source_id (data_source_id, seq)` index
already covers this query's `WHERE data_source_id = ?` predicate.** At today's write cap
(`DataSourceService.DatasetMaxRows = 500`) a full-index-scan-then-sum over ≤500 rows is trivial.
HEL-1133 (raising the cap for pipeline write-back) is explicitly out of scope; if that ticket lands
and materially raises real-world row counts for `dataset`-kind sources, its own delivery should
re-measure this query, not this one. No migration is needed for this change — V111 is NOT claimed.

**D5 — Reconciliation fetches only once a burst is fully quiesced; it never overwrites a still-pending
optimistic delta.** See D9 for the state model and why the fetch trigger is quiesce-gated rather than
per-click. This guarantees the display never regresses below what's already on screen.

**D9 — Replace the single-value `submitState` reentrancy guard with a per-click pending-delta map,
fetch the aggregate only on a success-driven quiesce, and invalidate any in-flight fetch on EVERY
settle event, success or failure alike (design-gate rounds 1–4 REFUTE fixes, merged).**
`handleImmediateStep`'s guard (`if (!schema || submitState === "pending") return;`,
`FormPanelView.tsx:115`) silently drops every click after the first in a burst (round 1) — fixed by
replacing it with a `Map<token, delta>` of outstanding requests (`token` is a locally-generated id),
plus a module/component-scoped `reconcileGeneration` counter starting at `0`, bumped on **every**
token removal (see below — this is the round 4 fix; rounds 1–3 only bumped it on a success that
emptied the map). Every activation fires its own request immediately, records `{token: delta}`, and
advances the displayed value by `delta` on top of whatever is already shown.

- **Success:** remove the token, **unconditionally** increment `reconcileGeneration`. **Only if
  removing the token leaves the map empty**, capture `myGen = reconcileGeneration` and call
  `fetchFieldAggregate`. Round 2 found fetching on *every* success racy (a still-in-flight sibling's
  write can already be committed — and thus already counted in a fetch's result — while its map entry
  is still present, so a *later* fetch then corrects the value back down: a visible backward snap). A
  seq-based alternative was rejected: it can't disambiguate an entry with no confirmed `seq` yet from
  "not yet submitted at all." Quiesce-gating sidesteps this provably: a response is only sent after its
  write commits, so once the LAST outstanding request in a burst has been locally processed, every
  request in it has already committed, and the triggered fetch is guaranteed to include all of them.
- **Fetch resolution:** apply `displayed = fetchedAggregate` only if **both** `myGen ===
  reconcileGeneration` (nothing has settled since dispatch) **and** the map is still empty; otherwise
  discard. Round 3 found a *new click* racing the fetch's own round trip could be silently overwritten
  if only the map-empty check were used. Round 4 found a *third* click's failure — after a *second*
  click had already succeeded without itself emptying the map (a further click was still outstanding)
  — also reached an empty map with the generation counter untouched (only a success-driven empty
  transition bumped it in rounds 1–3): the second click's real, committed contribution was invisible to
  the guard, so a stale fetch was wrongly applied with nothing left to ever correct it. Fixed by
  bumping `reconcileGeneration` on **every** settle — success or failure, whether or not it empties the
  map — while keeping the *dispatch-a-new-fetch* trigger success-and-empty-only (a failed request is
  still never itself a reconciliation trigger, per C2 — this only changes when an *already in-flight*
  fetch is considered stale, not whether a new one is fetched). A stale fetch is now invalidated by
  *anything* that has happened since dispatch, not a map-empty snapshot at one instant.
- **Failure/rejection:** remove the token, bump `reconcileGeneration` (see above), AND subtract only
  that click's own `delta` from the *current* displayed value — a relative adjustment, never an
  absolute revert-to-`previous` snapshot (HEL-1087's original approach), wrong once a second click can
  be concurrently in flight, since `previous` predates sibling clicks that may have since landed.
- `aria-busy` (D8) is derived from `pending map size > 0` only (not from an in-flight reconciliation
  fetch) — a brief, correctness-guarded background refresh needs no user-visible busy state of its own.
- Scoped to the compact single-counter-field immediate-submit path only (`isCompactCounter`/
  `onImmediateStep`) — the full multi-field form's submit button and its existing "no double submit"
  requirement (base `form-panel-submit` spec) are untouched.

**D6 — Concurrent writers are correct, not a bug.** Another user's (or tab's) increments landing in the
refetched aggregate is intended for a shared dataset — the aggregate is the real total, not a
per-session view. No conflict/merge logic is needed beyond D9's own pending-delta accounting, scoped to
the current session's own in-flight requests only.

**D7 — Rollback stays scoped to the submit request itself (owner ruling, unchanged from HEL-1087).**
No new rollback trigger is added for a downstream run `failed` event or a guard/gate denial — the
write already persisted in both cases. `usePanelRunRefresh`/`pipelineRunFanout.ts` are untouched.

**D8 — Pending affordance is `aria-busy` on the counter's own `role="spinbutton"` element**, set
whenever any submit request from this counter is outstanding (not just the very first), computed from
the pending-delta map D9 introduces (`pending map size > 0`), not the old single-value `submitState`.
Mirrors the existing `aria-invalid`/`aria-describedby` rollback-error association (HEL-1090) —
verified by computed ARIA state in tests, and visually compared against the running app in both light
and dark themes per DESIGN.md.

## Risks / Trade-offs

- [The AC's literal "on run success" wording could read as unmet by a skeptic or evaluator scanning
  for pipeline-run integration] → Mitigated by D1's explicit, owner-cited deviation note in
  proposal.md and the PR body; the design/final-gate skeptic is briefed on the owner ruling via
  `workflow-state.md`'s `CONSTRAINTS` C1/C2.
- [D9's quiesce-gating means a very long-running burst delays reconciliation until that straggler
  settles] → Acceptable at this scale (ordinary latency, human click cadence); the value is still
  correct and accumulating throughout — nothing spins, it's just not yet server-reconciled.
- [D9's pending map could leak an entry if a request neither resolves nor rejects (e.g. unmount
  mid-request)] → Out of scope (no AC depends on unmount cleanup); not user-visible (owning component
  is gone) and a remount starts a fresh map. Accepted gap.
- [The positional `dataset_rows.data` array requires the field's declared index to extract its value
  in SQL] → Read `dataset_schema` first (already required for the ownership check) to resolve the
  index, mirroring `parseStaticPayload`'s existing schema-then-rows read order.
- [D7/C2's rollback trigger ("rejected/network") conflates a genuine rejection with a network failure
  where the write actually committed server-side but the client never saw the acknowledgment — round 4
  flagged this as pre-existing HEL-1087 behavior, unchanged by any round of this ticket] → Accepted,
  out-of-scope gap for this ticket; a lost-ack-after-commit would incorrectly roll back a persisted
  write, worth a dedicated follow-up rather than scope-creeping into this one.

## Migration Plan

No database migration. Deploys as an ordinary backend route + frontend change; no feature flag
needed since the new endpoint is additive and the frontend behavior change is scoped to the existing
compact-counter code path only.

## Gate-Chain Implications Checklist

Not applicable — this change does not touch `.husky/**` or any script a pre-commit hook invokes.
