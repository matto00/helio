## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Diff scope** — `git diff --stat main...HEAD` shows only 7 files under
   `openspec/changes/decide-dataset-row-storage/**` (267 insertions, no deletions).
   No `backend/src`, `frontend/src`, or `db/migration` paths touched. Confirms AC
   "no implementation of the dataset row-storage layer lands" and tasks.md 3.1.

2. **Code-path claims re-derived from source, not trusted from design.md:**
   - `grep -n "DataType" backend/src/main/scala/com/helio/domain/model/DataSource.scala`
     → hits at lines 11, 34, 133, 142 — matches design.md/tasks.md 1.1's citation
     exactly (stale Scaladoc, correctly left uncorrected as out-of-scope prod-code
     edit).
   - The three call sites design.md names as consuming `readRawConfig`/
     `parseStaticPayload` identically are exactly the three found by grep, no more,
     no fewer: `DataSourceService.previewStatic` (line 930), `InProcessPipelineEngine
     .loadRowsWithStats` (line 509), `SparkJobSubmitter.loadDataFrame` (line 169).
     `def updateStaticPayload`/`readRawConfig`/`parseStaticPayload` all live in
     `DataSourceRepository.scala` as claimed — single write path, single physical
     store, no row identity in the write signature (`updateStaticPayload(id, name,
     payload: JsObject, ...)` — whole-object replace, confirming the row-level-
     addressing gap that anchors the decision).
   - RLS: `\d data_sources` in the live dev DB shows `Policies (forced row security
     enabled): POLICY "data_sources_owner" ... owner_id = current_setting(...)` —
     matches design.md's RLS claim and the migration source (`V35__rls_owner_only_tables.sql`).

3. **Dev-DB measurement re-run independently (not trusted from design.md):**
   - `SELECT count(*) FROM data_sources WHERE source_type='static'` → **2124** (design.md: 2124, exact match).
     Note: design.md calls the column `kind`; the live schema names it `source_type`
     — cosmetic mislabel in prose, not a wrong measurement (I had to correct the
     column name myself to run the query, but the underlying count is right).
   - `avg(jsonb_array_length(config->'rows'))` / `max(...)` → **3.08 / 220** (design.md: "avg 3.1 rows/source, max 220" — matches).
   - Top-10 name-prefix groups by count sum to **1289** (design.md: "~1300" — matches, and `HEL-912 Lanes Rejoin Source` at 707 is the single largest group as claimed).
   - Blob size sample (most-recent 50 rows): min 63 / max 274 bytes. design.md says
     "74-220-byte range for the sampled recent rows" — close but not identical
     (different sample window/size than mine); the material conclusion ("no source
     approaches a size where JSONB overhead is a concern") holds under either sample
     and isn't load-bearing for the decision, so this is a non-blocking discrepancy,
     not a refutable one.

4. **Rationale stress-test.** The core argument — `updateStaticPayload` replaces the
   entire `{columns, rows}` array with no per-row id or per-row `updated_at`, and
   HEL-1078 needs `WHERE id = ? AND updated_at = ?` optimistic-concurrency semantics
   — is airtight given the actual method signature I read in
   `DataSourceRepository.scala:194`. The blob-reuse alternative (synthetic id inside
   the JSON array) is correctly rejected: it still requires a full-blob
   read-modify-write on every single-row edit under RLS, which is exactly the
   correctness hazard (concurrent-append race) the decision calls out. I looked for
   a case in the blob's favor (measured scale is tiny — avg 3 rows/source) and
   design.md addresses this directly in Decision point 4 rather than ignoring it:
   volume doesn't favor the blob, it's neutral, and the addressing requirement
   dominates. No hidden third option was skipped (DataType/snapshot reuse is
   confirmed retired under HEL-904/909, independently corroborated by the `DataType`
   Scaladoc-only grep above — no live `DataType` table or repository exists in this
   codebase to reuse).

5. **tasks.md honesty** — 2.2 ("Update HEL-1075's Linear ticket...") is correctly
   left unchecked with an explicit note that Linear posting is a Delivery-phase
   orchestrator responsibility, not silently dropped. 1.1/1.2/2.1/3.1 checked items
   match what I independently verified above.

### Verdict: CONFIRM

### Non-blocking notes
- design.md's Context section calls the `data_sources` discriminator column `kind`;
  the live schema names it `source_type`. Purely cosmetic (doesn't affect the
  decision or any query result cited), but worth a one-word fix if design.md is
  ever revisited, so a future reader querying the live DB doesn't hit the same
  `column "kind" does not exist` error I did.
