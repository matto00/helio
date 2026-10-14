## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `e38be75b133a714f76057d6d5e5a0926af5c5317`; base resolved live with `resolve-review-base.sh` = `273c0b0c9c884a17210f58db811a3bb02718415d` (exit 0).

### What I verified (with evidence)

- **Spawn-cwd guard:** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/stale-specs-dead-text-path/HEL-1466`.
- **Diff scope:** `git diff BASE...HEAD --stat` touches CLAUDE.md (+2/-2), TextRenderer.tsx, PanelContent.tsx (one line), PanelContent.test.tsx, two backend test specs (test-only), and the change dir. No production backend, schema or CSS changes.
- **AC 3 (code): the dead path is really dead.** I traced it myself:
  - `usePanelData.ts` returns `data: null` in both of its result objects (lines 338 and 367). The other two `return {` sites (408, 419) are in a query helper, not the hook result.
  - PanelCard (113), the sole `usePanelData` caller, passes `panelData.data` down to PanelCardBody, PanelFullscreenOverlay and PanelDetailModal.
  - `PublicDashboardViewerPage` passes no `data`.
  - So no production path supplies non-null `data` to a text panel. Removing it changes no runtime behaviour, which confirms "no user-visible change". TextRenderer now has only `content` (`content ?? null`), and its only caller is `PanelContent.tsx:237`.
- **Guard test, re-run by me.** `npm --prefix frontend test -- --testPathPatterns=PanelContent` passed 7 suites / 70 tests, exit 0.
  - I did not re-run the mutation (read-only role). Reasoning instead: under the mutation, `data?.content ?? content` with `data={{content:"BOUND"}}` yields "BOUND", so `toHaveTextContent("LITERAL")` must fail.
  - evidence.md records exactly that red output. The guard is failable.
- **Frontend gates (mine):** `tsc --noEmit` exit 0. `eslint --max-warnings=0` on the 3 changed files exit 0. `prettier --check` on those files plus CLAUDE.md exit 0.
- **Backend (mine):** `sbt testOnly PanelContentOwnershipSpec DashboardApplyProposalConfigSpec` (Xmx3g, nice 19) passed 9/9, exit 0. These tests pin the markdown-panel delta's claims against the real route tree:
  - markdown content lives in `config.content`, with no top-level `content`
  - the content survives a round-trip through export
  - PATCH: absent leaves it unchanged, `null` clears it to `""`
  - text keeps its own content
  - a stray `content` key on image/output/divider is dropped; on form create it is rejected with 400; on update it is ignored
  - the proposal config passthrough carries markdown/text content and image fields
- **AC 1/2/3-spec/5 deltas:** `openspec validate remove-stale-bound-content-specs --type change --strict` reports valid.
  - Every REMOVED/MODIFIED header matches the main spec byte-for-byte (`grep -cxF` = 1 each), and ADDED headers are new (0 each).
  - I ran a real `openspec archive -y` on a scratch copy of `openspec/`. It applied +4 ~3 -4 cleanly, and I read the resulting spec diffs in full. The stale text is gone:
    - collection "bound to the DataType"
    - "source-companion DataType id"
    - the v1.5 seven-type set
    - top-level `content`
    - `text` in the null-content list
    - the "bound data" text-sizing scenarios
- **Delta facts spot-checked against code:**
  - `helio-mcp/src/tools/proposal.ts:45` PANEL_TYPES = text/markdown/image/output/form, which matches the delta and the ticket's `form` correction.
  - The panel-content-sizing values match the theme.css/PanelContent.css excerpts quoted in evidence.md.
  - The panel-cross-filtering quotes appear verbatim in the main spec: the header is line 46 and the target-panel definition is line 47 (`grep -n` on the exact strings). AC item 5 is met.
- **AC 4:** root `package.json:62` `"test": "jest && npm --prefix frontend test"` supports the mechanism. The evidence records 51 root suites + 596 frontend suites for the root form vs 3 suites for the prefix form. I did not repeat the full-suite run.
  - The mechanism is deterministic: npm appends extra args after the whole script, so the inner `npm` consumes them.
  - I did confirm the prefix form narrows (my run above: `jest ... --testPathPatterns=PanelContent`, 7 suites).
  - Only the CLAUDE.md doc lines changed; the script is untouched.
- **AC "re-derived against current tree":** the design's premise section records that all five items are present, with the `form` correction applied.

### Verdict: CONFIRM

### Non-blocking notes
- `openspec/specs/panel-type-rendering/spec.md` still has a "Bound text panel renders live content" scenario, plus the other stale typeId scenarios. It is out of the ticket's named scope, and the design lists it as a follow-up the orchestrator must actually file at Delivery.
- There is a stray comma in the panel-content-sizing REMOVED Migration line ("font-size, and skeleton-radius"), as the evaluator also noted.
- Archiving moves "Text panel sizing for literal content" to the end of panel-content-sizing/spec.md and inserts two blank lines near the top. This is a cosmetic openspec artifact.
- No UI review was performed: there are no CSS/markup changes and no reachable behaviour change (`data` is always null).
