## Context

See proposal.md — Why. Facts that shape the approach, every one re-derived from the tree at `main` @ `9f6f4d41`
(evidence: `.concertino/runs/HEL-1150/evidence/premise-validation.md`):

- The target is `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`. §2 is the block between
  the `### 2 — Form panel` and `### 3 — Output controls` headings. Anchor edits on those heading strings, never on
  line numbers. Prettier formats `docs/` (not in `.prettierignore`); nothing else reads the file.
- Symbols the corrected §2 must point at, all verified present:
  `Panel.Registry`, `Panel.Companion`, `PanelKind.All` (`backend/src/main/scala/com/helio/domain/model/Panel.scala`;
  trait deliberately not `sealed`); `PanelType` / `.fromString` / `.asString` / `.Default` and the hand-written
  "Valid values" literal (`.../domain/model/model.scala`); `PanelConfigCodec` (`.../domain/panels/`);
  `PanelServiceHelpers.buildNewPanel`; `PanelRowMapper.rowToDomain` (`case _ => OutputPanel`) and `.domainToRow`
  (`case _ => base`); `PanelRepository.configColumnsOf` / `.configColumnValuesOf`; `DashboardSnapshotRepository`'s
  `PanelConfigCodec` match; `AssistantProposalToolSchemas`; `schemas/panels/*.schema.json`;
  `schemas/dashboards/dashboard-proposal.schema.json`; `helio-mcp/src/tools/proposal.ts` and `write.ts`;
  `frontend/src/features/panels/types/panel.ts` (`PanelKind` union, per-kind config, `emptyConfigForKind`);
  `mobilePanelHeights.ts`; `panelNarrowing.ts`; `OutputPicker.CONTENT_PANEL_KINDS`; `PanelContent.tsx` (two
  if-chains: output-kind inside `OutputPanelContent`, panel-kind in the default export falling through to
  `MetricRenderer`); `PanelDetailModal.tsx` (`activeEditorRef`, `renderSubtypeEditor`).
- Gates that actually fire on a missed site: `PanelSpec`'s "Panel.Registry" / "PanelKind.All" blocks (hardcoded
  expected key set) and `scripts/check-schema-drift.mjs` (parses `PanelType.fromString`, derives
  `agentFacingPanelTypes`). Every other site above degrades silently.
- Migration: `panels_kind_check` is a closed-set CHECK constraint (`V94__outputs_model.sql`, widened by
  `V108__add_form_panel_kind.sql`, whose header records that the spec omitted it). A CHECK cannot be widened in
  place; V108 drops/re-adds it and adds the per-kind config column in the same migration.
- `text`, `markdown`, `image`, `divider` bind no Output (only `output` carries `outputId`; `form` binds via
  `dataSourceId`). §2's "second panel kind after `divider`" sentence is therefore also false.
- The HEL-1085 lane is live in a sibling worktree on `frontend/`. This change touches no source file.

## Goals / Non-Goals

**Goals:**

- A reader of §2 leaves knowing registration is one site among many, where the authoritative kind set lives, which
  sites fail silently, which gates fire, that a migration is mandatory, and how to re-derive the surface today.
- Every anchor in §2 survives line insertions.

**Non-Goals:**

- Prose outside §2 (see D7). Any runtime, schema, or migration change. The Linear epic/leaf text.

## Decisions

**D1 — Rewrite in place; one dated provenance clause.** The false sentence is replaced, not annotated. MISTAKES.md
("corrections replace decision text; they never accumulate beneath it") is binding, and the HEL-1118 correction in
the same file already set the in-place precedent for its `StaticSource` premise. Alternative — an appended
"Correction" blockquote under the old claim — rejected: a reader who stops at the heading gets the wrong answer.
Provenance is one parenthetical, e.g. "(corrected 2026-09-17 by HEL-1150, after HEL-1083/HEL-1084 delivered
against the original text)".

**D2 — Anchor form: symbol name plus directory-qualified file, never a line number.** The ticket's own `:149` for
`PanelType.Default` was already `:150` by the time this run branched — line anchors rot in days. Symbols are
`grep`-able and survive insertions. The directory is kept because a bare symbol is ambiguous across layers
(`PanelType` exists in both `model.scala` and `panel.ts`) and because the epic's `domain/panels/Panel.scala` path
was itself wrong. A wrong path fails loudly (no such file); a wrong line silently points at neighbouring code.
Alternative — re-verified line numbers — rejected for the reason above.

**D3 — Both a dated snapshot and a re-derive instruction, not one or the other.** AC4 accepts either; the snapshot
gets the reader to HEL-1083's actual surface in one read, and the instruction tells them it has grown since. The
snapshot is grouped by layer (backend model → codec → persistence → service/routes; JSON schemas; `helio-mcp`;
frontend), anchored per D2, and labelled "as of HEL-1083/HEL-1084, 2026-09-17 — not authoritative". Alternative —
pointer only — rejected: it repeats the original failure (the reader under-scopes because nothing shows the size).

**D4 — The recipe greps an existing kind's token across all four layers.** `divider` is the least ambiguous
existing token (`image`/`text`/`markdown` collide with output kinds and UI copy). Every hit is a candidate site for
the new kind; the reader triages. Name the two gates that fire (Context) so the reader knows everything else is
silent. Alternative — a maintained script — out of scope for a docs ticket; noted as a possible follow-up only.

**D5 — State the migration requirement inside §2, cross-referencing the existing pattern.** One sentence: a new
kind cannot be INSERTed until `panels_kind_check` is dropped/re-added (the same drop/re-add pattern the spec's
Decision 8 already describes for `pipeline_steps_op_check`); V108 is the precedent, and any per-kind config column
ships in the same migration.

**D6 — Fix the collateral false sentence.** Replace "second panel kind after `divider` that requires no Output
binding" with the true statement: the content kinds bind nothing; `form` is the first kind to bind a *source*.
Keep "`PanelType.Default` (currently `Divider`) is untouched" — still true — anchored per D2.

**D7 — Scope is §2 only; the three anchors outside §2 are a different defect.** `DataSource.scala:145`
(`StaticSource`) and the Migration-A rationale's three call sites (`InProcessPipelineEngine:509`,
`SparkJobSubmitter:169`, `DataSourceService.previewStatic:930`) are stale because HEL-1074 *executed* the decision
they justify: `StaticSource` no longer exists as a symbol and those sites no longer read the blob. Symbolizing them
would leave a present-tense claim that is now false; the honest fix is a dated "executed by HEL-1074" note, which is
a separate doc-maintenance change. AC2 is read as §2's anchors — the two the ticket names. Surface the rest at
Delivery via the follow-up triage, not silently.

**D8 — Verification for prose is zero-hit probes with positive controls, plus symbol resolution.** Record the
pre-edit counts (the red): "only enumeration to change" = 1, `Panel.scala:109`/`model.scala:141` = 2,
`panels_kind_check` = 0. After the edit: 0 / 0 / ≥1, no `` :NNN` `` inside §2, and every symbol named in §2 resolves
via `grep -rq` over `backend/src`, `frontend/src`, `schemas`, `helio-mcp/src`. No dev servers, no Playwright (the
HEL-1085 lane shares the browser; a docs diff has no UI). `git diff` hunks must all fall inside §2 (D7).

## Risks / Trade-offs

- [Snapshot rots again] → dated, labelled non-authoritative, paired with the recipe (D3/D4).
- [§2 balloons] → cap the addition at roughly 40 lines; the layer list is bullets, not prose.
- [Prettier reflows the file] → run the repo's Prettier on the one file before committing; check the diff is §2-only.
- [Husky chain exceeds 120s on a docs diff] → commit with a 600000 ms tool timeout; never re-run mid-hook.
- [Concurrent HEL-1085 lane] → zero file overlap; no `frontend/` edit, no Playwright, no migration.

## Migration Plan

None — documentation only. Rollback is `git revert`.

## Planner Notes

Self-approved: D1–D8. No new dependency, no architectural or API change, scope within the ticket's four ACs. No
`.husky/**` touch, so no Gate-Chain Implications Checklist applies.
