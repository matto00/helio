## 1. Tests

- [x] 1.1 Replace the `https://example.com/data.csv` literal at the `seedCsvUrlDs` call site (~line 939) in `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` with `https://pipeline-run-service.test/data.csv`.
- [x] 1.2 Replace both `https://example.com/notes.txt` literals at the two `seedTextUrlDs` call sites (~lines 972 and 1014) in the same file with `https://pipeline-run-service.test/notes.txt`.
- [x] 1.3 Confirm by reading the diff that no assertion, comment, import, or fixture helper changed — the diff must be exactly three string literals, and no production file may appear in it.
- [x] 1.4 Re-grep `PipelineRunServiceSpec.scala` for `example.com` and confirm zero remaining hits.
- [x] 1.5 Run `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"` from `backend/` and confirm it passes, capturing the output as evidence.
- [x] 1.6 Record in `files-modified.md` that exactly one file changed, and re-state the negative grep sweep of `backend/src/test/` (no test in the backend suite reaches a live external host) for the PR body.
