# node-root-encoding-guard Specification

## Purpose
The node-root-encoding guard fails CI when backend repositories (and helio-mcp) use the ambiguous standalone "node_step_id IS NULL means the root" encoding, while letting individually reviewed exemptions survive unrelated edits to the files they live in.

## Requirements

### Requirement: Exemptions are keyed on line content, not line number
The guard SHALL identify each reviewed exemption by its file, the name of the declaration enclosing the line, the whitespace-normalised text of the governing match arm (the nearest preceding or same `case ... =>` line in that declaration, or none), and the line's whitespace-normalised text, and SHALL NOT use the line's number as part of the key.

#### Scenario: Lines inserted above an exempt site
- **WHEN** lines are inserted or removed anywhere in a scanned file without changing an exempt line's text or its enclosing declaration
- **THEN** the guard reports no violation for that site

#### Scenario: Exempt line reformatted
- **WHEN** only the leading, trailing or internal whitespace of an exempt line changes
- **THEN** the guard still recognises the line as exempt

#### Scenario: Governing match arm of an exempt site changes
- **WHEN** the `case` pattern governing an exempt site is widened or rewritten while the exempt line's own text is unchanged
- **THEN** the guard fails, reporting the site as unexempted and its exemption as stale

### Requirement: Exemptions are bounded by an exact occurrence count
Each exemption SHALL declare how many occurrences it covers. The guard SHALL report a violation for every banned-form occurrence beyond that count in the same file and enclosing declaration, and SHALL fail when an exemption matches fewer occurrences than it declares.

#### Scenario: New line identical to an exempt line
- **WHEN** a new line with the same normalised text as an exempt line is added in the same enclosing declaration
- **THEN** the guard reports a violation

#### Scenario: Identical text in a different declaration or file
- **WHEN** a line with the same normalised text as an exempt line appears in a declaration or file that the exemption does not name
- **THEN** the guard reports a violation

#### Scenario: Exempt site removed but exemption left behind
- **WHEN** an exemption matches fewer occurrences than its declared count
- **THEN** the guard fails and names the stale exemption

#### Scenario: Exempted file missing
- **WHEN** a scanned file that still has exemptions no longer exists
- **THEN** the guard fails and names each of that file's exemptions as stale

### Requirement: Unexempted banned forms still fail
The guard SHALL report every banned-form occurrence that is not root-qualified on the same line and not covered by an exemption.

#### Scenario: New unexempted hit
- **WHEN** a new standalone `node_step_id IS NULL` predicate is added to a scanned file
- **THEN** the guard exits non-zero and names the file and line

#### Scenario: Exemption removed
- **WHEN** the exemption covering an existing site is deleted from the guard
- **THEN** the guard reports that site as a violation
