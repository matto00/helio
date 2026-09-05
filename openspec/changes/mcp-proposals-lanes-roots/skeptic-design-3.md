## Skeptic Report — design gate (round 3, skeptic-design-3.md)

### What I verified (with evidence)

1. **Round 2's five change requests are genuinely fixed, not just claimed.** Read
   `specs/pipeline-proposal-contract/spec.md` and `specs/pipeline-proposal-apply/spec.md` in full and
   diffed each MODIFIED block against the canonical original at `git show
   0f16b85d:openspec/specs/<cap>/spec.md`.
   - CR1: `pipeline-proposal-contract`'s "Backend protocol round-trips the schema, tolerating absent
     optionals" now describes `roots: Vector[PipelineProposalSource]`, round-trips a `roots` array
     (single-root, inline, and two-root-order-preserving scenarios), the "every optional absent"
     scenario now lists the required set as `(pipelineName, roots, steps)` (no `outputDataTypeName`),
     and an explicit "carrying `source` is rejected, not tolerated" scenario replaces the stale
     tolerant-of-unknown-key behavior. Full requirement rewritten, not appended to. **Fixed.**
   - CR2/CR3: `pipeline-proposal-apply`'s "Structural pre-validation creates nothing on a bad
     proposal" and "Non-mutating validation of a PipelineProposal" are both rewritten per-root
     (`roots[]`, "every root is ownership-checked, not only the first", position-addressed
     rejections). **Fixed.**
   - CR4: "Source-fetch failure is a structured, rolled-back error" now says "a root's inline
     `rest_api` or `sql` source" and adds a two-root scenario naming which root failed. **Fixed.**
   - CR5: `tasks.md` §6b (6b.1–6b.5) assigns all four rewrites as deliverables, with 6b.5 a
     grep-returns-zero gate and 7.6 running it before the MODIFIED-block diff-audit. **Fixed.**
   - `openspec validate mcp-proposals-lanes-roots --type change` passes (re-ran fresh this round).

2. **Round 1/2 fixes still stand; no regression.** `mcp-pipeline-proposal-tools`'s three MODIFIED
   requirements are unchanged from round 2's verified state (spot-checked headers); design.md's
   `outputDataTypeName` callout and file-list disambiguation are still present; the "one ticket, no
   split" and "patch-set work is lane-only, EditTarget gains a parent id, root ops deferred" rulings
   are still written as such in design.md §D3 — not reopened, only confirmed still in force.

3. **Exhaustive sweep of every delta'd capability plus the "touched but no delta" list turned up one
   new, real instance of the same defect class — this time as a *missing delta for a whole
   capability*, not an incomplete MODIFIED block.**

   `patch-set-apply`'s canonical spec (`git show 0f16b85d:openspec/specs/patch-set-apply/spec.md:110-115`)
   has this requirement, verbatim, untouched by any delta in this change (there is no
   `specs/patch-set-apply/` directory under this change at all):

   > ### Requirement: Create is rejected pre-validation where no viable path exists
   > `create` SHALL be rejected at pre-validation for `dataType` (no direct create API exists) and for
   > `pipelineStep` (**no field on `EditTarget` carries the new step's parent pipeline id**). A
   > dashboard-create edit whose decoded `patch` sets `ifExists` SHALL also be rejected...

   This change's own `patch-set-contract` delta directly falsifies the parenthetical reason this
   requirement gives for rejecting `pipelineStep` create: design.md §D3 states plainly "`EditTarget`
   gains `parentId: Option[String]`, required and non-blank for `op: create` on a child kind... .
   `pipelineStep` gains `create`/`delete`," and the `patch-set-contract` delta adds a whole new
   requirement, "`pipelineStep` supports a create op," with a scenario asserting the create edit
   "decodes and applies" and is *accepted* pre-validation (rejected only when the named parent
   pipeline isn't writable — a different, ownership-based rejection). `EditTarget` now *does* carry a
   parent id, so "no field on `EditTarget` carries the new step's parent pipeline id" — the load-bearing
   premise of this untouched requirement — is false the moment this change ships, and the requirement
   still literally instructs the apply service to reject the very create op the rest of this change
   builds. This is mechanically identical to the CR1–CR4 defect (a requirement whose premise a sibling
   requirement contradicts), just located one capability further out than round 2 checked, and with no
   delta file for the capability at all rather than an incomplete one — exactly the "capability the
   change touches but has no delta" variant the task called out to check for, and `patch-set-apply` is
   one of the five capabilities explicitly named as worth checking given the `EditTarget` change.

   I checked whether `patch-set-lane-edits` (the new capability) covers this gap instead — it doesn't:
   `patch-set-lane-edits` only ADDs domain-level lane-add/lane-undo behavior ("a lane SHALL be added by
   a `pipelineStep` create edit whose new step names an existing step as its parent"); it never touches
   `patch-set-apply`'s own generic pre-validation contract, which is the thing asserting the
   now-false universal rejection. Nor does `patch-set-contract`'s own delta patch this — it only adds
   the schema/protocol-level requirement; the sibling apply-service requirement in a different
   capability is left stale.

4. **Everything else swept clean.** For every other capability with a delta
   (`pipeline-analyze-api`, `workspace-context-assembly`, `mcp-pipeline-proposal-tools`,
   `pipeline-proposal-review-ui`, `patch-set-contract`, `mcp-pipeline-lane-tools`,
   `patch-set-lane-edits`) I diffed the delta's touched-requirement list against the canonical
   requirement list and read the untouched requirements' bodies:
   - `pipeline-analyze-api`: untouched requirements ("Source schema derived from...", "Analyze
     projects a schema per node...") are already written in root-plural terms in the canonical spec
     itself (pre-shipped by HEL-911/912/913, confirmed against `RootSourceSchemaResponse` /
     `sourceSchemas: Vector[...]` in `PipelineAnalyzeProtocol.scala`) — nothing for this change to
     modify. (Note: the *canonical* text of "GET /api/pipelines/:id/analyze returns pipeline with
     per-step schemas" still names a retired singular `sourceDataSourceName`/`sourceSchema` pair in
     its own prose, which no longer matches the shipped `PipelineAnalyzeResponse` shape at all — but
     that staleness predates this change (HEL-913 already shipped without updating this requirement's
     prose) and this change doesn't touch or worsen it; it's a pre-existing openspec-hygiene gap, not
     something HEL-914 introduces.)
   - `workspace-context-assembly`: the 24 untouched requirements are about sample rows/column
     statistics/truncation/connectors — none reference source/root cardinality; delta is purely
     additive (lane tree). Clean.
   - `mcp-pipeline-proposal-tools`: untouched "Tools are registered..." and "...operate on Outputs,
     not DataTypes" remain source-independent. Clean (confirmed again this round).
   - `pipeline-proposal-review-ui`: 7 untouched requirements (handoff/review/accept-reject for both
     pipeline and combined proposals, inline-connector-setup, Output previews) — read each; none
     assume a singular `source` field or a single-root pipeline in their body text or scenarios.
     Clean.
   - `patch-set-contract`: untouched "PatchSet schema shape," "patch reuses existing per-resource
     request shapes," "Backend protocol round-trips the schema...," "Edit targets reference existing
     ids..." — none of these describe *whether* `pipelineStep` create is viable (that's
     `patch-set-apply`'s job, per finding above); they remain true as written.
   - `mcp-pipeline-lane-tools` and `patch-set-lane-edits` are new capabilities with only ADDED
     requirements — no canonical baseline to falsify, and I read both in full for internal soundness
     (no placeholders, no contradiction between requirements, acceptance criteria traceable to
     scenarios): both are complete and unambiguous.
   - Checked the remaining "touched but no delta" list per the task's explicit prompt:
     `patch-set-undo`, `patch-set-preview`, `mcp-patch-set-tools`, `conversational-refinement` — grepped
     each canonical spec for `EditTarget`/`parentId`/`pipelineStep`-create-shaped assumptions; none
     assert or depend on `pipelineStep` create being *unsupported* (that assumption lives solely in
     `patch-set-apply`), so none of these four go false. Only `patch-set-apply` is the missing delta.

### Verdict: REFUTE

### Change Requests

1. **Add a `specs/patch-set-apply/spec.md` delta to this change with a `MODIFIED Requirements` block
   for "Create is rejected pre-validation where no viable path exists."** Remove `pipelineStep` from
   the set of kinds universally rejected for `create` (its stated reason — "no field on `EditTarget`
   carries the new step's parent pipeline id" — is exactly what this change's `patch-set-contract`
   delta fixes), keeping `dataType` (no direct create API) and the `dashboard`-`ifExists` case
   unchanged. Add or point to a scenario establishing that a `pipelineStep` create edit now proceeds
   past this pre-validation gate (its actual accept/reject fate — ownership of the named parent
   pipeline — is already covered by `patch-set-contract`'s new "A create edit naming a pipeline the
   caller cannot write is refused" scenario, so this fix can be a narrow scope-correction rather than
   new behavioral content).

2. **Add a corresponding `tasks.md` deliverable** (parallel to §6b) assigning this `patch-set-apply`
   rewrite as an implementation task, and extend 6b.5's/7.6's grep-and-diff verification gate to cover
   `patch-set-apply` alongside `pipeline-proposal-contract`/`pipeline-proposal-apply`, so this
   correction isn't silently dropped between design and execution — the same failure mode CR2/CR5
   guarded against in round 2.

### Non-blocking notes

- The `pipeline-analyze-api` canonical-spec staleness re: retired `sourceDataSourceName` (noted in
  item 4 above) predates this change and isn't caused or worsened by it — flagging for awareness only,
  not as a required revision here.
