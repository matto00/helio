## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD f63ab8365d2b0e6cac36154a83437b6d26b3a209 (worktree = origin/main; planning artifacts untracked).

### What I verified (with evidence)

- **Spawn guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=task/proposal-legacy-fields-followups/HEL-1440`.
- **(a) Deprecate, not remove / no wire change.** `openspec/specs/mcp-panel-composition-tools/spec.md:82-92`
  ("Proposal config passthrough is backward compatible") pins flat-field-only proposals incl. `fieldMapping`/`aggregation`
  applying unchanged, so removing the fields would contradict a live requirement. Marking them deprecated changes
  annotations only. `check-schema-drift.mjs` compares property NAME sets (`scalaSchemaPropertyNames` ->
  `topLevelEntries`, line 568), so a nested `"deprecated"`/`"description"` key is not read as a property. No
  `"strict"` tool mode in `infrastructure/ai` or `services/assistant` (grep: 0 hits), and the tool schema already
  sends non-validation keywords (`"examples"`, AssistantProposalToolSchemas.scala:151), so `"deprecated": true` is
  very unlikely to be rejected by the API. D1 holds.
- **(b) Inert on every apply path.**
  - `ProposalPanelSupport.buildCreateRequest` (l.250) -> `buildDataConfig` (l.316): an `output` panel gets only
    `{outputId}`. A non-output panel with an `outputId` gets `fieldMapping` in its config, but every non-output kind
    decodes through a typed `decodeCreate` (`TextPanel.scala:33`, `MarkdownPanel.scala:33`, `ImagePanel.scala:46`,
    `DividerPanel.scala:41`) that drops unknown keys, and form + outputId is rejected. `aggregation`/`label`/`unit`
    are read only by the encoder (`DashboardProposalProtocol.scala:116-126`).
  - Combined proposals and `replace_dashboard_contents` use the same `ProposalPanel`/`panelSchema`
    (`combinedProposal.ts:33,102`). First-run builds `ProposalPanel(... fieldMapping = None, aggregation = None,
    label = None, unit = None ...)` (`FirstRunPlanner.scala:170-172`). The NL authoring prompt
    (`DashboardAuthoringPrompt.scala:21-33`) already leaves the four out. MCP forwards the proposal to the backend apply.
    The fields have no effect on any apply path.
- **(c) V133 FK swap under FORCE RLS / non-superuser.** V109:15 `user_id UUID NOT NULL REFERENCES users(id)` (default
  name, NO ACTION), FORCE RLS (l.22). Same pattern already shipped in V119:83-85 (CASCADE added as the NOSUPERUSER
  NOBYPASSRLS table owner), whose header (l.25) records that FK validation and RI cascades run as the table owner
  without RLS. PK `(user_id, window_start)` indexes the cascade lookup. `V119OwnerFkMigrationSpec` already has a
  prod-shaped role (`helio_migration_test`, l.46-52) to reuse. Sound.
- **(d) Flyway ordering.** main's highest is V130 (`git ls-tree origin/main`). `gh pr diff 994` -> `V131__patch_set_applied_proposals.sql`
  and also edits `docs/user-reference-inventory.md` + `AssistantProposalToolSchemas.scala` (both disclosed in design
  Risks). `gh pr diff 1000` -> `V132__form_and_conversation_object_deletions.sql`. No other open PR (986/990/991/996/998/999)
  and no remote branch has a V133+ migration. Local worktrees: only HEL-1522 (V131) and HEL-1530 (V132). HEL-1433's
  lane has a "no migration" constraint, but its C4 also says "any migration would be V133" (see notes).
- **(e) e2e.** All three specs delete in `finally` inside the test body (hel1390:113, hel1304:205, hel1351:321), so
  `expect.soft` there records failures without replacing the body's error. `start-servers.sh` has no DATABASE_URL
  override (it sources only `.concertino.env`), so the D6 fallback (`--list` + tsc, recorded) will probably apply.
  The design states this up front, which is acceptable.
- **(f) Dropped items.** 5a: `PipelineCreatePreflight.validateOutputConfig` (l.205-210) is a formatted chain, and
  `PipelineService.scala` no longer has the block. The code moved in HEL-1469 (#918), and HEL-1480 (#924) touched it
  later, so the attribution is slightly off but the drop is correct. HEL-1301: commit 5986340c5 exists ("e2e runs
  delete the throwaway users they create").
- Spec deltas: `openspec/specs/user-reference-integrity/spec.md` has no rate-window wording that the ADDED
  requirement contradicts. `dashboards.owner_id` is NO ACTION (inventory l.27), so the "remaining blocking reference"
  scenario is meaningful.

### Verdict: REFUTE

The design is mostly sound. It leaves one implementation-shaping decision open, and one test-role choice hedged.
Both are cheap to fix in the artifacts.

### Change Requests

1. **Decide what happens to the human-facing "Mapping" row; do not leave it as "report what was found".**
   `frontend/src/features/dashboards/ui/ProposalReview.tsx:153-161` and
   `frontend/src/features/proposals/ui/CombinedProposalReview.tsx:41-49` show `panel.fieldMapping` to the user as a
   "Mapping" row (for example `value → revenue`), and tests pin that display (`ProposalReview.test.tsx:32,66`,
   `CombinedProposalReview.test.tsx:33,97`). After this change every agent-facing surface says the field is ignored,
   but the human reviewing the proposal before Apply is still shown it as if it applies. That is the same
   "advertised but inert" defect the ticket exists to close, moved to the UI. D1 only says "Check first whether any
   frontend code reads/writes these props ... report what was found", so one competent executor would remove the row
   and another would leave it. Record an explicit decision (an assumed call is fine, owner asleep) in design.md and
   tasks.md:
   - either drop the Mapping row in both review components and update the two tests to assert it is absent (a
     display-only change, no wire change);
   - or leave it and name it as an explicit non-goal with a follow-up ticket.
   Also say how the `@deprecated` JSDoc interacts with these reads. Lint has no `no-deprecated` rule
   (`eslint.config.cjs` uses the non-type-checked recommended set), so lint is not the constraint. The decision is.
2. **Pin the deleting role in D4 / task 4.1 instead of "where the harness supports it".** The harness does support
   it: `V119OwnerFkMigrationSpec` creates `helio_migration_test` (NOSUPERUSER NOBYPASSRLS, table owner, FORCE RLS
   applies to it). State that the spec scenarios run the `DELETE FROM users` over that role's connection with
   `app.current_user_id` unset, and read all counts over the superuser connection (the V119 pattern). That is the
   hostile case for question (c). A superuser delete would pass whether or not RLS interferes.

### Non-blocking notes

- `AssistantProposalToolSchemasSpec.scala:35` also has `.asInstanceOf[JsArray]`. AC5 names only `JsString`, but
  clearing the same anti-pattern in the same file costs nothing. The executor may choose.
- `helio-mcp/src/types.ts:740-820` (`ProposalPanel` doc) stays undeprecated because of parked #986/#990. That is a
  known gap; list it in the PR body as a follow-up.
- V133 collision risk: HEL-1433's lane constraint C4 says "any migration would be V133". It currently plans no
  migration, but if either lane changes course they collide. Note it in the PR body.
- Item 5a attribution: the code moved in HEL-1469 (#918), not HEL-1480. Fix the wording in ticket.md's premise
  section if it is touched again.
- D2's "no other property deprecated" assertion must target `ProposalPanelSchema`'s own `label`, not
  `ProposalControl.label` (which is legitimate, `dashboard-proposal.schema.json:125`).
