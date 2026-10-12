## Standing Constraints

- [C1] Spec temp/uploads roots come from `TempDirectorySupport.newTempDir` (never raw `Files.createTempDirectory`/`createTempFile`, never `~/.helio/uploads`), and are deleted after the spec.

## 1. Red first

- [x] 1.1 Write the failing specs of design.md Decision 3 (1-5) against the UNMODIFIED tree; run with `nice -n 19 sbt "testOnly ..."`; record per-path RED/GREEN with counts and the `[hel1468-guard]` line in `red-evidence.md`
- [x] 1.2 Report any path that does not leak pre-fix (with the measured evidence) in `red-evidence.md`

## 2. Fix (Backend)

- [x] 2.1 Add the private compensation helper and stored-object delete to `DataSourceService` (design Decisions 1-2); verify it compiles
- [x] 2.2 Route `createCsvWithinLimits`, `createCsvUrl`, `ingestText`, `ingestPdf`, `ingestImage` through it; verify the chains are moved verbatim (diff shows wrapping only)

## 3. Green and guards (Tests)

- [x] 3.1 Re-run the 1.1 specs; all green; record in `red-evidence.md`
- [x] 3.2 Mutation: neutralize the compensation, show the specs red, revert; record the result
- [x] 3.3 Run the existing affected specs (`DataSourceService*Spec`, `DataSourceRoutes*Spec`, `GcsFileSystemSpec`, `FirstRunDashboard*Spec`) green with `[hel1468-guard]` in the log
- [x] 3.4 Run the repo gates the commit hook runs (scalafmt/code-quality, inline-FQN guard) and commit with `HEL-1494` prefix
