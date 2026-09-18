# HEL-1150: The interactive-data design spec repeats the false "registration is the only enumeration" premise and two stale anchors that HEL-1084–1090 will read

## Description

Found by the HEL-1083 lane; filed at the owner's direction. **Time-sensitive: six more tickets in the HEL-1082 epic will read this document.**

### The problem

`docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` §2 asserts that registering a panel kind in the registry is the **only** enumeration that needs changing, and cites `Panel.scala:109` and `model.scala:141`.

All three are wrong, as HEL-1083 established by delivering against them:

- **There is no `Panel.scala` in `domain/panels/`.** `Panel.Registry` is at `domain/model/Panel.scala:87`.
- **`PanelType.Default` is at `model.scala:149`, not `:141`.** (See "Orchestrator corrections" below — it is `:150` on the tree this run branched from.)
- **Registration is nowhere near the only enumeration.** HEL-1083 had to touch, at minimum: `Panel.Registry`, `PanelKind`, `PanelType` (case object, `fromString`, `asString`, **and a hand-written "Valid values" string literal that no gate checks**), four `PanelConfigCodec` sites, `PanelServiceHelpers.buildNewPanel`, `PanelRowMapper` (`rowToDomain` **and** `domainToRow`), `PanelRepository` (`PanelRow`, `PanelTable`, **both** `configColumnsOf` and `configColumnValuesOf`), `PanelService` plus its `ApiRoutes` wiring, `DashboardSnapshotRepository`'s non-exhaustive match, four schemas under `schemas/panels/`, `dashboard-proposal.schema.json`, `AssistantProposalToolSchemas.scala`, `proposal.ts`, `write.ts`, and on the frontend `panel.ts` (**6** sites), `mobilePanelHeights.ts`, `panelNarrowing.ts`, and **two separate dispatch chains in `PanelContent.tsx`**.
- It also omits the hard blocker entirely: `panels_kind_check` was a five-value CHECK constraint, so a new kind could not be inserted at all without a migration (V108).

### Why this is High

Six tickets — HEL-1084 through HEL-1090 — cite this spec as their grounding document. Each one that reads §2 and believes it will under-scope its own drift surface, exactly as HEL-1083's ticket did. The cost is measurable: HEL-1083 spent four design-gate REFUTE rounds partly on enumeration sites the spec said would not exist.

This is the same pattern the repo-structure cleanup epic hit, where every leaf ticket's file list was stale and had to be re-enumerated from the tree. The fix there was to re-derive; the fix here is to correct the source document before five more lanes read it.

### Suggested direction

- Correct §2 to state the real enumeration surface, or better: replace the enumerated claim with a pointer to the authoritative registry plus the instruction to **re-derive the drift surface from the tree**, since any list in prose will go stale again.
- Fix the two anchors, or drop line numbers in favour of symbol names, which do not drift.
- Record the `panels_kind_check` migration requirement so the next kind-adding ticket does not rediscover it.
- Note in the document that `PanelContent.tsx` contains **two** dispatch chains on different vocabularies (panel kind and output kind), with a silent fallthrough in each.

## Acceptance criteria

1. §2 no longer claims registration is the only enumeration.
2. Anchors are correct or symbol-based.
3. The migration requirement for a new panel kind is stated.
4. A reader following the document arrives at the full drift surface HEL-1083 actually had to touch, or is told explicitly to re-derive it.

## Provenance

Filed 2026-09-17 from the HEL-1083 lane's report (spinoff 2) during the HEL-1082 Form-panel epic.

## Orchestrator corrections (premise validation against `main` @ `9f6f4d41`, 2026-09-17)

Every claim in the ticket and the lane brief was re-derived from the tree before this change was planned. Persisted evidence: `.concertino/runs/HEL-1150/evidence/premise-validation.md`.

- **Scope is docs-only.** Every acceptance criterion is satisfiable by editing the one markdown file. No `frontend/` source, schema, or migration change is in scope. The HEL-1085 lane is live in a sibling worktree on `frontend/` — do not touch it.
- **`PanelType.Default` is at `model.scala:150` on this tree, not `:149`** (ticket) and not `:141` (spec). The ticket's own anchor drifted by one line within days of being filed — which is the whole argument for symbol-based anchors in the spec. Do not write a line number for it.
- **`Panel.Registry` is at `backend/src/main/scala/com/helio/domain/model/Panel.scala:87`** (ticket correct; spec's `:109` is stale). Anchor by symbol, not line.
- **`PanelContent.tsx` lives at `frontend/src/features/panels/ui/PanelContent.tsx`.** Its two chains: an output-kind if-chain inside `OutputPanelContent` (falls through to an "Unsupported output kind" state) and a panel-kind if-chain in the default export (falls through to `MetricRenderer`; HEL-1083's D10 comment records that it is not typecheck-protected).
- **`PanelDetailModal.tsx`** (`frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx`) also carries **two** per-kind if-chains — the editor-ref selector and the editor renderer. HEL-1084 hit these; the ticket's list omits them. The spec should name them alongside `PanelContent.tsx` as silent-degradation sites.
- **`PanelRowMapper`'s `case _ => OutputPanel`** (`rowToDomain`) and `domainToRow`'s `case _ => base` are both silent fallthroughs; `PanelRepository.configColumnsOf`/`configColumnValuesOf` are two more hand-enumerated sites.
- **The `panel.ts` count is not stable** ("6 sites" in the ticket, "5 lines / ~6 sites" in the lane brief; the tree shows 7 lines carrying `PanelKind`/`"form"` including one comment). The spec must not carry a count — point at the registry and instruct re-derivation.
- **The `PanelSpec` parity test** (`backend/src/test/scala/com/helio/domain/model/PanelSpec.scala`, "Panel.Registry" / "PanelKind.All" blocks) hardcodes the expected key set, so it fails on any new kind until updated — it is a drift-detection guard, and worth naming in the spec as the one gate that does fire.
- **`MISTAKES.md` → "Corrections replace decision text; they never accumulate beneath it."** Rewrite §2's sentences in place (as the HEL-1118 correction did for the `StaticSource` premise); do not append a "Correction" note under the false claim.
- `dashboard-proposal.schema.json` is at `schemas/dashboards/dashboard-proposal.schema.json`; `proposal.ts` exists in both `helio-mcp/src/tools/` and `frontend/src/features/dashboards/types/`; `write.ts` is `helio-mcp/src/tools/write.ts`.
