# insight-grounding Specification

## Purpose
Defines how an insight's model input (the grounding pack) is built and bounded, how a preset is chosen, how the
model is called, and which model outputs are accepted, so every number an insight states is traceable to cited data.

## Requirements

### Requirement: Grounding pack cites every number

The system SHALL build a grounding pack from a node snapshot head, resolved compare deltas and window summary points.
Every numeric value in the pack, and every date-valued cell or capture time, SHALL carry a citation id `c1..cn` that
maps to its outputId, field, value and capturedAt. A string cell holding a plain number (for example `"1234"` from an uncast CSV) SHALL be
cited as a number. The pack SHALL be built only from these inputs and SHALL NOT read a
data source or any source configuration.

#### Scenario: Numbers are cited

- **WHEN** a pack is built from a head with a numeric column and a compare delta
- **THEN** every numeric value in the pack appears with a citation id, and each id resolves to outputId, field, value
  and capturedAt

#### Scenario: No source credential or connection fields

- **WHEN** a pack is built
- **THEN** every structural key of the pack belongs to a fixed allow-list, and no key or value derived from a data
  source's configuration, credentials or connection settings is present

### Requirement: Row text is data, not instructions

Row text SHALL be serialized as JSON string values inside a single delimited data block in the user message. A row
value SHALL NOT be able to close the data block or appear outside it, whatever characters it contains.

#### Scenario: Injected instruction stays inside the data block

- **WHEN** a row value shorter than the per-cell character cap contains the closing delimiter followed by an
  instruction
- **THEN** the user message contains exactly one opening and one closing delimiter, the instruction text appears only
  between them, and parsing the block's JSON returns the original row value unchanged

### Requirement: Input-token budget

The estimated input tokens of the full model request (system prompt plus user message) SHALL NOT exceed the input
budget (8,000 tokens by default). When over budget the pack SHALL shed data in a stated order; when even the minimal
pack is over budget no model call SHALL be made.

#### Scenario: Large head is trimmed under budget

- **WHEN** a pack is built from a head whose rows would exceed the budget
- **THEN** the estimated input of the resulting request is at or under the budget

#### Scenario: Irreducible pack is refused

- **WHEN** the minimal pack still exceeds the budget
- **THEN** the render outcome is a budget refusal and the model client is never called

### Requirement: Preset inference

When the preset is `auto`, the system SHALL infer it from the node's Outputs in this precedence: a metric with a valid
compare yields `delta`; a time-series chart yields `trend`; a top-n table yields `leaders`; anything else yields
`summary`. An explicit preset SHALL be used as given.

#### Scenario: Each rule and the fallback

- **WHEN** inference runs on a node carrying a metric with compare, a time-series chart, a top-n table, or none of these
- **THEN** it returns `delta`, `trend`, `leaders` or `summary` respectively

### Requirement: Model call shape

A render SHALL call the model through a replaceable seam with a system prompt, no tools, no web search and at most 400
output tokens, using the shared configured model. Tests SHALL use a fake seam; no test SHALL make a live API call.

#### Scenario: Wire request carries system, no tools

- **WHEN** the production adapter renders over a recording fake transport
- **THEN** the recorded request has a non-empty system field, no tools, no web search tool and max tokens of at most 400

### Requirement: Output validation

A model output SHALL be rejected when it exceeds `maxSentences` or `maxChars`, uses a citation marker not in the pack,
or contains a numeral or date that does not match a value cited in the same sentence under the normalization rules.

#### Scenario: Fabricated number rejected

- **WHEN** the output states a number that matches no cited value in its sentence
- **THEN** the output is rejected with a reason naming that numeral

#### Scenario: Rounded and percent numbers accepted

- **WHEN** the output states a correctly rounded cited value, or a cited percent change with a `%` sign, with or
  without a minus sign for a negative change
- **THEN** the output is accepted

#### Scenario: Citation markers are not numerals

- **WHEN** a valid output cites `[c12]` next to a number matching `c12`
- **THEN** the digits inside the marker are not treated as an uncited numeral and the output is accepted

#### Scenario: Unknown citation marker rejected

- **WHEN** the output contains a citation marker whose id is not in the pack
- **THEN** the output is rejected

#### Scenario: Over-length output rejected

- **WHEN** the output has more sentences than `maxSentences` or more characters than `maxChars`
- **THEN** the output is rejected

### Requirement: Rejected render keeps the last good render

A rejected output SHALL be retried at most once. If the retry is also rejected, or the model call fails, the outcome
SHALL carry no new render text and SHALL carry the last good render unchanged.

#### Scenario: Two rejections keep last good

- **WHEN** the fake client returns a fabricated number twice
- **THEN** the model is called exactly twice, the outcome is a rejection, and its last good render equals the input one

### Requirement: Cost recorded, not enforced

The system SHALL compute a render's cost in micro-dollars from the API-reported usage and a per-model price table
whose values are read from Anthropic's published pricing. An unknown model SHALL yield no cost rather than a guess. No
render SHALL be refused on cost.

#### Scenario: Known model cost

- **WHEN** usage is 1,000,000 input and 1,000,000 output tokens on a priced model
- **THEN** the cost equals that model's input plus output price per million tokens, in micro-dollars

#### Scenario: Unknown model

- **WHEN** the model id is not in the price table
- **THEN** the cost is absent and the render is not refused

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
