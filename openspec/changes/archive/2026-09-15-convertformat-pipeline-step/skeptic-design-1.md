## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md` in the worktree.
- **D7 cost classification claim** — read
  `backend/src/main/scala/com/helio/domain/engine/PipelineCostEstimator.scala` in full. Confirmed:
  `CheapOps` is hand-maintained (not derived from `Registry.keySet`), the comment explicitly calls
  out HEL-1107's `convertformat` as the motivating case for keeping it hand-maintained, and the
  reasoning in D7 ("cost scales with bytes per content cell, which `CostInput` cannot see") matches
  the actual `CostInput`/`estimateRows` shape (row-count and step-count only, no byte size anywhere).
  `AiOps` is untouched and the comment on it currently reads "HEL-1105/1106" (`Neither op is
  implemented/registered (HEL-1105/1106)`), confirming design.md's claim that this needs correcting
  to HEL-1106/1107 (task 3.1/2.5 cover this).
- **Schema enum claim** — grepped `schemas/pipelines/pipeline-analyze-response.schema.json`: reason
  enum currently has `ai-step`, `writeback-step`, `unclassified-op` but no `content-conversion`.
  Design's claim that the enum needs a new entry is correct, and task 2.5 covers it.
- **`StepExecutionException.from` claim (D3)** — read
  `backend/src/main/scala/com/helio/domain/engine/InProcessPipelineEngine.scala:47-50`. Confirmed:
  `case iae: IllegalArgumentException => new StepExecutionException(stepId, stepKind, iae.getMessage, cause, lanePath)`
  preserves the message verbatim; any other throwable is flattened to "step execution failed". So a
  reason-coded `IllegalArgumentException` really does reach the run-visible error as designed.
- **Wiring enumeration vs. `upsertsource`** — grepped every file touching `upsertsource` across
  `backend/src/main/scala`. `upsertsource` additionally touches `PipelineCycleValidator`,
  `PipelineCycleGuard`, `WriteBackSink`, `InProcessExecutionBackend`/`PipelineExecutionBackend` —
  but those are write-back-specific (cycle detection on write edges, execution-backend dispatch for
  writers). `convertformat` is a pure transform (no write-back target), so it correctly does not need
  those sites; design.md's wiring list (Registry, `PipelineStepKind.All`, codec, `rowToDomain`,
  analyze dispatch, analyze response protocol + `PipelineService` mapping, write-path validation,
  schemas) matches the non-writeback subset of `upsertsource`'s wiring. Frontend claim (unsupported-op
  fallback renders any registered-but-uncarded op safely via `stepNarrowing.ts`/`StepOpEditor.tsx`) is
  plausible from the description and consistent with how HEL-1109 is scoped out in the ticket; I did
  not independently re-derive the fallback logic byte-for-byte, but nothing in the diff or design
  contradicts it, and the ticket explicitly gates a StepCard as escalate-if-mandatory, which design.md
  answers by citing the fallback path by name.
- **D4 CSV<->JSON** — traced the definition against header-only, empty string, duplicate headers,
  single column with empty cells, CRLF-in-quoted-field. All five are explicitly handled: header-only
  documented as the one lossy case, empty string -> `[]`, duplicate/empty header names rejected as
  `csv-malformed` (not silently accepted then silently mismapped), CRLF preserved verbatim inside a
  JSON string with re-quoting logic (`,`/`"`/`\r`/`\n` triggers quoting) on the way back out. This
  definition is precise enough to implement without further judgment calls.

### D5 text<->Markdown "lossless" definition — NOT achievable for every string t as specified

This is a load-bearing claim (AC1: "lossless precisely defined... achievable"), and design.md commits
to `markdown->text(text->markdown(t)) == normalize(t)` **for EVERY string `t`**. Two adversarial
inputs break it as specified:

1. **Literal `"&#32;"` in the input text.** `text->markdown` escapes every CommonMark-escapable ASCII
   punctuation character; `&`, `#`, `;` are all in that set, so the literal substring `&#32;` becomes
   `\&\#32\;` in the markdown output (digits are not punctuation, so `32` stays bare). The reduction
   direction is specified as: *"then backslash-escape removal, `&#32;` decoding, and hard-break..."* —
   **escape removal runs before `&#32;` decoding.** Running escape-removal on `\&\#32\;` strips the
   backslashes and produces the bare string `&#32;`, which the very next step (`&#32;` decoding) then
   decodes into a literal space. The original text's literal `&#32;` is silently corrupted into a
   space. This is exactly the adversarial input the design's own leading-space-encoding scheme
   introduces a collision risk for, and the stated operation order does not resolve it — it makes it
   worse, because escape-removal happening first destroys the very marker (the backslashes) that would
   have disambiguated "this is escaped literal text" from "this is the leading-space token."
2. **A line ending in a literal trailing backslash inside a non-empty paragraph** (e.g. `t = "foo\\\n"`,
   i.e. the line content is `foo` followed by one literal backslash character, then a newline). The
   backslash is CommonMark-escapable, so it gets escaped to `\\` (two chars) by the punctuation-escape
   rule; then the paragraph-internal `\n` becomes a backslash hard break (one more `\` prepended to the
   `\n`). The result is three consecutive backslash characters immediately before the newline. The
   documented reduction order (escape-removal, then `&#32;` decoding, then hard-break conversion) does
   not specify how to correctly partition three consecutive backslashes into "one escaped backslash" +
   "one hard-break marker" — applying escape-removal first (pairing left-to-right) on an odd run of
   backslashes ahead of a hard-break marker is ambiguous/order-dependent and not resolvable by the
   stated pipeline without an explicit disambiguation rule (e.g. "hard-break conversion must run
   before escape-removal, consuming the rightmost backslash first"). As written, this is underspecified
   for `t`s that end a paragraph line in a literal backslash.
3. **Lines of only spaces / tabs — not addressed.** D5 says "leading spaces on a line become `&#32;`"
   and separately "blank lines are preserved as-is," but does not say which rule governs a line that
   consists *entirely* of spaces (every space on such a line is "leading"), nor does it mention tabs at
   all. This is a real gap in the "for EVERY string t" precision claim — the task explicitly asked for
   this adversarial case and design.md does not resolve it either way.

None of these are implementation bugs (nothing is coded yet) — they are gaps in the **design's own
lossless definition**, which AC1 requires to be both "precisely defined" and (per D5's own text)
proven for every string. As currently written, an implementer following D5 literally will ship a
converter that corrupts specific real inputs (a document containing the string `&#32;`, or text ending
a line in a backslash), and `tasks.md` task 4.1 ("text with Markdown-significant chars, leading spaces,
blank lines") does not explicitly enumerate the two adversarial cases above, so the planned test suite
would not necessarily catch them even after implementation.

### Change Requests

1. **design.md D5**: Fix the escape-vs-`&#32;` ordering bug. Either (a) choose a non-colliding
   leading-space encoding that cannot be produced by escaping ordinary punctuation (e.g. reserve a
   sequence that is never a substring text->markdown's own escaping can emit, or use a different
   escape prefix for the space-marker than for ordinary backslash-escapes), or (b) make `&#32;`
   decoding happen strictly on *unescaped* occurrences only (i.e. do escape-removal and `&#32;`
   decoding in the same pass so an escaped `\&\#32\;` is distinguished from the bare marker, never
   two sequential blanket passes). Re-derive the reduction order so it is provably unambiguous, not
   just narratively ordered.
2. **design.md D5**: Specify an unambiguous rule for a paragraph-internal line ending in one or more
   literal backslash characters immediately before `\n` — state explicitly which backslash (if any) is
   consumed as the hard-break marker before escape-removal runs, and prove it works for a line ending
   in exactly one, two, and three literal backslashes.
3. **design.md D5**: State the rule for a line consisting entirely of spaces (and address tabs, even if
   the rule is "tabs are passed through unescaped and are out of scope because X") — currently
   unaddressed by both the leading-space rule and the blank-line rule.
4. **tasks.md 4.1**: Add the literal-`&#32;`-in-input and trailing-backslash-before-newline cases as
   named test cases (not just "Markdown-significant chars"), since these are exactly the cases that
   break the current D5 definition and a generic property-style test may not naturally hit them.

### Non-blocking notes

- D4 (CSV<->JSON), D7 (cost classification), the wiring enumeration, and the `StepExecutionException`
  failure-contract claim (D3) all check out precisely against the current codebase — no changes needed
  there.
- C6 (mutation-proven failure tests) is captured concretely in task 4.2 ("record a mutation per arm
  showing it red"), which is failable/falsifiable as written.
