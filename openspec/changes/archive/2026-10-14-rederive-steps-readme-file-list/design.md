## Context

`backend/src/main/scala/com/helio/domain/steps/README.md` lines 3-9 (main at 574a589d8) list 23 `*Step` names inside
"one file per step type (...)", then "plus `StepCodecUtil` (shared codec helpers)". On the tree:

- `ls backend/src/main/scala/com/helio/domain/steps/*Step.scala | wc -l` = 27.
- `sed -n '/val Registry/,/^  )/p' backend/src/main/scala/com/helio/domain/model/PipelineStep.scala | grep -c -- '->'`
  = 27 (the command HEL-1467 already put in this README).
- Non-`*Step` `.scala` files: `AnalyzeWithAiConfig`, `ConvertFormatConfig`, `GenerateTextConfig`, `JoinColumnNaming`,
  `SecondaryInput`, `StepCodecUtil`, `UpsertSourceConfig`, `UpsertTargetCheck`, `WindowRolling`.

Precedent: HEL-1451 (`services/pipelines/README.md`, 609e62b6d) wrote "This list is a snapshot of the directory at
HEL-1451, not a completeness claim; re-derive it with:" followed by a fenced `ls ... | xargs -n1 basename | sed`
command. HEL-1467 (5074b6937) applied the same idea to the step-kind and spec counts lower in this README.

## Decisions

**D1. Keep a list, label it a snapshot, add the command.** The list is useful to a reader; deleting it would trade a
navigational aid for nothing. Re-derive the 27 names with
`ls backend/src/main/scala/com/helio/domain/steps/*Step.scala | xargs -n1 basename | sed 's/\.scala$//'`, list them
in that output order, and state "a snapshot of the directory at HEL-1590, not a completeness claim; re-derive it
with:" followed by that command in a fenced block. Same wording shape as HEL-1451.

**D2. Drop "one file per step type".** It asserts a 1:1 kind-to-file mapping that no command in the README verifies,
and four kinds (`analyzewithai`, `convertformat`, `generatetext`, `upsertsource`) also have a `*Config` file. Replace
it with a plain description of what the `*Step` files hold, verified per file by the executor (e.g. "pipeline
transform step definitions (`*Step` files)"), only if each word survives a check; otherwise say less. No wording
that implies a file-to-kind match ("one per", "mostly one per"): do not claim the two counts (27 files, 27
registered kinds) correspond by name — that is not checked.

**D3. Name the support files the same way.** Replace "plus `StepCodecUtil` (shared codec helpers)" with a second
snapshot list of the non-`*Step` files and its own command
(`ls backend/src/main/scala/com/helio/domain/steps/*.scala | grep -v 'Step\.scala$' | xargs -n1 basename | sed
's/\.scala$//'`). A short per-file gloss is allowed only where the executor verified it against the file's own
top-level declaration/scaladoc; otherwise the name alone.

**D4. Lines 11-13 are checked phrase by phrase; line 11 is false and is reworded.** Line 11 says "individual step
config types and their apply/infer logic". `grep -rn -i 'def infer' backend/src/main/scala/com/helio/domain/steps/`
returns 0 hits; per-step schema inference lives in `domain/engine/` (`StepSchemaInference.scala` and sibling
`*SchemaInference.scala` files; line 102 of this README already places lookup's in `MultiInputSchemaInference`).
Reword to, e.g., "individual step config types and their runtime (apply/evaluate) logic; per-step schema inference
lives in `domain.engine`", keeping only phrases the executor verified with a recorded command (config types present;
apply/evaluate/run defined per `*Step` file; inference files in `domain/engine`). Lines 12-13 ("shape-level expansion
... lives in `domain.shapes`") are checked the same way (`domain/shapes` exists and holds shape expansion) and kept
unless false. The sole-config-trap and column-collision sections are not
edited. No removed HEL-1467 claim returns: not "all 23 step kinds", not "Two step kinds have no capability spec at
all", not "bless" for join/upsertsource, not "only" for groupby.

**D5. Evidence.** `evidence/claims.md` in this change records, for every factual sentence of the new introduction,
the command run in the worktree and its output, plus both re-derive commands' full output. Gate: `npx prettier
--check` on the README; the pre-commit hook chain runs on commit.

## Risks

- A new snapshot list goes stale the same way. Mitigated by the label and command, which is the agreed standard
  (HEL-1156/HEL-1451); no drift test is added (out of scope for a docs ticket).
- Prettier may reflow the list; run `npx prettier --write` on the README only, then re-check the content.

## Planner Notes

- Self-approved: keep-list-plus-command (D1) over replace-with-command-only; both are allowed by the ticket.
- Self-approved: D3 extends the fix to the "plus `StepCodecUtil`" clause, because leaving it would keep an implied
  "nothing else lives here" next to a list that now explicitly disclaims completeness.
- No gate-chain file (`.husky/**` or a script it invokes) is touched.
