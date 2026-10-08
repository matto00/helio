## Why

`OutputService.scala` (503 lines at 24f6de4cf) and `NodeSnapshotRepository.scala` (458) are far over CONTRIBUTING.md's
250-line soft budget and `check:scala-quality` warns on both. Each mixes concerns that already have a natural home:
the service holds Output CRUD/ACL orchestration plus the materialized-row read surface, create-time root anchoring and
config-write validation; the repository holds its persistence methods plus a block of pure SQL-fragment builders for
filtered/sorted reads. HEL-915 will extend `OutputService` next, so splitting now is cheaper.

## What Changes

- Move `OutputService`'s row-read surface (`rows`, `filterCapabilities`, `distinctValues`, `materializedFor`) into a
  package-private `OutputRowReads` class; the public methods stay on `OutputService` as one-line delegations.
- Move create-time root anchoring (`requireUnambiguousRootWhenNeither`, `resolveExplicitRootId`) into a
  package-private `OutputRootResolution` class.
- Move the companion's config-write validation bodies (`validateFieldMapping`, `validateConfig`, `mergeConfig`) into
  the existing `OutputConfigValidation` object (already the home of config-write validation); the companion keeps
  same-signature forwarders.
- Move `NodeSnapshotRepository`'s filter/sort SQL-fragment builders into a package-private `NodeSnapshotFilterSql`
  object; the repository's public methods and companion types are untouched.
- Add the new persistence file to `check-node-root-encoding`'s scanned files so its coverage does not shrink.
- No behaviour change, no API change: both classes' public API (constructors with defaults, signatures, package,
  companion members) is byte-for-byte unchanged per `javap -public`.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

None — pure refactor (`skip_specs: true`).

## Impact

`backend/src/main/scala/com/helio/services/pipelines/` (OutputService, `OutputConfigValidation`, 2 new files),
`backend/src/main/scala/com/helio/infrastructure/persistence/pipelines/` (NodeSnapshotRepository + 1 new file), both
packages' `README.md`, `scripts/check-node-root-encoding.mjs` (target list only). Zero test-source diff. Callers,
including open PR #847 (HEL-1371), compile unchanged.

## Non-goals

- Fixing any defect found during the move (follow-up tickets instead).
- Moving `NodeSnapshotRepository`'s companion types (`SortSpec`, `FilterSpec`, `OpSpec`, ...) — a Scala companion must
  share its file, and aliasing them elsewhere changes the binary API.
- Reaching 250 lines exactly: both files end ~330-360 lines; the remainder is constructor documentation and
  public methods that must stay for API compatibility.
- Touching `PanelService` (HEL-1253) or `PipelineRunService` (HEL-1371).
