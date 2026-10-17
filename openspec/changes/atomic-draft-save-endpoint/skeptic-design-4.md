## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed at worktree HEAD 29cb0a60f41e72b0a6b26c15a28360c504fffdb8 (change dir untracked):
- ticket.md, proposal.md, design.md, tasks.md (Standing Constraints C1-C8)
- specs/{pipeline-draft-save,pipeline-definition-lock-protocol,patch-set-undo}/spec.md

I checked them against the live tree and against my prior-round reports. I followed the owner rulings (E, reload-only,
refuse-dependent-restore-rest) and did not re-litigate them.

### What I verified (with evidence)

**Round-3 CR1 (set-membership race on source delete): addressed.**
- (a) D5 now specifies a mechanism, hypothesis H′:
  - Source delete takes its `data_sources` row `FOR UPDATE` first. This conflicts with the FK key-share of every root add, so
    the rooted set is frozen before it is read.
  - It then calls `lockForDeletion(dataSources)`, then takes (3) over the frozen set.
  - Root add takes its source key-share explicitly before (2)/(3).
  - The resulting global order (source → panels → dashboards → advisory → pipeline → Outputs → alert rules) is written into H.
  - If no consistent order exists, the executor escalates (C3).
  - The mechanism holds at the schema level. `pipeline_roots.data_source_id REFERENCES data_sources ON DELETE CASCADE` (V98:81)
    is the only FK into `data_sources` on the pipeline side; the others are V22 (dropped per V99), V106 dataset_rows and V4. No
    step row FK-references a source, so the save never key-shares a source row after (3).
- (b) Task 6.3b adds a three-session race spec, red first.
- (c) 6.4 now includes a root add plus a source delete on the same source.
- (d) D6 and C8 flag every writer that locks (3) over a set it read. Each gets a three-session spec.
- The round-3 non-blocking note is adopted: a pipeline already deleted by a racer is dropped from the set and the delete
  carries on.

**Round-3 CR2 (D2 delete rule): addressed.** D2 now states a single rule.
- Removed steps are EXACTLY the current set minus the draft. There is no `removalOf` and no splice, and the server never
  deletes a step the draft keeps (C8).
- The order is: (a) topological inserts with final parents, (b) re-link survivors, (c) one `DELETE`, (d) config updates,
  (e) Outputs, then the cycle validators.
- I checked the FK claim. `parent_step_id REFERENCES pipeline_steps(id)` has no ON DELETE clause (V94:172), so it is NO ACTION
  and is checked at statement end. A single multi-row DELETE of a removed subtree is therefore safe, and (b) runs before (c), so
  no survivor still points at a removed row.
- I grepped every migration touching `pipeline_steps`. There is no unique index on root-level heads or positions; the only
  uniqueness is `pipeline_roots UNIQUE (pipeline_id, position)`, V98:84. So (a) cannot transiently collide.
- The V98:127 CHECK `(parent_step_id IS NULL) = (root_id IS NOT NULL)` is respected because (a) inserts with final
  parents/roots.
- The cascade 422 is "exactly this removed set plus its panels and alert rules".
- 6.1 adds all four required cases:
  - keep the head child;
  - keep a tail child that moved elsewhere;
  - an Output on a removed step;
  - an invalid forest.
- 6.6 adds undo of a branching-step delete.

**Round-3 non-blocking notes.**
- D11 states the reasoning for the count-returning helper in the migration header.
- D7 documents that run history, snapshots and payloads are not restored.

**Earlier rounds.**
- These items still stand in the text:
  - C4-C7;
  - D3 lock-free cores plus the `pg_stat_user_functions` count;
  - D3 pool pinning;
  - D5 "(2) never after (3)" plus re-plan → 409;
  - D7 derived confirmation;
  - task 4.1 gated on 6.3.
- None was regressed by the round-4 edits.

**On the merits.**
- A plan that follows D6 honestly either proves G1-G3 with mutation-red specs or stops at C3 with transcripts. Every hazard I
  can find in the code is either named as a probe target or enumerated for an order argument:
  - D5(a)-(g);
  - task 1.1's participant list;
  - the `lockSource` FOR UPDATE callers at `DataSourceRepository.scala:586/665/720/775/823/986/1089`, which are named as the
    `applyWriteBacks` candidate cycle;
  - `WorkspaceTeardownRepository.scala:166`, which is `lockForDeletion(dashboards, pipelines, sources)` → delete pipelines →
    delete sources, i.e. panels before source, and is listed as D5(g).

### Verdict: CONFIRM

### Non-blocking notes

1. **The G2 requirement in `specs/pipeline-definition-lock-protocol/spec.md` lists the order without the source-row prefix**
   ("panels, dashboards, ..., alert rules"). That contradicts D5's H′ (source → panels → ...).
   - Task 6.8 must amend this delta to the VERIFIED order before archive. Otherwise the main spec ships a false SHALL.
   - The final-gate skeptic should check this.
2. **D6(ii) and task 1.1 define G2 participants as transactions taking "locks (1)-(5)".** H′ effectively adds a lock (0), the
   source row.
   - D5 does require an argument "for every participant that locks a `data_sources` row". The executor should still list ALL of
     them explicitly in `g1-writers.md` with the same rigor:
     - every `lockSource` caller;
     - dataset row inserts (key-share, V106:32);
     - teardown;
     - root add.
   - Teardown is a concrete candidate inversion against H′. It takes panels before the source row, while the H′ source delete
     takes the source row before panels. A user-initiated source delete concurrent with that user's workspace teardown, on an
     overlapping source, is a real interleaving to probe or argue.
3. **D5's set-writer rule ("drop and carry on") versus the single-pipeline writers' "current not-found path"** should be
   recorded per writer in `g1-writers.md`, as round 3 suggested.
