### Backend

## 1. Mapping

- [x] 1.1 Re-enumerate the live test tree (`find backend/src/test/scala/com/helio -name '*.scala'`);
      confirm the file count matches this document's stated baseline (218) before any move; if it
      differs, re-derive the mapping rather than trusting this document's number.
- [x] 1.2 Extend `mapping/mapping.tsv` (partially built during Planning) to cover every remaining file
      using design.md D2/D5/D5b's domain-prefix + grep-verified rules; resolve every entry in
      `mapping/unmatched.txt` explicitly (no file left unmapped). Any file that names ≥2 domains with no
      clear primary (D5b) is a recorded no-op — mapped to its own current package, not silently dropped
      from the mapping file.
- [x] 1.3 Record final target package for every file, including the base classes (D3, split across two
      domains — see design.md) and the two `testutil/` files (D6). `ResourceTaggingSpec` and
      `AggregatorRegressionSpec` are recorded as explicit no-op moves (D5b), not omitted.

## 2. Moves and rewrites

- [x] 2.1 Move `domain/AggregateStepSpec.scala` into `domain/steps` (per the live tree, this is the
      *only* step spec still at `domain/` root — `AssertStepSpec`, `ChunkByTokenCountStepSpec`,
      `ExtractHeadingsStepSpec`, `SplitTextStepSpec` are already correctly in `domain/steps/` and need no
      move; do not repeat the ticket's stale "four step specs" framing). Update its `package` declaration.
- [x] 2.2 Move the four `*ShapeEngineSpec` files into `domain/shapes` (D4); update `package` declarations.
      While in `domain/`, also confirm `PipelineStepSpec.scala` → `domain/model`,
      `InProcessPipelineEngineSpec.scala`/`AlertEventStateMachineSpec.scala` → `domain/engine` per
      `mapping.tsv` (already resolved there; verify the moves actually happen, don't re-derive).
- [x] 2.3 Move every remaining `api/`-root and `api/routes/`-root spec into its resolved
      `api/routes/<domain>/` or `api/protocols/<domain>/` package (D1–D3, D5); update `package`
      declarations.
- [x] 2.4 Move every remaining `domain/`-root, `services/`-root, and `infrastructure/`-root spec into
      its resolved subpackage (D1, D2, D5); update `package` declarations.
- [x] 2.5 Move `testutil/JsonLogCapture.scala` and `testutil/PdfFixtures.scala` into `testsupport/`;
      delete the now-empty `testutil/` directory (D6).
- [x] 2.6 Rewrite every `import com.helio.test...` (and any other import naming a moved file) using a
      statement-oriented tool, never line-oriented (D7); emit every rewritten import on one line.
- [x] 2.7 `sbt Test/compile` clean after each batch of moves (per-directory batches, not one giant
      commit) — same per-layer-green discipline as HEL-633's D10.

## 3. Tests

- [x] 3.1 `sbt test` green; capture and compare the total test count before vs. after the move (must
      match exactly).
- [x] 3.2 File-count parity: `find backend/src/test/scala -name '*.scala' | wc -l` before/after this
      change must be identical.
- [x] 3.3 `rg 'com\.helio\.testutil'` returns nothing.
- [x] 3.4 Every package under `test/.../com/helio` corresponds to a package under `main/.../com/helio`
      (`testsupport` and `infrastructure` — the latter because `StructuredJsonLoggingSpec` (D5) has no
      main-tree Scala subject at all, only `logback.xml`/config — excepted) — spot-check with a
      directory diff.
- [x] 3.5 Bytecode constant-pool comparison (D8) on a representative sample of moved spec `.class` files,
      pre/post-move, to confirm only `package`/`import` lines changed.
- [x] 3.6 Write `files-modified.md` documenting the before/after test-file count and the moved-file
      count, for the PR description (ticket's own stated requirement).
