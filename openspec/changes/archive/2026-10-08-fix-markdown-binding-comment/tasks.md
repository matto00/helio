## Standing Constraints

- [C1] Comment/spec-text only: `git diff origin/main...HEAD --stat` touches only `OutputBindingSpec.scala` and files under `openspec/changes/fix-markdown-binding-comment/`.

### Backend

- [x] 1.1 In `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`, replace the 6-line comment that starts `// markdown → no fieldMapping slots at all (design.md: "a markdown template` (directly above `val Markdown: OutputBindingSpec =`) with EXACTLY the text in design note T1 below; verify `grep -c "template string" backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` prints `0` and `grep -n "literal \`config.content\`" backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` hits the new comment.
- [x] 1.2 Verify every claim in the new comment with the commands in design note T2; paste each command and its output into the commit-gate transcript (`files-modified.md` or your report).

### Tests

- [x] 2.1 Compile + run the spec that pins the contract: from `backend/`, `sbt "testOnly com.helio.domain.panels.OutputBindingSpecSpec"` passes (never bare `sbt test`).
- [x] 2.2 `openspec validate fix-markdown-binding-comment --type change` exits 0.

---

T1 — exact replacement (two-space indent, like the surrounding `val`s):

```
  // markdown → no fieldMapping slots and no data binding of any kind: a
  // markdown Output's text is the literal `config.content`, and
  // `validateFieldMapping` below rejects every `fieldMapping` key for this
  // kind (HEL-1139 owner ruling removed the bound Content mode). Vacuously
  // bindable, same as `table`. Narrative text bound to rows is the planned
  // `insight` kind (HEL-921), not this one. No `PanelBindingSpec`
  // predecessor (data-bound text/markdown panels were not in
  // `PanelBindingSpec.DataBindable` before HEL-904).
```

T2 — claim → proving command (run from the worktree root):

- no slots: `grep -n "OutputBindingSpec(OutputKind.Markdown, Vector.empty, Vector.empty, Map.empty)" backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`
- literal `config.content`: `grep -n "OutputKind.Markdown   -> (Shared ++ Set(\"content\"))" backend/src/main/scala/com/helio/services/pipelines/OutputConfigValidation.scala` and `grep -n "readMarkdownConfig(output.config)" frontend/src/features/panels/ui/PanelContent.tsx`
- rejects every key: `grep -n 'Map("content" -> "notes")' backend/src/test/scala/com/helio/domain/panels/OutputBindingSpecSpec.scala` (+ task 2.1 passing)
- HEL-1139 removed bound mode: `git log --oneline --grep=HEL-1139 | grep "Remove dead markdown Content binding mode"`
- vacuously bindable: `grep -n "vacuously bindable" backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`
- insight is planned, not present: `grep -rniw insight backend/src/main/scala | wc -l` prints `0`
- DataBindable history: `git show 2ec2a5bc8^:backend/src/main/scala/com/helio/domain/panels/PanelBindingSpec.scala | grep "val DataBindable"`

T2 correction (orchestrator, after executor cycle 1 flagged it): the `insight` probe was written against the pre-change
tree and is self-invalidating — once T1 lands, its only hit is the new comment's own line. Post-change form:
`grep -rniw insight backend/src/main/scala | grep -v "kind (HEL-921), not this one" | wc -l` prints `0`. The "vacuously
bindable" probe is case-sensitive; the new comment's "Vacuously" needs `grep -ni`.
