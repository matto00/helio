## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (against live tree)
- CR1 (date-like): FIXED. design.md D3 no longer mentions MM/dd/yyyy as accepted; it says non-ISO formats incl. MM/dd/yyyy are NOT date-like, states numeric-first precedence in D3 itself, and requires a shared predicate extracted from/next to DateBucketStep (parseToUtcDate is `private` at DateBucketStep.scala:158, so extraction is genuinely needed and is stated). Spec agrees ("datebucket step's own date parser, tested only for non-numeric columns").
- CR2 (sampling reader): FIXED. All named symbols exist with matching signatures: SchemaInferenceEngine.parseCsvRows(csv: String, maxRows: Int = 10): (Vector[String], Vector[Vector[String]]) (SchemaInferenceEngine.scala:67); DataSourceCsvSupport.csvPathFromConfig(JsValue): Option[String] and decodeUtf8(Array[Byte]): Option[String]; DataSourceRepository.findByIdOwned(DataSourceId, AuthenticatedUser): Future[Option[DataSource]] (L167). 404/400 mapping specified.
- Layout test: design D5 now requires reading the PERSISTED layout back from the repository (applyLayout swallows failures); covers lg/md/sm/xs for 1/2/3 panels. Task 1.4 states the layout spec but not "persisted" wording explicitly (D5 is binding).
- Earlier fixes (rollback injection, step wiring) unchanged and still sound.

### Verdict: CONFIRM

### Non-blocking notes
- D3 categorical rule contains a literal ellipsis (">= 2... otherwise text"); executor should read it as "distinct count >= 2 and <= max(20, 50% of sampled rows), otherwise text".
- Add the word "persisted" to task 1.4's layout spec for parity with D5.
- Add the MM/dd/yyyy-is-not-date-like test to task 1.1 (spec'd in D3 intent).
