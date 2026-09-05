## Skeptic Report — final gate (round 1, skeptic-final-1.md)

### What I verified (with evidence)

- **Seam claim re-derived from source, not from the artifacts.**
  `PipelineRunServiceSpec.scala:134-139` constructs `new PipelineRunService(...)` with named args
  (`registry`, `connector`, `outputRepo`, `nodeSnapshotRepo`) and **no `system` argument**;
  `PipelineRunService.scala:59` declares `system: ActorSystem[_] = null`; `urlFetchSeam` (`:90-92`)
  returns `Future.successful(Left("URL-backed source fetch is not configured"))` when `system == null`,
  ahead of every `CsvUrlFetch.fetch` / `ContentSourceSupport.fetchUrlWithLimit` branch (`:94-100`).
  The fixture does construct a `typedSystem`, but never threads it into the service — so the null
  short-circuit is real, not incidental.
- **That seam is the ONLY URL path in the engine.** `domain/engine/InProcessPipelineEngine.scala`
  calls `urlFetch(kind, url)` at `:513` (csv), `:541` (text), `:565` (pdf), `:597` (image) and nowhere
  else; its own constructor default (`:157-158`) is likewise a non-fetching `Left`. So the URL string
  in these three fixtures is never parsed as a host, resolved, or dialled. Premise refutation CONFIRMED
  independently.
- **Diff is exactly three inert string literals.** `git diff main...HEAD --stat` → one production-tree
  file touched (`PipelineRunServiceSpec.scala`, `6 +--` = 3 changed lines), rest is the change dir.
  Reading the full diff: only the host substring changed on lines 939/972/1014. No assertion, comment,
  import, or fixture helper touched. No production file in the diff.
- **AC1** — three literals now `https://pipeline-run-service.test/{data.csv,notes.txt}`, matching the
  sibling `<spec-name>.test` convention. **AC2** — assertions unchanged (verified by diff, not claim).
  **AC3** — no HTTP server introduced (no new imports, no `bindAndHandle`). **AC5** — I re-ran
  `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"` myself: `Tests: succeeded 67,
  failed 0`, `[success]`. `grep -n example.com` on that file → 0 hits (rc=1).
- **Negative sweep spot-checked, not taken on trust.** The tree-wide claim covers 27 files; I checked
  the four highest-risk real-transport specs. `CsvUrlFetchSpec:134-144` asserts `resolveCalled shouldBe
  false` (proves no resolution, let alone a dial); `ContentSourceSupportSpec` uses the literals in
  `filenameFromUrl`/`validateUrl` string assertions with an injected resolver;
  `HttpResendEmailSenderSpec:35` asserts on `request.uri.toString` against a stub transport;
  `HttpClaudeTransportSpec:117` has the literal inside a decoded JSON payload. Claim holds where I probed.
- **Iron Laws:** this is not a bug fix, so `systematic-debugging.md`'s root-cause/regression-test
  obligation is satisfied by the ticket's own recorded refutation; `verification-before-completion.md`
  satisfied by the freshly re-run suite output above.
- No UI changes in the diff → design-standard review and dev-server startup correctly skipped.

### Verdict: CONFIRM

### Non-blocking notes

- AC4 (negative sweep recorded durably in the PR description) is not yet satisfiable — no PR exists at
  this gate. The text is staged in `files-modified.md`; the orchestrator must actually paste it into the
  PR body, or the AC lapses silently. Worth including the per-file classification, not just the negative
  conclusion.
- ~20 other backend specs still carry `example.com` literals. Correctly out of scope here; a tree-wide
  `.test` normalization would be its own ticket.
