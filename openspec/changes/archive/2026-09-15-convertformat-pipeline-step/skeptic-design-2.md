## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

**Round-1 item 1 — escape-removal vs `&#32;` decoding order.** Hand-traced `t = "&#32;"` (literal
text, not a real space run) through the rewritten D5 char-by-char encoder: each of `&`, `#`, `;` is
individually escaped (`\&`, `\#`, `\;`) since they're in the ASCII-punctuation set, while `3`/`2` are
copied — encode output is `\&\#32\;`, never a bare `&#32;`. Decoding this left-to-right, rule (1)
(`\`+punct) fires on `\&` and `\#` before rule (3) can ever see a bare `&#32;` token, so it decodes
back to the literal text `&#32;`. Traced `"&#9;"` the same way — same result. Resolved: the tokenizing
scan and the per-character (not per-token) escaping of `&`/`#`/`;` make the ambiguity round 1 flagged
structurally impossible, not just asserted away.

**Round-1 item 2 — lines ending in literal backslashes before a newline.** Traced n=1, n=2, n=3 by
hand (`"foo\" + LF + "bar"`, `"foo\\" + LF + "bar"`, `"foo\\\" + LF + "bar"`) and the pure single-
backslash case `t = "\"`. Each literal `\` is escaped to `\\` (2 chars) at encode time, and a real
line-join hard-break adds exactly one more `\` before the `\n` (since both lines are non-empty).
Decoding a run of `2n+1` backslashes before `\n` left-to-right: `n` pairs each collapse via rule (1)
to one `\`, and the final lone backslash + `\n` collapses via rule (2) to `\n` — this generalizes for
any `n >= 0`, confirmed by direct trace for n=0..3. The design's "why the round trip holds" paragraph
is not merely asserted; I reproduced the exact character counts by hand and they match.

**Round-1 item 3 — lines of only spaces/tabs.** Traced `"   "` (3 spaces, no other chars) and a
tab-only line. Under the standard "leading run = prefix before first non-whitespace (or the whole
line if none exists); trailing run = suffix after the last non-whitespace (or the whole line if none
exists)" reading — the only reading consistent with the design's own claim "so a line of only
spaces/tabs is fully encoded" — every character in an all-whitespace line falls in the union of the
two runs and gets escaped as `&#32;`/`&#9;`. Decode consumes each 5-char/4-char token via rule (3)
and reproduces the original run exactly. I also traced the mixed case `" a "` (leading+interior+
trailing) and `"\t# x  "` (tab leading, two trailing spaces, one interior space) — both round-trip
correctly, and the interior space is copied literally in both directions without accidental
collision with the `&#32;` token (confirmed above that literal `&`/`#`/`;` are always individually
escaped, so a decoded bare space from rule (5) can never be misread as originating from an encoded
token). One soft note: design.md states the *outcome* ("fully encoded") for the all-whitespace case
but doesn't spell out the leading/trailing-run algorithm itself — the natural reading is unambiguous
here and I traced it working, so I'm not treating this as a blocking gap, but tasks.md 4.1 names the
"lines of only spaces/tabs" case as a required test, which will force the implementer to land on the
same reading (a divergent, narrower reading would fail that named test).

**Round-1 item 4 — missing named test cases in tasks.md 4.1.** Re-read tasks.md 4.1: it now names
"literal `&#32;` and `&#9;` in input," "lines ending in 1/2/3 literal backslashes before a newline,"
"a text that is exactly one backslash," "lines of only spaces/tabs," and "blank lines" explicitly.
All four round-1 concerns are now individually enumerated, not left to a generic "round-trip tests"
bullet. Resolved.

**Additional adversarial traces (not in round 1's list), all round-tripped correctly by hand:**
`"1. item"` (escaped `.` prevents an ordered-list-marker misread on decode, since rule (1) consumes
`\.` before rule (4)'s structural-marker check ever sees a bare `.`); `"a" + LF + LF + "b"` (blank
line preserved via bare, unescaped `\n` joins, since the design's join rule only inserts a
backslash-hard-break when *both* adjacent lines are non-empty); `"a\nb"` with no special chars
(ordinary hard-break join, decodes via rule (2)); and a boundary case I constructed myself — a line
ending in a literal backslash immediately followed by a blank line (`"x\" + LF + "" + LF + "y"`) —
where the trailing-backslash escape and the *bare* (non-hard-break) join don't collide, because rule
(1)'s pairwise consumption is local and greedy and stops as soon as no second punctuation character
follows. I found no adversarial input in the encodable text alphabet that breaks the round trip.

**D3 (failure contract).** Read `InProcessPipelineEngine.scala:41-52` — `StepExecutionException.from`
keeps an `IllegalArgumentException`'s message verbatim, otherwise substitutes the opaque "step
execution failed." Matches D3's claim exactly (ground truth, not asserted).

**D4 (CSV<->JSON).** Reviewed proposal/design for internal consistency; no contradiction with D1-D3.
Not independently re-derived byte-for-byte (round 1 already covered CSV concerns and raised none),
but re-read for consistency this round and found no change since round 1 that would reopen it.

**D6 (analyze parity).** Grepped `PipelineAnalyzeService.scala` — `inferSplitText` (the cited mirror)
implements exactly the three-branch shape D6 describes: field-absent -> validation error,
present-but-not-`string-body` -> "not a content field" error (`Field '$field' is not a content field
(string-body); splittext requires a string-body field"`), else passthrough. D6's claim to mirror this
pattern for `inferConvertFormat` is grounded in a real, existing precedent, not invented.

**D7 (cost classification).** Read `PipelineCostEstimator.scala` in full. `classifyStep` currently
checks `AiOps` -> `WriteBackOps` -> `CheapOps` -> falls to `unclassified-op`, exactly the ordering D7
says the new `ContentConversionOps` check will be inserted into (after AI/write-back, before
`CheapOps`). `CheapOps`'s own doc comment already explicitly calls out `convertformat`/HEL-1105/1107
as the motivating case for NOT deriving cheapness from `Registry.keySet` — this is strong
corroborating ground truth for D7's rationale, not just the plan's own assertion. The `AiOps` comment
currently reads "(HEL-1105/1106)"; the plan to correct it to "(HEL-1106/1107)" is coherent since this
ticket (HEL-1105) is what's now registering `convertformat`.

**Wiring enumeration (tasks 2.1-2.4) vs `splittext`.** Grepped for `SplitText` across
`PipelineStep.scala`, `PipelineStepConfigCodec.scala`, `PipelineStepRepository.scala`,
`PipelineAnalyzeProtocol.scala`, `PipelineService.scala` — all five hit, confirming these are exactly
the sites a content-transform (non-write-back) op wires through. Separately confirmed `upsertsource`
touches many more files (`WriteBackSink`, `PipelineCycleValidator`/`PipelineCycleGuard`,
`DataSourceRepository`, `PipelineRunService`, `SparkJobSubmitter`, `DataSourceService`) that
`convertformat` correctly does NOT need, since it isn't a write-back/cycle-relevant edge — design.md's
choice to cite `upsertsource` for the *general* wiring shape and `splittext` for the *content-field*
op pattern, rather than copying upsertsource's full footprint, is the right scope.

**Frontend claim — registering the op backend-side cannot make the frontend misclassify it as
SUPPORTED.** Read `frontend/src/features/pipelines/state/stepNarrowing.ts` in full. `OP_TYPES` is a
hardcoded, static TypeScript array literal (not fetched from any backend endpoint at runtime) that
drives the create-step picker; `pipelineStepToStep` resolves a persisted step's editor via
`OP_TYPES.find((op) => op.id === ps.type) ?? unsupportedOpType(ps.type)`. Since `convertformat` is
deliberately excluded from `OP_TYPES` (per C5, no StepCard), any persisted `convertformat` step falls
through to `unsupportedOpType`, which `StepOpEditor.tsx`/`isUnsupportedOpType` render as the
read-only "Unsupported step" notice. There is no code path by which a backend-side registry change
could cause the frontend to reclassify this op as supported — the frontend's op catalog is entirely
independent of backend registration. Design's claim is correct and grounded.

### Verdict: CONFIRM

All four round-1 change requests are resolved by concrete, hand-traceable mechanics in the rewritten
D5, not by restated assertions — I reproduced the encode/decode byte sequences myself for every named
case plus several adversarial extras I constructed, and found no counterexample. D3, D4 (unchanged
from round 1), D6, D7, the wiring enumeration, and the frontend fallback claim all check out against
current ground truth in the worktree.

### Non-blocking notes

- design.md's D5 doesn't spell out the leading/trailing-whitespace-run algorithm as an explicit
  procedure (only asserts the outcome for all-whitespace lines); the natural reading is unambiguous
  and I confirmed it round-trips, and tasks.md 4.1's named test case will catch a divergent
  implementation, so this is not a blocking ambiguity — just something the implementer should get
  right the first time rather than have to rediscover from a failing test.
