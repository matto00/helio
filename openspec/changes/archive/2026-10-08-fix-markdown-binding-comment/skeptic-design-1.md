## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed HEAD `002249226fadcbbe8d33eb0f00000c89de80cf73` (main; the change dir is still untracked).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/fix-markdown-binding-comment/HEL-1240`.
- **Target comment exists as described:** `OutputBindingSpec.scala:97-102` is a 6-line comment starting `// markdown → no fieldMapping slots at all (design.md: "a markdown template`, directly above `val Markdown` (line 103). Task 1.1's anchor is unambiguous.
- **Every factual claim in the T1 replacement comment holds.** I re-ran all T2 proof commands from the worktree root:
  - no slots: `OutputBindingSpec.scala:104` `OutputBindingSpec(OutputKind.Markdown, Vector.empty, Vector.empty, Map.empty)`.
  - literal `config.content`: `OutputConfigValidation.scala:27` `OutputKind.Markdown   -> (Shared ++ Set("content"))`. Also `PanelContent.tsx:338-339`: the markdown branch renders `readMarkdownConfig(output.config).content` via `MarkdownRenderer`, so it never reads rows.
  - rejects every key: `validateFieldMapping` (`OutputBindingSpec.scala:158-171`) returns `Left` when `validSlots.isEmpty`, and for markdown the message adds "(a markdown Output's text is the literal config.content)". `OutputBindingSpecSpec.scala:59` pins this with `Map("content" -> "notes")`.
  - HEL-1139 removed the bound mode: commit `e184391c9 HEL-1139 Remove dead markdown Content binding mode; ...`.
  - vacuously bindable: `evaluate` passes when there are no required slots, as the doc at `OutputBindingSpec.scala:127` says.
  - `insight` is planned, not present: `grep -rniw insight backend/src/main/scala | wc -l` printed `0`.
  - DataBindable history: `git show 2ec2a5bc8^:.../PanelBindingSpec.scala | grep "val DataBindable"` printed `Vector(Metric, Chart, Table, Collection, Timeline)`.
- **Task 1.1's self-checks will work:** the T1 text does not contain "template string", so `grep -c` will print 0. The only current "literal config.content" occurrence (line 162) has no backticks, so the backticked grep will hit only the new comment.
- **Sweep is complete for the "markdown Output = template over rows" claim.** I ran `git grep` with broader regexes than the orchestrator's (`markdown.{0,60}(template|interpolat|row shape|over rows|from rows)`, `data-bound (text|markdown)`, `bound markdown`, and `markdown` near `row|bind|field|interpol`), excluding archive and this change dir. Surfaces covered:
  - **backend:** `AssistantProposalToolSchemas`, `DashboardAuthoringPrompt`, `RefinementPrompt`, `OutputConfigValidation`, `PanelBindingChecks`, `panels/package.scala`, `MarkdownPanel.scala`, `TextPanel.scala`.
  - **helio-mcp:** `outputs.ts:76,108-112`, `placements.ts`, `proposal.ts`, `write.ts`, `combinedProposal.ts`, `types.ts`.
  - **frontend:** `OutputKindFields.tsx:285`, `buildOutputConfig.ts:124`.
  - **`openspec/specs/**` and `schemas/`.**
  - Results:
    - Only two live hits make the false claim: the target comment and `pipeline-output-sheet/spec.md:39`. Both are planned.
    - The remaining hits are historical records (`docs/superpowers/specs/2026-08-30-...:43,76,89`, `notes/roadmap.md:79`, and `hel904-real-dump.sql` fixture data).
    - Other hits are statements about legacy *panels* that are true (for example, `MarkdownPanel.scala:10` says V94 converted data-bound markdown panels into markdown Outputs, which is historical fact).
    - The rest already state literal-only.
- **Spec delta is a correct MODIFIED block:**
  - The header `### Requirement: Per-kind option sets` matches the base exactly (`openspec/specs/pipeline-output-sheet/spec.md:36`).
  - The full requirement text is restated with only the markdown clause changed.
  - The single scenario is copied verbatim.
  - The cross-reference "Markdown Output Content is literal-only" names a real requirement (base line 62).
  - `openspec validate fix-markdown-binding-comment --type change` prints `Change 'fix-markdown-binding-comment' is valid` (rc=0).
- **No placeholders, contradictions or scope drift:**
  - Proposal, design and tasks agree.
  - Each AC maps to a task: AC1 → 1.1/1.2; AC2 → design sweep + spec delta; AC3 → C1.
  - No API/schema contract is touched.

### Verdict: CONFIRM

### Non-blocking notes

- Task 1.1 abbreviates the second grep's path as `...OutputBindingSpec.scala`. A literal-minded executor should expand it to `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala`.
- The legacy-panel follow-up named in design.md (the `markdown-panel` spec's "bound DataType field" scenario at `openspec/specs/markdown-panel/spec.md:46`) should also cover two more places:
  - The `markdown-panel-content-source` spec's Purpose line ("Source/Static content modes (field-or-literal editor, bound-over-literal render resolution)"), which describes a markdown *panel* bound mode that HEL-904 removed.
  - `mcp-panel-composition-tools/spec.md:5` ("bind text/markdown/collection panels with backend-verified field mappings").
  - These describe panels, not Outputs, so they are outside this ticket's claim.
- `frontend/src/utils/crossFilterRows.ts:91-92` still reads `fieldMapping` for markdown Outputs. This is harmless: it is always `{}` for new writes, and markdown never renders rows. It is a behaviour surface, not a text claim, so it is out of scope here.
- C1 uses `origin/main...HEAD`. At the final gate, use `resolve-review-base.sh` (CON-152) rather than a possibly stale ref.
