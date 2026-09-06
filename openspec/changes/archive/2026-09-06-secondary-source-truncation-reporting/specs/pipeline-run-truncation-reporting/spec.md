## MODIFIED Requirements

### Requirement: Truncation is visible at the MCP surface
The MCP `run_pipeline` tool result SHALL carry the run-wide truncation flag, the per-source truncated-read detail, the
primary source's row counts, and the truncation notice. The tool's own description SHALL describe the returned
truncation fields rather than promising an unqualified row count.

An agent reading only the tool result, without access to the raw HTTP body, SHALL be able to tell a truncated run from
a complete one, and SHALL be able to identify **which** source was truncated and by how much without parsing prose.

**No two truncation fields of different scope SHALL be presented under names that do not distinguish their scope.**
The result's scalar row counts describe the **primary** source only and SHALL be named so that this is evident from
the field name alone; the truncation flag is **run-wide** (true when any read, primary or secondary, was truncated).
A result SHALL NOT present a run-wide truncation flag alongside unqualified fields named `availableRowCount` and
`sourceRowCount`, because a caller comparing that pair on a secondary-source truncation reads equal values and
concludes nothing was lost. Renaming those scalars does not by itself prove completeness; the run-wide flag together
with a non-empty `truncatedReads` is the signal that rows were lost, and the scope-qualified names exist so the
scalars cannot contradict it.

Per-source detail SHALL be carried by `truncatedReads`, one entry per truncated read, each naming the data source, the
rows read, and the available total when one was measured. `truncatedReads` SHALL be present and empty — never absent —
on a complete run, so an agent can branch on its length without distinguishing empty from missing.

The tool's description SHALL state what each returned row count is scoped to, and SHALL state that the truncation flag
is run-wide.

#### Scenario: MCP result distinguishes a truncated run
- **WHEN** an agent calls `run_pipeline` on a pipeline whose source exceeds the cap
- **THEN** the returned object carries `truncated: true`, the primary source's available-row count, the notice text,
  and a `truncatedReads` entry for that source

#### Scenario: MCP result on a complete run carries no truncation claim
- **WHEN** an agent calls `run_pipeline` on a pipeline whose source is under the cap
- **THEN** the returned object carries `truncated: false`, an empty `truncatedReads`, and no notice

#### Scenario: A secondary-source truncation is not readable as a complete run
- **WHEN** an agent calls `run_pipeline` on a pipeline whose primary source is under the cap and whose `lookup`,
  `join` or `union` secondary source exceeds it
- **THEN** the returned object carries `truncated: true`, and `truncatedReads` contains exactly one entry, naming the
  secondary source with the rows read and the larger available total
- **AND** the returned object contains no field named `availableRowCount` and no field named `sourceRowCount`, so
  the equal-valued primary pair cannot be read as a run-wide statement

#### Scenario: The primary-scoped row counts are named for their scope
- **WHEN** any `run_pipeline` result is returned
- **THEN** the primary source's rows-read and available-row counts are carried under names that identify them as
  primary-scoped, and no field named `availableRowCount` sits at the top level of the result alongside the run-wide
  truncation flag
