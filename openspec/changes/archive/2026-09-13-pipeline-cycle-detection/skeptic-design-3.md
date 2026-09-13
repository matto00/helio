## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD: ac5d1e6be868d83f2709d04d25a88ae56a70843e (planning artifacts are uncommitted files in the change dir)

### What I verified (with evidence)
- Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=feature/cycle-detection-write-back/HEL-1101`.
- I read design.md, tasks.md, specs/pipeline-cycle-detection/spec.md and skeptic-design-2.md in full.
- **Round-2 CR1 (RLS/tenancy on the step paths): resolved.**
  - `V39__pipeline_sharing_grants.sql:28-58`: `helio_can_access_pipeline` reads the GUC internally. Its predicate is `v_uid = p.owner_id OR EXISTS(resource_permissions rp WHERE rp.resource_type='pipeline' AND rp.resource_id = p_pipeline_id AND rp.grantee_id = v_uid)`. Design Decision 2 mirrors this exactly.
  - The columns are real:
    - `pipelines.owner_id UUID NOT NULL` (V32:21)
    - `pipelines.name TEXT` (V22:3)
    - `resource_permissions(resource_type VARCHAR, resource_id TEXT, grantee_id UUID)` (V16:2-6)
  - An inline join with the user id bound as a parameter does not use the GUC. It therefore returns the same scoped set on the BYPASSRLS privileged pool, and tasks 1.1/1.2 test it under both contexts.
  - Under `withUserContext`, the RLS policies still let the caller see the rows the filter needs:
    - `resource_permissions_pipeline_select` lets a grantee see their own rows.
    - `pipelines_select` is the same predicate.
    - So RLS and the explicit filter do not conflict.
  - `actingUserId` is threaded into `spliceInsertAtInternal`/`attachTailInternal`/`updateInternal` (task 3.4). Task 1.2 and task 3.4(b) exclude another tenant's edges under the privileged connection.
- **Round-2 CR2 (task 3.2 / self-cycle scenario): resolved.** Task 3.2 is now a read-edge test against a pre-seeded writer pipeline. The spec scenario is reworded, and the same-request case is assigned to the task 2.1 unit tests and HEL-1100.
- **Round-2 CR3: resolved in the tasks.** Task 3.4(a) calls the restructured repository method directly with an `upsertsource` row, so the wiring itself is tested. Task 3.6 adds tests for both editor-grantee cases. The round-2 non-blocking notes were also taken up: the run-time gap is now a Risk, and task 3.1's text has been cleaned up.
- HEL-1100 via `get_issue`: the description has a design-gate note saying HEL-1100 must not register `upsertsource` before HEL-1101's check exists. My tool returns no comments, so I **could not independently see** the posted comment the orchestrator describes (the end-to-end test handoff plus the run-time cycle gap). See the notes.

### Verdict: CONFIRM

### Non-blocking notes
- Put the HEL-1100 comment URL in design.md's Risks/Testability section. Then the handoff claim can be checked without trusting the narrative. I could only confirm the description note, not the comment.
- Cycle message and data-source names: `data_sources` has owner-only RLS (V35:43). An editor grantee can see a shared pipeline whose root reads a source owned by the pipeline owner. If the message names that source by name, it names a data source the grantee cannot SELECT. That arguably conflicts with the spec's "SHALL NOT name ... data source the caller cannot see". The executor should do one of these and state it in the test for task 3.6:
  - resolve names through the same pipeline-visibility join, and accept that a source read by a visible pipeline counts as visible; or
  - fall back to the source id.
- The fixed global advisory-lock key (72901101) is acceptable as documented. Put the constant in one named value, not repeated literals.
