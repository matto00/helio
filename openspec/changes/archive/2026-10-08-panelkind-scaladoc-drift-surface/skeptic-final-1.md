## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `9ad3e0578a89e46fb550bd16e9f3b4afd29378b2`
Review base (resolve-review-base.sh main origin, live, exit 0): `2dd4ed6237817b1feef22d69f8bc8058e58541db`
Spawn-cwd guard: `READY ambient=/home/matt/Development/helio branch=task/panelkind-scaladoc-drift-surface/HEL-1156`

### What I verified (with evidence)

**Scope of diff.** `git diff --stat BASE...HEAD`: outside the change dir, the only changed file is `backend/src/main/scala/com/helio/domain/model/Panel.scala` (+41/-17). Commits: 6b41e67c (the scaladoc) and 9ad3e057 (tasks.md ticks).

**AC1.** `grep -n "only requires updating" Panel.scala` on HEAD gives 0 hits (exit 1). Positive control: `git show BASE:Panel.scala | grep -c` gives 1. Met.

**AC2.** `PanelKind.All` scaladoc (Panel.scala:128-145) says "the source of truth for [[parseKind]] and this set ONLY". It also names the "Drift surface for a new panel kind" paragraph in §2 of `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`. That paragraph exists at spec:194, under "### 2 — Form panel" (spec:157). Met.

**AC3.** Comment-only, checked two ways:
- A filter over `git diff -U0` for +/- lines that do not start with `/**` or `*` prints nothing.
- Stripping all `/* ... */` blocks and blank lines from both the BASE and HEAD versions and diffing them shows identical code (`CODE-IDENTICAL`).

Met.

**Every claim in the new text, checked against the current tree** (beyond design.md's P1-P10):
- "Registry is the source of truth for PanelKind.All, parseKind, companionFor only" and "no codec, repo, service or snapshot dispatcher dispatches through this Map (PanelConfigCodec reads its key set only for an error message)": in `backend/src/main`, the only `Panel.Registry` reference outside Panel.scala is `PanelConfigCodec.scala:58`, the error-message string. `Panel.companionFor` and `PanelKind.parseKind` have no main-code callers; every `companionFor` hit is `PipelineStep.companionFor`. True.
- DB-shape paragraph: `PanelRepository.scala:28-29` has `rowToDomain = PanelRowMapper.rowToDomain(row)`. `PanelRowMapper.scala:37-49` matches on `row.kind` with literal `case <Kind>Panel.Kind` arms, and `case _ => OutputPanel(...)` has no log call. The `kind` column is mapped at `PanelRepository.scala:417`. True, including "silently".
- `PanelType` "Valid values" literal: `model.scala:159`. True.
- Named sites enumerate kinds by hand:
  - `PanelConfigCodec`: :27, :54, :83
  - `PanelServiceHelpers.buildNewPanel`: :130, :142
  - `DashboardSnapshotRepository`: :182
  - `ProposalPanelSupport`: :331
  - `AssistantProposalToolSchemas`: :49-52
  - `schemas/panels/` and `dashboard-proposal.schema.json`: both present

  All present.
- V108 "drops and re-adds `panels_kind_check`": `V108__add_form_panel_kind.sql:22-23`. True.
- Re-derive recipe `git grep -l -i divider -- backend/src/main frontend/src helio-mcp/src schemas` runs (rc=0, 76 files). It hits every site the comment and ticket name: model.scala, PanelConfigCodec, PanelServiceHelpers, PanelRowMapper, PanelRepository, DashboardSnapshotRepository, ProposalPanelSupport, AssistantProposalToolSchemas, dashboard-proposal.schema, panel.schema.json, proposal.ts, write.ts, types/panel.ts, mobilePanelHeights, panelNarrowing, OutputPicker, PanelContent.tsx, PanelDetailModal.tsx.
- "Known gates: PanelSpec pins the registry key set; check-schema-drift.mjs checks several schema / helio-mcp enums against PanelType.fromString":
  - `PanelSpec.scala:58-68` is the key-set equality test.
  - `scripts/check-schema-drift.mjs:218-226` parses `PanelType.fromString`. The surfaces at :269-321 are three schemas/panels enums, the dashboard-proposal enum and helio-mcp `PANEL_TYPES`.

  True. The wording says "Known gates" and "several" and does not claim these are the only gates. That is a deliberate softening of the ticket's suggested "the only gates" wording, which would have overclaimed: other surfaces in the script are checked against `DataPanelKinds`, and TS exhaustiveness can fire.
- Header: "PanelSpec ... pins the registry's key set; it does not detect a missed hand-enumerated site". True: PanelSpec only compares `Registry.keySet`, `PanelKind.All` and each subtype's kind.
- Overclaim check: the new text uses "many further sites", "e.g.", "dated snapshot: re-derive from the tree" and "Known gates". Nothing asserts completeness.

**Gates re-run by me:**
- `nice -n 19 sbt "testOnly com.helio.domain.model.PanelSpec"`: 36/36 passed, `[success]`. It reported a cache hit, which is valid because the sbt 2 cache is content-addressed and the blob is unchanged.
- `npm run check:scala-quality`: clean, rc=0.
- `npm run check:openspec`: openspec/ is clean.
- `npm run check:schemas`: in sync, with 8 panel-type surfaces checked.

**Iron Laws:** this is not a bug fix (comment-only), so no regression test is required. Verification evidence is above.

**UI:** no frontend changes, so this step was skipped.

### Verdict: CONFIRM

### Non-blocking notes
- `PanelSpec.scala:59`'s test name "be the single source of truth for all 6 panel kinds" repeats the old overclaim in test-name form. It is outside AC3's Panel.scala-only scope; a candidate one-line follow-up.
- `PanelKind.All` and `PanelKind.parseKind` have no main-code consumers (tests only). The new wording is still accurate.
- `evaluation-1.md` and `evaluation-2.md` are untracked in the worktree. The orchestrator should commit them before archive.
- The `Claude Haiku 5.5` commit trailers are known and moot after the squash.
