## Context

See proposal.md. Every op registers through `PipelineStep.Registry` (`domain/model/PipelineStep.scala`), which feeds
`PipelineStepKind.All` (the create/add 400 gate), the codec, and the engine. Analyze inference is a hand dispatch in
`PipelineAnalyzeService` (falls through to `Unknown op`), the typed analyze response is built in
`PipelineService` (~line 1697), and persisted rows decode in `PipelineStepRepository.rowToDomain` (throws on an
unmapped config). `upsertsource` (HEL-1099..1102) and `splittext` (content-field op) are the wiring references.
Engine failures: `StepExecutionException.from` keeps an `IllegalArgumentException` message verbatim as the curated
reason; any other throwable becomes the opaque "step execution failed". V107 already admits the op; no migration.
Frontend maps any op it has no editor for to `unsupported:<type>` and shows a read-only notice (`stepNarrowing.ts`,
`StepOpEditor.tsx`), so no card is required here (HEL-1109).

## Goals / Non-Goals

**Goals:** deterministic CSV<->JSON and text<->Markdown over a `string-body` field; a precisely defined lossless round
trip; named failure reasons; full backend wiring; a deliberate cost classification.
**Non-Goals:** AI conversion or hooks for it (C1, HEL-1135); `binary-ref`; other pairs; StepCard; new dependencies.

## Decisions

**D1 Config.** `{ field: string, from: "csv"|"json"|"text"|"markdown", to: <same enum>, outputField?: string }`.
`outputField` defaults to `field`. Tolerant read decode (absent fields default to `""`, never throw in
`rowToDomain`), strict write validation: supported pair only (`csv->json`, `json->csv`, `text->markdown`,
`markdown->text`); `from == to` and cross pairs (e.g. `csv->markdown`) are rejected with 400.

**D2 Row shape.** 1:1 map. Each input row yields exactly one output row: passthrough fields plus the converted string
written to `outputField`. The step never drops, fans out, or blanks rows.

**D3 Failure contract.** Any unconvertible value throws `IllegalArgumentException` whose message starts with a stable
reason code: `convertformat <code>: <detail>`, so it survives `StepExecutionException.from`. Codes:
`field-missing` (absent or null), `field-not-string`, `csv-malformed` (unterminated quote, ragged row with a column
count differing from the header, duplicate or empty header name), `json-malformed` (unparseable), `json-not-array-of-objects`,
`json-nested-value` (object/array cell), `json-non-string-value` (number/boolean/null cell; see D4), `json-inconsistent-keys`.
The whole run fails on the first bad row (engine semantics); no partial output.

**D4 CSV <-> JSON and what "lossless" means.** CSV is untyped, so the typed-value round trip cannot be lossless;
rather than silently stringify, JSON cells must be strings.
- csv->json: RFC 4180 parse (quoted fields, embedded commas, quotes, newlines; `\r\n` and `\n` rows). First record is
  the header. Output: compact JSON array of objects, keys in header order, all values strings. Header-only CSV -> `[]`.
  Empty string -> `[]`.
- json->csv: requires an array of objects with identical key sets (order taken from the first object); every value a
  string. Output: header + rows joined by `\n`, a field quoted iff it contains `,` `"` `\r` or `\n` (quotes doubled),
  no trailing newline. `[]` -> `""`.
- Lossless means: for any CSV input `c` that parses, `csv(json(c)) == canonical(c)`, where `canonical` is re-serialization
  under the rules above (so equivalent quoting/line endings compare equal and every cell string is byte-identical);
  and for any accepted JSON input `j`, `json(csv(j))` is structurally equal to `j` (same keys, order, strings).
  Header-only CSV is the one documented lossy case (`[]` carries no header); tested as such.

**D5 Text <-> Markdown and what "lossless" means.** Markdown is a markup language over text, so only one direction
can be exact. The contract: `markdown->text(text->markdown(t)) == normalize(t)` for EVERY string `t`, where
`normalize` only converts `\r\n`/`\r` to `\n`.
- text->markdown (after `normalize`), per line (split on `\n`), per character:
  every ASCII punctuation character `c` (the CommonMark-escapable set, including `\`, `&`, `#`, `;`) -> `\c`;
  a space or tab that is leading or trailing on its line -> `&#32;` / `&#9;` (so a line of only spaces/tabs is fully
  encoded, and indentation or trailing-space hard breaks can never arise); interior spaces/tabs and all other
  characters (digits, letters, non-ASCII) are copied. Lines are joined with `\` + `\n` (backslash hard break) when
  both adjacent lines are non-empty, otherwise with a bare `\n` (so blank lines stay paragraph breaks).
  Invariant: in the output, an unescaped `&`, `#`, `*`, `` ` ``, `[`, `>`, `-`, `.` or any other punctuation can
  only originate from the `&#32;`/`&#9;` tokens; every text-origin punctuation character is preceded by `\`.
- markdown->text is ONE left-to-right scan (no sequential blanket passes), consuming the first matching token:
  (1) `\` + ASCII punctuation -> that character; (2) `\` + `\n` -> `\n`; (3) `&#32;` -> space, `&#9;` -> tab;
  (4) an unescaped structural marker of the documented subset (line-start ATX `#`s + space, emphasis/strong `*`/`_`
  runs, inline-code backticks, fence lines, link/image `[text](url)` -> text, line-start list/blockquote markers)
  -> removed/reduced; (5) any other character -> copied. A `\` not followed by punctuation or `\n` is copied.
  Other entities (e.g. `&amp;`) pass through literally.
- Why the round trip holds for every `t`: because each backslash consumes exactly the next character in a left-to-
  right scan, a line ending in n literal backslashes (encoded as 2n backslashes, then `\`+`\n` hard break) scans as n
  escaped backslashes followed by one hard break, for any n >= 0 (n=1: `\\\`+LF; n=2: `\\\\\`+LF; n=3 likewise).
  A literal `&#32;` in `t` encodes as `\&\#32\;`; rule (1) fires on `\&` before rule (3) can see `&#32;`, so it
  decodes to the literal characters, never a space. Rule (4) never fires on text->markdown output since every
  marker there is escaped. Lines of only whitespace and tabs round-trip via rule (3).
- markdown->text never fails on a string (every string is valid Markdown); only `field-missing`/`field-not-string`
  apply. Not claimed: `text->markdown(markdown->text(m)) == m` (formatting is intentionally discarded).

**D6 Analyze parity.** `inferConvertFormat` mirrors `inferSplitText`: field absent -> validation error; field type
not `string-body` -> "not a content field" error; invalid pair -> error. Output schema: input schema with
`outputField` set/added as `string-body`. Engine apply and inference share `ConvertFormatStep.SupportedPairs` so the
two cannot diverge.

**D7 Cost classification: deny with a new reason code `content-conversion`.** New set
`ContentConversionOps = Set("convertformat")` in `PipelineCostEstimator`, checked after AI/write-back and before
`CheapOps`. Rationale: the estimator's cheapness bounds are row-count and step-count only; convertformat's cost scales
with bytes per content cell (one row can hold a multi-MB document), which `CostInput` cannot see, so it is not
"actually cheap" on the evidence available. Deny-by-default holds. A distinct code (not `unclassified-op`) records it
was classified deliberately and lets HEL-1093 relax it later with a content-size signal. Alternatives rejected: adding
to `CheapOps` (unbounded bytes would auto-run); leaving it `unclassified-op` (fails the partition test by intent and
lies about review). The response schema's reason-code enum gains `content-conversion`. `AiOps` unchanged (C3); its
comment corrected to HEL-1106/1107.

**D8 Test stand-ins.** The partition test extends to four disjoint sets. `PipelineCostEstimatorSpec`'s simulated
future op becomes `"notarealop"`. `PipelineCreateTransactionalSpec`'s rejection loop drops `convertformat` (now
`analyzewithai`/`generatetext`) and gains an "accept a convertformat step" case, mirroring the upsertsource flip.

## Risks / Trade-offs

- [Strict string-only JSON cells reject common numeric JSON] -> named `json-non-string-value` reason; a typed-cast
  step can precede it; revisit with a real use case rather than silently lose types.
- [markdown->text subset is not full CommonMark] -> documented subset; lossless claim is only the text-first direction.
- [Whole run fails on one bad row] -> matches existing engine semantics (assert/cast).
- [Failure tests could pass vacuously] -> each reason-code test must be shown red under a mutation (C6).

## Planner Notes

- Self-approved: config field names, reason codes, `content-conversion` code, 1:1 row shape, `binary-ref` excluded.
- No frontend change: the unsupported-op fallback already renders a persisted convertformat step safely.
