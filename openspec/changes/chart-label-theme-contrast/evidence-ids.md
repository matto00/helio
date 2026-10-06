# Evidence ids (HEL-1263)

Created in the shared dev DB through the API on dev 6695 / backend 9602. Deletion is by these exact ids only.

- user: `f9b99055-4f33-4c04-b09d-31dc4f610c9e` (hel1263-measure-1791278480673@example.test)
- dashboard: `79ab66ec-f187-4c06-9c75-246baa59cd1a`
- data source: `7a234160-fc67-41b1-af94-bf60fbb2da6c`
- pipeline: `9716be42-e5db-4bd7-9d9d-40c8071b1f33`
- output: `7c5b6062-8dd3-4d19-9489-2db24f49b157`
- panel line: `8b44d86d-c335-4926-b5bd-b2e32de77c05`
- panel bar: `6cf6ab99-2415-4f1a-b302-a9988a06fb03`
- panel scatter: `906235cd-23b2-4296-a217-cb32a16e6739`
- panel pie: `dbdf0537-e85c-4ff5-8ff9-3b854eaa2daa`
- panel tinted-line: `f610b573-9bb2-4ecf-8d5d-d1a2a5318ff7`

## Deletion status (task 3.5)

Deleted by exact id only. Panels, dashboard, output, pipeline and data source through the API with the throwaway user's own session (204/200 each); re-queried through the API: none of the four ids present in the user's lists. The user row `f9b99055-4f33-4c04-b09d-31dc4f610c9e` was deleted by exact id with psql, after first deleting that user's one `pipeline_run_rate_window` row (RESTRICT foreign key, keyed by the same user id, created by the pipeline run). Final re-query by exact user id: users=0, pipeline_run_rate_window=0, and dashboards, panels, pipelines, outputs owned by that id = 0. Residue: none.
