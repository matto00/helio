## Skeptic Report — final gate (round 1)

### What I verified (with evidence)

- **AC1** (`create-panel-request.schema.json` accepts `type: "collection"`): confirmed by direct read
  — `schemas/create-panel-request.schema.json:13` has `"enum": [..., "divider", "collection"]`. This
  was already true on `main` before this branch (added by HEL-315, commit `51ca0963`, whose message
  says "absorbs HEL-310") — the executor correctly identified this as already-fixed rather than
  re-touching it (`files-modified.md` "Confirmed correct, no change needed" section). Verified via
  `git log -p` that HEL-305 (the immediately prior touch of this file) did *not* have `collection`, and
  HEL-315 added it.

- **AC2** (audit note): `design.md` and `files-modified.md` enumerate every surface that separately
  re-lists panel types — 4 JSON schemas, helio-mcp `proposal.ts` (`PANEL_TYPES` + `DATA_PANEL_TYPES`),
  `ProposalReview.tsx` `DATA_PANEL_TYPES`, and explicitly scopes out `write.ts` with a stated reason
  (deliberate `divider` omission — verified by reading `helio-mcp/src/tools/write.ts:252` and `280`,
  which do include `collection` and omit `divider`, matching the claim). I independently grepped
  `frontend/src`, `backend/src`, `helio-mcp/src`, `schemas/` for any enum literal containing 7-8 panel
  type strings and found no site missed by the audit.

- **AC3** (contract test): `backend/src/test/scala/com/helio/api/ApiRoutesSpec.scala` — new case
  `"create a collection panel and return 201 with type echoed (HEL-310)"` (lines 311-332), POSTs
  `type: "collection"` and asserts `201` + `type` echoed. Ran fresh: `sbt "testOnly
  com.helio.api.ApiRoutesSpec"` → **178/178 pass**. Also ran full `sbt test` → **1392/1392 pass**, no
  regressions.

- **Drift guard actually fails on drift** (explicitly directed to verify): mutated
  `schemas/dashboard-proposal.schema.json` to drop `collection` from the enum → `node
  scripts/check-schema-drift.mjs` exited **1** with `schemas/dashboard-proposal.schema.json
  $defs.ProposalPanel.properties.type.enum: missing: collection`. Restored via file copy, re-ran →
  clean exit 0. Repeated the same mutate/verify/restore cycle against
  `helio-mcp/src/tools/proposal.ts`'s `DATA_PANEL_TYPES` → exit **1**, correct diagnostic, restored via
  `git diff --stat` confirming zero residual diff. Confirmed clean-tree baseline: `npm run check:schemas`
  → `panel-type enums in sync with backend canonical sets (7 surfaces checked)`.

- **Frontend regression test is real, not decorative**: `ProposalReview.test.tsx`'s new case
  ("flags an unbound collection panel...") — I ran it against the *unfixed* code (reverted
  `ProposalReview.tsx`'s `DATA_PANEL_TYPES` to drop `collection`) and it **failed** (`getByText("No
  DataType bound")` not found). Restored via `git checkout`, re-ran → **7/7 pass**. This is a
  genuine regression test per `systematic-debugging.md`'s bar.

- Full gate re-run, fresh: `npm run lint` (clean, zero-warnings), `npm run format:check` (clean), `npm
  test` (frontend Jest: **1137/1137 pass**, 106 suites), `helio-mcp && npm run build` (tsc compiles
  clean — task 4.4).

- Canonical panel-type source cross-checked directly:
  `backend/src/main/scala/com/helio/domain/model.scala:71-92` `PanelType.fromString`/`asString` list
  exactly 8 types (metric, chart, text, table, markdown, image, divider, collection); every surface
  the guard checks matches this set exactly by direct read (`proposal.ts` `PANEL_TYPES`,
  `DashboardProposalService.scala:271` `DataPanelKinds`, `proposal.ts`/`ProposalReview.tsx`
  `DATA_PANEL_TYPES`, all four schema enums).

- UI: this change's only `frontend/**` diff is a one-line `Set` literal widening
  (`ProposalReview.tsx:29`, no CSS/token/layout touched). Started dev/backend servers via
  `scripts/concertino/start-servers.sh` + `assert-phase.sh servers` → **PASS**. Loaded the app,
  checked console — 0 errors. No design-standard (`DESIGN.md`) surface is implicated (no styling,
  spacing, or component changes), so the mutate/restore Jest verification above is stronger, more
  direct evidence for the actual restored behavior (the "needs bound DataType" warning) than a manual
  click-through would add.

- No scope creep: `git diff main...HEAD --stat` shows exactly the files named in `files-modified.md`
  plus planning artifacts; `write.ts` correctly left untouched.

### Verdict: CONFIRM

### Non-blocking notes
- None beyond what's already tracked. The audit is thorough and the drift guard is the strongest part
  of this change — it converts a previously CI-invisible drift class into a hard failure, and I
  reproduced that failure myself on two independent surfaces (a JSON Schema and a TS `Set` literal)
  rather than trusting the executor's or evaluator's self-reported probes.
