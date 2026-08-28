# Comment corpus analysis (2026-08-27)

A census of every comment in the repo, plus two attempts to measure whether they
are worth their space. Read the **Caveats** section before quoting any number
from here — one of the two instruments turned out to be unreliable.

Scripts and raw data are session-scratch and not committed; the method is
reproducible from the descriptions below.

## 1. Census

Scanned all tracked source files (Scala, TS/TSX, CSS, SQL, shell, JS/MJS/CJS,
sbt, YAML, TOML) with a string-aware tokenizer, so `//` inside string literals
and URLs is not miscounted. Contiguous runs of single-line comments are merged
into one **logical block** — the raw per-line count is 21,359, which is not the
number you want.

| metric                            |             value |
| --------------------------------- | ----------------: |
| Logical comment blocks            |         **9,435** |
| Comment lines                     |        **36,761** |
| Source lines (same files)         |           255,667 |
| Comment density                   |         **14.4%** |
| Blocks citing a `HEL-####` ticket | **3,058 (32.4%)** |
| Distinct tickets cited            |               273 |

By language:

| ext    | blocks (raw) | comment lines | src lines | density |
| ------ | -----------: | ------------: | --------: | ------: |
| .scala |        7,496 |        17,097 |   118,483 |   14.4% |
| .tsx   |        6,400 |         7,919 |    69,608 |   11.4% |
| .ts    |        4,197 |         6,958 |    43,606 |   16.0% |
| .sql   |        1,348 |         1,348 |     2,728 |   49.4% |
| .sh    |          887 |           887 |     2,160 |   41.1% |
| .css   |          533 |         1,917 |    14,477 |   13.2% |

Block-size distribution (merged): 32.5% are one line, 29.6% are 2-3 lines,
30.1% are 4-9, 7.8% are 10+.

Composition by kind (merged blocks): prose 34.5%, doc comment 33.9%,
ticket-referencing 20.1%, short (<=6 words) 11.5%. Section-divider comments
(`// ── Foo ──`) are **997 blocks, 10.6% of the corpus**.

Notable absences: almost no TODO/FIXME debt, and only ~115 blocks that look
like commented-out code.

Most-cited tickets: HEL-703 (70), HEL-702 (66), HEL-548 (65), HEL-412 (64),
HEL-822 (62), HEL-528 (59), HEL-667 (52), HEL-535 (52). Ticket refs concentrate
in `backend/src` (1,736) and `frontend/src` (1,257).

## 2. Blinded value study (the instrument that worked)

115 comments, stratified across prose/doc/ticket/short, scored by three
independent passes:

- **Arm A** saw only the comment + file path, and predicted the code beneath it.
- **Arm B** saw only the code with comments stripped, and summarised it.
- **Arm C** (judge) saw the comment, the real code, and both blind outputs.

Blinding matters: without it the judge scores with hindsight and everything
looks obvious.

### Headline

| judged value                                         |   n |     % |
| ---------------------------------------------------- | --: | ----: |
| 3 — load-bearing (removal likely costs a future bug) |  26 | 22.6% |
| 2 — genuinely useful                                 |  45 | 39.1% |
| 1 — marginal                                         |  21 | 18.3% |
| 0 — deleting it loses nothing                        |  23 | 20.0% |

**Mean value 1.64/3. 38% redundant** (Arm B recovered the content unaided).
**1 of 115 inaccurate** — and that one was merely unverifiable from the visible
snippet, not demonstrably wrong. Near-zero factual rot across 9,435 comments is
the standout result of the whole exercise.

Corpus-weighted extrapolation: mean value ~1.76/3, ~3,200 blocks (34%) redundant.

### What earns the value

| what the comment adds               |   n | mean value |
| ----------------------------------- | --: | ---------: |
| **gotcha** (ordering trap, hazard)  |  13 |   **3.00** |
| contract (invariant a caller needs) |  26 |       2.31 |
| why (reason / tradeoff / history)   |  31 |       2.16 |
| pointer (mostly just a ticket ref)  |  13 |       1.08 |
| **navigation** (section label)      |  30 |   **0.27** |

Single cleanest predictor: **a comment that states a _why_ scores 2.31; one
that does not scores 0.71.** A 3.3x gap, and it cuts across every category.

| category              |   n |    value | redundant | %>=2 |
| --------------------- | --: | -------: | --------: | ---: |
| ticket-referencing    |  25 |     2.08 |       24% |  76% |
| doc comment           |  25 |     2.04 |       24% |  76% |
| prose                 |  45 |     1.80 |       29% |  71% |
| **short (<=6 words)** |  20 | **0.25** |   **95%** |   5% |

Blind-arm scores: information recoverable from the comment alone 2.50/3;
self-evidence of the code alone 2.44/3; 58% of comments state a why; **50%
require resolving something outside the file** (usually a Linear ticket).

## 3. Git-history drift (the instrument that FAILED — see caveats)

Idea: for each comment, compare the commits touching the comment's own lines
against those touching the code region below it. Commits that changed the code
without touching the comment = drift.

Measured over all 9,430 analysable blocks with an indentation-scoped code
window: 88.0% never drifted; 3.6% have a >30d gap between last code edit and
last comment edit. Only 29% of code under a comment has ever been revised at
all — the repo's first commit is 2026-03-13, ~1,100 commits. Conditioned on
code that _was_ revised, 62% of the comments above it were left untouched.

Drift by category (stale% = of those whose code was revised):

| category           |    stale% |
| ------------------ | --------: |
| short (<=6 words)  |     83.3% |
| doc comment        |     63.7% |
| prose              |     59.2% |
| ticket-referencing | **56.6%** |

## Caveats

**The drift metric over-reports, badly, in list-shaped code.** Its top offenders
were all in `ApiRoutes.scala` (drift 48-53). Every one was manually checked and
is **still accurate** — they annotate entries in an append-only route list, so
any commit adding a _neighbouring_ route registers as drift. Tightening the code
window to the indentation-scoped unit did not fix it, because sibling routes
share the indent.

Treat drift as an **upper bound on staleness, not a measurement of it**. The
judge's accuracy pass is the trustworthy instrument, and it found essentially no
rot. The 62% conditional figure mostly reflects comments that stayed true
through a change, not comments that went wrong.

Other limits: the judge is a single model pass with no inter-rater agreement
check; n=115 gives roughly +/-9pp on the headline proportions; category
stratification means raw sample percentages must be re-weighted (done above)
before extrapolating to the corpus.

## Worst offenders

Judged value 0. Note these are one habit, not scattered sloppiness — 22 of 23
are navigation labels or restatements of the line below:

- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:3603` — `// ── Ownership enforcement ──` (also :1016, :2526, :1248)
- `frontend/src/features/pipelines/ui/shapes/ShapePickerModal.css:9` — `/* ── Step 1: shape list ── */`
- `backend/src/main/scala/com/helio/infrastructure/persistence/auth/MfaRepository.scala:100` — `// ── mfa_login_challenges ──`
- `backend/src/test/scala/com/helio/api/routes/pipelines/PipelineAclSpec.scala:94` — `// ── DB helpers ──`
- `frontend/src/shared/ui/toast.css:73` — `/* Variant intent colors */`
- `frontend/src/features/pipelines/ui/PipelineDetailPage.test.tsx:1866` — `// Clear the input`; `:1559` — `// Restore original name`
- `frontend/src/features/layout/state/layoutHistorySlice.test.ts:115` — `// Past should be unchanged`
- `backend/src/test/scala/com/helio/infrastructure/persistence/pipelines/DataTypeRowRepositorySpec.scala:67` — `// Second write with completely different data`
- `frontend/src/features/panels/state/panelNarrowing.ts:92` — `/** Returns image URL for image panels, otherwise null. */` (pure restatement)
- `backend/src/main/scala/com/helio/infrastructure/persistence/metrics/MetricRepository.scala:201` — `// Bring MetricFormat's Spray JSON formatter into scope.` (describes the `import` below it)
- `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala:132` — `// Stub session repo: returns testUser for testToken…` (restates the stub verbatim)
- `backend/src/test/scala/com/helio/domain/engine/InProcessPipelineEngineSpec.scala:1337` — `// only non-null counted` (the one flagged inaccurate; unanchored to visible code)

Longest staleness gaps, same population: `PanelContent.css:110` `/* Table */`
and `:46` `/* Text */` (148d), `SqlConnectorDriverSpec.scala:55` (130d),
`PanelDetailModal.css:88` `/* Discard warning */` (119d).

## Conclusions

- ~62% of comments are pulling their weight (value >=2). That is high.
- The headroom is narrow and specific: ~1,000 section dividers plus ~1,082 short
  labels, ~11-21% of the corpus, at a mean value of ~0.25. Deleting them costs
  essentially nothing.
- The `HEL-####` convention is vindicated: ticket-anchored comments score
  highest, drift least, and most often carry a why.
- Their one liability: **50% of comments cannot be fully understood without
  leaving the file.** That is a standing bet on Linear remaining readable, and
  it is worth knowing how often that pointer actually gets followed.

## 4. Are the ticket pointers ever actually followed?

The 50% external-reference rate above is only a good trade if someone resolves
the pointer. Measured directly against the agent transcript store.

**Corpus:** 1,378 session transcripts (~2.0 GB) under
`~/.claude/projects/*helio*/`, main sessions and subagents alike. For every
`mcp__linear__*` call carrying a `HEL-####` id, the id was classified by where
it first entered that session:

- **directed** — the user prompt, or a subagent's assignment prompt
  (`TICKET_ID=HEL-757`), named it.
- **comment-driven** — the id was NOT in any prompt, and first appeared inside a
  `//` or `/*` code comment in a tool result.
- **seen in other tool output first** — appeared first in workflow-state files,
  git log, PR bodies, Markdown, etc.

| origin                          | all Linear calls | read ops only |
| ------------------------------- | ---------------: | ------------: |
| directed                        |    1,718 (72.6%) |   306 (70.5%) |
| seen in other tool output first |      600 (25.3%) |   116 (26.7%) |
| comment-driven                  |        25 (1.1%) |  **0 (0.0%)** |
| no prior exposure               |        25 (1.1%) |     12 (2.8%) |

**Follow-through rate.** Counting (session, ticket) pairs where a `HEL-####`
appeared in a code comment and no prompt ever named it — 8,311 such exposures
across 957 sessions — the number that led the agent to subsequently _read_ that
ticket from Linear is **0**. The 25 comment-driven calls in the "all" column are
all writes (`save_issue` / `save_comment`), i.e. Concertino reporting status,
not an agent resolving a pointer.

Read operations are the ones that matter: `get_issue`, `list_issues`,
`list_comments` total only 434 calls across the whole store, and every single
one was either the agent's own assigned ticket or an id picked up from a
workflow file.

**Conclusion: agents never follow a `HEL-####` comment reference.** In ~5 months
and 1,378 sessions it has not happened once.

This does not make the convention worthless — the ticket-anchored comments still
scored highest in the value study (2.08/3), and the prose _around_ the id is
doing that work. But the id itself functions as provenance for human readers,
not as a live pointer any agent dereferences. Adding a ticket id is close to
free; relying on it to carry information that is not also stated inline is not.

**Method caveats.** Two bugs were found and fixed while building this, both of
which had inflated the comment-driven count: (a) the comment-line regex
originally matched Markdown headers (`#`) and bullets (`*`), and (b) subagent
assignment prompts arrive as a plain-string `content` field and were being
skipped, so their ticket was misread as un-prompted. The numbers above are
post-fix. The remaining bias runs toward over-counting comment-driven, so 0% is
if anything an upper bound. Scan is order-based (line index within the
transcript), which establishes precedence, not intent — but with a count of
zero that distinction does not bite.

## 5. Validation round (2026-08-27, before any cleanup)

Four follow-up tests were run to check whether the findings above are strong
enough to delete code on. Two held, one gave a useful nuance, one failed.

### 5.1 Judge reliability — HELD

The value study was a single model pass, so the same 115 blinded items were
re-scored by an independent judge on a different model.

| judgment                       | agreement |    kappa |
| ------------------------------ | --------: | -------: |
| exact 0-3 value                |       70% |     0.58 |
| within 1 point                 |       97% |        — |
| **delete (<=1) vs keep (>=2)** |   **92%** | **0.84** |
| redundant flag                 |       89% |     0.76 |
| "adds" category                |       60% |     0.49 |

The delete/keep boundary — the only judgment a cleanup rests on — is reliable
(kappa 0.84). The `adds` taxonomy is NOT (kappa 0.49): treat gotcha/contract/why
ordering as directional, never as measurement.

Aggregate means matched closely (1.64 vs 1.71), but per-category numbers moved:
judge 2 scored `short` comments 0.85, not 0.25. Still by far the worst category
(18 of 20 delete-flagged by both), but the earlier 0.25 was one rater's read.

**Safe-delete set: 41 of 115 (36%) where BOTH judges independently said
value <= 1.** That is the defensible basis for a sweep — narrower than either
judge alone.

### 5.2 Divider navigation — NUANCE

Two agents located the same 10 test sections in `ApiRoutesSpec.scala` (4,766
lines, 22 dividers); one got the real file, one got a divider-stripped copy.

| arm              |  accuracy | tool calls | wall time |
| ---------------- | --------: | ---------: | --------: |
| WITH dividers    |     10/10 |          2 |      8.6s |
| WITHOUT dividers | **10/10** |          8 |       62s |

Dividers do not prevent errors — accuracy was identical. They are a _speed_
convenience: 4x fewer tool calls, 7x faster. And this was the best case for
dividers, since the target list was worded from the divider text itself; with
realistic phrasing the gap narrows.

Implication: dividers earn their place in genuinely large files and not
elsewhere. They are not the dead weight the value study alone suggested.

### 5.3 Counterfactual probe — FAILED, do not cite

Design: a question-writer (blinded to comments) wrote one maintenance question
per snippet; two solver arms answered with and without the comment; a grader
scored both blind, in randomised order.

Result: 98% correct without the comment vs 99% with. No differential in any
pool, including load-bearing gotcha/contract items (100% vs 100%).

**This is a broken instrument, not a finding.** Blinding the question-writer to
the comments — done to avoid leading questions — guaranteed the questions were
answerable from code alone. The grader confirms it: 90% of questions were
code-derivable by construction, 79% even in the load-bearing pool. A 98% ceiling
leaves no room to detect an effect.

A sound replacement: mine git history for bugfix commits whose changed lines sat
under a comment already warning about that failure mode, and check whether the
warning predated the bug. Real errors, no ceiling. Not yet built.

### 5.4 Main vs test split — HELD

| tree | blocks | short | divider | ticket |   doc | prose |
| ---- | -----: | ----: | ------: | -----: | ----: | ----: |
| main |  5,690 |   553 |     454 |  1,056 | 2,666 | 1,415 |
| test |  3,745 |   529 |     543 |    840 |   532 | 1,844 |

Low-value comments concentrate in tests: short+divider is **28.6% of test
comments vs 17.7% in main**. Test comments are also 49% prose vs main's 25%.
Policy should differ by tree.

### Evidence status going into any cleanup

- **Solid:** judge delete/keep reliability; the both-judges safe-delete set; the
  ticket-pointer null (0 of 8,311); dividers as speed-not-accuracy; main/test split.
- **Directional only:** the `adds` taxonomy; the why/no-why value gap.
- **Unknown:** whether comments causally prevent errors. The attempt failed; see 5.3.

## Open follow-ups (not acted on)

- Deleting the section-divider / short-label population is the obvious cleanup,
  but it is a large mechanical diff and was deliberately NOT started.
- Consider whether `HEL-####` refs should be accompanied by a one-line summary
  of _what the ticket decided_, since nothing downstream ever opens it.
