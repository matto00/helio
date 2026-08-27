## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

- **Round-2 item 4 (the invalid `## REMOVED Requirements` block)** — read
  `specs/rest-api-connector/spec.md` directly (79 lines). The file now contains exactly one
  section, `## MODIFIED Requirements`, with a single requirement "Create a REST/HTTP data
  source". No `REMOVED` block anywhere. **Fixed.**
- `npx openspec validate mcp-connector-source-authoring --type change --strict` →
  `Change 'mcp-connector-source-authoring' is valid`.
- Read all planning artifacts in full: `ticket.md`, `proposal.md`, `design.md`, `tasks.md`,
  `specs/rest-api-connector/spec.md`, `specs/mcp-data-source-tools/spec.md`,
  `specs/workspace-context-assembly/spec.md`.
- Diffed each delta against its baseline in `openspec/specs/`:
  `rest-api-connector/spec.md:6-68` (baseline "Create a REST/HTTP data source" — confirmed the
  MODIFIED replacement preserves every baseline scenario and adds none silently);
  `mcp-data-source-tools/spec.md:23-37` (baseline `create_rest_data_source`, plus the existing
  "Credentials never appear in tool results" requirement at :55, which the new tools are
  consistent with); `workspace-context-assembly/spec.md` requirement list, incl.
  "Deterministic, priority-ordered budget trimming" at :396.
- Confirmed `mcp-context-agent-block` is a **real existing capability**
  (`openspec/specs/mcp-context-agent-block/spec.md`) covering the `get_workspace_context` /
  `helio://workspace/context` fan-out, including its established
  "a failed fetch degrades that section only" scenario (:31-33).
- Decisions 1/2/5/6 (round-1 items 1-3): re-read; the edit-site precision
  (`SourceService.createRest`'s own `(None, Some(url))` arm, `toDomain` untouched), the
  two-surface workspace-context split, and the allow-listed `ConnectorSummary` projection are
  all still present, specific, and mirrored into `tasks.md` (1.1, 2.1-2.5). No regression.

### Verdict: REFUTE

The blocking issues are all small, mechanical **text** edits to the delta specs — no redesign is
required and none of rounds 1-2's substantive fixes need revisiting. But #1 is the same
self-contradiction class round 2 refuted on: deleting the `REMOVED` block made the change
*valid*, it did not make the surviving scenario *coherent*, and this text is what lands in
`openspec/specs/` permanently on archive.

### Change Requests

1. **`specs/rest-api-connector/spec.md:62` — scenario title directly contradicts its own body.**
   The scenario is titled "Legacy bare-url create still succeeds (dual-support)" and its THEN
   asserts "the response is 400, not 201". A MODIFIED requirement wholly replaces the baseline,
   so this contradictory heading is what will be archived into the canonical spec. Rename it to
   state the new behavior (e.g. "Legacy bare-url create is rejected") and drop the now-pointless
   "(as of this change, retiring the create-time dual-support path per Decision 1)" parenthetical
   from the THEN — a spec states behavior, not its own changelog.

2. **`specs/mcp-data-source-tools/spec.md:15` — same stale-title problem.** Scenario titled
   "Agent creates a REST source with bearer auth" whose THEN says authentication is *never*
   supplied inline and the schema has no credential field at all. Rename to describe what is
   actually asserted (e.g. "The tool has no inline-auth field"). Also note this scenario and
   ":33 An agent attempts to pass a credential inline" now assert nearly the same property —
   either differentiate them or merge.

3. **`specs/workspace-context-assembly/spec.md:32-37` — the budget-trimming scenario is
   unimplementable as written and is filed under the wrong requirement.** Its title literally
   offers two behaviors ("...trimming last, or not at all") and the THEN is a comparative
   hand-wave ("trimmed no more aggressively than ... comparably-sized fixed collections"), with
   no crisp pass/fail signal. Meanwhile the requirement that actually owns this —
   `openspec/specs/workspace-context-assembly/spec.md:396` "Deterministic, priority-ordered
   budget trimming" — enumerates a closed trimming order (`sampleRows` → `exampleValues` →
   `joinHints`) and a closed never-shrunk structural set, and the delta does not modify it.
   An implementer cannot tell whether `connectors` joins the structural never-shrunk set or the
   trimming order. Decide it (recommended: structural, never trimmed — it is small and bounded)
   and express it as a `## MODIFIED Requirements` entry for "Deterministic, priority-ordered
   budget trimming" naming `connectors` in the never-shrunk list, replacing the vague scenario.
   `tasks.md:28-29` ("Confirm budget-trimming behavior doesn't silently drop the new field")
   should be tightened to match the decision rather than "confirm ... if the existing suite has
   a natural slot".

4. **Missing degradation behavior for the new `GET /api/connectors` fan-out.** `tasks.md:2.5`
   and `specs/mcp-data-source-tools/spec.md:57-71` add a new client-side fan-out call in
   `helio-mcp/src/context.ts`, but nothing specifies what happens when that one call fails. The
   sibling capability already sets the precedent
   (`openspec/specs/mcp-context-agent-block/spec.md:31-33`: a failed `GET /api/preferences` or
   `GET /api/agent/memory` degrades that section only). Without an explicit requirement, a
   plausible implementation lets the rejection propagate and breaks the entire workspace context
   for anyone whose connector list errors. Add a scenario: a failed `GET /api/connectors`
   degrades `connectors` to an empty list, the rest of the context is returned normally.

5. **Capability filing / proposal inconsistency.** `proposal.md:28` says the change "extends
   existing `mcp-data-source-tools` and `mcp-context-agent-block` capabilities", but there is no
   `specs/mcp-context-agent-block/` delta, and `proposal.md:30-36`'s Modified list names
   `mcp-data-source-tools` / `workspace-context-assembly` / `rest-api-connector` instead. The
   requirement "Connectors surfaced in the MCP workspace-context fan-out"
   (`specs/mcp-data-source-tools/spec.md:57`) is about `get_workspace_context` /
   `helio://workspace/context`, i.e. it belongs to `mcp-context-agent-block` (or its own
   capability), not to the data-source-tools capability. Either move that requirement into a
   `specs/mcp-context-agent-block/spec.md` delta and update `proposal.md:30-36`, or fix
   `proposal.md:28` to stop naming a capability this change does not touch. Pick one and make
   the three statements agree.

### Non-blocking notes

- `specs/rest-api-connector/spec.md:58-67`: "Missing required fields returns 400" (no
  `connectorId`) and the renamed bare-url scenario now overlap substantially. Not wrong, just
  redundant — worth collapsing when you touch #1.
- `scripts/concertino/next-report-number.sh` does not exist in this worktree's
  `scripts/concertino/` (the branch base predates it); I ran the copy from the main checkout
  against this change dir. Non-blocking for the design gate, but the executor/evaluator should
  expect the same gap.
- `design.md` Decision 1's "precondition for ever removing the migration" is a genuinely good
  piece of durable reasoning to keep — recommend it survives into the archived spec or a code
  comment rather than only living in a change dir that gets archived away.
