## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed: ticket.md, proposal.md, design.md, tasks.md, all checked against worktree HEAD bcde936d5e09f22fc0150fba603f70c3065866f6 (= origin/main; the change dir is untracked). I read round 1's skeptic-design-1.md as a claim to check, not as a fact.

### What I verified (with evidence)

I built a new simulation of the **revised** plan, covering both D1 and D2, inside a full copy of `frontend/src` taken at bcde936d. It lives in `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/skeptic-design-sim-r2/`. `build2.py` is the script. `repo/` is the copy, which uses the worktree's `eslint.config.cjs`, `prettier.config.cjs`, `tsconfig.json` and `jest.config.cjs`, plus symlinked node_modules (eslint-plugin-react-hooks 7.0.1). I made no worktree edits.

- **CR1 fix is applied consistently in the artifacts.**
  - D2d's body is now L220-314. The host bullet no longer keeps the keydown effect.
  - D3's host remnant is L316-588 minus L559.
  - D3b says the effect sits inside (d).
  - tasks 2.4 matches.
  - D2d now states the general rule: no verbatim host code may keep a deps array that names a hook-returned identifier.
- **CR1 holds against the source.** Base L298-314 has deps `[modalMode]` and calls `setModalMode`. L293-297 are a blank line and a comment, so no hook call sits between L292 and L298. Moving the effect keeps the hook order unchanged. The moved body L220-314 uses only `panel`, `initialMode`, `buildInitialChart`, `clampTransparency`, the `is*Panel` guards, `PanelEditorHandle` and `RefObject`. It does not use the host's `dispatch`, `theme` or `navigate`, and it does not use any handler defined later. So it compiles inside the hook with no token change.
- **The round-1 defect is real, and the revised plan fixes it.** Both reproduced in the r2 sim.
  - Mutant: I re-inserted the effect into the simulated host. ESLint reported `react-hooks/exhaustive-deps` "missing dependency: 'setModalMode'" and exited 1.
  - Restored, per the revised plan: exit 0.
- **The full revised split is lint-clean and typecheck-clean.**
  - `eslint --max-warnings=0 src/features/panels` exited 0.
  - `tsc --noEmit` over the whole frontend exited 0. Round 1 did not run tsc.
  - The baseline copy was also tsc 0 and lint 0 before the split.
- **Byte-identity spot checks.**
  - The `usePanelDetailEditState` body after prettier `diff`s identical to base L220-314 (BODY_IDENTICAL).
  - Host handlers L316-377 match by sha256 after whitespace stripping (HANDLERS_IDENTICAL).
  - The host keeps no direct `useState/useEffect/useMemo/useCallback/useRef` call; grep found zero. Only `useAppDispatch`, `useTheme`, `usePanelDetailData`, `useNavigate` and `usePanelDetailEditState` remain, in base order.
- **Line counts after prettier, all under 400.**

  | File | Lines |
  |---|---|
  | `PanelDetailModal.tsx` | 336 |
  | `usePanelDetailEditState.ts` | 143 |
  | `usePanelDetailData.ts` | 95 |
  | `OutputPanelSection.tsx` | 85 |
  | `renderSubtypeEditor.tsx` | 76 |
  | `panelDetailChartState.ts` | 25 |
  | `PanelContent.tsx` | 254 |
  | `OutputPanelContent.tsx` | 293 |

- **Other verbatim code whose lint, typecheck or deps behaviour could change.** I found none beyond CR1.
  - **Host:** no deps-array hook is left after the effect moves.
  - **The `resetFormToPanel` `eslint-disable-next-line react-hooks/exhaustive-deps`:** it still suppresses a real warning (`activeEditorRef`) inside the hook, so it does not become an unused directive. Lint exit 0 confirms this.
  - **`usePanelDetailData`:** every deps array (`[controls, controlValues]`, `[controls]`, `[outputIdForControls]`) names hook-local values only.
  - **`OutputPanelContent`:** it moves as a whole function with its hooks and props, so nothing in it changes.
  - **The react-hooks v7 compiler rules (`refs` and others):** they accept passing hook-returned ref objects into `renderSubtypeEditor({...})` during render (lint 0).
- **Tests are unchanged and green on the simulated split.**
  - `src/features/panels`: 158/160 suites, 1553/1555 tests pass. The 2 failures are `controlFitnessDriftGuard.test.ts` and `outputControlEligibilityDriftGuard.test.ts`, which throw "Could not locate repo root (no ancestor directory contains 'backend')". That is a sim-copy artifact, because the copy has no `backend/`. The split does not cause it.
  - 12 consumer suites outside panels pass (PublicDashboardViewerPage.\*, OutputEditorSheet.kindLock, panelActionsAccessibleName, rawElementGuardHel440, among others).
  - `src/test`, `src/theme` and `src/shared` guards: 73/73 suites pass.
  - No test reads `PanelContent.tsx` or `PanelDetailModal.tsx` source text via fs. The only hits are comments in `TableRenderer.test.tsx:1028` and `PanelCard.filterEmptyState.test.tsx:5`, which D4 already lists as follow-ups.
- **D1 CSS order.**
  - Only three renderer modules carry side-effect CSS: `CollectionRenderer.css`, `TableRenderer.css` and `TimelineRenderer.css`.
  - All three move together into `OutputPanelContent.tsx`, and their relative order stays the same.
  - The live light/dark comparison remains the backstop.

### Verdict: CONFIRM

### Non-blocking notes

1. **D1's wording overstates what lint catches.** D1 says "Each file imports exactly what it uses, so lint has no unused imports". Lint does not check this at all.
   - `eslint.config.cjs` spreads `...tseslint.configs.recommended.rules`, but `tseslint.configs.recommended` is an array, so `.rules` is `undefined`. I confirmed it with `node -e`.
   - `--print-config` shows zero `@typescript-eslint/*` rules active, and `no-unused-vars` is `0`.
   - A mutant unused value import in `PanelContent.tsx` linted exit 0.

   The executor should verify unused imports with a one-off `tsc --noEmit --noUnusedLocals`, filtered to the 8 touched files. My sim is clean under that check. Leftover dead renderer imports would also keep stale side-effect evaluation order. The config gap itself is pre-existing and out of scope, so it is a follow-up candidate.
2. **D3's host-remnant list omits L218** (`const navigate = useNavigate();`) and the closing L589. Both stay in the host verbatim and should be part of the comparison.
3. **D3b's base range "L163-298"** now reads better as L163-314, since the effect is inside (d). Either range covers the same hook calls.

### Evidence

- `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/skeptic-design-sim-r2/build2.py`: the revised-plan simulation.
- `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/skeptic-design-sim-r2/repo/frontend/src/features/panels/ui/`: the simulated split files, prettier-formatted.
- The round-1 simulation is in `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/skeptic-design-sim/`, unchanged.
