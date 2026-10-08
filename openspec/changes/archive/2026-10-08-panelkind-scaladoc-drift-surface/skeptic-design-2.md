## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD `2dd4ed6237817b1feef22d69f8bc8058e58541db` (= origin/main; the change dir is untracked).
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/panelkind-scaladoc-drift-surface/HEL-1156`.
I formed my own view first and read skeptic-design-1.md only afterwards.

### What I verified (with evidence)

- **OLD blocks.** A script (scratchpad `apply.py`) extracted each E1–E5 OLD/NEW pair from design.md and applied it to
  a scratch copy of Panel.scala outside the worktree. Each OLD block occurs exactly once in the file:
  `E1 OLD count 1` … `E5 OLD count 1`. The resulting diff touches only the five scaladoc blocks (41+/17-).
- **No nested-comment hazard.** In the new file, `/*` and `*/` appear only as real scaladoc openers and closers
  (lines 6, 42, 55, 58, 65, 71–93, 103, 113, 117, 128, 145). There is no stray `/*` in `schemas/panels/` or anywhere else.
- **P1–P10 re-run against the live tree. Every output matches design.md:**
  - P1: one hit, `PanelConfigCodec.scala:58` (an error message).
  - P2: `PanelRepository.scala:29`.
  - P3: `37`, `48`, `49- OutputPanel(...)`.
  - P4: `model.scala:159`.
  - P5: counts 8, 3, 2, 2, 2, 2.
  - P6: lines 4, 22, 23.
  - P7: lines 194 and 157.
  - P8: line 60.
  - P9: lines 220 and 318.
  - P10: every named site prints ` 1`, and `schemas/panels/` prints ` 4`. I confirmed that the `-F` substrings resolve to the real
    files (e.g. `persistence/panels/PanelRepository.scala`, `detailModal/PanelDetailModal.tsx`).
  - P10 negative control: `0`.
- **Claims not covered by P1–P10, checked separately:**
  - `git grep -w -E "Registry|companionFor|readConfigFromWire|writeConfigToWire" -- backend/src/main`, excluding
    Panel.scala: the only panel-registry consumer is PanelConfigCodec:58, and the per-kind `*Panel.scala` files only define
    the companion methods. All other hits are `PipelineStep`/`PipelineShape`/`ResourceTypeRegistry`. So the "only" in E1/E3/E4 and E3's "no ... dispatcher dispatches through this Map" both hold.
  - The DB discriminator is `kind`. `PanelRepository.scala:417` has `column[String]("kind")`, and `PanelRowMapper.scala:31-36`
    says that `type`/`type_id` were retired. E2's `panels.kind` and its hand-written match with `OutputPanel` fallback hold.
  - `PanelSpec.scala:59-85` contains only the registry key-set pin, `PanelKind.All == Registry.keySet`, and parseKind checks.
    None of these detect a missed hand site, so E1's "does not detect a missed hand-enumerated site" holds.
  - `check-schema-drift.mjs` compares the schemas/panels/*, dashboard-proposal schema and helio-mcp
    `proposal.ts`/`proposalValidation.ts` sets. E4's "several schema / helio-mcp enums" holds.
  - `PanelServiceHelpers.buildNewPanel` is at :130. The frontend `PanelKind` union is at panel.ts:63, with a switch at :383.
- **Round-1 CRs:**
  - CR1 is resolved: the recipe is unquoted and P10 proves coverage.
  - CR2 is resolved: P10 is now a per-site check with a negative control.
  - CR3 is resolved: the single-line regex's control is `8` on origin/main, and the new file has no hits (exit 1).
- **Recipe blind spots.** I compared the recipe against a form-kind grep. The recipe misses only form-specific
  "source-bound" sets (`DashboardProposalService.SourceBoundKinds`, `proposalValidation.SOURCE_BOUND_PANEL_TYPES`,
  `proposalHandlers.ts`), plus FormPanel.scala itself and a comment in PanelService. Those sets track a semantic
  property, not a list of every kind, and E4 makes no completeness claim (D2). This is acceptable. PanelPacker is caught.
- **tasks.md AC commands on the scratch result:**
  - 2.1: control `1`; after the edit there is no output (exit 1).
  - 2.2: `1`, `1`, line 128, line 129. The overclaim control prints `8`; after the edit there is no output (exit 1). The recipe-string count is `1`.
  - 2.3: the AC3 filter over `git diff --no-index -U0` prints nothing (exit 1).
  - 3.2: `openspec validate panelkind-scaladoc-drift-surface --type change` reports `Change ... is valid` (exit 0).
- **Scope.** All edits are comment lines in one file, and AC1–AC3 are each covered by a task. E5 and the E1/E2 header fixes are in-file
  overclaims of the same kind, so they are in scope under the ticket's "check the Registry doc ... same overclaim" direction.
  PipelineStep and PanelConfigCodec's own overclaim are correctly listed as non-goals.

### Verdict: CONFIRM

### Non-blocking notes

- The tasks.md 4.1 commit body says "every hand-enumerated site in the spec's ... paragraph", while E4 itself says that
  list is a stale snapshot. Consider "the drift surface described by the spec's ... paragraph". This is commit text only.
- P10 writes to `/tmp/claude-1000/hel1156-recipe.txt`. That directory exists on this machine, but a `mkdir -p` first
  would make the command self-sufficient for the executor.
