## 1. Baseline on the running app (BEFORE any edit)

- [ ] 1.1 Start the dev server on DEV_PORT 5873 / BACKEND_PORT 8780 and capture BEFORE evidence via Playwright MCP in BOTH themes, covering every AC surface and every judgment call: the two spinners (`Spinner` primitive and pipeline run), the auth card entrance, **Popover** (named in AC2), Modal open AND close, Toast enter AND exit, **MobileNavSheet** and **RefinementChatDrawer** (the D7 surfaces), **OnboardingChecklist**, and a panel drag/resize. Save to `.concertino/runs/HEL-441/evidence/`
- [ ] 1.1a Name and use a concrete mechanism to reach the `pipeline-run-spin` state (trigger a real pipeline run, or force the running state via store/devtools) — task 5.2's judgment cannot be made without it, and a task with no mechanism reliably becomes a checked box
- [x] 1.2 Record the baseline gates: `npm run lint`, `npm run typecheck`, `npx jest` from `frontend/` — paste counts (do NOT use root `npm test`; its `jest --passWithNoTests` leg finds nothing at a worktree root and turns silence into a pass)
- [x] 1.3 Confirm the guard's RED arm is reachable BEFORE the guard exists: add a throwaway ad-hoc duration to a real component, confirm nothing currently catches it, then revert

### Frontend

## 2. Tokens (design D1)

- [x] 2.1 Add ONLY `--app-spin-duration: 0.7s` to `frontend/src/theme/theme.css`; do NOT change the values of `--app-transition` or `--transition-slow` (51 surfaces depend on them — re-timing them is a redesign, not a consolidation)
- [x] 2.2 D1 REVISED — **leave `--toast-exit-duration` exactly as it is.** Its `.toast` scoping is deliberate (HEL-535 D4: the self-documenting counterpart of `Toast.tsx`'s `TOAST_EXIT_MS`), it has one consumer, and `shared/ui/toast.css.test.ts:91` asserts it BY NAME — promoting it would force that assertion to be edited, i.e. a test changed in shape to pass. Verify `toast.css.test.ts` passes UNMODIFIED

## 3. Apply (designs D2/D3/D4)

- [x] 3.1 D2 — `shared/ui/Spinner.css` and `features/pipelines/ui/PipelineDetailPage.css` both use `var(--app-spin-duration)`; the pipeline spinner speeds up 0.8s -> 0.7s
- [x] 3.2 D3 — `features/auth/ui/auth.css`'s `auth-card-in` uses `var(--transition-slow)`, dropping the literal `0.45s cubic-bezier(0.3, 0.9, 0.4, 1)` whose curve already duplicates the token
- [x] 3.3 D4 REVISED — **make NO change to `PanelGrid.css`.** (Spinoff: **HEL-1032**.) Folding 180ms to 160ms would widen the layout-motion spread, not narrow it: `react-grid-layout/css/styles.css` (imported at `DesktopPanelGrid.tsx:26`) contributes 200ms item/container and 100ms `.react-grid-placeholder` durations that no `frontend/src` text carries. Verify those vendor values yourself, then RECORD the 180/100/200 spread as a finding in `files-modified.md` for **HEL-1032** — do not absorb it (HEL-1023 owns that subsystem)
- [x] 3.4 Do NOT change `MobileNavSheet` or `RefinementChatDrawer` — design D7 rules their backdrop+panel pair ONE entrance, deliberately

## 4. Guard (design D5)

- [x] 4.1 Add a motion guard alongside `frontend/src/theme/tokenAuditSweep.css.test.ts`: no `transition:`/`animation:` may carry a literal duration EXCEPT (a) inside a `prefers-reduced-motion` block, (b) on the commented single-use-loop allowlist (`streaming-text-blink`, `pipeline-run-pulse`), or (c) `PanelGrid.css`'s three `180ms` transition literals, pinned to those exact declarations and annotated with HEL-1032 as the ticket that removes them. WITHOUT (c) the guard goes RED on day one, because D4-REVISED deliberately leaves those literals in place — do not discover this at implementation time and paper over it. Parse multi-line declarations — a line-oriented grep truncates these and reports garbage
- [x] 4.2 Mutation-prove the guard in THREE directions: adding an ad-hoc duration to a real component -> RED; removing an exception entry -> RED; a STALE exception entry matching NOTHING in the tree — keyframe OR `transition:` shorthand — -> RED. The stale arm MUST cover shorthands, not just keyframes, or exception (c) survives forever once HEL-1032 removes PanelGrid's literals. The allowlist pins keyframe name AND exact duration, not name alone. Paste all three transcripts. Label it a guard
- [x] 4.3 Verify the guard actually scans what you think: confirm the file count it walks matches the 110 CSS files present, and state explicitly what it does with a CSS file containing ZERO motion declarations — otherwise "110 files walked" is a count that passes vacuously
- [x] 4.3a Record the EXPECTED post-change literal inventory (which literals remain, in which files, under which exception) so the guard's exception set is auditable against a stated list rather than whatever happens to make it green

## 5. Judge the running app (design D6/D7/D8 — the actual deliverable)

- [ ] 5.1 AFTER evidence in BOTH themes for every surface captured in 1.1; compare against the before-shots directly
- [x] 5.2 D2/D3 judgment calls: does the pipeline spinner at 0.7s and the auth card at 0.28s look RIGHT, not merely consistent? If either reads worse, REPORT it — do not silently keep two speeds or invent a third duration
- [x] 5.3 D4 REVISED: nothing changes in PanelGrid, so there is no regression to check — instead, OBSERVE the existing 180/100/200 layout-motion spread during a real drag/resize and describe how it reads, as evidence for **HEL-1032**
- [ ] 5.4 D6.1 — look for motion that NO SOURCE TEXT CARRIES: a surface that does not animate where its siblings do. A grep cannot find this; only the running app can
- [x] 5.4a OBSERVE (do not change) the chart-panel entrance: confirm it runs at echarts' ~1000ms default and that `ChartPanel.tsx:452`'s `notMerge={true}` replays it on an option/data change. Record the observation as evidence for **HEL-1034**, which owns the fix — re-timing the app's most numerous animated surface is out of scope here
- [ ] 5.5 D6.2 — vary STATE, not just rendering: check EMPTY, LOADING, ERROR and FIRST-PAINT, specifically the skeleton-to-content swap, toast enter AND exit, and modal open AND close
- [x] 5.6 D8 — note whether entrances were observed under `React.StrictMode` (`main.tsx:58`), and confirm any entrance-under-test in a PRODUCTION build via a named mechanism: `npm run build` then preview on a free port (not 5873/8780), since StrictMode's double-invoked effects can re-fire a mount-triggered entrance and make a dev observation vacuous
- [x] 5.7 Confirm `prefers-reduced-motion: reduce` still suppresses every touched animation (the global rule already exists — verify, do not extend it; HEL-538 owns that surface)

## 6. Docs and gates

- [x] 6.1 Update `DESIGN.md`'s `### Radius / Shadow / Motion` with THREE things: (a) the one new token `--app-spin-duration`; (b) D1's governing rule — a single-use loop may carry its own literal, a loop role used by two or more surfaces needs a token; (c) D7's ruling, in one sentence, that a backdrop fade plus its panel rise is ONE entrance, naming `MobileNavSheet` and `RefinementChatDrawer` as the reference implementations, so a later HEL-442/444 reviewer does not remove a backdrop fade the app depends on
- [x] 6.1a Also record in `DESIGN.md` that exit motion is deliberately component-scoped (`--toast-exit-duration` in `toast.css`, paired with `Toast.tsx`'s `TOAST_EXIT_MS`), so the next reviewer does not "promote" it and break its guard
- [x] 6.2 `npm run lint`, `npm run typecheck`, `npx jest` from `frontend/` all green with ZERO new warnings; paste counts against 1.2's baseline
- [x] 6.3 Screenshots land in `.concertino/runs/HEL-441/evidence/`; never `git add -f` past `.gitignore`

## 7. Delivery

- [ ] 7.1 Rebase onto latest `main`; re-run 6.2 and re-check the visual comparison if frontend files moved
- [ ] 7.2 PR body states the five motion categories, the ONE token added and why only one, the judgment calls (D2/D3) with their running-app verdicts, D4's reversal and why folding 180ms would have WIDENED the spread (with HEL-1032 owning it), and D7's one-entrance ruling
