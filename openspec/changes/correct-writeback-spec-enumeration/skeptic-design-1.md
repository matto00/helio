## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- **Pre-edit reds match design.md's D8 claims** (ran against the live worktree file, not trusted from prose):
  - `grep -n "only enumeration to change" docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` → 1 hit (line 159 area).
  - `grep -nE 'Panel\.scala:109|model\.scala:141'` → 2 hits: line 159 (`Panel.scala:109`) and line 174 (`model.scala:141`).
  - `grep -c panels_kind_check` → 0.
  These are exactly the "red" counts D8/task 1.1 commit to, confirmed on the untouched file before any edit.

- **`Panel.Registry` location.** `grep -n Registry backend/src/main/scala/com/helio/domain/model/Panel.scala` → `val Registry: Map[String, Companion] = Map(` at line 87. Matches the ticket's correction and design.md Context (not the spec's stale `:109`, and not the epic's wrong `domain/panels/Panel.scala` path — confirmed no `Panel.scala` exists under `backend/src/main/scala/com/helio/domain/panels/`, only `DividerPanel.scala`, `FormPanel.scala`, etc.).

- **`PanelType.Default` location.** `grep -n "val Default: PanelType" backend/src/main/scala/com/helio/domain/model/model.scala` → line 150. Matches the ticket's "Orchestrator corrections" (`:150`, not the ticket's own stale `:149` nor the spec's `:141`) — this is itself live confirmation of D2's rationale that line anchors rot in days, since even the ticket's correction differs from what I measured moments ago... no, it matches exactly. Good: design.md's decision to abandon line anchors entirely (D2) is validated by the fact that three different documents (spec, ticket body, ticket's own correction) each cite a different line number for the same symbol.

- **Every symbol design.md's Context commits the rewritten §2 to point at resolves in the live tree**, confirmed by direct grep, not by trusting the artifact:
  - `Panel.Registry`, `Panel` trait/companion — `backend/src/main/scala/com/helio/domain/model/Panel.scala` (lines 39, 83-87).
  - `PanelType`, `.fromString`, `.asString`, `.Default`, "Valid values" literal — `backend/src/main/scala/com/helio/domain/model/model.scala` (lines 133, 150, 152, 159, 162).
  - `PanelRowMapper` — exists at `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRowMapper.scala`, with a `case _ =>` fallthrough at line 48.
  - `PanelRepository.configColumnsOf` / `.configColumnValuesOf` — exist at lines 325 and 337 of `backend/src/main/scala/com/helio/infrastructure/persistence/panels/PanelRepository.scala`.
  - `PanelSpec`'s "Panel.Registry" / "PanelKind.All" hardcoded blocks — confirmed at `backend/src/test/scala/com/helio/domain/model/PanelSpec.scala` lines 58-82.
  - `check-schema-drift.mjs` parsing `PanelType.fromString` / deriving `agentFacingPanelTypes` — confirmed at lines 160, 226, 236, 282, 302.
  - `panel.ts`'s `PanelKind` union, `emptyConfigForKind`, `"form"` case — confirmed in `frontend/src/features/panels/types/panel.ts` (lines 58, 264, 271, 306, 318, 326 — 7 lines carrying the token, consistent with design.md's explicit refusal to commit to a stable count).
  - `PanelContent.tsx`'s two dispatch chains (`OutputPanelContent`, default-export fallthrough to `MetricRenderer`) — confirmed at `frontend/src/features/panels/ui/PanelContent.tsx` lines 84, 174, 300-335.
  - `PanelDetailModal.tsx`'s `activeEditorRef` / `renderSubtypeEditor` — confirmed at `frontend/src/features/panels/ui/detailModal/PanelDetailModal.tsx` lines 196, 317.
  - `V108__add_form_panel_kind.sql` — exists at `backend/src/main/resources/db/migration/`.

- **D7's scope carve-out (StaticSource anchors are a separate, pre-existing defect, not in scope here) is correct.** The spec's `StaticSource`/`DataSource.scala:145`/`InProcessPipelineEngine:509`/etc. references sit at lines 21-133, well outside §2 (which the doc's own headings bound to lines 157-175, `### 2 — Form panel` through `### 3 — Output controls`). I confirmed `StaticSource` no longer exists in `backend/src/main/scala/com/helio/domain/model/DataSource.scala` (zero grep hits) — so design.md's characterization ("HEL-1074 executed the decision; the symbol no longer exists") is accurate, and correctly excluded from this ticket's diff scope per AC-tracing (the ticket's four ACs are all about §2's registration/anchor/migration claims).

- **§2 boundaries and diff-scope plan are concrete and checkable.** tasks.md 2.2/2.3 commit to verifying the diff touches exactly one file and that every hunk falls inside the `### 2` / `### 3` heading pair — this is a real, grep-able acceptance test, not hand-waving.

- **No placeholders, TODOs, or deferred decisions** found in proposal.md/design.md/tasks.md. D1-D8 each state a decision and a rejected alternative with a reason — none are hedged or left open.

- **Scope discipline vs. the concurrent HEL-1085 lane** is explicit and correctly reasoned: docs-only change, zero `frontend/` touch, no dev servers, no Playwright — consistent with the run's hard constraints and this gate's own instructions.

### Acceptance criteria traced against the plan

1. "§2 no longer claims registration is the only enumeration" → task 1.2, verified via zero-hit grep. Sound.
2. "Anchors are correct or symbol-based" → task 1.5 + D2, verified via a `sed`-scoped regex for any `:[0-9]+` inside §2. Sound; I independently confirmed all cited symbols resolve.
3. "Migration requirement is stated" → task 1.4, D5, verified via `panels_kind_check` + `V108` grep. Sound; V108 confirmed to exist and be the correct precedent.
4. "A reader arrives at the full drift surface or is told to re-derive it" → D3/D4, task 1.3: a dated, labelled-non-authoritative snapshot plus a concrete re-derive recipe (grep `divider` across four layers). I sanity-checked the recipe's viability: `grep -rl '"divider"\|Divider' backend/src/main frontend/src schemas helio-mcp/src` returns 50 files — a real, non-trivial hit set a reader would need to triage, which matches the spirit of "re-derive, don't trust a stale list."

### Verdict: CONFIRM

The design is grounded in fresh, independently-reproduced tree evidence (not inherited from the ticket's or the orchestrator's claims), every cited symbol resolves, the scope carve-outs (D7, HEL-1085 non-overlap) are correctly justified, and each task has a concrete, mechanically-checkable verification step tied to a real grep/sed probe rather than an assertion. No contradictions between proposal/design/tasks, no scope drift beyond the ticket's four ACs, no missing contract updates (none needed — `skip_specs: true` is correct for a docs-only, no-behavior-change edit).

### Non-blocking notes

- `tasks.md` ends with a "## Standing Constraints" heading and no content beneath it. Harmless (likely a template artifact) but worth trimming or filling during execution so it doesn't look like a dropped section to a future reader.
- Design.md's own aside under D2 flags line-number rot as the *reason* for symbol anchors; ground truth here makes that argument unusually strong — the ticket itself, the spec, and the orchestrator's own correction each stated a different line number for `PanelType.Default` within the same investigation window. Nothing to change; noted because it's a clean, real-world vindication of the decision.
