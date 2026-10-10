# Live probe (task 3.1) -- worktree dev backend :9808, post-fix

Throwaway user: id `e936201a-f95f-4633-9414-8b64fe214a5c`, email `hel1469-probe-1791624748@helio.test` (registered via POST /api/auth/register; never matt@helio.dev). Count = `GET /api/data-sources` items (total).

| request (inline `dataset` root + ...) | status | data-sources count before -> after |
|---|---|---|
| compute step, unknown function | 422 `Step 'calc': compute: invalid expression: 'nosuchfn' ...` | 0 -> 0 |
| unknown step type `nosuchkind` | 400 `Invalid step type 'nosuchkind' ...` | 0 -> 0 |
| table Output, disallowed key `notAKey` | 400 `Unknown config key for a table Output ...` | 0 -> 0 |
| metric Output fieldMapping column `does_not_exist` (post-creation, schema-dependent -> compensating delete) | 400 `fieldMapping references column(s) not present ...` | 0 -> 0 |
| control: valid select step | 201 | 0 -> 1 |

Ids created (only the control): pipeline `2a43c1df-42c5-4c92-be2d-ec45080ea0f7`, source `d852289e-29c4-45ce-b09b-dee8129b1a1f`. Deleted by exact id via the API (pipeline 204, then source 204); afterwards `GET /api/pipelines` = `[]`, `GET /api/data-sources` total 0.
