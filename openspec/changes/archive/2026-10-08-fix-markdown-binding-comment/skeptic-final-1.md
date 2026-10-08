## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: 21b6d569d3845d76008ebf970c71e84c3a8eff72. The base was resolved live with
`resolve-review-base.sh` and printed 002249226fadcbbe8d33eb0f00000c89de80cf73 (exit 0).

### What I verified (with evidence)

- **Spawn guard:** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=task/fix-markdown-binding-comment/HEL-1240`.
- **Scope is comment and spec text only:** `git diff <base>...HEAD --stat` excluding the change dir shows only
  `OutputBindingSpec.scala` (+8/-6). Filtering out the `+++`/`---` headers and every changed line starting with `//`
  leaves nothing, so the code change is comment-only. Nothing in behaviour changes.
- **Each claim in the new comment (OutputBindingSpec.scala:97-104), checked against source:**
  - "no fieldMapping slots": `val Markdown = OutputBindingSpec(OutputKind.Markdown, Vector.empty, Vector.empty, Map.empty)`.
  - "text is the literal `config.content`": `OutputConfigValidation.scala:27` reads `OutputKind.Markdown -> (Shared ++ Set("content"))`.
    The renderer `PanelContent.tsx:337-339` passes only `readMarkdownConfig(output.config).content` to `MarkdownRenderer`
    and reads no rows.
  - "`validateFieldMapping` below rejects every fieldMapping key": a slotless spec gives `validSlots.isEmpty`, so any
    unknown key returns `Left` (with the markdown literal-content suffix). This is pinned by `OutputBindingSpecSpec.scala:59`.
  - "HEL-1139 removed the bound Content mode": commit `e184391c9 HEL-1139 Remove dead markdown Content binding mode ...`.
  - "Vacuously bindable, same as table": `evaluate` with no required slots gives `bindable = true`. The scaladoc of
    `evaluate` says the same.
  - "planned `insight` kind (HEL-921)": Linear HEL-921 is the Backlog epic "Narrative `insight` Outputs". Running
    `grep -rniw insight backend/src/main/scala` finds only the new comment, so no such kind exists in code yet.
  - "not in `PanelBindingSpec.DataBindable` before HEL-904": `git show 2ec2a5bc8^:...PanelBindingSpec.scala` has
    `val DataBindable = Vector(Metric, Chart, Table, Collection, Timeline)`, which has no text or markdown.
- **AC1:** met. The comment says there is no data binding of any kind and that the text is the literal `config.content`.
  The phrases "template string" and "row shape" are gone.
- **AC2:** met. My own broader `git grep` sweep, outside archives and node_modules, used the patterns
  template string/interpolat, interpolated from rows, against the row shape, markdown template,
  markdown..interpolat/template and "interpolat" filtered to markdown/row/content.
  - The only live hit is `openspec/specs/pipeline-output-sheet/spec.md:39`. It is fixed by a proper MODIFIED delta.
  - The other hits do not need changing:
    - Historical records the proposal excludes on purpose: the remodel design doc (lines 43, 76, 89) and `notes/roadmap.md:79`.
    - A test fixture dump `hel904-real-dump.sql`, which is data and makes no claim.
    - Unrelated uses: `MISTAKES.md:73` and `nodePath.ts:11`.
  - helio-mcp `outputs.ts`, `placements.ts` and `proposal.ts` already say literal-only.
- **The spec delta is correct:**
  - The requirement name "Per-kind option sets" matches the base spec exactly. Only the markdown clause changed.
  - The scenario is copied verbatim.
  - The cross-reference "Markdown Output Content is literal-only" points to a requirement that exists (spec.md:62).
  - `openspec validate fix-markdown-binding-comment --type change` printed "Change 'fix-markdown-binding-comment' is valid", exit 0.
- **AC3 and the test gate:** `sbt "testOnly com.helio.domain.panels.OutputBindingSpecSpec"`, run under nice 19, passed
  11/11. sbt reported "cache 100%". That is immaterial for a comment-only diff, because the bytecode is unchanged either way.
- **UI / design:** there are no frontend changes, so this step was skipped.
- **Iron Law (debugging):** not applicable. This is not a bug fix in behaviour.

### Verdict: CONFIRM

### Non-blocking notes
- `evaluation-1.md` is untracked in the worktree (`git status --porcelain`). The orchestrator should commit or persist it
  as its process requires.
- The legacy "bound DataType field" content-panel scenarios in the `markdown-panel` spec are rightly left as a follow-up
  under the proposal's Non-goals. Make sure that follow-up actually gets filed.
