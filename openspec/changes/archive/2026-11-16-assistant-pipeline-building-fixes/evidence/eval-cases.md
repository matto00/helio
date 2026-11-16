# HEL-1639 eval case set (fixed before the baseline, task 0.4)

Runner: `backend/src/test/scala/com/helio/eval/AssistantEval.scala`, a plain `main` object (not a ScalaTest suite, so
`sbt testFull` never discovers it), refusing to start unless `HELIO_ASSISTANT_EVAL=1`. It drives the lane's dev backend
over HTTP under the tracked shared dev account; the password is read from `HELIO_EVAL_PASSWORD` at run time and is never
written to any file.

Each case is ONE user message sent through a new conversation's `POST .../converse`. The case set and fixture workspaces
below are frozen; the baseline (branch-point code) and the after-run (final code) use exactly the same ones.

| id | workspace | user message | what a good answer is |
|---|---|---|---|
| `standings` | Standings | "Can you add more charts to my Fantasy Football standings dashboard?" | ONE `propose_patch_set` that adds chart Outputs to the existing "Sleeper League Pipeline" at the node that has `display_name`/`points_for` and binds new panels on the existing "Standings" dashboard; previews and really applies |
| `csv-chart` | Sales | "Make a bar chart of total revenue by region from my Sales data." | a pipeline (aggregate) plus a chart Output plus a dashboard, one proposal |
| `line-existing` | Sales | "Add a line chart of revenue by month to my Sales Overview dashboard." | a chart Output on the existing "Sales Pipeline" plus a panel on the existing dashboard (patch set) |
| `top-n` | Sales | "Show me the top 3 regions by total revenue as a bar chart." | aggregate, sort, limit steps plus a chart Output, one proposal |
| `compute-column` | Sales | "Add a profit column (revenue minus cost) to my Sales data and show the result in a table." | a `compute` step (revenue minus cost) plus a table Output, one proposal |

## Fixture workspaces (created over the public API under the eval account, deleted by exact recorded id)

- **Standings** (mirrors the 2026-10-16 transcript): static sources "Sleeper rosters" (`owner_id`, `roster_id`,
  `settings.wins`, `settings.losses`, `settings.ties`, `settings.fpts`, `settings.fpts_decimal`; 5 rows) and
  "Sleeper users" (`user_id`, `display_name`); pipeline "Sleeper League Pipeline" (root: rosters; `lookup` owner_id ->
  user_id adding `display_name`; then `compute` `points_for` = `round($settings.fpts + $settings.fpts_decimal / 100, 2)`);
  table Output "Standings Table" at the compute node; dashboard "Standings" with one table panel bound to it. The
  pipeline name contains no "Standings", so the dashboard is the only name match.
- **Sales**: static source "Sales" (`region`, `month`, `revenue`, `cost`; 4 regions x 3 months); pipeline "Sales Pipeline"
  (root: Sales; `cast`); table Output "Sales Table"; dashboard "Sales Overview" with one table panel.

## Counting rules (design.md D8)

- Failed call = a transcript `tool_result` with `isError=true`, including decode errors and one-propose-per-response
  rejections. A zero-result `find` is not a failure; it is counted separately.
- Successful propose = a non-error `propose_*` tool_result. The applied proposal is the LAST successful one (the one the
  server captured).
- Preview: `POST /api/patch-sets/preview` for a patch set; other proposal kinds are validated by the propose call itself.
- Applied: the proposal kind's own apply route returned success with no `failure`.
- Standings pass = exactly one SUCCESSFUL propose, it previews, it really applies, the hop budget is not exhausted, and at
  most 2 failed calls.

## Spend (C1)

Cost is computed from the backend's JSON `assistant_tool_loop_outcome` line (matched by conversation id) at Haiku 4.5
prices ($1/$5 per Mtok, $0.10 cache read, $1.25 cache write). `evidence/eval-spend-ledger.json` accumulates every case's
cost across all runs; the runner stops before a case that could take the total past $3.00.
