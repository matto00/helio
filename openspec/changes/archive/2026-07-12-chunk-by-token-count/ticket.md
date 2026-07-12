# HEL-221: Text pipeline operation: Chunk by token count

## Description

Pipeline step for unstructured text: splits a string-body field into chunks of
approximately N tokens (configurable). Designed for LLM context window
preparation. Output is one row per chunk with chunk index and approximate
token count as metadata fields.

## Context

Epic: HEL-147 (Helio v1.4 — Unstructured Data). This is a TEXT PIPELINE
OPERATION — "chunk by token count": takes a StringBodyType content field and
splits it into chunks of roughly N tokens each (for fitting LLM context
windows), emitting one output row per chunk with a chunk-index field. It is
the THIRD and FINAL of the three text ops. The first two — HEL-219
(`splittext`) and HEL-220 (`extractheadings`) — are both merged to main.
MIRROR their wiring pattern exactly; they are worked examples of every step.

Reference implementations:
- HEL-219 `splittext`: archived design at
  `openspec/changes/archive/2026-07-12-split-text-by-paragraph/design.md`
- HEL-220 `extractheadings`: merged to main (V51 migration)

## Acceptance criteria / wiring checklist

- **apply/infer parity**: implement the op in BOTH the execution/apply path
  AND the schema-inference (analyze) path. CRITICAL: add the op's arm to
  EVERY enumeration/ADT site — especially
  `PipelineService.toAnalyzeStepResponse` / `PipelineProtocol.scala` (a
  missed arm here 500'd the analyze endpoint in HEL-219's first cycle).
  Verify `GET /api/pipelines/:id/analyze` returns 200 for a pipeline
  containing the new op, via a live check.
- **allowedOps**: register the op — needs a Flyway migration. Main is at
  e3889f0 (includes HEL-219's V50 and HEL-220's V51). Next free migration
  version is **V52** (confirmed against `backend/src/main/resources/db/migration/`).
- **StepCard / step config UI**: add the frontend step config component,
  wire into the step picker, gate the field selector to string-body content
  fields.
- **Token counting**: decide and document the tokenization approach (e.g. a
  simple whitespace/heuristic approximation vs. a real tokenizer
  dependency). If it requires a new dependency or a non-obvious
  approximation choice that affects output correctness, this must be
  ESCALATED to the human before implementing rather than picked
  unilaterally.

## Additional notes

- A prior review flagged that `PipelineProtocol.scala` is approaching its
  soft line-budget threshold. If this change pushes it over, consider a
  proactive behavior-preserving split as part of this ticket (or flag it if
  out of scope).
- Serial delivery — no other implementation workflow running, so no
  worktree/migration contention expected.
- Delivery protocol: repo auto-merge is disabled; the human handles merges.
  Present the PR and pause at delivery (do not merge). If a rebase needs a
  force-push, pause and ask directly — do not route a force-push through a
  relayed approval.
