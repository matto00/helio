## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Cold review. Every conclusion below derives from the files/diff/test output I read myself.
The executor and evaluator reports were treated as claims, not facts.

### What I verified (with evidence)

**1. `ContentSourceSupport.scala` is genuinely unmodified.**
`git diff origin/main..HEAD -- .../ContentSourceSupport.scala` → empty. Re-ran with the
three-dot form (`origin/main...HEAD`) → also empty. The security argument's premise holds:
`resolveValidated` (scheme/host/denylist) and `pinnedTransport` (the DNS-rebinding TOCTOU fix)
are untouched, as is the 2xx-only status check that refuses to treat a 3xx redirect body as
content.

**Base-staleness note (not a defect):** the two-dot diff also shows a README/docs-image revert.
This is because the branch is based on `7f29402e` and `origin/main` has since advanced to
`2a223e01` (the README rewrite, PR #469). It is *not* scope drift — `git log origin/main..HEAD
-- README.md docs/` returns no commits, and the three-dot diff contains no README/docs entry
at all. No file in this change overlaps that commit.

**2. The SSRF guard is genuinely reached on all three paths — traced, not inferred from signatures.**
I read `ContentSourceSupport.fetchUrl` in full to confirm the denylist is inside `fetchUrl`
itself (`resolveValidated` at the top, then `pinnedTransport` threaded into the pool settings),
not only in `validateUrl` — which matters, because `CsvUrlFetch` calls `fetchUrl` and never
`validateUrl`. It is. The guard is reached.

- **Create:** `DataSourceRoutes.createStaticRoute` `csv` branch → `createCsvUrl`
  (`DataSourceService.scala:231`) → `CsvUrlFetch.fetch(...)`.
- **Manual refresh:** `refreshCsv`'s `case Some(url)` (`DataSourceService.scala:668`) →
  `CsvUrlFetch.fetch(...)`.
- **Scheduled/manual run:** `InProcessPipelineEngine.loadRowsWithStats`'s `case c: CsvSource`
  → `csvUrlFetch(url)` seam → `PipelineRunService.csvUrlFetchSeam` → `CsvUrlFetch.fetch(...)`.
  `ApiRoutes.scala:288` threads the real `system` in, so the seam is live in production.

All three pass the production `resolveHost`/`isBlocked` defaults through unchanged (no call
site weakens them; the overrides exist only in tests).

**Bypass sweep (my own addition).** I searched for any way to get a `sourceUrl` into a CSV
config without passing the guard, or to read one without it:
- `grep -rn "CsvSourceConfig(" backend/src/main/scala` → exactly two construction sites:
  `createCsv` (always `None`) and `createCsvUrl` (constructed *after* a successful fetch).
- `PATCH /api/data-sources/:id` takes `UpdateDataSourceRequest(name: Option[String])` and the
  service's `CsvSource` arm is `c.copy(name = newName, updatedAt = now)` — config is not
  mutable over the API, so an attacker cannot plant `file://` or an internal host into an
  existing row.
No bypass found.

**3. AC3 is genuinely proven — differing upstream bytes produce differing ROWS.**
`InProcessPipelineEngineSpec`: two `loadRows` calls against a seam returning
`"name,age\nalice,30"` then `"name,age\nalice,31\nbob,40"`, asserting `firstRun` size 1 /
`age == "30"` and `secondRun` size 2 / `age == "31"` / `bob`. This is row content, not a
"refreshCsv was called" assertion — the fake the design explicitly forbade.
I confirmed this is not a parallel code path: `loadRows` (line 149) is literally
`loadRowsWithStats(ds, dataSourceRepo).map(_._1)`, i.e. the same branch the scheduler drives via
`PipelineRunService`. Companion tests also prove the snapshot path never calls the seam, a
failing fetch fails the run naming source + reason, and the default (unconfigured) seam neither
throws at construction nor silently serves stale data.

**4. Every rejection class has its own test asserting message content.** All 13 present in
`CsvUrlFetchSpec`, each asserting the ADT case *and* message substance:
http (+ `resolveCalled shouldBe false`, proving pre-network rejection), file, ftp, gopher,
schemeless, loopback, 169.254.169.254, RFC1918 10.0.0.5, IPv6 unique-local `fd12:3456::1`,
any-local 0.0.0.0, multicast 224.0.0.1, oversize (`TooLarge`, names the limit), HTML body
(names URL + "html"), BOM-prefixed HTML. The suite stands up a **real self-signed HTTPS server**
so the success path exercises the actual network path rather than a stub — a genuinely stronger
choice than a plain-HTTP stub, which this helper could not have exercised at all.

**5. ADT→status mapping matches Decision 2.** `csvUrlErrorToServiceError` maps
InvalidScheme→BadRequest(400), Upstream→BadGateway(502), TooLarge→PayloadTooLarge(413),
NotCsv→BadRequest(400). Both HTTP paths (`createCsvUrl` and `refreshCsv`) call that single
shared method, so they cannot diverge. `DataSourceServiceCsvUrlSpec` asserts all four statuses
on the create path, plus that a failed fetch and an over-limit body each leave the data-source
count unchanged (no partial state).

**6. Existing behaviour untouched.** `createCsv` (multipart/inline) still builds
`CsvSourceConfig(filePath)` with no URL; `refreshCsv`'s `case None` arm preserves the original
read *and* the exact `NoSuchFileException` message; the multipart route is unchanged. text/pdf/
image still call `ContentSourceSupport.fetchUrl` directly (lines 291/375/472/707/747/790) and so
still accept `http` — the https-only tightening is confined to CSV, as designed. The codec is
absent-tolerant (`decodeCsv` uses `obj.fields.get("sourceUrl").collect{...}`, tested with a
path-only JSON and with the legacy `filePath` key), and `encodeCsv` omits the key when `None`.

**7. Gates re-run by me, not accepted on assertion.**
- Backend: `sbt -batch test` from `backend/` → `Total number of tests run: 3741`,
  `Tests: succeeded 3741, failed 0`, `[success] Total time: 220 s`. I additionally confirmed the
  three new suites actually *executed* rather than being silently skipped: `CsvUrlFetchSpec`
  (20 cases), `DataSourceServiceCsvUrlSpec` (8 cases), `DataSourceConfigCodecSpec` present.
- helio-mcp: I reproduced the HEL-880 vacuous-green trap first. `npx jest` from `helio-mcp/`
  finds no config, falls back to babel and reports `26 failed, Tests: 0 total`; and root
  `npm test` is `jest --passWithNoTests` whose `testPathIgnorePatterns` includes
  `/.claude/worktrees/` — which matches *every* path in this worktree, so it would exit green
  having run nothing. I ran the real gate by supplying the root ts-jest config with that
  worktree pattern removed: **13 suites, 225 tests, all passed**, including both new suites
  (`csvDataSourceSchema.test.ts`, `helioApi.test.ts`). `npx tsc --noEmit` from `helio-mcp/` is
  clean.

**Findings confirmed still accurate and NOT silently fixed.**
- **Finding 1:** I read the engine's `TextSource`/`PdfSource`/`ImageSource` arms directly — each
  is still an unconditional `fileSystem.read(<config>.path)` with no `sourceUrl` branch. The
  scheduled-path staleness gap genuinely remains for those three, as reported.
- **Finding 3:** `ContentSourceSupport.fetchSizeLimitBytes` is still a `private val` (100 MiB)
  hard-coded into `toStrict(30.seconds, fetchSizeLimitBytes)` at line 226, with no `maxBytes`
  parameter. The CSV limit therefore still rejects rather than prevents the allocation, exactly
  as documented. Neither was quietly patched.

**Design-gate regressions:** I checked the corrections recorded in skeptic-design-1..4 against
the shipped code — public (not private) helper, discriminated ADT (not bare `String`), URI-parsed
scheme check (not `startsWith`), BOM skip before the `<` test, size limit inside the helper with
a single `maxFileSizeBytes` val that the route now reads too, lazy `system` deref in the seam,
mutual exclusion at the MCP layer, no `filenameFromUrl`/`validateExtension`. None crept back.

### Verdict: CONFIRM

The security core holds up under independent scrutiny: the shared guard is reused byte-for-byte,
all three paths provably reach it, there is no config-mutation route to plant a hostile URL, and
the load-bearing AC3 claim is proven by row content through the real engine path rather than
faked with a call assertion. Both gates are genuinely green, not vacuously so.

### Non-blocking notes

1. `CsvUrlFetchSpec`'s http-rejection case asserts `msg.contains("http")`, which is trivially
   satisfied by the word "https" in the message. The assertion is still carried by the
   `InvalidScheme` type match and `resolveCalled shouldBe false`, so it is not weak overall —
   but `msg.contains("'http'")` would assert what was intended.
2. The four-status mapping is proven per-case on the **create** path only; the refresh path's
   coverage is structural (both call the same `csvUrlErrorToServiceError`). That is sound as
   written, but a single refresh-path status test would make it regression-proof against someone
   later inlining a second mapping.
3. The branch is based on `7f29402e`; `origin/main` is now `2a223e01`. Merge/rebase before the
   PR so reviewers don't see a spurious README/docs revert in a two-dot diff. No file overlap,
   so no conflict expected.
4. HEL-880 is real and worth prioritising: `helio-mcp` has no `test` script and no jest config
   of its own, so its suites are invisible to any gate run from inside a worktree. Until it is
   fixed, MCP tests in worktree deliveries must be run with the `/.claude/worktrees/` ignore
   pattern explicitly overridden, or they silently do not run.
