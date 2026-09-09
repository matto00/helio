## 1. Baseline and provenance (BEFORE any edit)

- [x] 1.1 Start the dev server (DEV 5876 / BACKEND 8783). **Prove provenance before recording anything visual**: confirm the listener's `/proc/<pid>/cwd` is THIS worktree (`ss -lptn`) AND `curl` the dev server for a string unique to this branch, absent on `main`. Vite auto-increments when a port is taken, so a port number alone is NOT provenance
- [x] 1.2 Baseline gates: `npm run lint`, `npm run typecheck`, `npx jest` from `frontend/` — paste counts. NOT root `npm test`
- [x] 1.3 Prove the guard's RED arm is reachable BEFORE it exists: temporarily move a token so it is defined only in the dark block, confirm `check:tokens` and the full suite BOTH still pass (they will — HEL-1037 checks resolve-anywhere), then revert. This is what establishes the gap is real and unprotected

### Frontend

## 2. The per-theme coverage guard (design D1/D2)

- [x] 2.1 Add a guard asserting every `--app-*` token defined in either theme block is defined in BOTH. Zero violations exist today, so it is pure protection
- [x] 2.2 **Put the HEL-1037 distinction in the guard's own header comment**: `scripts/check-tokens.mjs` validates a `var(--*)` resolves ANYWHERE in the scanned set, so a dark-only token passes it; this guard checks "defined in both theme blocks". Without this, the next reader closes it as duplicative
- [x] 2.3 Any exception pinned to exact file + declaration + count, never a per-file or pattern allowance, and demonstrably able to EXPIRE (HEL-442's construction). Do NOT reintroduce HEL-1045's whole-declaration-match hole
- [x] 2.4 Mutation-prove: a token defined in only one theme block -> RED; a stale exception matching nothing -> RED. Paste transcripts. Label it a guard
- [x] 2.5 Confirm what the guard actually scans, and what it does with a theme block containing zero tokens, so the count is not a vacuous pass

## 3. Analytic matrix (design D3 — discharges the 8x without walking it 8 times)

- [x] 3.1 Compute the accent x surface matrix for all 8 presets x 5 surface tokens x 2 themes. **Parse the eight preset hexes from `frontend/src/theme/theme.ts` (`ACCENT_PRESETS`) and the surfaces from `theme.css`** — the presets do NOT live in `theme.css`, and `theme.css`'s own `--app-accent` defaults never render (see D5). Never transcribe. Record pairings below 4.5:1 (normal text) AND below 3:1 (non-text/large) — expect four presets failing 3:1 outright in light
- [x] 3.1a Re-derive D4's adversarial pair from THIS matrix rather than carrying forward earlier numbers: Purple (thinnest ink margin) and Yellow (worst accent-on-surface). Confirm Yellow's light minimum independently
- [x] 3.2 State the ink-selection group as covered analytically, citing `buildAccentTokens` (`theme/appearance.ts`, symbol not line — the old `305-326` is dead): `buildAccentTokens` picks the higher-contrast fixed ink against the accent, theme not an input. Assert once for all 8; do NOT re-walk it per preset
- [x] 3.2a **Do NOT extend that proof to the SECOND ink site** at `resolvePanelTextColor` (`theme/appearance.ts`, symbol not line — the old `255-265` is dead) (D3a): it picks text against an ARBITRARY user-chosen surface, applies its own 4.5:1 check, and IS theme-aware. Exercise it in the walk with a custom panel/dashboard colour in both themes, or record explicitly that it was not reached
- [x] 3.3 **Do NOT report the matrix's sub-4.5 count as a defect count.** A saturated accent is inherently low-contrast on light surfaces; it is a defect only where the accent colours normal-size text (task 4.2)

## 4. The running-app walk (design D4/D5/D6 — the genuine work)

- [x] 4.1 Walk every top-level surface in BOTH themes: Dashboards + PanelGrid, Sources, Pipelines, Proposal Review, auth pages, all modals/popovers/toasts, mobile shell. Per-surface recorded result (confirmed / mismatched / unreachable); an unreachable surface is REPORTED, never skipped
- [x] 4.2 **Resolve D5 by COMPUTED STYLE per-surface, not from the grep count.** A computed-style sweep of Dashboards in light theme found ZERO elements rendering the accent colour, so the 41 static sites concentrate elsewhere (20 are in `PipelineDetailPage.css`). For each surface walked, enumerate the elements ACTUALLY rendering `--app-accent` as `color` or as a border/outline, and record which surface each was observed on. Classify each as normal-size text (4.5:1) vs large/non-text (3:1). **The rendered light accent is `#f97316` at 2.38-2.80, which fails BOTH thresholds** — so borders count as findings too. A purely static classification would report sites the walk never saw. **Do not retune the accent** — an 8-preset visual-identity decision belongs to the owner
- [x] 4.3 Walk two presets end-to-end, chosen adversarially (D4): **Purple** (#a855f7, thinnest ink 4.60) and **Yellow** (#eab308, worst accent-on-surface 1.63:1 on light `--app-surface-soft`)
- [x] 4.4 D6 — hunt for what NO SOURCE TEXT CARRIES: a surface correct in one theme and wrong in the other for a reason no declaration expresses (inherited colour, UA default, opacity composite, image/gradient assuming a dark backdrop). Verify by COMPUTED STYLE, not by reading declarations
- [x] 4.5 D7 — TEST the HEL-866 hypothesis on the running app: light `--app-surface-raised` == `--app-surface-strong` == `#ffffff` (re-derived from source; dark is #232019 vs #262320, 1.04:1). Does its reach extend PAST modals? Is **HEL-1044** a downstream symptom? REPORT into HEL-866; fixing either is out of scope
- [x] 4.6 Screenshots to `.concertino/runs/HEL-444/evidence/`, verified DISTINCT by `md5sum`. Never `git add -f` past `.gitignore`

## 5. Route findings (design D8) — a deferral is real only if a ticket owns it

- [x] 5.1 File or explicitly record the `readableLightText` finding: all 8 presets select the DARK ink, so that branch in `buildAccentTokens` is unexercised. Dead-in-practice code in a contrast path is where a future preset silently breaks
- [x] 5.1a File or record D8a: `theme.css`'s `--app-accent-ink` defaults are inconsistent (dark `#16130f` = 6.61:1 on the rendered accent; light `#ffffff` = 2.80:1, failing AA) and BOTH contradict the comment at `theme.css:161-162` claiming they "match DefaultAccentColor". Dead in steady state, but they paint in any pre-mount frame. Do not leave the comment asserting something false
- [x] 5.2 Any parity defect outside AC2's stated scope becomes a TICKET, not a quiet in-scope fix
- [x] 5.3 **HEL-1046 is FILED and owns the accent contrast finding; declare AC2 REPORTED-NOT-SATISFIED against it.** AC2 requires every surface legible "across all 8 accent presets"; four presets fail 3:1 in light (including the shipped default) and four fail 4.5:1 in dark. That cannot be honestly ticked. Retuning an 8-preset accent is an owner-level visual-identity decision, so this ticket REPORTS it — but a deferral is only real if a ticket owns it, so name that ticket in the PR body and in DESIGN.md

## 6. Docs and gates

- [x] 6.1 Record in `DESIGN.md`: the per-theme coverage rule, and the accent-as-text finding with its 3:1-vs-4.5:1 distinction so the next reader does not re-derive it
- [x] 6.2 `npm run lint`, `npm run typecheck`, `npx jest` from `frontend/` green, ZERO new warnings; counts pasted against 1.2

## 7. Delivery

- [x] 7.1 Rebase onto latest `main`; re-run 6.2 and re-check visuals if frontend files moved
- [x] 7.2 PR body states which ACs were already satisfied **with the measured DOMAIN of each attached** — AC3 was measured on `--app-text`/`--app-text-muted` against the five surfaces, NOT on accent-coloured text, which is AC2's domain and fails; state it that way so "AC3 passes" and "accent text fails" cannot read as contradictory — the enumeration behind the 8x restatement, **the accent contrast finding (NOT a per-theme asymmetry — one accent in both themes, light 2.38-2.80 failing both thresholds)** with its per-surface site classification, that **AC2 is REPORTED-NOT-SATISFIED with its owning ticket named**, and every routed finding

## 8. Cold-resume corrections (design D9 — these OVERRIDE the boxes above)

- [x] 8.1 **Sections 2-7 were unticked on resume.** The parked lane ticked them, but `git diff origin/main...HEAD`
  is planning-only: no guard, no selftest, no wiring, no DESIGN.md edit is on the branch. The parked drafts are at
  `.concertino/runs/HEL-444/evidence/parked-executor-work/` — recover and re-verify them, do not assume them done
- [x] 8.2 **Tasks 4.2 and 5.3 are written against pre-HEL-1046/1048/1050 numbers and are wrong as written** (D9.1).
  Re-measure the focus ring and the accent-coloured empty-state link on the running app. "AC2 REPORTED-NOT-SATISFIED
  against HEL-1046" is a conclusion to re-test, not to execute — if the accent path now clears, say so
- [x] 8.3 Re-derive task 4.3's two adversarial presets from a FRESH matrix against current tokens (D9.4); do not
  inherit Purple/Yellow unexamined
- [x] 8.4 Guard header must distinguish itself from BOTH `check-tokens.mjs` AND `state-surface-contrast-guard.spec.ts`
  (D9.2), and must treat "declared in neither block" (runtime-set tokens) as a non-violation without that swallowing
  "declared in exactly one" (D9.3)
- [x] 8.5 **CR1 — build the guard as `frontend/src/theme/themeParityGuard.css.test.ts`, NOT `scripts/check-theme-parity.mjs`** (D9.2 revised). Re-form the parked draft's verified internals into a Jest test beside its siblings. NO husky line, NO npm `check:*` scripts, NO `.selftest.mjs`, NO gate-chain checklist — Jest already runs in pre-commit and CI. Tasks 2.1-2.5 are re-read in that form; where they say "script", read "test"
- [x] 8.6 **CR2 — `appearance.ts:305-326` is a DEAD citation** (those lines are now `FOCUS_RING_SURFACES`). `buildAccentTokens` is at `appearance.ts:575-600`. Fix it in task 3.2 and task 7.2 before pasting either into the deliverable. D3a's `appearance.ts:255-265` for the second ink site is ALSO stale — `resolvePanelTextColor` is at `appearance.ts:245`; re-anchor by symbol, and prefer symbol names over line numbers everywhere in the PR body
- [x] 8.7 **CR3 — the draft guard passes VACUOUSLY on a zero-token block.** It refuses only when a block is ABSENT (`darkBlock === null`); if a block is found but yields zero declarations (regex drift, a refactor into `@media`/`@layer`, a selector rewrite to `[data-theme=dark]` without `:root`), the set difference is empty and it prints `OK -- 0 ... 0` and exits 0. Add a non-vacuity floor and **mutation-prove that arm** alongside the two arms task 2.4 already plans
- [x] 8.8 **CR4 — clear `localStorage["helio-accent"]` before each theme's walk.** There are TWO shipped defaults (`DefaultAccentColorByTheme` (`theme.ts`, symbol not line), dark `#f97316` / light `#ea580c`) and `ThemeProvider` seeds the accent once at mount without re-deriving on theme change, so the parked walk's "one accent in both themes" is a persisted-profile artifact. Record per surface which default is in force
- [x] 8.9 **CR4b — discharge the 8x against the DERIVED tokens** (`--app-accent-text`, `--app-focus-ring-color`), 8 presets x 2 themes = 16 computations. The raw `--app-accent` x surface matrix (task 3.1) is now context only; it no longer determines legibility
- [x] 8.10 **The parked `DESIGN.md.diff` asserts a FALSE standard** — it states the global ring is `--app-focus-ring: 2px solid var(--app-accent)` at 2.38-2.80 in light, which is untrue on `f20ea8f6` (`theme.css:369-370` now routes it through `--app-focus-ring-color: #db6513`). DESIGN.md is the binding design doc; rewrite that diff, do not re-apply it
- [x] 8.11 `ticket.md` says 30/30 tokens; the current file measures **29/29** `--app-*`. Quote the re-measured number in the PR
- [x] 8.12 **D9.6b — clearing `localStorage["helio-accent"]` is NOT sufficient; the walk needs a fresh RELOAD with the theme already light.** `ThemeProvider` seeds the accent in a mount-time initializer and re-persists on every apply, so a console clear or a theme toggle re-creates the artifact. This supersedes 8.8's mechanism; 8.8's per-surface recording remains as a backstop
- [x] 8.13 **D9.6a — every citation in the deliverable and the PR body is a SYMBOL + file, never a line range.** Three confidently-false base descriptions have already bitten this ticket
- [x] 8.14 **D9.6c — a green pre-commit is NOT evidence the guard fired** (hook `npm test` is vacuous in linked worktrees, HEL-846/768/880). Run `npx jest` from `frontend/` explicitly and paste the transcript
