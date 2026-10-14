## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: bb0c947bfe5ef739e343b01b0e61f1d27f082ebd (base a67f76b9527ec9ec6aebde9077fdf9dc2caea097, resolved live). The delta reviewed is `aff0e7539..bb0c947bf`.

### Phase 1: Spec Review — FAIL

Cycle-1 change requests and notes, each checked against the tree:
- **CR2 (README spec name): fixed.** `README.md` now writes out `pipeline-join-column-collision` and `pipeline-joinstep-right-source-acl` in full. They match `ls openspec/specs` (S17).
- **Non-blocking (a), PipelineShape: addressed.** The comment now says the named layers are examples and the command returns more.
- **Non-blocking (b), enumKey doc: addressed.** The doc now says exemption keys are compared as written. This matches `panelKindEnumCoverage.mjs:119` (`key in exemptions`).
- **CR1 (PipelineStepSecondSourceGuardSpec): the content is fixed, but the edit broke the sentence. FAIL.**
  - The new facts are true. `PipelineStepKind.All`'s scaladoc does name the hand-enumerated layers (S16b output). The three frontend files contain kind ids. The kind-id grep finds them (S16c, which I re-checked: 36 files, including all three).
  - The problem is in `PipelineStepSecondSourceGuardSpec.scala:17-23`. The original single sentence was "This spec iterates `PipelineStep.Registry` -- <aside> -- decodes a default config per kind, and calls the REAL extractors against it, so a kind ... fails this test". It was split into new sentences, but the trailing clause was left in place. It now reads: "Re-derive the layers with `git grep -l chunkbytokencount -- ...` -- decodes a default config per kind, and calls the REAL extractors against it, so a kind whose `secondaryInput` field the extractors don't handle fails this test".
  - Read literally, the `git grep` command is now the subject that "decodes a default config per kind". The statement of what the spec actually does has lost its subject. The ticket exists to make these comments accurate and self-evident (AC1), so a rewritten comment that misattributes the spec's behavior does not meet it.
  - The same edit left a 134-character comment line at L22, against the roughly 95-character wrap of the surrounding scaladoc.

Other Phase 1 items are unchanged from cycle 1 and still hold:
- AC2 through AC5 pass.
- C3 passes: the delta touches no rendered Concertino files and no HEL-1474 files.
- C4 passes.
- `files-modified.md` lists repo-relative paths, including the committed `evaluation-1.md`.

### Phase 2: Code Review — PASS

Fresh runs at bb0c947bf in WORKTREE_PATH:
- `check:schemas`, `check:schemas:selftest`, `check:openspec`, `check:spec-structure`, `check:scala-quality`, `npm run lint` and `npm run format:check` all exit 0.
- `sbt testOnly` of the touched and adjacent specs (PipelineStepSecondSourceGuardSpec, PipelineStepConfigCodecSpec, PipelineStepSpec, DraftRoundTripWriteSafetySpec, PipelineShapeSpec) passed: 5 suites, 122 tests, 0 failed, and the hel1468-guard reported failed=0 aborted=0.
- The full `sbt testFull` was **not** re-run this cycle. The cycle-2 delta is comment-only in Scala and doc-only in `.mjs`. The full suite passed at aff0e7539 in cycle 1 (8058 tests, 6 shards). It must be re-run on the final commit before a PASS.

The only code change is a comment edit in the `.mjs`. The behavior and mutations verified in cycle 1 are unaffected.

### Phase 3: UI Review — N/A

No UI-trigger paths changed.

### Overall: FAIL

### Change Requests
1. `backend/src/test/scala/com/helio/api/protocols/pipelines/PipelineStepSecondSourceGuardSpec.scala:17-23`: give the spec's behavior its subject back and re-wrap the lines.
   - For example, end the re-derive sentence after the command with a period, then start a new sentence: "For each kind, this spec decodes a default config and calls the REAL extractors against it, so a kind whose `secondaryInput` field the extractors don't handle fails this test, not a comparison of two string lists."
   - Wrap the comment to the surrounding width (about 95 characters), so no line runs to 134 characters as L22 does now.
   - Update comment-verification.md if any factual wording changes.

### Non-blocking Suggestions
- none
