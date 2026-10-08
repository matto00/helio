## Standing Constraints

- [C1] Behaviour-preserving split only: moved code byte-identical modulo leading indentation (D3); any bug found is a follow-up listed in the report, never fixed here (HEL-1380 untouched).
- [C2] Existing PanelCard/PanelCardBody suites change only in import paths (plus the D5 comment); render-count tests unchanged.
- [C3] Commits stay separated: pure move, comment touch-ups, test comment, spec Purpose edit; no code change for item 3.
- [C4] Never pkill/pgrep/killall; never HUSKY=0 or `commit -n` without disclosure; no root `jest --coverage`; cap workers at 3-4 with `nice -n 19`; use `git -C <path>`, never cd.
- [C6] Moved-block identity is proven with ALL whitespace removed (`tr -d '[:space:]'`) against the base ranges; any non-identical block is a defect.
- [C5] UI checks log in as a fresh own test user (never matt@helio.dev; the Playwright browser is shared across lanes); record any dev-DB residue by exact id.

### Frontend

## 1. Pure move (Commit 1)

- [x] 1.1 Create `PanelCardBody.tsx` with L76-105, L126-130, L132-372 verbatim; verify D3 diff empty
- [x] 1.2 Create `controlResultCountText.ts` with L107-124 verbatim (exported); verify D3 diff empty
- [x] 1.3 Create `hooks/usePanelCardInspect.ts` (`(panel, outputId, panelData)`) with L449-545 verbatim as the body; verify D3 identical
- [x] 1.4 Create `PanelCardHeader.tsx` with L604-727 verbatim (props named per D1); verify D3 diff empty
- [x] 1.5 Reduce `PanelCard.tsx` to the host calling the hook at the same position; verify `wc -l` < 400 for all five files
- [x] 1.6 Update importers (MobilePanelStack, test imports) path-only; verify `git diff` on tests shows import lines only
- [x] 1.7 Persist the D3 byte-identity transcript as evidence; verify every block's normalised diff is empty

## 2. Comment touch-ups (Commit 2)

- [x] 2.1 Run the D4 grep, record every hit as fixed/still-correct in the report, fix the wrong ones; verify the diff changes comment text only

## 3. Test comment (Commit 3)

- [x] 3.1 Rewrite the false "genuinely SETTLED baseline" comment (D5); verify no code token changed in the test

## 4. Spec Purpose and item 3

- [x] 4.1 Rewrite `openspec/specs/chart-type-selector/spec.md` `## Purpose` (D6); verify `grep -c "selector appears"` is 0
- [x] 4.2 Record D7 evidence (cited lines + live aggregated vs scatter Inspect column order) in the report; no code change

### Tests

## 5. Tests and gates

- [x] 5.1 Run `npm run lint`, `npm run typecheck`, `npm run format:check`, and the panels + grid + rawElementGuard suites; verify zero new warnings
- [x] 5.2 Run the full frontend `npm test` (no coverage) and verify green
- [ ] 5.3 Light + dark screenshots of a panel card (normal, title-edit, delete-confirm header states) on base vs branch; verify identical
