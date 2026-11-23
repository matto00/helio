## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `1a3a14c4c5d79e4c723edd27cc11aaa1859848db`. Base resolved live via `resolve-review-base.sh` (main/origin):
`68829c1c677f31c38dd695cfb06ecff0690a6a7e`. 3 commits: probe `839b9f253`, red `9a80886bc`, fix `1a3a14c4c`.
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=bug/panel-modal-appearance-probe/HEL-1615`.
Scratch logs: `/home/matt/Development/helio/.concertino/scratch/HEL-1615/skeptic-*.txt`.

### What I verified (with evidence)

- **AC1 (probe, before/after JSON):** `probe-evidence.md` records the API probe and the real-modal B/C/D runs. I re-ran
  `e2e/hel1615-panel-modal-appearance-save.spec.ts` myself against fresh lane servers (start-servers.sh, backend log
  shows `jdbc:postgresql://localhost:5432/helio_hel1615`, ANTHROPIC_API_KEY empty, ports 7047/9954, 2 workers): `1 passed (13.0s)`,
  exit 0. Live log: flushed batch body
  `[{"id":B,"title":"HEL-1615 B renamed"},{"id":C,"appearance":{"background":"#445566"}},{"id":D,"appearance":{"background":"#778899","color":"#ddeeff"}}]`;
  before the flush the Redux panel keeps `chartType "pie"` and `transparency 0.555`, rendered `pie`; after the flush server and client
  both hold pie / 0.555 and the edited colors. Seed honours C1 (pie is distinct from the Output's `bar` and the `line` fallback).
  The teardown deleted its throwaway user and the dashboard, pipeline and source by exact id.
- **AC2 (fix at the write seam, red first):** the defects are real and measured. The client dropped `chart` from Redux, so the
  panel rendered the Output's `bar` until the flush, and the server persisted 0.555 as 0.56. The fixes:
  - `panelsSlice.ts` `accumulatePanelUpdate`: the appearance patch is merged over the stored item AND over the prior pending
    patch. I read the diff. The shallow-merge limitation is stated in a comment and in the design note. `buildBatchRequest`
    builds items per panel, and the server's `PanelMutationRepository.batchUpdate` applies `item.appearance.foreach`, so a
    title-only item mixed into a batch whose `fields` include `appearance` is safe.
  - `PanelDetailModal.tsx` `handleEditSubmit`: stages only the changed keys. Transparency is compared on the seeded
    integer (`usePanelDetailEditState` derives `initial*` with the same rounding as the state seed). Nothing changed means
    nothing is dispatched.
  - Red: `git diff 68829c1c6 9a80886bc --stat` on both source files is empty, so the red commit left the source untouched.
    `red-jest-unit.txt` shows `Tests: 8 failed, 39 passed`.
  - Server unchanged (it already merges), so no documented API semantics changed and no escalation was needed.
- **Gates re-run by me:**
  - jest `--testPathPatterns='panelsSlice|detailModal'`: 3 workers, 21/21 suites and 152/152 tests passed, exit 0.
  - `npm run typecheck && npm run lint`: exit 0.
  - sbt `testOnly com.helio.api.ApiRoutesSpec -- -z HEL-1615`: the guard ran, 1 succeeded and 0 failed. hel1468-guard
    reports failed=0. Exit 0.
  - I relied on the evaluator's pasted results for the full suites. Its full sbt run was 6 shards, 10292 passed, and its
    full jest run was 10589 passed.
- **Re-expressed existing tests (design 2b):** sentinel, panelSwitch, aggregateChart and chartTypeDefault. I read the
  sentinel and panelSwitch diffs. The intent holds: the untouched sentinel is not sent and the store still reads it. The
  panelSwitch test still fails if the edit state goes stale, because A's `#111111` differs from B's initial value and would
  be staged. These are intended changes, not fixture tweaks.
- **Subtype / OutputControlsEditor saves:** they use typed thunks with no appearance. I confirmed this in the code
  (`handleEditSubmit` step 2), and the evaluator's browser run showed the body `PATCH {"config":{"controls":[...]}}`.
- **UI / design judgment:** no CSS, markup or token changes in the diff. Only `PanelDetailModal.tsx` logic and the hook's
  return values changed. The modal looks the same, so there is no visual, theme or layout change to judge. I did not
  screenshot it: the shared MCP browser belongs to other lanes, and the e2e run covered the real modal path.
- Servers stopped with `stop-servers.sh` (`STOPPED ports=7047,9954`). Both ports are free afterwards and no PIDs are left.

### Verdict: CONFIRM

### Non-blocking notes
- The evaluator's suggestions stand:
  - Drop the leftover `as PanelAppearance` cast in `panelsSlice.test.ts`.
  - Reword `tasks.md` 1.2 to say the subtype saves were checked by code reading and by the evaluator's run.
  - Note the size budgets of `panelsSlice.ts` and `ApiRoutesSpec.scala` in the PR.
- Pre-existing and out of scope, a possible spinoff: when a typed subtype thunk resolves in the same save,
  `*.fulfilled` replaces the local item with the server copy, so a staged title or appearance shows reverted until the
  batch flush.
