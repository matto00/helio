## Why

`domain/steps/README.md`'s introduction says "one file per step type" and lists 23 `*Step` files plus
`StepCodecUtil`. The directory holds 27 `*Step.scala` files (`AnalyzeWithAiStep`, `ConvertFormatStep`,
`GenerateTextStep`, `UpsertSourceStep` are missing) and several other support files the sentence does not mention.
HEL-1467 already moved the rest of this README to "snapshot plus re-derive command"; the introduction was left behind.

## What Changes

- Re-derive the `*Step` file list from the tree with a recorded command, put that command in the README, and label
  the list a snapshot at HEL-1590, not a completeness claim (the HEL-1451 `services/pipelines/README.md` pattern).
- Reword "one file per step type ... plus `StepCodecUtil`" so it no longer implies the directory holds nothing else:
  name the non-`*Step` files via their own re-derive command (snapshot, not a completeness claim).
- Record every factual sentence of the rewritten introduction, with the command that verifies it and its output.

## Capabilities

No spec-level behaviour change (README only). `skip_specs: true` in `.openspec.yaml`.

### New Capabilities
(none)

### Modified Capabilities
(none)

## Non-goals

- No change to any `.scala` file, spec, schema or test.
- No edit to the README sections below the introduction (the sole-config trap, column collisions) except where a
  sentence there is found false; HEL-1467's wording stays, and no claim it removed comes back.
- No README edits outside `domain/steps/`.

## Impact

`backend/src/main/scala/com/helio/domain/steps/README.md` (introduction only), plus evidence under this change.
