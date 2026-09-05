## Skeptic Report — design gate (round 2, skeptic-design-2.md)

### What I verified (with evidence)

1. **Round-1 CR1/CR2 fix, `mcp-pipeline-proposal-tools`.** Read
   `specs/mcp-pipeline-proposal-tools/spec.md` in full and diffed it against the canonical original
   (`git show 0f16b85d:openspec/specs/mcp-pipeline-proposal-tools/spec.md`). The delta now carries a
   `## MODIFIED Requirements` block rewriting all three flagged requirements
   (`propose_pipeline assembles and validates without writing`,
   `analyze_pipeline_proposal projects the output schema without writing`,
   `apply_pipeline_proposal applies atomically and surfaces guardrail errors verbatim`) fully in terms
   of `roots[]`/lanes, each with a complete scenario set that supersedes (not merely appends to) the
   stale `source`-based scenarios — including an explicit "carrying the removed singular source is
   rejected" scenario. The two untouched canonical requirements in this same capability
   ("Tools are registered and consistent with existing tool conventions",
   "Pipeline proposal tools operate on Outputs, not DataTypes") are genuinely source-independent and
   remain true unmodified — correctly left alone. tasks.md task 6.11 explicitly assigns this
   spec-body rewrite as an implementation deliverable and gates 7.6 on no scenario still naming
   `source`. **CR1 and CR2 from round 1 are fixed.**

2. **Non-blocking notes from round 1.** design.md now has a one-line callout on the dropped
   `outputDataTypeName` (searched and found the disambiguating text), and proposal.md/design.md's
   file-list overlap is disambiguated. Both addressed as claimed.

3. **`openspec validate mcp-proposals-lanes-roots --type change` passes** (re-ran it fresh this
   round).

4. **The same defect class recurs, unfixed, in two capabilities round 1 did not check line-by-line: `pipeline-proposal-contract` and `pipeline-proposal-apply`.**

   - `pipeline-proposal-contract`'s canonical spec (`git show 0f16b85d:openspec/specs/pipeline-proposal-contract/spec.md`)
     has 7 requirements. The delta correctly MODIFIES "PipelineProposal schema shape" and
     REMOVES+ADDS "Source is an existing reference or an inline spec" → "Roots are existing
     references or inline specs" + "A proposal expresses lanes and per-root step binding". Three are
     untouched and correctly still true ("Steps are an ordered type/config list", "Inline REST source
     may propose a not-yet-existing Connector", "Structural validation accepts an unresolved
     newConnector draft", "PipelineProposal schema describes steps and outputs" — none of these
     reference the singular `source` field's cardinality). **But "Backend protocol round-trips the
     schema, tolerating absent optionals" is untouched and goes false.** Its body says the backend
     SHALL provide `PipelineProposal`/`PipelineProposalSource` case classes and a
     `RootJsonFormat[PipelineProposal]`; its scenarios explicitly round-trip
     `source = PipelineProposalSource(sourceId = Some("src-1"), ...)` and assert the required-field
     set is `(pipelineName, source, outputDataTypeName, steps)`. tasks.md 2.2 confirms
     `PipelineProposal.source` is renamed to `roots: Vector[PipelineProposalSource]` — so this
     requirement's field name (`source`) and its required-field list (both `source` and the
     already-dead `outputDataTypeName`) are stale in exactly the same "sits alongside a contradicting
     new requirement" way round 1 caught in `mcp-pipeline-proposal-tools`. No MODIFIED block touches
     it.

   - `pipeline-proposal-apply`'s canonical spec has 7 requirements. The delta MODIFIES "Atomic apply
     of a PipelineProposal" and ADDS two lane/rejoin requirements — good. Three of the four untouched
     requirements are fine (unrelated to source cardinality: "Full rollback on any mid-apply
     failure", "Output DataType is pipeline-bindable", "Applying a pipeline proposal creates outputs
     and placements"). **But two are stale and untouched:**
     - **"Structural pre-validation creates nothing on a bad proposal"** — its entire body and five
       scenarios are written against a singular `source` object ("a `source` that sets both
       `sourceId` and an inline `type`", "a caller POSTs a proposal whose `source` sets..."). This is
       the backend-apply-side mirror of exactly the MCP-side validation the `mcp-pipeline-proposal-tools`
       delta already correctly rewrote per-root — but this sibling requirement in
       `pipeline-proposal-apply` was never touched, so it still describes single-`source` structural
       rejection semantics that no longer exist once `source` is removed outright.
     - **"Non-mutating validation of a PipelineProposal"** — its scenarios reference "a `PipelineProposal`
       whose source references an existing data source owned by the caller" and "whose source
       references a `sourceId` that does not exist" — singular `source`, stale for the same reason.
     - "Source-fetch failure is a structured, rolled-back error" is borderline (its prose says "the
       proposal's source is inline `rest_api` or `sql`", singular phrasing that should generalize to
       "a root's inline source" now that a proposal can carry several), but its core behavioral claim
       (no delete-on-fetch-failure, blocked run persisted) is still substantively true per-root; the
       phrasing issue is real but less severe than the two above, which assert since-removed
       validation semantics as if they still fire.

   This is not a new product decision to relitigate — it's the identical mechanical defect round 1
   named in CR1 (a requirement whose body is entirely `source`-shaped, left un-modified while `source`
   is deleted outright), recurring in two more capabilities this ticket's own proposal.md explicitly
   lists as "Modified Capabilities." The fix pattern round 1 already established (MODIFIED block,
   `roots[]`-shaped scenarios, explicit removed-field rejection scenario) needs to be repeated here,
   plus a task analogous to 6.11 covering both.

5. **Design rulings not relitigated.** Confirmed design.md still scopes this as one ticket (no split)
   and patch-set work as `lane-only` with `EditTarget` gaining a parent id and root ops deferred — did
   not reopen either; only verified they're still what's written, which they are (design.md §D3,
   tasks.md section 5).

6. **`pipeline-analyze-api` and `workspace-context-assembly` spot-checked for the same defect class**
   and found clean: `pipeline-analyze-api`'s untouched requirements ("Source schema derived from bound
   DataSource's registered DataType fields" etc.) already describe **per-root** schemas in the
   canonical spec text itself (pre-shipped by HEL-911/912, per round 1's "already shipped" table) —
   nothing to modify. `workspace-context-assembly`'s untouched requirements are about sample
   rows/column statistics, unrelated to source/root cardinality — the delta there is purely additive
   (lane tree) and correctly so. `patch-set-contract`'s untouched requirements ("Edit targets
   reference existing ids...", "PatchSet schema shape", "patch reuses existing per-resource request
   shapes", "Backend protocol round-trips the schema...") do not reference `source`/root cardinality
   and remain true.

### Verdict: REFUTE

### Change Requests

1. **`pipeline-proposal-contract`: add a `MODIFIED Requirements` block for "Backend protocol
   round-trips the schema, tolerating absent optionals."** Rewrite its body to describe
   `PipelineProposal.roots: Vector[PipelineProposalSource]` (not a singular `source` field) and its
   round-trip/tolerant-reader scenarios to construct/decode a `roots` array instead of
   `source = PipelineProposalSource(...)`. Also drop `outputDataTypeName` from the "every optional
   field absent" scenario's required-field list (it should read `(pipelineName, roots, steps)`,
   matching the already-corrected "PipelineProposal schema shape" MODIFIED requirement and the
   already-shipped HEL-907 reality round 1's non-blocking note identified).

2. **`pipeline-proposal-apply`: add a `MODIFIED Requirements` block for "Structural pre-validation
   creates nothing on a bad proposal."** Rewrite it to validate each element of `roots[]`
   independently (mirroring the ADDED requirement in `mcp-pipeline-proposal-tools` that already does
   this on the MCP-tool side) rather than a singular `source` object, keeping the same guardrails
   (mutual-exclusivity of `sourceId`/inline `type`, inline-`csv`-rejected, missing name/config,
   non-read-only SQL) per root.

3. **`pipeline-proposal-apply`: add a `MODIFIED Requirements` block for "Non-mutating validation of a
   PipelineProposal."** Rewrite its scenarios to reference `roots` (plural, per-element
   ownership/existence checks) instead of "a `PipelineProposal` whose source references...".

4. **`pipeline-proposal-apply`: reword "Source-fetch failure is a structured, rolled-back error"**
   (can be a lighter-touch MODIFIED block, or at minimum an explicit design.md callout if the plan's
   authors judge the existing text tolerable) so its prose says "a root's inline source" rather than
   "the proposal's source," since a proposal can now carry more than one inline root and either could
   independently fail to fetch/infer a schema.

5. **Add a tasks.md item** (parallel to the existing 6.11) explicitly assigning the
   `pipeline-proposal-contract` and `pipeline-proposal-apply` spec-body rewrites from items 1–4 as
   implementation deliverables, and gate verification on no remaining scenario in either capability
   naming a singular `source` field. Without this, the same "spec rewrite silently dropped between
   design and execution" failure round 1's CR2 caught could recur for these two capabilities.

### Non-blocking notes

- None beyond what round 1 already recorded (still valid).
