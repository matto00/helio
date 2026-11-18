## ADDED Requirements

### Requirement: Citation id offset for multi-pack loops
`InsightContextBuilder.pack` SHALL accept a first citation number (default 1) so that several packs built inside one
ask loop assign disjoint ids (`c<first>`, `c<first+1>`, ...). With the default, every existing caller's pack is
byte-identical to before.

#### Scenario: Default numbering unchanged
- **WHEN** a pack is built without a first citation number
- **THEN** its ids start at `c1` and its serialized text equals the pre-change output for the same inputs

#### Scenario: Offset numbering
- **WHEN** a pack is built with first citation number 7
- **THEN** its first citation id is `c7` and no id below `c7` appears in the pack
