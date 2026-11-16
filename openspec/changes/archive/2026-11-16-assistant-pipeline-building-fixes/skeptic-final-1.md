## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `ecbb0ebe4e7f3ff7ca878556e32159ecacdc27a0`. The review base was resolved live by `resolve-review-base.sh` as
`ee66e5b1a933cafdc8316ce30f90c8582159b9cd` (origin/main). The spawn-cwd guard returned READY.

### What I verified (with evidence)

**1. Nothing of the ticket's own changed after the evaluator's PASS.**
- I diffed the branch's own patch at the evaluated head (`8fff8eed1...4210ca7eb`) against its patch now
  (`ee66e5b1a...HEAD`), comparing only the +/- lines. The only difference is the added `evaluation-2.md`: 118 lines, all
  of them additions to that file.
- So the three main merges (`da874cae6`, `82b8f85f2`, `ecbb0ebe4`) did not textually change any line of the ticket's own
  diff. That includes `CredentialSurfaceEnumerationSpec`, where the branch's added lines are unchanged.
- `82b8f85f2..ecbb0ebe4` touches only openspec/archive files: 13 files, all under `openspec/`.
- The helio-mcp change is still the optional `ref: z.string()` plus comment text. That API is the same in zod 4.
  `refinementSchemas.test.ts` re-run: 7/7 pass.

**2. Gates.**
- Backend: I read the orchestrator's post-merge log, `.concertino/scratch/HEL-1639/sbt-testFull-postmerge2.log` (written
  09:08 today). It shows `Tests: succeeded 9484, failed 0, canceled 5` and `All tests passed`.
- Every new or changed spec appears in that log by name: AssistantStepSchemasSpec, AssistantPipelineReadsSpec,
  AssistantProposeErrorsSpec, PatchSetOutputCreateSpec, ClaudeClientOncePerResponseSpec, SecretRedactionSpec,
  CredentialSurfaceEnumerationSpec, WorkspaceSearchServiceSpec, PipelineProposalServiceValidateSpec,
  AssistantEvalParsingSpec and PatchSetPreviewOutputContextSpec.
- Between that run and HEAD, only openspec files changed, so I did not re-run sbt (the machine is shared).
- Frontend `--testPathPatterns=PatchSetReview` re-run: 4 suites / 42 tests pass.

**3. Acceptance criteria.**
- **AC1 (replay eval, ≤2 failed calls) and AC5 (measured before/after): NOT MET, deferred by the owner.**
  - `workflow-state.md` records `skip-live-eval`.
  - HEL-1708 (Backlog) exists. It names AC1, AC5 and the unverified `oneOf` schema acceptance, and says to treat a failure
    as a High bug.
  - The eval runner, fixture and parsing are delivered and unit-tested (`AssistantEval*`, `EvalWorkspace`,
    `AssistantEvalParsingSpec`). No measurement is claimed anywhere.
  - Per the orchestrator's instruction, I am not re-litigating the deferral. The deferral is honest.
- **AC2 (items 1–7 and 9 each fixed or won't-fix):** traced in `evidence/failure-taxonomy.md`'s disposition table. Each row
  names the main code and the asserting test. I spot-checked the code for items 1, 2, 3, 5, 6 and 7, and checked them
  live (below). The won't-fix items are stated with reasons:
  - 3e, select column check → HEL-1638;
  - 7, new pipeline plus panels on an existing dashboard in one proposal → stays two proposals.
- **AC3 (`get_resource(pipeline)` returns steps and per-node schemas, with a test):** `AssistantPipelineReadsSpec`
  asserts:
  - a non-empty `laneTree`;
  - ordered nodes `lookup, compute`, with id, config (`sourceKey=owner_id`), `rootId` and `parentStepId`;
  - `display_name` in the lookup node's `outputSchema` but not `points_for`, and both at the compute node;
  - the Outputs, with kind and node.
- **AC4 (`passthrough`, empty lookup and Output-as-root rejected, errors naming valid options):**
  - `AssistantProposeErrorsSpec` asserts `invalid type 'passthrough'` together with `Valid step types:`, with `groupby`
    excluded.
  - `lookup {}` gives an error naming `secondaryInput`, `sourceKey` and `lookupKey`.
  - An Output root gives `is an Output, not a data source` plus the pipeline id. A stranger gets `data source not found`,
    and a grantee gets the hint.
  - I also checked this at the schema layer (item 5 below).

**4. Live behaviour.** On the running lane servers (`assert-phase.sh servers` PASS on 7071/9978), I sent preview-only
`POST /api/patch-sets/preview` calls on an existing dev-account pipeline and dashboard. Nothing was written, so no
residue was created.
- An output create plus a `$ref` panel create: 200, with both pending creates.
- A missing column: `fieldMapping references column(s) not present at this node: display_name. Available columns:
  region, total (node '…')`.
- A dangling ref: `$ref:nope does not name an earlier output create (refs: w)`.
- A ref used before its definition: rejected with `refs: none`.
- `target.parentId` on a panel: rejected, naming `patch.dashboardId`.
- Panel-level `fieldMapping`: rejected with "chart shape belongs on the Output".
- A step update upstream of an output create in the same set: rejected with the D2 message.

**5. The Anthropic `input_schema` concern (no API call made).** I dumped every assistant tool schema from the
running backend's jar with jshell. The dump is persisted at
`/home/matt/Development/helio/.concertino/runs/HEL-1639/evidence/.skeptic-final-tool-schemas.json`. I then checked the
schemas with ajv 8.20 (Ajv2020, `strict: true`).

Evidence FOR acceptance:
- All 7 tool schemas compile under ajv strict mode and are valid against the 2020-12 meta-schema.
- Every schema is top-level `type: object` with no top-level `oneOf`/`anyOf`/`allOf`. A top-level combinator is the one
  documented `input_schema` restriction I know of.
- There are 4 `oneOf`s, all nested: the step item in `propose_pipeline` and in `propose_combined`, and the lookup
  `secondaryInput` inside each of them.
- The tools are sent without `strict: true` (no `strict` field anywhere in `infrastructure/ai`). The structured-outputs
  schema subset, which restricts combinators and `minimum`, therefore does not apply.
- Each schema's own `examples` validate against it.
- The `oneOf` is semantically correct:
  - `passthrough`, `lookup {}` and a `limit` with an extra key fail;
  - a full lookup, a full compute and a non-schema'd op with `{}` pass;
  - each authorable op matches exactly one variant.

Evidence AGAINST, or unproven:
- No live request has ever carried these schemas.
- Before this branch, no `oneOf`/`anyOf` appeared anywhere in `backend/src/main` (`git grep` at base: 0 hits). This is the
  first combinator helio sends to Anthropic.
- If the API rejected it, the failure would not be confined to pipeline authoring. Every converse that offers
  `propose_pipeline`/`propose_combined` would get a 400.
- My judgement from the code and docs: acceptance is likely, but it is not proven. HEL-1708 explicitly owns the proof.

**6. UI judgement (DESIGN.md).**
- The UI change is one summary line per create edit in the patch-set review (`createSummary.ts`,
  `.patch-set-review__summary`).
- It uses tokens only (`--text-sm`, `--app-text`, margin 0) and sits in the existing card rhythm between the title row and
  the before/after panes.
- I rendered it on the page (router state set to the previewed set) in dark and light. Contrast is good in both, the
  rhythm matches the rest of the dialog, and there is no layout shift.
- Screenshots:
  - dark: `/home/matt/Development/helio/.concertino/runs/HEL-1639/evidence/.skeptic-final-review-current-theme.png`
  - light: `/home/matt/Development/helio/.concertino/runs/HEL-1639/evidence/.skeptic-final-review-light.png`
- The theme was restored to dark afterwards (localStorage was untouched).

**7. Code review: points I checked and accept.**
- `OutputReadAccess`:
  - it learns the pipeline id through an internal read, but returns it only after a grant-aware `findSummaryById`;
  - a stranger gets the same 404 text as for an unknown id;
  - the cross-tenant test is asserted.
- Apply:
  - creates in order and substitutes refs;
  - backfills only after the whole set succeeds;
  - rollback deletes the created Output, and its panel was already removed by the reverse walk.
- Undo inverts an output create, with a conflict check that the Output still exists.
- `ProposalStepRules` also runs on first-run and template proposals via `validateStructure`. The shapes those emit
  (select with fields, aggregate with aggregations, sort with sortBy, limit with count, datebucket) all satisfy it, and
  the full suite is green.

### Verdict: CONFIRM

Every AC that is in scope is traced to code, tests and live behaviour. AC1 and AC5 are unmet, but the owner deferred them
and that deferral is recorded honestly: HEL-1708 names the exact gap, including schema acceptance. Since the evaluator's
PASS, the ticket's own diff has not changed by a single line. The UI addition is on-token and has light/dark parity.

### Non-blocking notes
- **Release sequencing (strongly recommended).** The nested `oneOf` is the first combinator helio sends to Anthropic, and
  a rejection would break every assistant converse, not only pipeline authoring. Do not cut a release containing this
  merge until HEL-1708 has run at least one live converse, or watch the first prod converse right after deploy.
- `tasks.md` leaves 0.4 and 3.9 unchecked with no annotation. Before archive or in the PR, mark them as deferred to
  HEL-1708 (owner ruling `skip-live-eval`), so the archived change does not read as silently incomplete.
- Polish: the output-create summary line shows the raw step UUID ("at step f3ce56db-…"). A step type or position (e.g.
  "at the aggregate step") would read better to a reviewing human. The raw JSON pane already carries the id.
- Undo of an output create uses `deleteWithPanelsInternal`. Any panel bound to that Output after apply, including one
  made by someone else, is deleted with it. This is consistent with the pipeline/dashboard create-undo precedent, but
  worth a sentence in the PR.
- The evaluator's carried-over PR notes still apply. The stricter `RequiredKeys` also tightens the MCP and HTTP
  apply-proposal paths, and the change reverses the HEL-814/HEL-1416 wording.
