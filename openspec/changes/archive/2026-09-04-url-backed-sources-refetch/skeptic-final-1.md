## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

1. **Diff scope** — `git diff main...HEAD --stat` on HEAD `04c9f7b8`: touches
   `InProcessPipelineEngine.scala`, `LocalFileSystem.scala`,
   `PipelineRunService.scala`, `ContentSourceSupport.scala`,
   `DataSourceService.scala`, plus tests and openspec artifacts. Confirmed
   (`git diff --name-only`) **no** touches to `WorkspaceContextService.scala`,
   `PipelineService.scala`, `api/protocols/patchsets/**`, `helio-mcp`, the REST
   connector fetch path, or schema inference. Confirmed no new Flyway
   migration (`db/migration` tree unchanged, highest file still `V99`).

2. **Upload-only sources genuinely untouched** — read the full
   `InProcessPipelineEngine.scala` diff: each of `TextSource`/`PdfSource`/
   `ImageSource` now matches on `config.sourceUrl`; the `None` branch is
   byte-for-byte the pre-existing code path (same error messages, same
   `fileSystem.read`). `InProcessPipelineEngineUrlRefetchSpec`'s "upload-created
   (sourceUrl = None)" test asserts `changingHits.get() shouldBe 0` — a real
   local HTTP server whose hit-counter would be nonzero if any network call
   were issued.

3. **Real changed-bytes proof, not evidence-shaped non-evidence** — read
   `InProcessPipelineEngineUrlRefetchSpec.scala` in full. All four kinds (csv
   already covered by HEL-862; text/pdf/image added here) probe against a real
   local akka-http test server that serves genuinely different bytes on
   sequential hits, and assert on the actual returned content, not just a
   "fetch was called" spy. The image test in particular:
   `bytesOnDiskAfterRun1 shouldBe redPng` / `bytesOnDiskAfterRun2 shouldBe
   greenPng`, read back via `fileSystem.read(storageKey)` — i.e. the exact
   bytes reachable through `storageKey`, not merely derived
   width/height/mimeType — and the file is pre-seeded with a *third* distinct
   image so the assertion can't pass by coincidence.

4. **Fetch failure fails the run, never serves stale bytes** — `"a fetch
   failure (5xx upstream) fails the run..."` test seeds `storedPath` with
   `"should-never-be-served"` content, points `sourceUrl` at a route that
   500s, and asserts the run throws `IllegalArgumentException` naming the
   source. Ran this spec myself (`sbt "testOnly
   com.helio.domain.engine.InProcessPipelineEngineUrlRefetchSpec"` as part of
   the combined run below) — passes.

5. **LocalFileSystem atomicity guard — reproduced myself, not trusted from
   the report.** I reverted `LocalFileSystem.write` to the pre-fix bare
   `Files.write(target, bytes)` and re-ran `LocalFileSystemSpec`:
   ```
   [info] - should stages a same-directory temp file during a large write, and leaves none behind afterward *** FAILED ***
   [info]   false was not equal to true (LocalFileSystemSpec.scala:137)
   [info] Tests: succeeded 14, failed 1, canceled 0, ignored 0, pending 0
   ```
   Confirmed the guard genuinely goes red against the claimed reversion, then
   restored the file (verified `git diff` on `LocalFileSystem.scala` was
   clean afterward). Also confirmed by reading the code: `Files.createTempFile(
   target.getParent, ...)` places the temp file in the **same directory** as
   the target (not a system temp dir), which is what keeps `ATOMIC_MOVE`
   actually atomic rather than degrading to a cross-mount copy. The `catch
   NonFatal` branch deletes the temp file on any failure — verified by the
   second new test ("cleans up the temp file... when the atomic move fails"),
   which forces the move to fail (target path is a non-empty directory) and
   asserts zero `.tmp` siblings remain and the original directory contents
   are untouched.

6. **CSV behaviour preserved through the shared seam** — `urlFetchSeam` in
   `PipelineRunService.scala` dispatches `"csv"` to the untouched
   `CsvUrlFetch.fetch(url, CsvUrlFetch.maxFileSizeBytes, resolveHost,
   isBlocked)` (same call as before this diff), and `"text"/"pdf"/"image"`
   to the new `ContentSourceSupport.fetchUrlWithLimit`, which deliberately
   does **not** carry CSV's https-only or non-CSV-body gates (per the
   docstring and `csv-url-ingestion/spec.md`). Ran `InProcessPipelineEngineSpec`
   (its existing CSV https-only/size/non-CSV-body tests) alongside the new
   specs — all pass, 270/270 in the combined engine+run-service run.

7. **Full evidence re-run** — ran the whole backend suite fresh:
   `cd backend && sbt test` → `Tests: succeeded 3749, failed 0` in 4m32s.
   Confirms nothing else regressed.

8. **The `example.com` determinism question** — read both new
   `PipelineRunServiceSpec` tests. They hit `https://example.com/notes.txt`
   for real. I verified independently (`curl -m5 https://example.com/notes.txt`
   → `404`) and ran the two tests directly (`sbt 'testOnly
   com.helio.services.pipelines.PipelineRunServiceSpec -- -z "shared seam"'`
   → both pass in ~2s). Judgment: this is a genuine test-hygiene smell (a
   backend unit test making a live call to a third-party domain, in a repo
   that already established a local-test-server pattern for exactly this
   purpose two files over in `InProcessPipelineEngineUrlRefetchSpec`), but it
   is **not a validity defect** in the evidence for the acceptance criteria —
   both tests assert only that the shared dispatch is reached from
   `submit`/`previewStep` (already proven at the engine level with local
   servers), and either a 404 or a network-down "Request failed" satisfies
   the assertion (`result shouldBe a[Left[_, _]]` / `UnprocessableEntity`).
   The only way this test misfires is if `example.com` ever serves 2xx for an
   arbitrary path, which is not plausible for that domain's actual behavior.
   I am treating this as **non-blocking** but recording it as a concrete,
   actionable follow-up rather than waving it through silently.

### Verdict: CONFIRM

### Non-blocking notes
1. `PipelineRunServiceSpec.scala` (two new tests near line 947 and 989):
   replace the live `https://example.com/notes.txt` calls with a local
   akka-http test route (the pattern already used in
   `InProcessPipelineEngineUrlRefetchSpec`), so these tests don't depend on
   an external domain's continued 404 behavior or on the CI sandbox's network
   egress characteristics. Low priority, does not block this delivery.
