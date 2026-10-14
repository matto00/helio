# Task 1.1: where sbt 2.0.9 keeps its cache, and what is in it

Verified (transcripts/1.1-*, `show Global/localCacheDirectory`):

- Default disk cache: `~/.cache/sbt/v2` (`ac/` action results, `cas/` content blobs). Setting: `Global / localCacheDirectory`;
  JVM property `-Dsbt.global.localcache=<dir>` relocates it. Run with
  `-Dsbt.global.localcache=$S/cache`, sbt printed `$S/cache/v2`, and that directory filled (`ac` 2.7 MB, `cas` 239 MB
  after B's testFull) for both trees. The matrix never ran against `~/.cache/sbt`. (Whether the home cache saw writes
  during the run cannot be proven: another lane, HEL-1451, was running sbt against it concurrently.)
- `Global / rootOutputDirectory` is `<tree>/target/out`; its `value/.../*.json` files are symlinks into `cas/`.
- An `ac/` entry is JSON: `{"outputFiles":["${OUT}/value/sha256-<h>/64.json>sha256-<h>/<size>"],"origin":"disk",
  "exitCode":0,"contents":[],"isExecutable":[]}`. Output paths are `${OUT}`-relative and there is NO captured stdout or
  log text. `grep` for the tree paths (`HEL-1595/treeB`, `worktrees/bug`, `scratchpad`) over the whole scratch cache
  found 0 files; over a 3000-entry sample of the 42007 `~/.cache/sbt/v2/ac` entries (read-only) found 0 files with
  `worktrees` or `/home/matt`. So a replayed cache entry cannot itself carry another tree's absolute path.
- Key inputs (observed, not read from source): the main-source compile was a cache hit in A after B had compiled the
  same sources at a different absolute path (`cache 93%`, only 659 test sources compiled), i.e. the compile key is
  content-based and tree-relocatable; adding a test source made only the test compile miss.
- `Test / testGrouping` is `Def.uncached` (HEL-1018): the failing probe in A ran and failed in a run that still
  printed `cache 100%, 644 disk cache hits` (transcripts/1.3-A-testFull-red.txt). That line counts the cached
  non-test tasks only; it says nothing about tests being replayed.
- sbt 2 server sockets are NOT under `~/.sbt/1.0/server` any more: `project/target/active.json` points to
  `local:///home/matt/.config/sbt/2/server/<hash>/sock` (a per-project hash; ~35 stale dirs exist there from other
  lanes). The old `~/.sbt/1.0/server` holds two stale April/August dirs and was not written by these runs.
