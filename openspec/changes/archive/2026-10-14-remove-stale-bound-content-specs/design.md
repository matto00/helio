## Context

See proposal.md (Why) and ticket.md. Premise re-derived on 2026-10-14 against main 273c0b0c9
(`.concertino/runs/HEL-1466/evidence/premise-validation.md` in the main checkout): all five items are still present.
One ticket claim is itself stale: the agent-facing proposal set is `text/markdown/image/output/form`
(`helio-mcp/src/tools/proposal.ts` `PANEL_TYPES`; `schemas/dashboards/dashboard-proposal.schema.json` `ProposalPanel.type`),
not `text/markdown/image/output` — `form` was added by HEL-1148. The deltas use the five-member set.

Code facts the deltas rest on (each re-verified by the executor, task group 1):
- Panel requests/responses carry a typed `config`; there is no top-level `content` (`PanelProtocol.scala`
  `CreatePanelRequest`/`UpdatePanelRequest`; `schemas/panels/panel.schema.json` top-level properties).
- `TextConfig` and `MarkdownConfig` each have `content`; `ImageConfig`/`OutputConfig`/`DividerConfig`/`FormConfig` do not.
- Markdown/Text `Patch`: absent `content` leaves it unchanged; `null` clears it to `""` (`MarkdownPanel.scala`
  `Patch.decode` `case Some(JsNull) => Some("")`; `TextPanel.scala` same). Stored content is never null.
- Per-kind decoders differ on an unknown `content` key: image/divider/output decoders read only their own keys (dropped);
  `FormPanelConfig` is a closed attribute set (`FormPanel.scala` `AllowedKeys`), so a form CREATE with `content` is a
  400, while form PATCH ignores it. The delta states only the shared invariant (never stored) plus the two probed cases.
- Proposal `mergeConfig` re-applies the flat `outputId` after the passthrough merge; `withSourceBinding` does the same
  for `dataSourceId` (`ProposalPanelSupport.scala`).
- `TextRenderer` reads `data?.content ?? content`; its only caller is `PanelContent.tsx` (`isTextPanel` branch).

## Goals / Non-Goals

**Goals:** correct exactly the stale statements the ticket names, through deltas `openspec validate --strict` accepts;
remove the dead bound text path with a mutation-failable guard; fix the single-file test command documentation.

**Non-Goals:** the other stale requirements in `mcp-panel-composition-tools` (create-panel-request `collection`,
timeline flat fields, `metricId`) and `panel-type-rendering` (every `typeId`-based metric/chart/table/text scenario) —
a whole-spec rewrite is a different ticket. The orchestrator triages this as a follow-up at Delivery.

## Decisions

D1. Delta shape. `openspec validate` rejects a MODIFIED block that drops a current scenario. So a requirement whose
stale scenario must go is REMOVED (with Reason/Migration) and re-ADDED under a new name — the pattern HEL-1405 used
(`openspec/changes/archive/2026-10-09-markdown-spec-literal-content/design.md` D1). Applied to: `Text panel sizing`,
`propose_dashboard exposes the v1.5 panel type set`, `Proposal panels accept a generic config passthrough`,
`Non-markdown panels have null content`. Requirements whose scenario names survive are MODIFIED: markdown-panel
requirements 1–2 and the `panel-cross-filtering` markdown requirement. Alternative (MODIFIED keeping the stale
scenarios verbatim) rejected: it re-asserts the exact false claims the ticket exists to remove.

D2. Item 5: the markdown requirement now quotes the narrowing requirement's header and its target-panel definition
verbatim (inside quotation marks), so a reader can grep the quoted text and land on the defining requirement.

D3. Item 3 code: delete the `data` prop and the `MappedPanelData` import from `TextRenderer`; render
`content ?? null`; drop `data={data}` at the `PanelContent.tsx` call site. Before deleting, the executor proves the
path dead (no code path supplies non-null row data to a text panel) or, if it cannot, records that the removal
changes behaviour for that case — either way the ticket asks for removal. Guard: a test renders a `text` panel through
`PanelContent` with `config.content: "LITERAL"` AND a non-null `data` whose `content` is `"BOUND"`, asserting
`LITERAL` is shown and `BOUND` is absent. Mutation proof: restoring `data?.content ??` (and the prop pass-through)
turns it red; the red run's output is recorded in evidence.md. Existing tests asserting the bound path are deleted,
not rewritten to pass.

D4. Item 4: verify first. Expected mechanism: the root script is `jest && npm --prefix frontend test`
(`package.json`), npm appends extra args to the end of the whole script, and the inner `npm ... test` receives
`--testPathPatterns=X` with no `--`, so npm consumes it as its own config and the frontend Jest never sees it. The
executor proves this with a real run of the root form (count of suites/tests executed vs the prefix form). If
confirmed, fix the **doc**, not the script: CLAUDE.md's "Run a single test file" command becomes the form that
narrows from the root (`npm --prefix frontend test -- --testPathPatterns=dashboardsSlice`), with the `frontend/`
alternative noted. The script is the pre-commit hook's and CI's entry point; changing its argument handling is a
larger blast radius than this Low ticket warrants. Only those CLAUDE.md lines change.

D5. Evidence. Every factual claim in each delta gets a verification command and its output in `evidence.md` in the
change directory (standing constraint C1).

## Risks / Trade-offs

- [A delta claim is subtly false (e.g. PATCH of `content` on an image panel is 400, not ignored)] → task 1.x verifies
  each claim; the executor amends the delta wording to match ground truth and records the probe. Never the reverse.
- [REMOVED/ADDED header mismatch aborts archive] → headers copied byte-exact; `openspec validate --strict` gate.
- [Item 4 probe runs the full root+frontend suite] → run once, `nice -n 19`, `HELIO_JEST_MAX_WORKERS=3`.
- [panel-type-rendering keeps a "Bound text panel renders live content" scenario after the code is removed] →
  known, pre-existing family of stale `typeId` scenarios in that spec (Non-Goals); named in the follow-up.

## Planner Notes

Design gate round 1 (REFUTE, skeptic-design-1.md) addressed: PATCH `null` clears to `""` (requirement text, new
scenario, code-fact bullet, task 1.1 split into absent vs null probes); round-trip scenario names
`GET /api/dashboards/:id/export`; the follow-up will name `panel-type-rendering/spec.md` "Bound text panel renders
live content" explicitly.

Design gate round 2 (REFUTE, skeptic-design-2.md) addressed: per-type `content` handling (form create 400) in the
markdown-panel ADDED requirement + code fact + task 1.1 probing all four types on create and update; dropped the
stale `create_panel` parity clause (that tool was removed; `create_content_panel` offers divider) in favour of the
`AGENT_SURFACE_EXCLUSIONS` reason; "valid, caller-owned `outputId`".

Self-approved: doc-not-script for item 4 (D4); REMOVED+ADDED shape (D1); `form` included in the type set (premise
correction). No user-visible change; no escalation needed.
