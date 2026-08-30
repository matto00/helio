# HEL-891 red/green evidence (task 1.12)

`red-before-change.log` is the full `sbt "testOnly com.helio.services.pipelines.PipelineRunServiceSpec"`
output captured against UNMODIFIED production code, before any change to
`PipelineRunService`/`SchemaInferenceEngine`.

Result: 42 succeeded, 7 failed — exactly the two sets tasks.md 1.12 predicts:

**RED (failed, as expected — these prove the defects exist):**
- 1.2 "includes a column absent from row 0..." — `rec` missing from persisted fields
- 1.3 "reports a column absent from row 0... in the capability report" — `rec` missing
- 1.4 "types a fractional row-0 column as float..." — got `"double"`, not `"float"`
- 1.5 "types a column integral in row 0 but fractional later as float..." — got `"integer"`
- 1.6 "derives the same field names and types regardless of row order" — forward vs reversed schemas differ (and both differ from post-change expectation)
- 1.9 "types a column numeric in row 0 but non-numeric later as string..." — got `"integer"` (row-0 value), not `"string"`
- 1.11 "types an ISO-date-like string column as timestamp..." — got `"string"`, not `"timestamp"`

**GREEN (passed, as expected — regression guards, not defect proofs):**
- 1.7 "marks every derived field nullable..." (D3)
- 1.8 "types the image loader's nested content value as a single string field..." (D2/CR1)
- 1.10 "keeps displayName equal to the raw column name" (D7/CR4)
- 1.11a "keeps a numeric column with an explicit null on a later row typed integer..." (D8)
- 1.11b "includes an all-null column in the persisted fields, typed string..." (D8 fallback)

No test failed for a wiring/fixture/compilation reason — every red failure's assertion message
names the exact pre-change value (`"double"`, `"integer"`, `"string"`, missing `rec`) that the
row-0-only / non-canonical-type defects predict.
