## Standing Constraints

- [C1] Every factual sentence in a rewritten comment has a verification command and its output in comment-verification.md.
- [C2] Red is behavioral: the unmodified tree's check exits 0 on the oneOf form-branch removal, and self-test cases print FAIL assertion lines against a `[]` stub (never a load/SyntaxError); each mutation m1-m4 makes a gate fail and is restored, proven by per-file `git diff --exit-code`.
- [C4] red-evidence.md labels each case red-vs-stub or guard (passes against stub); an upsertsource arm switch needs a round-trip test in the codec spec.
- [C5] A sentence about what a spec says is verified by quoting the spec content, never by directory existence alone.
- [C3] Never edit or `git add` Concertino rendered files; never touch HEL-1474's EmbeddedPostgres files.

### Backend

- [x] 1.1 PipelineStepSpec: drop "sealed" from the scaladoc, rename the exhaustiveness test per design D2; verify `git grep -n -i "sealed" -- backend/src/test/scala/com/helio/domain/model/PipelineStepSpec.scala` has no false claim and the spec passes.
- [x] 1.2 PipelineStepConfigCodec: fix encodeConfig's "compile error" scaladoc, the stale upsertsource comment/arm, and the "23 `*Config` case classes" count (~L105) per D3; verify the codec specs pass.
- [x] 1.3 domain/steps/README.md: replace current-tense counts with count commands and re-derive the no-spec kinds per D4; record each command's output.
- [x] 1.4 PipelineShape.scala:39: replace "single source of truth" with known layers plus a re-derive command; name the frontend/helio-mcp sites that hard-code shape ids (re-derive with `git grep -n -e "passthrough" -e "time_series\|timeseries" -- frontend/src helio-mcp/src` or equivalent) or limit the claim to the backend catalog; verify each sentence.
- [x] 1.5 PipelineStepSecondSourceGuardSpec.scala:17: same correction; verify the spec passes.
- [x] 1.6 Write comment-verification.md: each factual sentence, its command, its output.

### Tooling

- [x] 2.0 Before any tooling edit: remove panel.schema.json's oneOf form branch, record `node scripts/check-schema-drift.mjs` exits 0, restore, prove with `git diff --exit-code`; save to red-evidence.md.
- [x] 2.1 Add self-test cases (const group detected; unchecked const group errors; non-combinator consts ignored; `\` key matches `/`) with a `[]`-returning stub in the lib; save the FAIL assertion lines to red-evidence.md.
- [x] 2.2 Implement findPanelKindConstGroups and separator-normalizing enumKey in scripts/lib/panelKindEnumCoverage.mjs; verify the self-test passes.
- [x] 2.3 Wire const groups into scripts/check-schema-drift.mjs with parity surfaces for panel.schema.json and create-panel-request.schema.json; verify `npm run check:schemas` passes and reports the detected count.

### Tests

- [x] 3.1 Run mutations m1-m4 from design D7, record each failing output in red-evidence.md, restore, confirm `git diff` shows only intended changes.
- [x] 3.2 Run the gates: schema check, drift self-test, lint/format on touched files, and the touched Scala specs (PipelineStepSpec, PipelineStepSecondSourceGuardSpec, codec specs); record exactly what ran.
