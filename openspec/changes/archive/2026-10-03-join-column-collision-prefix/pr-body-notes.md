# PR-body notes for the owner (HEL-1236, task 3.5)

## What happens to Outputs/panels bound to a collided column

Correction to the ticket's framing: today (`leftRow ++ rightRow`, `JoinStep.evaluate` on main) the RIGHT value
wins on every matched row, not the left. So a binding to `cnt` currently reads the RIGHT-hand `cnt`.

Real code paths:
- An Output stores its binding as `config.fieldMapping`, a `{slot: columnName}` object
  (`OutputService` extracts it, `OutputService.scala` ~L106-117; slots validated by
  `OutputBindingSpec.validateFieldMapping`). Panels reference an Output and read its rows
  (`GET /api/outputs/:id/rows`, the latest materialized `node_snapshots` for that Output); the
  column name in `fieldMapping` is looked up by name in each snapshot row.
- Column EXISTENCE is checked only at Output creation, against the analyzed schema at the Output's node
  (`PipelineService.buildOutputsAction` -> `OutputBindingSpec.validateFieldMappingColumnsExist`, ~L667-681).
  There is no read-time or step-edit-time re-validation, and no migration rewrites stored mappings.

After this change (once the pipeline re-runs and writes a new snapshot):
- A binding to a colliding column name (`cnt`) keeps working with NO error but now reads the LEFT value
  (the value that used to be silently destroyed). Same name, different data: this is the silent part the
  owner is accepting. Charts/tables bound to the right-hand value must be rebound to `right_cnt`.
- The right value is now available as `right_cnt` (or `right_cnt_2`, ... when that name is taken) in
  analyze, the Output field pickers (they read the analyzed schema), and `analyze_pipeline` MCP output.
- Bindings to non-colliding columns, the join key, and left-only columns are unaffected.
- Until the pipeline re-runs, existing snapshots still hold the old (right-wins) data under `cnt`.
- Dev DB check: there are no join steps in the dev DB, so no dev Output/panel is affected
  (see `dev-db-inventory.md`). Production not inspected.

Not changed (follow-ups): `lookup` still overwrites a same-named left field with the looked-up value.
