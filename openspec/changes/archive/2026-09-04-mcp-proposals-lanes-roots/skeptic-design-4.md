## Skeptic Report — design gate (round 4, skeptic-design-4.md)

### What I verified (with evidence)

1. **Round 3's `patch-set-apply` fix is genuine.** Recovered the pre-change original via
   `git show 0f16b85d:openspec/specs/patch-set-apply/spec.md`. The `MODIFIED` block in
   `openspec/changes/mcp-proposals-lanes-roots/specs/patch-set-apply/spec.md`:
   - Keeps both still-true scenarios verbatim (`dataType` create rejected; dashboard `ifExists`
     create rejected).
   - Drops `pipelineStep` from the rejection list, with the retraction reasoned inline ("the reason
     it was there ... is resolved by `EditTarget.parentId`").
   - Adds `output` to the rejection list, correctly reasoned as "makes it representable but
     untested" rather than silently omitted.
   - Adds two new scenarios (`pipelineStep` create accepted with `parentId`; rejected without one)
     that exercise the newly-opened path.
   - Title and body match; no scenario lost. Confirmed clean.

2. **tasks.md / proposal.md / design.md updates from round 3 are present and consistent.**
   `tasks.md` 6b.6 names the `patch-set-apply` fix and 6b.7 requires a grep sweep for remaining
   `EditTarget`-cannot-carry-a-parent-id language; `proposal.md` and `design.md` §D3 name the
   capability (`pipelineStep` create/delete, lane-only scope) and identify this as "the same class"
   as 6b.1–6b.4. Consistent with the fix.

3. **The two product rulings are respected, not reopened.** `design.md` D3 explicitly rules
   patch-set root ops out of scope as a follow-up (product ruling, 2026-09-04) and confirms
   `EditTarget` gains `parentId`; `proposal.md` Non-Goals repeats this. One ticket, no scope split.
   Not relitigated here.

4. **Exhaustive sweep by property, not by capability list.**
   - Search (b) — any requirement asserting `EditTarget` cannot carry a parent id / a child create
     is impossible: `grep -rniE "no field on|EditTarget has no|carries no parent|cannot carry a
     parent|no parent id|child resource has a.create" openspec/specs/*/spec.md` returns exactly
     the pre-fix `patch-set-apply` line (expected — it's the file this change's delta overwrites)
     and nothing else. `patch-set-contract`'s current canonical text (`EditTarget` kind enum,
     target.id rules) is already in this change's delta list. **No new instance found by this
     search.**
   - Search (a) — singular-`source`/`sourceSchema`/`sourceName` proposal requirements: turned up a
     **fourth, previously unfound instance**: `openspec/specs/pipeline-proposal-analyze-api/spec.md`
     (distinct from `pipeline-analyze-api`, which IS in this change's delta list and covers a
     different route — `/api/pipelines/:id/analyze` concise mode for an existing multi-root
     pipeline). `pipeline-proposal-analyze-api` defines the contract for
     `POST /api/pipelines/analyze-proposal`, which I confirmed at
     `backend/src/main/scala/com/helio/api/routes/pipelines/PipelineRoutes.scala:45-47` decodes
     `entity(as[PipelineProposal])` — the exact same `PipelineProposal` class this change turns
     `source: X` into `roots: Vector[X]` on. Every requirement in that spec is written against a
     singular `source` field: "SHALL accept a `PipelineProposal` request body and return the
     projected **source** schema"; "request body omits a `PipelineProposal`-required field
     (`pipelineName`, `source`, ...)"; "Inline source resolution reuses existing inference/guard
     calls"; "An existing sourceId takes precedence over an inline source"; "Existing-source
     resolution is RLS-scoped." All of these become false once `PipelineProposal.source` is gone
     — there is no delta for this spec anywhere in
     `openspec/changes/mcp-proposals-lanes-roots/specs/` (confirmed via `ls`).

### Verdict: REFUTE

### Change Requests

1. Add `openspec/changes/mcp-proposals-lanes-roots/specs/pipeline-proposal-analyze-api/spec.md`
   with a `MODIFIED Requirements` block rewriting every requirement/scenario currently keyed on
   `PipelineProposal.source` (singular) to `roots[]` (multi-root), matching the treatment already
   given to `pipeline-proposal-contract` and `pipeline-proposal-apply` in rounds 1-2: the dry-analyze
   endpoint contract, the "required field" 400 list, inline-source resolution, the
   sourceId-precedence rule, and the RLS-scoping rule all need a `roots[]`-shaped restatement (per
   root, or documenting the projected-schema shape across roots — whichever this change's D2/D3
   design already settled for the sibling specs). Do not conflate this with `pipeline-analyze-api`,
   which is a different route already covered.
2. Add a task under the existing "6b. Spec-body rewrites are deliverables, not additions" section
   naming `pipeline-proposal-analyze-api` explicitly (mirroring 6b.1-6b.4's per-requirement
   itemization), and extend 6b.5's verification-gate grep to also scan
   `pipeline-proposal-analyze-api` for surviving singular-`source` scenario language after the fix.
3. Update `proposal.md`'s Impact/spec-delta list and `design.md`'s D1 correlated-surface list to
   include `backend/.../api/protocols/pipelines/PipelineAnalyzeProposalProtocol.scala` and the
   `analyze-proposal` route handler in `PipelineRoutes.scala:43-52`, since these consume
   `PipelineProposal` exactly like the already-listed apply/contract files and were missed from the
   surface enumeration for the same reason the spec delta was missed.

### Non-blocking notes
- Rounds 1-3's fixes all re-verified clean on this pass; no regression found in
  `mcp-pipeline-proposal-tools`, `pipeline-proposal-contract`, or `pipeline-proposal-apply` deltas.
- Once CR1-3 land, re-run both sweep greps once more before the next round to confirm the class is
  now closed; four instances across four rounds from the same two mechanical searches suggests the
  underlying cause (an incomplete grep for `PipelineProposal`/`source` consumers when Impact was
  first enumerated) is now understood and the fifth pass should be a confirming pass, not a new-find
  pass.
