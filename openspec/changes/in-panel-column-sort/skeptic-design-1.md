## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Scope note: the Output-vs-panel scoping ruling is settled and was not re-opened. Everything below
takes Output-scoped persistence on `TableOutputConfig` as given.

### What I verified (with evidence)

**Attack 2 — the second premise correction. The design is RIGHT; the premise-validation doc is WRONG.**
- `frontend/src/features/panels/state/panelThunks.ts:295` carries the comment "pagination is sliced
  on the client", but `:309-311` computes `const offset = page * pageSize` and calls
  `getOutputRows(outputId, offset, pageSize)`; `hasMore = offset + pageSize < result.total`.
  That is a server-side offset/limit window, not a client slice.
- `frontend/src/features/panels/state/panelsSlice.ts:204-207`: `fetchPanelPage.fulfilled` does
  `page > 0 && existing ? [...existing.rows, ...rows] : rows` — pages accumulate.
- `frontend/src/features/pipelines/services/outputService.ts:110` `getOutputRows` confirms the
  paged endpoint.
- So design.md's Context §2 is correct and the `premise-validation.md` line "Rows are fully
  client-loaded and pagination is sliced client-side — CONFIRMED" is false. The design/specs describe
  the real mechanism and are honest that sort covers loaded rows only
  (`specs/table-panel-column-sort/spec.md:51-58`). No change required here — recording it so the
  final gate does not "correct" the design back toward the stale comment.

**Attack 3 — D4's merge-not-replace claim. REFUTED against the service.**
- `backend/.../services/pipelines/OutputService.scala:247` — `val mergedConfig =
  req.config.map(patch => mergeConfig(existingConfig, patch))`.
- `:274-282` `mergeConfig` = `existing.fields ++ patch.fields`, i.e. a top-level shallow MERGE, with
  a one-level deep merge for `legend`/`tooltip`/`seriesColors`/`axisLabels` only.
- `OutputProtocol.scala` `UpdateOutputRequest` docstring says so verbatim: "`config`, when present,
  is merged into the stored config one level deep ... rather than replacing `config` wholesale
  (HEL-877) — see `OutputService.mergeConfig`."
- The backend therefore does NOT replace the config. D4's stated mechanism, its mandated
  `{ ...output.config, sort }` spread, its Risks-table row and task 3.4/3.5 are all built on a false
  premise.

**Attack 1 — D1's extension point.** The reasoning that sort is a table-level singleton with an
exclusivity rule badly modelled by a per-column map is sound, and it is *independently* corroborated
by ground truth the design did not cite: because `mergeConfig` deep-merges only the four hardcoded
keys above, a nested `tableColumns: {...}` container would be **replaced wholesale** on every patch,
whereas flat top-level siblings each merge correctly. Flat siblings are the right call for the lane.
Two problems remain (CR2, CR3).

**Attack 4 — D2's split vs `columnWidths`.** Holds. `DataGrid.tsx:71-79` documents "`DataGrid` itself
does not persist anything; the caller owns storage", and `:136-139` keeps only transient `liveWidths`
for drag responsiveness. `TableRenderer.tsx:61-67` owns width state; `orderedColumns` (:44-50) shows
the caller already shapes what `DataGrid` renders. Reporting intent and letting the caller order rows
is the same split. No acceptance criterion is made unreachable by it.

**Attack 5 — specs/tasks verifiability.** Mostly good: each spec scenario maps to a task, and tasks
4.2/1.2 correctly pre-empt the root-`npm test` false-green and demand a mutation-failable stability
test. Gaps in CR4/CR5.

**UI-cohesion commitment (D5 / tasks §5).** Adequate as written: it names the running app rather than
tokens, requires both themes, names the HEL-866/496 light-theme collision, and forbids both silent
diff-widening and quietly shipping incohesive. One gap in CR6. I did not start the servers for a
baseline — a REFUTE was already established from static ground truth and the executor will re-render
this surface anyway; the final-gate successor should capture the baseline itself.

### Verdict: REFUTE

### Change Requests

1. **D4 is factually wrong — rewrite it.** `PATCH /api/outputs/:id` shallow-merges top-level config
   keys (`OutputService.scala:247`, `mergeConfig` :274-282). Replace D4's mechanism, its Risks row
   ("Config PATCH replaces and drops fieldMapping/columnOrder") and tasks 3.4/3.5 with the merge
   reality. The correct write is the **minimal patch `{ config: { sort } }`** — do NOT spread
   `output.config`. Spreading is worse than cargo cult here: `output.config` comes from
   `useOutputMeta` (`frontend/src/features/panels/hooks/useOutputMeta.ts`), a per-mount local
   `useState` snapshot that is never refreshed by an `updateOutput` dispatch, so the spread re-sends
   a stale `fieldMapping`/`columnOrder` and turns every sort into a lost-update hazard against any
   concurrent Output edit. Keep a regression test, but re-aim it: assert the PATCH body contains
   only `sort` and that `fieldMapping`/`columnOrder` survive the round trip.

2. **Clearing the sort is unspecified and, under merge semantics, is the likely default failure.**
   The third activation emits `null` (D2), but with `existing.fields ++ patch.fields` a key that is
   omitted from the patch leaves the stored `sort` intact. If the executor lets the field become
   JS `undefined` it is dropped by `JSON.stringify` and the cleared state silently never persists —
   the table reopens sorted after the user cleared it, failing ticket AC "a third activation clears"
   across reload. Specify explicitly that clearing sends an explicit JSON `null` (`sort: null`, and
   `readTableConfig` treats `JsNull` as unsorted), and add a task + spec scenario: "clearing a sort
   persists as cleared across a reload".

3. **D1: resolve the `sort` name collision inside the same file.**
   `outputConfigTypes.ts:71-74` already has `TimelineOutputConfig.sort: "asc" | "desc"`, read at
   `:148` as a bare direction string. Adding `TableOutputConfig.sort: TableSortState` gives one
   config file two different `sort` keys with two different types, and the lane inherits it three
   more times. Either rename the new key (e.g. `columnSort`, which also pairs cleanly with the
   documented siblings `columnFilters`/`pinnedColumns`/`columnFormats`) or record in D1 why the
   collision is deliberately accepted. State the decision; do not leave it to the executor.

4. **The Output-scoped consequence is documented one notch stronger than the code will behave.**
   `specs/table-panel-column-sort/spec.md:8-14` asserts "two panels bound to the same Output cannot
   hold different sorts". That is false within a session: each `TableRenderer` holds its own local
   sort state and each `PanelContent` has its own `useOutputMeta` fetch (no Redux, no cross-panel
   subscription), so sorting panel A does not move panel B — they only converge on next load.
   Either specify live propagation, or correct the requirement and its scenario
   (`:28-30`) to say the shared sort applies **on load**, and say the same in the PR-body wording
   task 6.3 mandates. Owner-accepted is not the same as inaccurately described.

5. **The non-owner write path is unhandled.** The config write goes through
   `OutputRepository.updateOwned` (`:256`), an RLS-gated owner-only write, so a viewer/editor grantee
   on a shared dashboard fails the PATCH on **every** sort activation, and D4's "surfaced through the
   existing error path" turns that into an error per click. Decide and record: either suppress the
   persist (sort stays session-local) when the Output is not writable by the caller, or state that
   sorting is owner-only. Add the corresponding task and spec scenario.

6. **Task 5 must produce citable artifacts, not a narrative.** Amend 5.1/5.2 to require the
   pre-change baseline screenshot of the existing table chrome AND the post-change screenshot, in
   both themes, saved and referenced by path in the executor report, so the final gate inherits a
   comparison rather than a claim. (Design D5's substance is otherwise sound and should stand.)

### Non-blocking notes
- `TableRenderer`'s `panelId` prop is declared (`:11-13`) but not destructured in the component
  signature (`:52-59`); task 3.2's warning is right, but the executor will also have to add it to the
  destructure. Consider renaming it `outputId` while touching it — the misleading name is exactly the
  trap D4 warns about.
- `validateFieldMapping` (`OutputService.scala:113-126`) is safe for a sort-only patch: `table` has no
  binding slots, so the merged-config validation cannot reject it. Worth stating so a later reviewer
  does not re-derive it.
- With a sort active, "Load more" inserts newly fetched rows mid-list rather than at the bottom. The
  spec is honest about it; it may still warrant a UX note at the final gate.
- `premise-validation.md` should be corrected or annotated: its "pagination is sliced client-side —
  CONFIRMED" line is refuted above and will otherwise mislead the next cold reader.
