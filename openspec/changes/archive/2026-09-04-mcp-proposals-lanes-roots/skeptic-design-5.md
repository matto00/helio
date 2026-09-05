## Skeptic Report — design gate (round 5, skeptic-design-5.md)

### What I verified (with evidence)

1. **Round 4 CRs + three self-found instances — checked against recovered originals.**
   - `patch-set-apply` delta (`openspec/changes/mcp-proposals-lanes-roots/specs/patch-set-apply/spec.md`):
     rewrites "Create is rejected pre-validation where no viable path exists" to drop `pipelineStep`
     from the rejection list, add `output`, and add scenarios for the new create-with-`parentId` path
     and the missing-`parentId` rejection. Matches task 6b.6/5.4 intent. Confirmed against canonical
     `openspec/specs/patch-set-apply/spec.md:112-118` (stale "no field on `EditTarget` carries..." text
     — correctly superseded by the delta's MODIFIED block, which is the expected pre-archive state).
   - `patch-set-contract` delta: `target.id is required...` requirement gains `parentId` with the
     create-required / update-delete-forbidden rule; `Backend protocol round-trips...` gains
     wire-level tolerance-of-absence language distinct from the validation-time requirement; new
     `pipelineStep supports a create op` ADDED requirement. Coherent, no scenario dropped versus
     `git show 0f16b85d:openspec/specs/patch-set-contract/spec.md`.
   - `assistant-conversation-loop` delta: "An inline REST/SQL source must be connection-tested..."
     rewritten to "**any** inline ... root" with an "every root independently" framing and a
     `propose_combined`/`pipeline.roots` scenario. Matches canonical requirement title/scope; no
     scenario dropped (compared against `openspec/specs/assistant-conversation-loop/spec.md:164-206`).
   - `pipeline-proposal-review-ui` delta: "Pipeline proposal review page" now renders "the proposal's
     roots ... lane structure ... proposed Outputs", also fixes the stale "output DataType name"
     wording flagged in round 4. Confirmed.
   - `patch-set-contract` "Backend protocol round-trips..." (`EditTarget.parentId` wire tolerance):
     present and correctly scoped (wire-level tolerance vs. validation-time requirement kept
     separate, as task 6b.4d specifies).

2. **Property sweep A (singular proposal `source`/`sourceSchema`/`sourceName`/created-source) —
   run against `openspec/specs/` (pre-archive canonical) and cross-checked every hit against whether
   this change's delta touches that requirement:**
   ```
   grep -rn "proposal\.source\b|PipelineProposalSource\b|\.pipeline\.source\b|sourceSchema\b|sourceName\b" openspec/specs/
   ```
   Hits fall into three buckets:
   - `pipeline-analyze-api` (the **persisted**-pipeline route, not the proposal route) — out of
     scope; correctly excluded since round 4 (different capability, pre-existing debt unrelated to
     this ticket's root cause).
   - `pipeline-proposal-contract`, `mcp-pipeline-proposal-tools` — all singular-`source` hits are
     inside requirements this change's delta already rewrites (confirmed full requirement bodies
     match delta MODIFIED/ADDED blocks, verbatim scenario-for-scenario, nothing left true-and-stale).
   - `pipeline-proposal-review-ui:112` — a `PipelineProposalSource.config` type reference in a
     REJECTED-then-superseded requirement not the modified one; benign (it's naming the still-valid
     per-root element type, not asserting a singular top-level `source`).

   **However, one instance was missed and is NOT covered by any grep pattern used so far because it
   doesn't use the literal strings searched for** — see Change Request 1 below. I found it by
   diffing the full requirement-title list of `pipeline-proposal-apply`'s canonical spec against the
   delta's requirement list, which is a completeness check the property sweep alone does not
   perform (the sweep only catches specific field-name strings, not "singular source" expressed in
   prose like "the inline source").

3. **Property sweep B (`EditTarget` cannot carry a parent id) —**
   ```
   grep -rn "EditTarget" openspec/specs/
   ```
   The one substantive hit (`patch-set-apply/spec.md:114`, the exact stale sentence) is inside the
   requirement the delta already rewrites (confirmed above). Closed.

4. **Requirement-title diff, every touched capability** (`grep -n "^### Requirement"` canonical vs.
   delta) — done for all 12 capability dirs. `pipeline-proposal-contract`, `mcp-pipeline-proposal-tools`,
   `pipeline-proposal-analyze-api` all account for every canonical requirement that mentions the
   surface this change touches. **`pipeline-proposal-apply` does not** — see CR1.

5. **`openspec validate mcp-proposals-lanes-roots --type change`** exits `Change
   'mcp-proposals-lanes-roots' is valid`.

6. **Overall coherence at 12 deltas.** Ticket ACs still trace: AC1 (two-root/two-lane
   `create_pipeline` E2E) → task 7.2 + `mcp-pipeline-lane-tools`/`pipeline-proposal-apply`
   requirements; AC2 (rejoin grounding + patch-set undo) → task 4 + `patch-set-lane-edits` +
   "Proposal Outputs are grounded at their own node, across lanes"; AC3 (concise `analyze_pipeline`
   under budget) → task 6.4/6.5 + `pipeline-analyze-api` ADDED requirement; AC4 (tool-name test +
   docs example) → tasks 6.7/6.9. No task or delta reads as scope creep beyond the ticket's inherited
   scope (the HEL-913 hand-off is explicit and bounded to the two named deltas plus the correlated
   sites). The "ONE ticket" and "patch-set lane-only, roots deferred" rulings are respected and I did
   not re-litigate either.

### Verdict: REFUTE

### Change Requests

1. **`pipeline-proposal-apply`'s "Full rollback on any mid-apply failure" requirement is untouched
   by this change's delta and goes false under a multi-root proposal — this is the same defect
   class as every prior round, just not caught by the literal-string greps.**
   Canonical text (`openspec/specs/pipeline-proposal-apply/spec.md:78-116`): "The service SHALL
   delete every resource this call created — the pipeline ..., the pipeline node's Output, and, **if
   this call created it, the inline source and its companion Output** — if any step after
   source/pipeline creation begins fails..." Its three scenarios ("A healthy rest_api or sql source
   reaches the ordinary run/rollback path", "A run failure on a rest_api or sql source rolls back the
   same as any other run failure", "A run blocked by an error-severity assertion rolls back...") are
   all written against exactly one source.
   Once a proposal can carry N inline roots (this change's core contract change — confirmed in the
   sibling requirement "Atomic apply of a PipelineProposal", which this change's own delta rewrites
   to "create the resolved sources (for every inline root)"), a late-stage failure (step creation,
   run failure, error-severity assert) must roll back **every** inline source created across **every**
   root, not "the inline source" singular. As written, the requirement is either ambiguous (does "the
   inline source" mean "each of the inline sources"?) or, read literally, false for a two-root
   proposal where only the first root's source gets rolled back.
   This is the same requirement (`git show 0f16b85d:openspec/specs/pipeline-proposal-apply/spec.md`)
   as the currently-shipped one, and its title/list of covered requirements in
   `pipeline-proposal-apply`'s delta (`Atomic apply...`, `Structural pre-validation...`,
   `Source-fetch failure...`, `Non-mutating validation...`, plus two ADDED requirements) skips it
   entirely — confirmed by comparing `grep -n "^### Requirement"` output for the canonical file
   (7 requirements) against the delta file (6 requirements, none titled "Full rollback on any
   mid-apply failure").
   **Required fix:** add a `MODIFIED Requirements` block for "Full rollback on any mid-apply
   failure" that (a) pluralizes "the inline source" to "every inline source this call created,
   across every root" (or equivalent), (b) adds a scenario proving a late-stage failure on a
   two-root proposal rolls back both roots' created sources, not just the first, and (c) states
   explicitly whether a partial-resolve-then-late-failure interacts with the earlier
   resolve-time rollback (task 3.3) or is a distinct code path reusing the same rollback list —
   the two rollback paths (resolve-time in "Atomic apply...", late-failure here) should not
   silently diverge on which sources get cleaned up. Add the corresponding task under section 3
   or 6b (a 6b.3a-style item) and extend 6b.5's grep or the requirement-title diff to be an
   explicit gate task, since the literal-string sweep alone does not catch this instance.

### Non-blocking notes

- Task 6b.5's grep is phrased as "the same two property greps the design gate used" but the design
  gate's actual completeness check that caught CR1 above was a requirement-title diff, not a string
  grep. Worth naming both methods explicitly in 6b.5/7.6 so a future round doesn't rely on the grep
  alone and miss a prose-only instance again.
- `pipeline-proposal-review-ui:112`'s surviving reference to `PipelineProposalSource.config` (inside
  a requirement the delta does not touch) is fine as-is, but confirm at archive time that the
  requirement it lives in doesn't itself need a root-aware rewrite — a quick read during 7.6 is
  sufficient, not a new task.
