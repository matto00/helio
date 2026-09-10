## Skeptic Report — design gate (round N, skeptic-design-1.md)

### What I verified (with evidence)

1. **`DataType` retirement claim.** Read `backend/src/main/scala/com/helio/domain/model/DataSource.scala:130-144` — the `StaticSource` doc comment is indeed stale, referencing a "linked `DataType` row." Also read `DataSourceService.scala:900-908`, whose `upsertSourceDataType` comment explicitly states "HEL-904 ... there is no companion `DataType` row to find-or-create anymore." Confirmed via `git log --oneline --all | grep 'HEL-904\|HEL-909'`: `2ec2a5bc HEL-904 P1.1 Outputs model migration: outputs, node_snapshots, parent_step_id; drop data_types + metrics` and `94874bf4 HEL-909 ... retire wizard/BindingEditor/Types/Metrics pages`. The retirement claim is accurate.

2. **Single-physical-store / three-call-site claim.** Grepped `readRawConfig`/`parseStaticPayload`/`updateStaticPayload` across `backend/src/main/scala/`. Confirmed exactly three call sites read the blob: `DataSourceService.previewStatic` (`DataSourceService.scala:929-930`), `InProcessPipelineEngine.loadRowsWithStats` (`InProcessPipelineEngine.scala:507-509`), `SparkJobSubmitter.loadDataFrame` (`SparkJobSubmitter.scala:165-171`). Matches design.md exactly.

3. **`data_sources` schema and RLS policy.** `psql \d data_sources` on the live dev DB shows `config jsonb NOT NULL`, `owner_id uuid`, and a forced-RLS policy `data_sources_owner USING (owner_id = current_setting('app.current_user_id')::uuid)` — matches design.md's characterization and `V35__rls_owner_only_tables.sql`.

4. **Dev-DB measurement numbers.** Re-ran the queries myself (not trusting the doc):
   - `SELECT count(*) FROM data_sources WHERE source_type='static'` → **2124** (matches).
   - Top name-prefix groups by count: `HEL-912 Lanes Rejoin Source` = **707**, `HEL-813 Source` = 136, etc. — matches the "e2e/delivery-run fixture residue" characterization and the 707-row example cited verbatim.
   - `avg(jsonb_array_length(config->'rows'))` = **3.08**, `max` = **220** — matches "avg 3.1 rows/source, max 220 rows/source" exactly.
   All cited measurements reproduce.

5. **Decision-only scope / no code changes.** `git status` on the worktree shows only untracked `openspec/changes/decide-dataset-row-storage/` files; `git diff --stat main...HEAD` is empty (no commits yet, consistent with design-gate timing). No `backend/src`, `frontend/src`, or migration files are touched. tasks.md's task 3.1 correctly scopes verification to this check.

6. **Rationale coherence.** The four ranked reasons for "new table" (row-level addressing for HEL-1078's optimistic-concurrency precondition, `append`-mode concurrency safety, only-two-call-sites migration cost, volume/size not favoring the blob) are each traceable to evidence gathered in this same document, not asserted independently. The rejected alternative (synthetic per-row id inside the JSON blob) is addressed with a specific, non-hand-wavy reason (keeps the whole-blob-replace hazard). Row-level addressing is concretely resolved with a named shape (`dataset_rows(id, data_source_id, seq, data jsonb, created_at, updated_at)`) and a concrete precondition query (`WHERE id = ? AND updated_at = ?`). The legacy-blob-path disposition is concretely resolved (both call sites migrate to `readDatasetRows`; `config` becomes unused for `dataset`-kind sources; non-`dataset` kinds unaffected) — not left open.

7. **AC traceability.** AC1 ("the decision names the measurement that produced it") — satisfied; design.md's Context section states the measurement inline and Decisions section cites it by number. AC2 ("no implementation of the dataset row-storage layer lands as part of this ticket") — satisfied per point 5 above, and tasks.md's Non-Goals/task 3.1 make this explicit and verifiable.

### No placeholders / contradictions found

No `TODO`/`TBD` in design.md or tasks.md. Proposal, design, and tasks are mutually consistent (all describe decision-only scope, same three call sites, same RLS trap). The RLS-testing-parity concern correctly cites the standing prod trap and correctly defers its enforcement (non-superuser-role test) to the leaf tickets (HEL-1077/1080) rather than hand-waving it as "someone else's problem" with no trace — it's named as a requirement on those tickets.

### Verdict: CONFIRM

### Non-blocking notes

- The doc comment on `StaticSource` in `DataSource.scala:130-144` (referencing the retired `DataType` row) is now confirmed stale by this ticket's own investigation but is left uncorrected in code — reasonable to leave for the ticket that actually touches this file (HEL-1077 migration), since this ticket is decision-only, but worth a one-line follow-up note so it isn't lost.
- Migration Plan section is explicitly informational/non-binding, correctly labeled as guidance for leaf tickets rather than binding scope creep into this ticket.
