## 1. Backend — measurement

- [x] 1.1 Confirm `DataSource.scala` read-path documentation against current code and correct any stale references to the retired `DataType` concept; verify by grepping for `DataType` in `DataSource.scala` and cross-checking HEL-904/909 as the retirement source.
      Note (executor, cycle 1): grep confirms `DataType` doc-comment references still exist at
      `backend/src/main/scala/com/helio/domain/model/DataSource.scala:11,34,133,142` (retired per
      HEL-904/HEL-909). Correcting those Scaladoc comments would be a `backend/src` production-code
      edit, which this decision-only ticket's own AC ("no implementation lands before this ticket
      closes") and task 3.1 explicitly prohibit. design.md's own Context section does not repeat the
      stale `DataType` framing — it correctly describes the current architecture (`data_sources.config
      jsonb`, no `DataType` row) — so the decision itself is not built on stale documentation. The
      doc-comment cleanup is deferred to the leaf ticket that touches this file (HEL-1077/1078/1080).
- [x] 1.2 Query the shared dev Postgres `data_sources` table for `static`-kind row counts, size distribution, and residue-vs-real breakdown; verify by capturing the query output as evidence (see design.md Context).
      Verified: design.md's Context section already carries this measurement (2124 `static` rows,
      residue-vs-real breakdown, avg 3.1 rows/source, max 220, blob sizes 74-220 bytes) dated
      2026-09-10 — satisfies this task as written.

## 2. Docs — decision

- [x] 2.1 Write `design.md`'s Decisions section naming the chosen store (`dataset_rows` new table), the legacy-blob-path disposition, and the row-level-addressing answer, each backed by the measurement in 1.1/1.2; verify by re-reading design.md against the ticket AC ("the decision names the measurement that produced it").
      Verified: design.md's Decisions section names the store (`dataset_rows` new table), the legacy
      blob-path disposition ("Legacy blob path" subsection), and row-level addressing ("Row-level
      addressing" subsection), each citing the 1.2 measurement and the HEL-904/909 retirement from 1.1.
- [ ] 2.2 Update HEL-1075's Linear ticket with the decision summary and a link to the merged design.md; verify by checking the posted comment.
      Note (executor, cycle 1): deliberately left unchecked — posting to Linear is handled by the
      orchestrator at Delivery, not by the executor. Not silently dropped; flagging here so Delivery
      picks it up.

## 3. Tests

- [x] 3.1 No production code changes in this ticket — verify by confirming `git diff --stat` against `main` touches only `openspec/**`, `docs/**`, and Linear/evidence artifacts, no `backend/src`, `frontend/src`, or migration files.
      Verified: `git diff --stat main -- .` and `git status --porcelain` show only untracked/added
      files under `openspec/changes/decide-dataset-row-storage/` — no `backend/src`, `frontend/src`,
      or migration files touched.
