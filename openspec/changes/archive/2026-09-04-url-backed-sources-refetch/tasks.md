## 1. Probe the root cause before fixing

- [x] 1.1 Re-derive the enumeration in design.md from the current `loadRowsWithStats` match; if a kind was added
      since planning, classify it and record it.
- [x] 1.2 Write a probe test that runs a URL-backed `text` source twice against a local test HTTP server whose
      response bytes change between the runs, asserting the second run's rows carry the new bytes. Confirm it is
      RED, and record the observed failure (which bytes were served) as the root-cause evidence.
- [x] 1.3 Rule out the two competing mechanisms explicitly: show no conditional-request header is involved, and
      show the read is a storage read rather than a short-circuited fetch. Record the disproof.
- [x] 1.4 Check manual runs and step preview as well as scheduled runs, and record whether the defect is broader
      than the ticket states.

## 2. Shared run-path fetch

- [x] 2.1 Generalise the engine's URL-fetch seam from CSV-only to one entry point carrying per-kind policy (size
      limit; https-only + non-CSV body gate for `csv` only), per design Decision 2/3.
- [x] 2.2 Rewire `PipelineRunService` to supply the single implementation, keeping the lazy `ActorSystem` capture
      that the existing seam relies on.
- [x] 2.3 Keep the default seam value loud-on-use so fixtures that omit it fail rather than silently no-op.

## 3. Engine branches

- [x] 3.1 `text`: re-fetch when `sourceUrl` is present; otherwise read the stored file with unchanged error text.
- [x] 3.2 `pdf`: same, feeding fetched bytes into the existing page extraction and its existing parse-failure error.
- [x] 3.3 `image`: same, and write the fetched bytes to `config.path` before building the row (Decision 4).
- [x] 3.3a Make `LocalFileSystem.write` atomic: stage in a temp file **in the same directory as the target**, then
      `Files.move` with `ATOMIC_MOVE`; delete the temp file on failure. Do not change the `FileSystem` trait or
      `GcsFileSystem`.
- [x] 3.4 `csv`: moved onto the shared path with no behaviour change.
- [x] 3.5 A fetch failure fails the run with an error naming the source; no fallback to the stored file.

## 4. Tests

- [x] 4.1 Promote the 1.2 probe to a regression test; add the equivalent changed-bytes-across-two-runs test for
      `pdf` and for `image`. The `image` assertion must read the bytes at `storageKey`, not only the dimensions.
- [x] 4.2 Upload-created (`sourceUrl = None`) `text`/`pdf`/`image` sources still read the stored file and make no
      network call; missing-`path` errors unchanged.
- [x] 4.3 CSV behaviour preserved through the shared path: https-only rejection, size limit, non-CSV body gate,
      upload-created CSV unaffected.
- [x] 4.4 An `http` `sourceUrl` on `text`/`pdf`/`image` is still accepted on the run path (Decision 3), and each
      kind's size limit is enforced.
- [x] 4.5 A fetch failure fails the run rather than serving stored bytes.
- [x] 4.5a Atomicity guard that FAILS if `write` reverts to a bare `Files.write` — assert the temp-and-move
      behaviour itself (e.g. no partially-written content is ever observable, and no temp file survives a failed
      write). A test that only asserts the final bytes would pass against the non-atomic implementation and is not
      acceptable as this guard.
- [x] 4.6 At least one non-scheduled path (manual run or preview) covered, per Decision 6.

## 5. Gates and delivery

- [x] 5.1 `sbt test` green; backend code-quality and OpenSpec hygiene checks pass. No Flyway migration added —
      verify `db/migration/` is untouched.
- [x] 5.4 PR body records: the shared-caller argument for the atomic write (image uploads, data-source writes, and
      the assistant transcript writes' write-then-record ordering all benefit; it is not a cost paid for images),
      and the fact that the fix covers scheduled, manual and preview runs because the dispatch is shared.
- [x] 5.2 Verify no file owned by a parallel run was touched (`WorkspaceContextService.scala`,
      `PipelineService.scala`, `api/protocols/patchsets/**`, `helio-mcp`, the REST connector fetch path, schema
      inference). Escalate rather than absorbing any such change.
- [x] 5.3 Record the kind enumeration and the true breadth (scheduled/manual/preview) in the PR body.
