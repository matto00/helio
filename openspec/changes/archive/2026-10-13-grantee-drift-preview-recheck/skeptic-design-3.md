## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed tree: HEAD d16e58d7e9d3e08a43a0483d06b1dd29fe1e6fbc. The change dir is untracked, so I read the artifacts from
disk. `openspec validate grantee-drift-preview-recheck --strict` reports "Change 'grantee-drift-preview-recheck' is
valid". Both target capability specs exist under openspec/specs/. The MODIFIED requirement header matches
openspec/specs/pipeline-analyze-api/spec.md:150. There are no TODO/TBD markers in proposal.md, design.md or tasks.md.

### Round-2 change requests: re-checked

1. **CR1 (findByIdInternal privileged-caller doc list): resolved.**
   - D3 now says to add the empty-roots branch to the doc list at PipelineRepository.scala:55-62, described as "a
     read-only existence check keyed by the id `findByIdShared` just authorized". Task 3.2c covers it.
   - I confirmed the live doc list names the HEL-1503 executor bullet and the "Do not call from a request-bound
     service method" line, so the exception gets recorded.
2. **CR2 (defect vs guard labelling): resolved.**
   - D4 marks (a), (d), (e) and (f) as defect proofs that must be red on unchanged main.
   - (b) and (g) are guards, made failable by M2 and M5.
   - (c) is a pure pin with no mutation, which is stated explicitly.
   - Constraint C2 (tasks.md and workflow-state.md) matches this, and C1 is retired.
3. **CR3 (S1/S2 arms): resolved.**
   - S1 is pinned to `previewAtNode`'s own `findByIdShared` (:135), never the outer all-Outputs read (:80). The design
     gives the reason: outputs cascade (V94:208), so that arm would answer 200 `outputs: []`.
   - S1 uses the step preview and the single-Output arm with a source-bound Output.
   - S2 is limited to the step arm and a step-bound single-Output preview, which are the only paths that reach the
     `listByPipelineInternal` seam.

### Round-2 non-blocking notes: all folded in

- (e) pins the all-Outputs fixture to one distinct node key, and states the `Future.traverse` race reason.
- Seam R now names the overridable reads (`listByPipelineInternal` / `listRootDataSourceIdsInternal`), not the
  `PipelineRunSupport` helper.
- S2 asserts the "Pipeline not found" message rather than "Step not found".
- The ExistenceNotLeakedRoutesSpec comment rewrite states the classification inline.
- A1 says the rest of analyze stays in the grantee's view.

### Fresh ground-truth checks of the design's premises

- **(a) is red on main.** PipelineAnalyzeReads.scala:149 calls `findLastSourceSchema(pipelineId, user)`. That method
  filters `ownerId === caller` (PipelineRepository.scala:600-609), so a grantee gets a `None` baseline and no drift.
- **(b)/M2 is sound.** Under the fix, a privileged baseline diffed against `findByIdOwned(dsId, user)` for a grantee
  who cannot see the source (:77, empty schema) reports every column removed. So M2 turns (b) red.
- **D2's primary root is the same root.** `rootDsOpts` traverses `listRootDataSourceIdsInternal` in order, and
  `primarySchema = rootSchemas.headOption` (:91). D2's "first entry of listRootDataSourceIdsInternal" is therefore
  the same root.
- **(d) is red on main.** For a non-AI closure, `authorizedForAi` short-circuits to true
  (PipelineRunPreview.scala:245), and `backend.execute` (:263) runs after the step-list read at :205. A revoke at that
  seam therefore executes on main.
- **(e) is red on main.** In the source-level arm, `resolveAllRootDataSourcesInternal` (:140) is the last DB read
  before `backend.execute` (:178). A revoke there executes on main.
- **(f) S1 is red on main.** Roots cascade with the pipeline, so `roots.isEmpty` gives 422 "DataSource not found"
  (:141-144). The step lookup happens after that, so S1 never degrades to "Step not found".
- **D3's predicate matches today's gates.**
  - `findGrantRole` (PipelineRepository.scala:184-194) reads `permissions` rows (resource_type='pipeline') under the
    system context.
  - `findByIdShared` admits the owner, or an editor or viewer grant.
  - So "owner, or any grant (or an editor grant when requireEditor)" exactly re-states the existing entry gate plus
    HEL-1108's AI gate. Replacing `authorizedForAi` keeps the viewer AI-closure preview at 403 with zero model calls,
    and (g)/M5 pins that.
- **Supporting pieces exist.**
  - The `RunAuthorization` ADT is at PipelineRunRepository.scala:652-656.
  - `findByIdOwnedByInternal` is at DataSourceRepository.scala:190.
  - The `PipelineRunPreview.scala -> 1` entry and the comment to rewrite are at
    ExistenceNotLeakedRoutesSpec.scala:519-520 and :534.
  - There is currently one `ServiceError.Forbidden` in PipelineRunPreview.scala (:250). Task 3.3 correctly says to
    set the count to whatever the real number is after the change, rather than guessing.
- **Every AC is covered.**
  - AC1 is covered by D1, D2 and test (a) (NOBYPASSRLS, red first).
  - AC2 is covered by D3: the revoked case by (d)/(e), the deleted case by (f), and the "live previews unchanged"
    clause by (g).
  - The ticket's literal "owner-or-editor" wording is handled as assumed call A2 and is recorded for owner review.

### Verdict: CONFIRM

### Non-blocking notes

- The tasks are listed in the order 3.2a, 3.2c, 3.2b. This is cosmetic only.
- `PipelineRunRepository.submitterMayRunAction` is `private` (:268). The 3.2b cross-reference is doc-only, which is
  fine. Do not widen its visibility to "reuse" it.
- A1–A3 are product calls the planner assumed overnight. The PR must carry OWNER REVIEW and stay parked, as
  workflow-state.md records.
