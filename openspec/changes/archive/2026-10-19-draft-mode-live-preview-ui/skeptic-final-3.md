## Skeptic Report — final gate (round 3, skeptic-final-3.md)

Reviewed HEAD `4c2b360756b9b1a45a3b2f1a3a8c9bd1bf9a8504`. The base, resolved live with `resolve-review-base.sh` (main/origin), is `538a867d718204775f7c0844450f683889e145e3`. The fix delta under review is `8a2d5ec15..4c2b36075`, a single commit.

Durable evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1631/evidence/.concertino/scratch/HEL-1631/sk3-*`

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=feature/live-draft-mode-ui/HEL-1631`.

**Owner rulings.** Each of these is an `escalation.answered` event in `.concertino/runs/HEL-1631/events.jsonl` with `answer_source: human`:

| Line | Ruling |
|---|---|
| 11 | `block-during-draft-recommended` |
| 34 | `accent-22-amend-design` |
| 55 | `amend-ac-fetch-on-view` |
| 71 | `extend-final-gate` (escalation HEL-1631-1792472668290-cfc8ae) |

The chat-relayed "draft kept per tab" claim has no event. I judged it on its merits:
- It is now written into the spec requirement "Step edits form a client-only draft".
- With a base check in place it is safe, as the probes below show.

**Delta code read:**
- `state/keptDraft.ts` stores `{overlay, base}`, where `base` is `baseSignature(saved steps)`.
- `usePipelineDraft.ts` restores the overlay and, on a signature mismatch, sets `staleRestored` and `keptBaseRef`.
- The write effect keeps the *old* base while stale. So leaving again, or reloading the page, cannot launder the base.
- `usePipelineDraftSave.post()` returns before any request while `staleRestoredRef` is set.
- `rebase` (Reload) and `discard` clear the flag.
- Logout calls `clearKeptDrafts()`, which removes only `helio.pipelineDraft.*` keys.

I checked for a cached-steps race on return: `ready` waits for a steps fetch issued this mount (`stepsFetchedThisMount`, `usePipelineEditorState.ts:53-58`). So the restore compares against fresh steps, never the pre-leave Redux cache.

`PipelineDetailPage.tsx:33` keys the content by `id`, so the stale flag cannot leak to another pipeline.

**The round-2 blocker, reproduced live** (7063/9970; log in `sk3-probes.txt`):

- **P1, same-step repro of skeptic-final-2:**
  1. I drafted filter `duration_s >= 321`. The kept entry carried `base`.
  2. Back. An external PATCH changed the same step to `[>=260, status=success]` (200).
  3. Forward. The draft chip shows, with the alert "This pipeline changed since you started editing. / Reload the saved pipeline" (`sk3-restore-stale-notice.png`).
  4. I pressed Save & run. **Zero `/api` requests** were sent: no definition read, no `/draft/save`.
  5. A fresh GET of the steps still has `[>=260, status=success]`. **The external change is preserved, so the blocker is fixed.**
- **P3, second same-step repro (light theme, different change):** gave the same stale notice (`sk3-1280-light-restore-stale.png`).
- **P4, phone at 375:** shows the same notice, and Save & run sends 0 requests (`sk3-375-light-restore-stale.png`).
- **P2, the Reload path:**
  1. Draft filter 300, Back, PATCH the *sort* step, Forward. The stale notice shows.
  2. I pressed "Reload the saved pipeline". The notice cleared and the draft stayed.
  3. Save & run sent the definition read and then exactly **one** `POST /draft/save`.
  4. The result has the filter edit and the external sort change. This matches the reload-only ruling.
- **P5, Discard while stale:** clears the chip and the kept key.

**Gates I re-ran myself:**

| Gate | Result | Evidence |
|---|---|---|
| typecheck | rc 0 | `sk3-typecheck.txt` |
| lint | rc 0 | `sk3-lint.txt` |
| format:check | rc 0 | `sk3-format.txt` |
| Jest over `features/pipelines\|features/auth\|shared/ui\|shared/chrome\|theme/\|rawElementGuard` (`HELIO_JEST_MAX_WORKERS=2`, `nice -n 19`) | 259 suites, 3888 tests passed, rc 0 | `sk3-jest.txt` |
| e2e `hel1631-draft-mode.spec.ts` + `hel1579-pipeline-spine-layout.spec.ts` (e2e.lock flock, `--trace retain-on-failure`, `DEV_PORT=7063`) | 25 passed, EXIT 0 | `sk3-e2e.txt` |

The e2e run's measurements:
- Every test stayed at or below 63 `/api` requests per 60 s window, with 0 × 429.
- The server-only test sent 6 draft-preview requests in 4226 ms, within its bound of 10.
- The hel1579 accent audit still passes in both themes.

The new jest tests exercise the real paths:
- The stale-restore test asserts that `saveMock` and `readDefinitionMock` are not called, and that Reload clears the notice.
- The logout test dispatches the real thunk.

The evaluator's red-first files (`final2-*-red.txt`) are self-authenticating test output. No mtime ordering was relied on.

**AC trace:**

| AC | Evidence |
|---|---|
| AC1 (zero requests, < 50 ms) | The burst e2e passed. |
| AC2 (transport, paced, never a run) | The server-only e2e passed: 6/4226 ms, no run request. |
| AC3 (Discard, amended per `amend-ac-fetch-on-view`) | The Discard e2e passed, and Discard cleared the state live (P5). |
| AC4 (one save, run, one journal row, Undo) | The Save & run e2e passed; live P2 sent one `/draft/save`. |
| AC5 (sample label and age) | The source card shows "Static · 14 rows" with refresh. The non-static case is in the evaluator's `eval-1280-rest-sample-label.png` and `eval-375-rest-sample-label.png`, which the round-1 and round-2 skeptics also accepted. |
| AC6 (request counts) | The measured window lines in `sk3-e2e.txt`. |

The spec's stale-base requirement now holds on the restore path, which was the only divergence in round 2.

**Outputs-only change while away.** I checked the evaluator's argument in the code:
- `post()` builds `outputs` from the freshly read `definition.outputs` (`usePipelineDraftSave.ts`, `toDraftOutputs(definition.outputs, …)`).
- The overlay carries no Output state.
- A removal still needs the server's cascade confirmation.
- I agree: no silent loss.

**Design (DESIGN.md):**
- I looked at 1280 dark (in-session stale and after save), 1280 light (restore-stale) and 375 light.
- The accent appears only on Save & run (or Run pipeline), the selected step badge and the focused input. The draft chip is secondary with the accent dot. The notice uses the shared warning tint, and light and dark match.
- Console errors are only the pre-existing `/schedule` 404 for a pipeline with no schedule.

### Verdict: CONFIRM

### Non-blocking notes (follow-ups)

1. **Empty band under any draft notice on desktop.** `PipelineSpineLayout.css:5` sets `grid-template-rows: auto auto minmax(0, 1fr)` for three children. The draft notice is a fourth grid child, so the empty `.spine-strip-slot` gets the `1fr` row.
   - At 1280×800 the computed rows are `44px 54px 116px 538px`, which leaves a ~116 px empty band between the notice and the spine and editor, in both themes (`sk3-restore-stale-notice.png`, `sk3-1280-light-restore-stale.png`).
   - It is functional: at 560 tall the band collapses to 0 and the inner scrollers work, so nothing is clipped.
   - It only appears while a notice shows.
   - Fix: give the notice a grid row, for example `auto auto auto minmax(0,1fr)`, or render it inside the strip slot.
2. Reload re-applies whole-step configs. A same-step conflict therefore resolves to the user's version after an explicit Reload, and the user is not told which step conflicted. This matches the spec and the `reload-only` ruling, but a per-step "changed elsewhere" hint would help.
3. Kept drafts are cleared on explicit logout, but not on the 401 `clearAuth` path (session expiry). The next user in that tab who can open the same pipeline would get the previous draft. With the base check this is not a silent overwrite, but it should also be cleared there.
4. On phone at 375, the floating "Draft · unsaved changes" slot overlaps the Output card's kebab until the list is scrolled.
5. Carry-overs that still stand:
   - The CR3 SSE `onTerminal` 404 residual.
   - The round-1 notes 3–8.
   - The `hel1582Phone.ts` Output-count race.
   - A design.md line explaining why Outputs are not part of the base signature.

### Process / cleanup

- Created and deleted by exact id:
  - Pipeline `ecb4c50e-…`: DELETE 204, then GET 404.
  - Source `4cb87a81-…`: DELETE 204, no longer listed.
  - User `10dd80f6-ebe0-4d9b-aa42-8791034d91f5`: deleted through the harness's own `buildUserDeleteSql`, count after 0.
- Browser state: I removed the sessionStorage key and reset `helio-theme` to `dark`.
- I removed my 16 `.playwright-mcp` files by exact name; the list is in `sk3-created-ids.txt`. No glob was used.
- `stop-servers.sh` printed `STOPPED ports=7063,9970`.
- Gate-defect check: no mtime-ordering evidence was accepted.
