## Why

HEL-957 (merged `0f758ff3`, PR #564) guarded the dependency-closure slicing at
`PipelineRunService.scala:507` with mutation-proven key-set assertions. Those guards drive the
service through `previewStep`. `previewOutputs` (`:329`) reaches the same slice by **delegating**
to the shared `previewAtNode` helper (`:403`), so it is covered **transitively** — and transitive
coverage is real coverage: a break in `closureOf`, or in `previewAtNode`'s use of it, is caught
today. This is hardening, not a hole.

The uncovered case is narrow and specific: a change to how `previewOutputs` resolves its own
target/root, or to the arguments it hands `previewAtNode`, **without touching `previewAtNode`
itself**. Every HEL-957 guard exercises the shared callee, so every such change lands green.

## What Changes

Test-only. Add guards to `PipelineRunServiceSpec` that observe the executed node key set
(`stepRowCounts.keySet`) on the `previewOutputs` path specifically — covering **both** of its arms
(single-`outputId`, and the all-Outputs `outputId = None` arm, whose per-node dedup/pairing logic
is entirely its own and has no analogue in `previewStep`).

Each guard is demonstrated RED under a mutation applied inside `previewOutputs`' own body
(lines 329-374) — never at `:507`, which would only re-prove HEL-957's guards. Evidence is captured
in `mutation-evidence.md` to HEL-957's standard: verbatim failure output from real runs against
mutated source, with wrong-reason reds recorded and discarded rather than banked.

No production source changes. No migration.

## Capabilities

### New Capabilities

None — this change adds test coverage only.

### Modified Capabilities

None — no requirement changes. `.openspec.yaml` sets `skip_specs: true` accordingly.

## Impact

- `backend/src/test/scala/com/helio/services/pipelines/PipelineRunServiceSpec.scala` (only production-adjacent file touched).
- Change-local evidence artifacts (`mutation-evidence.md` and its captured run transcripts).
- No API, schema, migration, or frontend impact.
