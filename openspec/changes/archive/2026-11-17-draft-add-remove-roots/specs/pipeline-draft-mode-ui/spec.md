## ADDED Requirements

### Requirement: Add and remove source are draft actions
While a draft exists, "Add source" (desktop spine and the phone actions menu) and "Remove source" on a source card SHALL
be enabled and SHALL change only the draft. A drafted source SHALL appear in the source list with the draft styling, its
sample SHALL feed the draft preview, and steps and Outputs SHALL be addable on it. A drafted removal SHALL hide the
source, its steps and its Outputs from the draft view. Save & run SHALL apply them atomically with the rest of the draft,
confirming the removal cascade first; Discard SHALL drop them. The kept draft SHALL restore them after a reload, and the
stale-base "Reload the saved pipeline" path SHALL count a root op it cannot re-apply as dropped. Removing the last
remaining source SHALL stay unavailable.

#### Scenario: Add a source inside a draft and save
- **WHEN** a user with a draft adds a source, adds a step on it, and clicks Save & run
- **THEN** one save request carries both, and after it the saved pipeline shows the new source and step

#### Scenario: Discard drops a drafted source
- **WHEN** a user adds a source inside a draft and clicks Discard
- **THEN** the source list is back to the saved roots and no request changed the pipeline

#### Scenario: Kept draft restores a drafted removal
- **WHEN** a user removes a source inside a draft and reloads the page
- **THEN** the restored draft still hides that source and Save & run removes it
