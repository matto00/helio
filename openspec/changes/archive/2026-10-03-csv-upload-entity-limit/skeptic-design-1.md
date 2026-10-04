## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)
- Read ticket.md, proposal, design, tasks, spec delta.
- Route enumeration vs tree: toStrict multipart sites are DataSourceRoutes.scala:276 (create), DataSourcePreviewRoutes.scala:73 (infer), PanelRoutes.scala:143 (submit), UploadRoutes.scala:46 (image). Matches design: only infer + create carry CSV.
- Run-path loading: InProcessPipelineEngine.scala:539/549 call loadCsvRowsFromBytes (full String + linesIterator.toVector) - confirms design's claim and that the run-time check site exists. Preview (DataSourceService.scala:1275 previewCsv) does new String(bytes) then parseCsvRows; first-run sampleAndBuild goes through dataSourceService.preview, so a previewCsv check covers it.
- SchemaInferenceEngine.splitCsvLines (line 216) splits the whole file: head-only claim is real work. CsvUrlFetch.maxFileSizeBytes (50 MiB, env override) exists as claimed. ServiceError.PayloadTooLarge already maps to 413 (ServiceResponse.scala:97). infer route (preview routes line ~85) maps non-BadRequest errors to 500 - needs a PayloadTooLarge case; covered by D3 intent.
- Every AC maps to a task (red first 1.1, green/413 2.2, frontend 3.x, live themes 4.2); memory ESCALATE condition handled by measurement plus caps.

### Verdict: CONFIRM

### Non-blocking notes (executor should treat 1-3 as binding detail)
1. Row-count definition: D3 says "newline count". The engine (linesIterator) and SchemaInferenceEngine.splitCsvLines both treat bare CR and CRLF as line breaks. CsvLimits.check must count line terminators the same way (LF, CR, CRLF counted once), otherwise a CR-only 50 MiB file reports ~0 rows and bypasses the cap straight into the OOM path. Add a unit test for CR-only and CRLF.
2. D5 contains a garbled sentence ("permit acquired only once the type is known to be CSV is impossible..."); intent is clear (permit wraps whole multipart create route). Ensure the permit is released on every completion path (success, failure, stream exception) with a test, and that the 429 rejects before the entity is consumed.
3. Over-the-wire 413: a client mid-upload may see a connection reset rather than a readable 413 when the server answers early; verify live (task 4.2) that the frontend actually surfaces the 413 message, not a generic network error.
4. The ticket AC says "up to 50 MiB succeeds"; with the 50k-row / 750k-cell caps typical 50 MiB files will 413. The owner constraints cover row caps, but the PR body must state this narrowing explicitly with the measurements.
5. SparkJobSubmitter reads CSV by path outside the JVM heap path; note as out of scope in the PR.
