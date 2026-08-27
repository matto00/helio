## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

- Read in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and all three
  `specs/*/spec.md` deltas (rest-api-connector, mcp-data-source-tools, workspace-context-assembly).
- **Fixes 1 & 2 (title/body mismatch)** — I independently reproduced the validator constraint the
  executor cited rather than taking it on faith: renaming
  `#### Scenario: Legacy bare-url create still succeeds (dual-support)` in a scratch copy produced
  `✗ [ERROR] rest-api-connector/spec.md: MODIFIED "Create a REST/HTTP data source" omits scenario(s)
  the current spec still has: "Legacy bare-url create still succeeds (dual-support)"`. The constraint
  is real and not relaxable. Both baseline names exist verbatim
  (`openspec/specs/rest-api-connector/spec.md:53`,
  `openspec/specs/mcp-data-source-tools/spec.md:29`). The `**NOTE**` lines now placed at the head of
  each scenario body state explicitly that the title is retained for archival name-continuity and
  that behavior is the opposite/different. A reader of the archived spec cannot be misled: the note
  precedes the WHEN/THEN. Accepted as the correct resolution under a hard validator rule. Scratch
  edit reverted; `git status --porcelain` shows only the untracked change dir, no stray edits.
- **Fix 3 (budget trimming)** — the new ADDED requirement "Connectors are a structural field, never
  shrunk by budget trimming" references real baseline anchors: `### Requirement: Deterministic,
  priority-ordered budget trimming` (`openspec/specs/workspace-context-assembly/spec.md:396`) and
  `#### Scenario: Structural identity survives even the tightest budget` (line 438). The scenario is
  concrete (GIVEN sampleRows/exampleValues/joinHints all fully emptied → connectors present and
  untrimmed), not hand-wavy. Being additive rather than MODIFYing is defensible: the baseline's
  "Structural fields (...)" list is illustrative and connectors is unambiguously structural; no
  contradiction with the existing trimming order. `tasks.md` 2.6 covers it with a test.
- **Fix 4 (fan-out degradation)** — new scenario "A failed connectors fetch degrades that section
  only" mirrors the real precedent it cites: `openspec/specs/mcp-context-agent-block/spec.md:27`
  `#### Scenario: A failed preferences or memory fetch degrades that section only`. Behavior is
  specified concretely (empty list, whole call still succeeds). `tasks.md` 2.7 covers it.
- **Fix 5 (proposal Capabilities)** — `proposal.md` now lists New: none; Modified:
  `mcp-data-source-tools`, `workspace-context-assembly`, `rest-api-connector` — exactly matching the
  three delta directories on disk. No reference to `mcp-context-agent-block` as a delta remains
  (it appears only as a cited precedent inside a scenario, which is correct).
- **Validator** — `npx openspec validate mcp-connector-source-authoring --type change --strict` →
  `Change 'mcp-connector-source-authoring' is valid`.
- **Independent ground-truth spot-check of the edit site** —
  `backend/src/main/scala/com/helio/services/sources/SourceService.scala:83-88` confirms the
  `(Some,Some)` → 400 "provide exactly one of connectorId or url" and `(None,None)` → 400 arms
  already exist, and that the `(Some(_),None)` arm is the only caller of `toDomain` on this path,
  which is exactly what design.md Decision 1 and the rest-api-connector delta assert about
  `toDomain`'s bare-url branch being unreachable dead code. The specs' "both present rejected" and
  "missing required fields" scenarios are therefore consistent with current code.
- Full re-read for anything new: task coverage traces to every AC (list+author 3.x/4.x; e2e real run
  6.1; credential enumeration both-directions 7.1; agent-creates-Connector decision Decision 2 +
  its own forbidden requirement; tool-description wording 3.2/4.3; naming vs child 0 Decision 3).
  No TODO/TBD/unspecified types found; no proposal/design/tasks contradictions found.

### Verdict: CONFIRM

### Non-blocking notes

- `SourceService.createRest`'s `(None, None)` arm currently returns
  `"Missing required fields: connectorId or url"`. Once bare-url create is retired, that message
  still advertises `url` as a valid alternative. Worth updating to name `connectorId` only, in the
  same edit as task 1.1. Not blocking — the spec scenario only requires "a descriptive error".
- The two retained-title scenarios are correct but visually odd in the archived spec. If openspec
  ever gains scenario-level RENAMED support, these are the first candidates.
