## 1. Docs — rewrite §2 of the v0.8 design spec

- [x] 1.1 Record pre-edit positive controls on the untouched file (D8): `grep -c "only enumeration to change"` = 1, `grep -cE 'Panel\.scala:109|model\.scala:141'` = 2, `grep -c panels_kind_check` = 0; paste the output into `files-modified.md`'s verification section
- [x] 1.2 Rewrite §2's first paragraph in place (D1/D2): registration is one hand-enumerated site among many; `Panel.Registry` anchored by symbol + `backend/src/main/scala/com/helio/domain/model/Panel.scala`, no `:NNN`; verify `grep -c "only enumeration"` = 0
- [x] 1.3 Add a "Drift surface for a new panel kind" subsection (D3/D4): layer-grouped, symbol-anchored snapshot labelled "as of HEL-1083/HEL-1084, 2026-09-17 — not authoritative"; the silent-degradation sites and the two gates that fire, from design.md Context; the `divider`-token re-derive recipe; verify every symbol named resolves via `grep -rq` over `backend/src frontend/src schemas helio-mcp/src` (loop, all exit 0, output recorded)
- [x] 1.4 Add the migration requirement (D5): `panels_kind_check` drop/re-add, V108 precedent, config column in the same migration; verify `grep -c panels_kind_check` ≥ 1 and `V108` appears by name
- [x] 1.5 Fix the `PanelType.Default` sentence (symbol + `.../domain/model/model.scala`, no line) and the "second panel kind after `divider`" sentence (D6); verify `sed -n '/^### 2 — Form panel/,/^### 3 —/p' <file> | grep -cE ':[0-9]+`'` = 0
- [x] 1.6 Add the single dated provenance parenthetical (D1) and verify no "Correction" blockquote was appended under the old claim (the old sentence must be gone, per 1.2)
- [x] 1.7 Format the one file with the repo's Prettier config from the worktree root (`npx prettier --write docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md`) and verify `npx prettier --check` on it exits 0

## 2. Tests — verification of a prose change

- [x] 2.1 Re-run every probe from 1.1–1.5 on the edited file and record before/after counts in `openspec/changes/correct-writeback-spec-enumeration/files-modified.md` (the pre-edit counts are the red; the post-edit counts are the green)
- [x] 2.2 Verify the source diff touches exactly one file: `git diff --stat main...HEAD -- . ':!openspec'` lists only the spec
- [x] 2.3 Verify no section outside §2 changed (D7): every `@@` hunk in `git diff main...HEAD -- docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` falls between the `### 2 — Form panel` and `### 3 —` headings
- [x] 2.4 Commit with a 600000 ms tool timeout (the Husky chain runs in full on a docs diff); never re-run a commit mid-hook; no dev servers, no Playwright (D8)

## Standing Constraints
