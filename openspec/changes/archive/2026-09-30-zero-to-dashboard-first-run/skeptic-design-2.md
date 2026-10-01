## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (against live tree)
- CR1 (layout): FIXED and true. DashboardProposalService.applyLayout (L146+) persists lg items as given and scales md/sm/xs via LayoutBreakpointScaling.scaleWidthAndX; lg x=0,w=12 -> md w=10, sm w=6, xs w=2 (breakpointCols lg12/md10/sm6/xs2), x=0, y/h unchanged. All panels carrying layout -> no drop. Overlap-free by construction. Note: applyLayout failure is swallowed (best-effort, falls back to default half-width placement); the planned layout test must run through the real service and assert persisted layout, not just the proposal payload.
- CR4 (wiring): FIXED. PipelineShapeService.expand(id, params) exists (Future[Either[..., Vector[ShapeStepExpansion]]]); top-n expands to sort+limit with `measure` param, so hand-built agg_topn pre-step is correctly stated; clientId/parentStepId wiring and granularity-over-sample are now specified.
- CR5 (rollback injection): FIXED (D2 + 1.4 name a stub DashboardProposalService via constructor, red-first).
- CR2 (date-like): NOT FIXED. design.md D3 still reads "ISO-8601 ... or `yyyy-MM-dd`/`MM/dd/yyyy`" (grep: 1 hit for MM/dd). DateBucketStep does not parse MM/dd/yyyy. D3 now contradicts the spec ("parseable by the datebucket step's own date parser") and its own "non-ISO formats are not date-like" and "executor verifies" hedge remains. Epoch precedence is only in the spec ("tested only for non-numeric columns"), not in D3.
- CR3 (sampling reader): NOT FIXED. D3 says the reader is "the concrete reader the pipeline's CSV root run already uses (executor names it in a design amendment before coding)" — a deferred decision, the exact hand-wave CR3 asked to remove. Owner-scoped lookup is described only generically ("owner-scoped repository query"), not the named method (findByIdOwned).

### Verdict: REFUTE

### Change Requests
1. design.md D3: delete `MM/dd/yyyy` and make date-like exactly "the set DateBucketStep.parseToUtcDate parses" (reuse that function in the classifier), with the precedence rule (numeric first, date-like only tested on non-numeric columns) stated in D3 itself so design and spec agree; add a test asserting a MM/dd/yyyy column is not date-like.
2. design.md D3/task 1.2: name the concrete sampling reader now (file-system read of CsvSourceConfig.path plus the specific CSV parser class/function used by SchemaInferenceEngine or the pipeline CSV root) and the owner-scoped lookup method; remove the "executor names it in a design amendment" deferral.

### Non-blocking notes
- Once those two edits land, the design is otherwise sound; no need for further layout changes.
