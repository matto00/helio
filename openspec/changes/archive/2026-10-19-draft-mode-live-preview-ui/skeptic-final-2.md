## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Reviewed HEAD `8a2d5ec1585629df181ef7a8a0531fae2f4aec67`. The base, resolved live with `resolve-review-base.sh`, is `538a867d718204775f7c0844450f683889e145e3`. The round-1 fix delta is `fdfeca1dd..8a2d5ec15`.

Evidence (durable): `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/sk2-*`

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned READY (branch `feature/live-draft-mode-ui/HEL-1631`).

**Owner rulings** (`.concertino/runs/HEL-1631/events.jsonl`):
- (a) is line 11, `block-during-draft-recommended`, `answer_source: human`.
- (b) is line 34, `accent-22-amend-design`, human. Line 33 is the 8 ms auto-discard that came before it.
- (c) is line 55, `amend-ac-fetch-on-view`, human. Line 54 is the 8 ms auto-discard that came before it.
- (d) has no event. I judged it on its merits, below.

**Gates I re-ran myself:**
- Typecheck: rc 0.
- Lint: rc 0.
- Jest over `features/pipelines|shared/ui|theme/` with `HELIO_JEST_MAX_WORKERS=2` under `nice -n 19`: 223 suites and 3480 tests passed (`sk2-jest.txt`).
- e2e `hel1631-draft-mode.spec.ts`, under the e2e.lock flock with `--trace retain-on-failure`: 10 of 10 passed, rc 0. Every test stayed at or below 23 `/api` requests per 60 s window, with 0 × 429 (`sk2-e2e.txt`).

**Round-1 CRs, checked in the running app** (7063/9970; log in `sk2-probes.txt`):

| CR | Live result |
|---|---|
| CR1 Back/Forward | **Fixed.** I opened the pipeline through an in-app link and drafted filter value 321. Back went to `/pipelines` with no dialog. Forward showed the chip, the value 321 and counts `14 → 5`. Choosing "Discard draft" in the leave dialog clears `helio.pipelineDraft.*`, and the draft does not come back on return (`sk2-leave-dialog.png`). |
| CR2 stale Undo | **Fixed.** One Undo button before the Undo, zero after it, then "Undone.". |
| CR3 deleted-Output preview | **Partly fixed.** Reproduced twice, on two different Outputs. After "Remove and save" there is still **one** `GET /api/pipelines/:id/preview?outputId=<removed> → 404` (there were two in round 1). The remaining request comes from the SSE `onTerminal` loop in `usePipelineRunStream.ts:56-58`, which still iterates the stale `allOutputsRef`. The jest test only covers `settleSaved`. The only effect is a console 404, so I list it as non-blocking. |
| CR4 phone add row | **Fixed.** At 375 with a draft: `disabled`, opacity 0.5, `not-allowed`, and the title "Save or discard your draft first". The draft slot reads "Draft · unsaved changes", and the pills are Discard / Save & run (`sk2-375-dark-draft.png`). |
| CR5 Discard | **Matches amended AC3 (ruling c).** The new e2e asserts exactly one GET, for the step's own preview, and it passed in my run. |

**(d) The kept draft: safety probe.** This is the reason for the REFUTE.
1. I drafted filter `duration_s >= 321` and pressed Back, so the draft was kept in sessionStorage.
2. A second writer (my API PATCH, standing in for another tab, an editor grantee, or the assistant/MCP apply) changed the same step to `[duration_s >= 260, status = success]`, and got a 200.
3. I pressed Forward. The page restored the draft over the new base. It showed only `duration_s ≥ 321`, gave no notice, and the only trace of the change was that the counts now read `11 → 5` (`sk2-restore-over-moved-base.png`).
4. I pressed Save & run. It returned 200 with no 409. A fresh GET of the steps shows `[duration_s >= 321]`, so the other writer's `status = success` condition was **silently overwritten**. Undo did bring it back, but nothing told the user there was anything to undo.

Why it happens:
- `usePipelineDraft.ts:105-112` restores with `rebaseOverlay(baseStepsRef.current, kept)` over the *current* saved steps.
- The kept copy records no base, so `definitionMatchesBase` in Save & run compares the new base with itself and passes by default.
- This bypasses the stale-base protection the owner ruled on (`reload-only`: "the draft is kept as a diff to re-apply. No overwrite button"), and it breaks the spec requirement that Save & run proceeds only "if the draft's base still matches it".
- During a live session the same race correctly gets the 409 and the reload notice. Only the restore path loses the base.
- The kept copy lasts for the tab's lifetime, including reloads, so the window is open-ended rather than a few milliseconds.

**AC trace** (code read plus the live run and e2e):
- AC1 (0 requests, < 50 ms): e2e tests 1–2.
- AC2 (transport, paced, no run): e2e test 4.
- AC3 (Discard, amended): the CR5 e2e plus the Discard e2e.
- AC4 (Save & run, one journal row, Undo): e2e test 3, plus my live save → Undo.
- AC5 (sample label): `SpineSourceCard`, seen live ("Static · 14 rows" and refresh).
- AC6 (request counts): the measured lines in `sk2-e2e.txt`.
- All of these are met. The one exception is the restore path, which breaks the stale-base requirement.

**Design (DESIGN.md).**
- Desktop 1280 dark: the leave dialog and cascade dialog use the shared modal. The chip is secondary with an accent dot, and accent appears only on Save & run and the selected step.
- Phone 375 dark: the draft slot and pills are correct.
- I did not re-run the light-theme sweep, because the round-1 light checks still apply and the delta touches no colour tokens (the only CSS change is the `:disabled` rule).

### Verdict: REFUTE

### Change Requests

1. **A restored (kept) draft silently overwrites changes saved in the meantime.** This is spec divergence from the stale-base requirement and owner ruling `reload-only`, and it loses data.
   - Location: `frontend/src/features/pipelines/hooks/usePipelineDraft.ts:43-56` and `:126-149`.
   - Store the base with the kept draft. That can be the saved definition fingerprint, or the saved `config`/`enabled` of each step the overlay touches.
   - On restore, if the loaded base differs from it, do not re-apply without a word. Take the same path a stale-base 409 takes: re-apply as a diff, with the existing "your saved pipeline changed / N of your edits no longer apply" notice. Alternatively keep the old base, so that Save & run returns 409 and offers reload-only.
   - The silent drop of edits for deleted steps on restore (design.md addendum, "dropped silently") should surface through the same notice.
   - Add a test (jest or e2e): keep a draft, change the same step through the API, return, and assert either a notice or a 409 on Save, never a silent overwrite.

### Non-blocking notes

- CR3 residual: `usePipelineRunStream.ts:56-58` (`onTerminal`) still requests every Output in the pre-save `allOutputsRef`, which gives one 404 per Output a save removes. Filter it against the saved definition, or skip the loop when `settleSaved` already refreshed.
- The kept draft survives a confirmed reload, and a logout/login in the same tab, because it is keyed only by pipeline id. A different user who opens a shared pipeline in that tab would inherit the previous user's draft. Clear `helio.pipelineDraft.*` on logout.
- Round-1 non-blocking notes 3–8 still stand: the "from an unknown step" Output label, the padding of the empty last-good frame, the repeated cascade hints, the dead `saveError` plumbing, the last-good frames resetting on a layout switch, and the run chip clearing before a refused save.
- The evaluator's hel1582 AC1 helper flake is pre-existing. I agree with treating it as non-blocking.
- Gate-defect check: no mtime-ordering evidence was relied on.

### Process disclosure

- My MCP-artifact cleanup used the glob `.playwright-mcp/{page,console}-2026-10-20T04-*`. That also deleted nine gitignored Playwright-MCP snapshot and console files from 04:04 and 04:46–04:47 that I did not create; they were probably the evaluator's.
- None of them is cited evidence: the evaluator's evidence is persisted under `.concertino/runs/HEL-1631/evidence/`.
- The files were:
  - `console-2026-10-20T04-04-55-964Z.log`
  - `console-…04-46-33-835Z.log`, `…04-46-40-150Z.log`, `…04-46-59-314Z.log`
  - `page-…04-46-34-697Z.yml`, `…04-46-40-960Z.yml`, `…04-46-41-414Z.yml`, `…04-47-00-158Z.yml`, `…04-47-44-793Z.yml`

### Cleanup

- Pipeline `331c7540-…` returned 204, then 404 on GET. Source `0e38c3f2-…` returned 204 and is no longer listed.
- The Outputs `afec37ec…` and `cb4cbd08…` were removed by the draft saves.
- I cleared the probe's sessionStorage keys.
- I stopped the servers through `stop-servers.sh`, which reported `STOPPED ports=7063,9970`.
