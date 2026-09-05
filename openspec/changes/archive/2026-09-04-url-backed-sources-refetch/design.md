## Context

`InProcessPipelineEngine.loadRowsWithStats` is the single choke point every pipeline run reads its source rows
through (scheduled fire, manual run, and step preview all reach it; `join`/`union`/`lookup` re-enter it for their
secondary source). Its `DataSource` match has seven cases. HEL-862 added a `sourceUrl` branch to the `CsvSource`
case and injected a `csvUrlFetch` seam wired by `PipelineRunService` to `CsvUrlFetch.fetch`. The `TextSource`,
`PdfSource` and `ImageSource` cases were not touched and still call `fileSystem.read(config.path)`
unconditionally, even though all three configs carry `sourceUrl: Option[String]`.

Verified against the tree at `0f16b85d` before planning (`.concertino/runs/HEL-881/evidence/premise-validation.md`):
`sourceUrl` already exists and is already persisted in each config's JSON, so **no Flyway migration is in scope** —
a hard constraint here, since parallel worktrees share one dev Postgres.

### Enumeration of every source kind on the engine load path

Required by the ticket's AC4, re-derived from `loadRowsWithStats`, not from the ticket:

| Kind | Today | Required |
| --- | --- | --- |
| `static` | inline rows from `raw_config` | no fetch — there is no upstream; the config *is* the data |
| `csv` | re-fetches `sourceUrl` when present (HEL-862) | keep, moved onto the shared path |
| `text` | reads stored file always | **broken** — must re-fetch when `sourceUrl` is present |
| `pdf` | reads stored file always | **broken** — same |
| `image` | reads stored file always | **broken** — same |
| `rest_api` | `connector.fetch` every run | already live; owned by a parallel run (HEL-844) — untouched |
| `sql` | `SqlConnectorDriver.fetch` every run | already live per run — untouched |

Any kind added to this match after planning must be classified the same way before the PR is opened.

## Goals / Non-Goals

**Goals:**
- A URL-backed `text`/`pdf`/`image` source derives its run rows from freshly fetched bytes.
- One shared run-path fetch entry point for all four URL-backed kinds.
- Upload-created sources of every kind behave byte-for-byte as they do today.
- The proof is changed upstream bytes producing changed rows, not a spy asserting a function was called.

**Non-Goals:**
- No migration, no ETag/If-Modified-Since conditional requests, no fetched-at column, no caching layer.
- No change to the `FileSystem` trait, `GcsFileSystem`, `DataSourceService.refresh`, the REST connector fetch path, schema inference, or any file owned by
  a parallel run (`WorkspaceContextService.scala`, `PipelineService.scala`, `api/protocols/patchsets/**`,
  `helio-mcp`). If the fix appears to require reaching into one of those, stop and escalate.
- No browser-driven verification (parallel runs share one Playwright session).

## Decisions

### Decision 1 — Confirm the mechanism with a probe before writing the fix

Three mechanisms could each produce "stale content on a scheduled run": (a) content captured at upload and never
refetched by the engine; (b) a conditional-request header short-circuiting an actual fetch; (c) a storage-layer
read preferred over a network read. They need different fixes. The static read above points hard at (a), but the
implementation SHALL begin with a failing probe test that runs a URL-backed `text` source twice against a local
test server whose bytes change between the runs, and observes the second run's rows still carrying the first
bytes. Only once that probe is red does the fix get written; the probe then becomes the regression test. A fix
written before the probe is red is not accepted, per `systematic-debugging`.

### Decision 2 — Generalise the existing seam rather than adding three more

The engine gets one fetch seam covering all URL-backed kinds instead of `csvUrlFetch` plus three siblings. The
seam is widened to carry the kind's policy (its size limit, and whether the CSV-only https-only + non-CSV-body
gates apply) so the engine holds one branch shape and `PipelineRunService` supplies one implementation. This is
the ticket's explicit AC5 and the HEL-599 drift lesson. Rejected: copying the CSV branch three times — four
independently-editable copies of a security-sensitive fetch is exactly how the schema/row traversal drifted.

### Decision 3 — Preserve per-kind scheme and size policy exactly as manual refresh applies it

`csv-url-ingestion`'s shipped spec states that CSV is https-only and that `ContentSourceSupport.fetchUrl` — which
also serves text/PDF/image and permits both `http` and `https` — SHALL NOT be modified. So the shared path applies
the https-only pre-check and the non-CSV body gate for `csv` only, and applies each kind's own configured maximum
size (`textMaxBytes`/`pdfMaxBytes`/`imageMaxBytes`/`CsvUrlFetch.maxFileSizeBytes`). Making the run path stricter
than the refresh path would break already-stored `http` text sources on their next run — a new failure introduced
by a bug fix. Both directions of this must be tested.

### Decision 4 — `image` additionally writes the fetched bytes back to storage, atomically

A `text` row carries `content` as an inline string and a `pdf` row carries per-page extracted text, so for those
two an in-memory re-fetch fully satisfies the AC. An `image` row instead carries
`content = {storageKey -> config.path, ...}` — the bytes are served later from storage by key. An in-memory-only
re-fetch for `image` would refresh `width`/`height`/`mimeType`/`sizeBytes` while the rendered image stayed old:
a metadata/content mismatch in the same silent-wrong-answer class as the bug under repair, and harder to notice,
because everything would look freshly updated. The `image` branch therefore writes the fetched bytes to
`config.path` before building the row, matching what `refreshImage` already does.

Because that write now fires on every run rather than only on a user-initiated refresh, `LocalFileSystem.write` is
made atomic: write to a temp file **in the same directory as the target**, then `Files.move` with `ATOMIC_MOVE`.
The same-directory placement is load-bearing — `ATOMIC_MOVE` only holds within a single filesystem, so a temp file
under `/tmp` or any other mount silently degrades to a copy, leaving the torn-read hazard intact while the code
claims otherwise. The temp file is cleaned up on failure so a failed write does not litter the uploads tree.

This is confined to `LocalFileSystem.write`'s body: the `FileSystem` trait is unchanged, and `GcsFileSystem` needs
no change because GCS object writes are already atomic. It is a strict improvement for every existing caller —
image uploads, data-source writes, and the assistant transcript writes, which use a write-then-record ordering that
a torn file would corrupt silently — not a cost paid for the image case alone. That framing belongs in the PR body.

AC verification for `image` must assert on the bytes reachable through `storageKey`, not only on the derived
dimensions; asserting only on dimensions would pass while this defect was present. Atomicity needs a test that
would fail if `write` reverted to a bare `Files.write` — assert the temp-and-move behaviour itself, or the guard is
documentation rather than a guard.

### Decision 5 — A failed fetch fails the run; never fall back to the stored file

Falling back to the snapshot on a fetch error would restore exactly the silent staleness under repair, with a
green run and no operator signal. The run fails with an error naming the source and the reason, matching the CSV
precedent.

### Decision 6 — Report the true breadth rather than only the scheduled path

The ticket says "scheduled run", but `loadRowsWithStats` is shared by scheduled runs, manual runs, and step
preview, so the defect and the fix both cover all three. The PR must state this explicitly rather than describing
a scheduled-only fix, and at least one test must exercise a non-scheduled path.

## Risks / Trade-offs

- **A run now makes network calls it previously did not.** That is the intended correction, but it makes a run
  fail where it previously succeeded-with-stale-data. Accepted: a loud failure is strictly better than a silent
  wrong answer, and it is the behaviour `csv` has already shipped with.
- **The `image` storage write (Decision 4) mutates shared upload storage during a run.** Confined to sources that
  already opted into URL backing, writing to the path that source already owns. The torn-read hazard that this
  frequency increase would otherwise create is removed, not merely accepted, by the atomic-write change in the same
  decision. Coordinator-verified: no other in-flight run touches `LocalFileSystem` (HEL-844 is in the REST fetch
  path, HEL-868 in schema inference, HEL-914 in proposals), so there is no contention on this shared file.
- **Widening the seam touches the CSV path.** Mitigated by keeping every shipped `csv-url-ingestion` behaviour
  under test — https-only, size limit, non-CSV gate — through the new shared path.
- **Test doubles could make the proof vacuous.** The probe must use a real local HTTP server with genuinely
  differing bytes between the two runs; a stubbed fetch function returning canned values proves nothing here.
