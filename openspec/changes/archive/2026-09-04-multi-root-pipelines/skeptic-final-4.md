## Skeptic Report — final gate (round 4, skeptic-final-4.md)

Head reviewed: `c95d0559` (confirmed as PR #543's `headRefOid`, base `main`, MERGEABLE).
No UI section: `git diff --stat main...HEAD -- frontend/` is empty, so servers/screenshots were not
stood up. There is no visual judgment to make on this change.

### What I verified (with evidence)

**CR1 (round 3) — RESOLVED.**
`grep -rn "PipelineProposal" --include=*.md .` — the sentence "`PipelineProposal.source` likewise
becomes `roots[]`" is gone from `proposal.md`. The only surviving `PipelineProposal` mentions in
this change's artifacts are the non-scope bullet (`proposal.md:23-25`) and prior skeptic/eval
reports quoting the defect. `grep -rn "Proposal\|proposal" openspec/specs/{pipeline-multi-root,
mcp-pipeline-root-tools,pipeline-create-api,patch-set-apply,mcp-output-tools}/spec.md` returns
**zero matches** — nothing false about proposals reached the canonical specs.

**CR2 (round 3) — acceptable resolution, I do not require the code fix before merge.**
- Read `V99__prevent_zero_root_pipelines.sql` in full. The header no longer claims RLS
  independence; it states the measured result (`pipelines=1, roots=0` with a NOSUPERUSER
  NOBYPASSRLS definer and `app.current_user_id` unset), names it as the same failure class V98/V40
  record, and points at HEL-974.
- I verified the safety rationale myself rather than accepting it:
  `backend/src/main/scala/com/helio/infrastructure/persistence/sources/DataSourceRepository.scala:216-217`
  — `def delete(...) = ctx.withUserContext(user.id.value)(table.filter(...).delete)`. The GUC is set
  on the user-facing path, so the trigger fires there. I found no other writer reaching
  `pipeline_roots` outside a user context.
- HEL-974 exists (Linear, **High**, project v0.7, parent HEL-903) with ACs that are actually
  falsifiable: the exact non-superuser repro, no-false-positive cases, "`FlywayNonSuperuserMigrationSpec`
  … actually fires the trigger", and mutation proof.
- Judgment: the residual gap is latent (privileged/no-context writers only), the previous behaviour
  for that same class was itself lossy (V22 cascaded away the whole pipeline), and the fix has a
  named owner with a real acceptance test rather than living only in a doc caveat. Ship it.

**Acceptance criteria — traced.**
- AC1 (migration, one root per pipeline, snapshot equality):
  `FlywayNonSuperuserMigrationSpec.scala:300-312` asserts `pipeline_roots` count equals the
  pre-migration `pipelines` count and is non-zero (73 from a real dump), **as the non-superuser
  role**, plus every parentless `pipeline_steps` row carrying a non-null `root_id`. This is the
  gate the ticket's constraint 2 demanded, exercised on dump-shaped data (constraint 3).
  Constraint 1: `V98*.sql:64-68` / `:330-334` bracket and restore `FORCE ROW LEVEL SECURITY` on all
  five tables; `:349` sets it on the new `pipeline_roots`.
- AC2 (two roots joined by a lane-`join`; root removal removes Outputs and reports placements):
  `InProcessPipelineEngineTreeWalkSpec.scala:379` "a lane rejoin can cross roots"; `:328`, `:355`,
  `:424`, `:449`, `:475`. `PipelineRootRoutesSpec.scala:320` "reports a NON-ZERO
  removedOutputCount and removes the root's Output and its panel placement", `:294` position
  compaction + counts, `:263` last-root refusal, `:397` surviving-lane refusal.
- AC3 (unreadable root is 404 at write time): `PipelineRootRoutesSpec.scala:186` (unowned/nonexistent
  `sourceId` → 404), `:241` (pipeline not owned → 404), `:426` (foreign `rootId` → 404), `:178`
  (blank id → 400, no ownership lookup — the HEL-950 empty-seed shape).
- AC4 (`check:schemas` / `check:openspec` green): I ran both myself in the worktree.
  `check:schemas` → "schemas in sync with JsonProtocols (73 checked across 48 protocol files)",
  panel-type enums and `AssistantProposalToolSchemas.scala` in sync. `check:openspec` → "openspec/
  is clean". `ls openspec/changes/` → `archive` only, so the HEL-967 stray-file hazard is closed.
- AC5 (design.md states the contract; HEL-911 item 11 superseded with a forward pointer):
  the supersession text exists on items 8 and 11 of
  `openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md:150,153` — **but both
  pointers resolve to nothing. See CR1 below.**

**CI — composition verified, contradicting the "solely hel910" belief only in that it is even
narrower than feared.** `gh pr checks 543`: backend **pass** (10m40s), frontend pass, security pass,
CodeQL + all three Analyze pass; `e2e` fail. I pulled the e2e job log (job 101072240993):

```
✘  36 e2e/hel910-pipeline-to-dashboard-flow.spec.ts:90:7 …
   Error: page.waitForURL: Test timeout of 30000ms exceeded.
   waiting for navigation to "/pipelines/undefined" until "load"
1 failed
37 passed (2.2m)
```

Exactly one failing test, and it is the documented HEL-969 create-UI gap at the exact stated
symptom. `hel813-mobile-touch-target-floor` (the other spec `tasks.md:1177` licensed as
expected-red) actually **passed**, and `hel908-full-flow` (the known HEL-964 flake) passed. Nothing
red is outside the declared window. This is not a new finding.

**Rebase onto `489c4c93` — intact.** `git diff --stat main...HEAD -- e2e/ playwright.config.ts
frontend/`: `playwright.config.ts` is **unchanged from main**, so HEL-912's quarantine of
`hel912-lanes-rejoin.spec.ts` (`:66-80`) survived verbatim; `frontend/` is empty as the non-goal
requires; the eight touched `e2e/` specs carry only the `sourceDataSourceId` → `roots: [{sourceId}]`
wire-format edit. `e2e/hel912-lanes-rejoin.spec.ts` exists and is the sole remaining
`sourceDataSourceId` request body under `e2e/` — correctly left alone because it is quarantined
(noted below for HEL-972).

**Archive — substantively faithful, with the caveats below.** I diffed every one of the 11 canonical
files in `c95d0559` against the deltas. The two `REMOVED Requirements` blocks
(`pipeline-execution`, `pipeline-create-api`) each carry an explicit **Reason** and **Replaced by**
and are correct decisions, not silent drops. The two hand-written `Purpose` lines
(`pipeline-multi-root`, `mcp-pipeline-root-tools`) are **accurate**, not plausible-sounding: every
clause in each ("ordered, non-empty set", "position compaction", "per-root access control", "refuses
the last root", "placement-count reporting") maps to a requirement in its own file and to a named
test in `PipelineRootRoutesSpec`.

### Verdict: REFUTE

Two findings, both in the un-reviewed archive step, both objectively checkable and cheap. Everything
else above is genuinely clean, and I want that on the record so the escalation is proportionate: the
code, the tests, the migration coverage, the CI composition, the rebase and CR1/CR2 are all in good
shape. What is broken is the pointer machinery this ticket explicitly promised as a deliverable.

### Change Requests

**1. Six forward pointers now dangle at a path the archive deleted — this breaks AC5's deliverable.**

`openspec/changes/multi-root-pipelines/` no longer exists (`ls openspec/changes/` → `archive` only).
Six references still name it:

| File | Line |
|---|---|
| `openspec/changes/archive/2026-09-03-multi-lane-pipeline-engine/design.md` | 150 (item 8), 153 (item 11) |
| `docs/superpowers/specs/2026-08-30-pipelines-outputs-remodel-design.md` | 7, 50, 174 |
| `backend/src/main/scala/com/helio/domain/panels/OutputBindingSpec.scala` | 173 |

The two in HEL-911's design are the ticket's own AC5: *"HEL-911's engine-contract item 11 is
superseded with a forward pointer **so no reader follows the stale format**."* A pointer that
resolves to nothing leaves the reader with exactly the stale `root > s1 > s4` format and the stale
`Some(stepId)` keying, which is the outcome the AC was written to prevent. The three in the remodel
spec are the "corrects four now-false sentences" deliverable, and the one in `OutputBindingSpec.scala`
sends a future maintainer to a dead path for R12/R15.

Fix: repoint all six at
`openspec/changes/archive/2026-09-04-multi-root-pipelines/design.md`. (Worth a
`grep -rn "openspec/changes/multi-root-pipelines"` afterward returning only matches **inside** the
archived change dir's own self-references, which are fine.)

**2. `openspec/specs/pipeline-steps-persistence/spec.md:12-26` — the requirement's body no longer
describes the thing its title and scenario assert.**

The delta's `MODIFIED` block replaces the whole requirement body, so "Requirement: Pipeline steps
table exists in the database" now reads *only* as the `root_id` sentence. The pre-existing body —
the column list, the `op` CHECK enum, the Flyway V23/V25/V26/V27/V31/V50/V51/V52/V86 history, the
`enabled NOT NULL DEFAULT true` rationale — is gone from the canonical spec entirely, while the
surviving scenario at `:26` still reads "**THEN** the `pipeline_steps` table exists with **the
specified columns**, FK, CHECK constraint (including `'chunkbytokencount'`), and index". Nothing in
the document specifies them any more; the reference dangles.

Fix: restore the prior body text and append the `root_id` sentence to it (the delta in the archived
change dir may stay as-is; this is a repair to the canonical file). Nothing about behaviour is
wrong here — this is a canonical document that contradicts itself, in the same class as CR1.

### Non-blocking notes

- **Requirement-body narrowing elsewhere in the archive (accepted, not blocking).** The same
  `MODIFIED`-replaces-the-whole-block mechanic narrowed four other requirements to their multi-root
  subject, dropping pre-existing normative prose: `patch-set-apply` (the pre-validation /
  per-op access-parity / no-direct-repository-writes rule), `workspace-context-assembly` (the route's
  mount point, payload, schema validation and `budgetBytes` default), `mcp-output-tools` (the
  inline-source two-HTTP-calls mechanic and the orphaned-data-source-id error rule), and
  `pipeline-analyze-api` (the `{name,type}` `sourceSchema` shape, and the `source`-kind vs
  `lane`-kind asymmetry paragraph). I checked each: in **all four** the behavioural contract survives
  in the file's Purpose and/or its scenarios (`patch-set-apply:4-7,20-53`;
  `workspace-context-assembly:35-39`; `mcp-output-tools:118`; `pipeline-analyze-api:179-182`, which
  still carries the HEL-965 pointer). So no contract was lost, only its prose statement — unlike CR2,
  where a live cross-reference is left dangling. Worth a doc-hygiene pass some day, not this ticket.
- `InProcessPipelineEngineTreeWalkSpec.scala:320-321` — the comment "no route creates a second root
  yet" is now false in this very change (`POST /api/pipelines/:id/roots` and multi-root
  `POST /api/pipelines` both ship here). One-line correction while in CR territory.
- `e2e/hel912-lanes-rejoin.spec.ts:76` still posts `sourceDataSourceId`, so it will 400 the moment
  HEL-972 unquarantines it. Correctly out of scope here; worth a line on HEL-972 so it is not
  diagnosed from scratch.
- `files-modified.md` was deleted rather than moved by the archive commit, so the reconciled
  171-file declaration does not survive in the delivered tree. That appears to be `squash-branch.sh`'s
  intended lifecycle for a transient artifact; flagging only so nobody later reads its absence as a
  loss.
