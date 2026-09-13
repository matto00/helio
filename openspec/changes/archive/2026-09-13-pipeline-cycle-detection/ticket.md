# HEL-1101: Cycle detection: a pipeline must not write to a source it reads

## Description

Reject at validation time, not at run time. Include transitive cycles across pipelines — A writes the dataset B reads, B writes the dataset A reads.

## Acceptance Criteria

- A direct cycle (a pipeline whose `upsertsource` step targets a `dataSourceId` that pipeline's own root/sources also read) is rejected at validation time with a message naming the cycle.
- A two-pipeline transitive cycle (pipeline A writes the dataset pipeline B reads; pipeline B writes the dataset pipeline A reads) is rejected at validation time with a message naming the cycle.

## Context

- Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (epic 5, `upsert_source` step: "Cycle detection is required (a pipeline must not write to a source it reads)").
- HEL-1099 (merged, PR #657): `upsertsource` step config model (`UpsertSourceConfig`: `target` = `newSource(name)` | `existingSource(dataSourceId)`, `mode` = `append`|`replace`) and write-path validation. Spec: `openspec/specs/pipeline-upsertsource-config/spec.md`. That spec's "not yet creatable" requirement explicitly blocks registering `upsertsource` in `PipelineStep.Registry` until this ticket's cycle check exists.
- HEL-1100 (engine implementation, registers `upsertsource` in the registry) is `blockedBy` this ticket — do not register the step here; design the seam HEL-1100 will call into.
- `upsertsource` is deliberately NOT YET in `PipelineStep.Registry`/`PipelineStepKind.All` — no persisted pipeline can contain one today. `PipelineCreateTransactionalSpec.scala:174` pins the current rejection of `upsertsource` (and 3 sibling ops) as an invalid step type.

## Scope notes (from driver + premise validation)

- Only a target naming an existing `dataSourceId` can close a cycle today; a new-source-name target cannot until that source exists and is later read by another pipeline. Detection must therefore run on every write path that can add a read-or-write edge to the graph: pipeline create, step add/update (including root/source changes), pipeline update/import/duplicate, and agent-proposal apply paths — enumerate these from the tree during planning.
- General (not just 2-hop) cycle detection; AC's two cases plus a 3-pipeline transitive case and a non-cycle diamond (false-positive guard) as named tests.
- Tenancy: build the read/write graph only from the caller's own visible pipelines/sources (RLS); the rejection message must not leak names of resources the caller can't see.
- Concurrency: two simultaneous edits could each individually validate cycle-free and together form a cycle. Assess honestly — either prevent it or document as a tracked, filed gap. Escalate before adding a migration/lock if one is needed.
- Performance: bound cost on the write path; avoid N+1 queries.
