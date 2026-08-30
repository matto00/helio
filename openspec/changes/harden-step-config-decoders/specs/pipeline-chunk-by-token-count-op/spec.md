## MODIFIED Requirements

### Requirement: Chunk-by-token-count op splits a string-body field into one row per real-BPE-token chunk

The execution engine SHALL support the `chunkbytokencount` op. The step config SHALL contain:
`field` (string, the source column name), `targetTokenCount` (integer, defaults to `500`),
`encoding` (string, `"o200k_base"` or `"cl100k_base"`, defaults to `"o200k_base"` when omitted, matched
case-insensitively when supplied, and reported as a validation failure at analyze time and failed at run
time when it matches neither member — never silently replaced by `"o200k_base"`), `indexField` (string,
defaults to `"chunkIndex"`), and `tokenCountField` (string, defaults to `"tokenCount"`). For each input
row: if the value of `field` is `null` or the field is absent, the row SHALL be dropped (zero output rows
for that input row). Otherwise the field's string value SHALL be tokenized using the selected encoding,
and the resulting token ids SHALL be split into consecutive chunks of at most `targetTokenCount` tokens.

This replaces the previous fallback to `"o200k_base"` for any unrecognised value. Tokenizing with an
encoding other than the one the caller asked for produces chunk boundaries that are wrong in a way no
downstream consumer can detect, while reporting success.

#### Scenario: A long field is split into fixed-size token chunks

- **WHEN** a `chunkbytokencount` step with `{"field":"content","targetTokenCount":500,"encoding":"o200k_base","indexField":"chunkIndex","tokenCountField":"tokenCount"}`
  is applied to a row whose `content` value tokenizes to 1200 tokens under `o200k_base`
- **THEN** three output rows are produced with `chunkIndex` `0`, `1`, `2`; the first two rows have
  `tokenCount` `500` and the last row has `tokenCount` `200`; each row's `content` decodes back to
  that chunk's token range

#### Scenario: Other row fields pass through unchanged

- **WHEN** a `chunkbytokencount` step with `{"field":"content","targetTokenCount":500}` is applied
  to a row `{"content":"some long text...","filename":"doc.txt"}`
- **THEN** every output row contains `{"filename":"doc.txt"}` unchanged

#### Scenario: Null content field drops the row

- **WHEN** a `chunkbytokencount` step is applied to a row where `field` is `null`
- **THEN** zero output rows are produced for that input row

#### Scenario: Empty string content yields zero output rows

- **WHEN** a `chunkbytokencount` step is applied to a row where `field` is `""`
- **THEN** zero output rows are produced for that input row

<!-- The scenario name below is retained verbatim because openspec requires a MODIFIED requirement to keep every
     existing scenario name. Its BODY now asserts the opposite of what the name says: there is no longer a
     fallback. Trust the body, not the heading. -->

#### Scenario: Unrecognized encoding value falls back to o200k_base
- **WHEN** a `chunkbytokencount` step's stored config has `"encoding":"not-a-real-encoding"`
- **THEN** the stored config still decodes, retaining the supplied value rather than being rewritten to
  `"o200k_base"`, so an existing row remains readable
- **AND** analyze reports a validation error naming `not-a-real-encoding` and listing the supported encodings
- **AND** running the pipeline fails rather than tokenizing with an encoding the caller did not request
