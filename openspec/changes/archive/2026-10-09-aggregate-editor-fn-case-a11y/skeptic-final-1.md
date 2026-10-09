## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `c6ab309c7847183f45310d6cec427a018d95b636`. Base resolved live via `resolve-review-base.sh`: `e7470bc620557e3c0f27db637d7fb28811cb516c`. Spawn-cwd guard: `READY`.

### What I verified (with evidence)

**Red-first, reproduced by me (not taken from red-*.txt)**
- Frontend: I extracted the base tree (`git archive e7470bc6 frontend`) into the scratchpad, dropped in HEAD's `StepSchemaDiffChips.test.tsx` and `AggregateConfig.test.tsx`, and ran jest against the base sources. Result: 12 failed / 33 passed. The 5 new HEL-1407 tests fail for real reasons, not name mismatches:
  - Stored `SUM`: hint `""` vs the sum hint.
  - Stored `PERCENTILE`: hint `""` vs the percentile hint.
  - a11y label test: `input.labels` length 0, i.e. no real `<label>` (C1).
  - Error-link test: `aria-invalid` is null.
  - Per-row test: `labels?.[0]` is undefined.
  - Duplicate-key test (item 4): React logs "Encountered two children with the same key" for `added-`.
  - The other 6 failures are pre-existing p-input tests whose accessible-name regex changed from `percentile p 1` to `percentile p (row 1)`. That is expected and is not evidence.
- Backend: I ran `sbt -batch "testOnly ...PipelineAnalyzeServiceSpec"` on an archived base tree carrying HEAD's spec. Result: 131 passed, 3 FAILED, including the parity test `fn=min declared=integer: Some("integer") was not equal to Some("float")`. So the HEL-1310 parity pattern fails on the old behavior, as AC item 3 requires. On HEAD: 134 passed, 0 failed.
- Green at HEAD in the worktree:
  - The two jest suites: 45/45.
  - `tsc --noEmit`: clean.
  - eslint `--max-warnings 0` on the 4 changed TS files: clean.
  - I relied on the evaluator's pasted full-suite results (frontend 5072/5072, sbt testFull 6425/0). The backend tree is byte-identical between ad112326 and HEAD (`git diff --quiet` confirmed).

**AC trace**
- Item 1 is met by `AggregateConfig.tsx` `fnKey = agg.fn.toLowerCase()`, which drives the Select value, the hint lookup and the `percentile` gate. The stored value is left as-is; the backend lowercases it.
  - Live check: I created a pipeline with stored `PERCENTILE`/`SUM`/`max`. The editor shows all three hints, the pickers read `percentile`/`sum`/`max`, and the p input shows 90.
- Item 2 is met by the shared `FormField` (real `<label htmlFor>`, label text "Percentile p (row N)") with `errorId`. The `TextField` gets `aria-invalid`/`aria-describedby` only while an error shows. One `useId` per component, suffixed per row (C1 honored).
  - Live, at p=150: `aria-invalid="true"`, `aria-describedby="_r_7_-p-err-0"` resolving to the `role="alert"` error text. At p=95 both attributes are removed and there is no error node. The label persists while a value is present.
- Item 3 is met by the new `aggregateResultType` (min/max → `float`), used only at the `inferAggregate` call site (`PipelineAnalyzeService.scala:637`). `groupby` still calls `aggResultType` (`:1178`), whose min/max case is unchanged (declared type). This matches `AggregateStep.apply:149-155`, which computes min/max over `PipelineRowJson.toDouble` and so always returns a Double or null.
- Item 4 is met by index-qualified keys in all four categories of `StepSchemaDiffChips.tsx` (C2 honored).

**UI / design judgment (running app)**
- The servers serve this worktree:
  - The `:9746` and `:6839` listener PIDs have cwd under this worktree's `backend/` and `frontend/`.
  - Vite serves the `fnKey` and `aggregate-p-field` code.
  - `assert-phase.sh servers` passed.
  - The backend predates the last commit, but the backend tree is unchanged since ad112326.
- Visual results:
  - The p field uses the shared `FormField` (no reinvented one-off).
  - The CSS adds one layout-only rule (`flex: 1 1 100%`) with no literals.
  - The p input matches the alias input exactly: width 766 and left 457 at 1440px, width 309 at 375px. The width is stable across the error toggle, and there is no document overflow at 375.
  - The error uses `--app-error`: `#f17b67` in dark, `#af3325` in light, settled after the 160ms border transition. It is the same color and size (`--text-xs`) as the row's existing `InlineError`, so it is consistent within the row.
  - The label uses `--app-text-muted` with medium weight.
  - Light and dark are in parity.
  - The only console entry is the known 404 on `/schedule` for an unscheduled pipeline.
- Screenshots, persisted:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/skeptic-final-agg-theme1-valid.png` (dark, valid)
  - `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/skeptic-final-agg-dark-error.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/skeptic-final-agg-light-error.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1407/evidence/skeptic-final-agg-light-375.png`
- No claim here rests on mtime ordering. I did not accept any mtime-ordering claim from the evaluator.

### Verdict: CONFIRM

### Non-blocking notes
- The hint line and the "Percentile p (row 1)" label stack 4px apart and are both muted `--text-xs`. The label's medium weight is the only thing telling them apart, so at a glance the label reads a little like a second hint line. This is acceptable, but a slightly larger gap or a hint placed after the p field would separate them.
- The live analyze probe could not tell old from new behavior: a `dataset` source declared `integer` surfaced as `float` in `sourceSchema`. The red/green unit runs above are the load-bearing evidence for item 3.
- Dev-DB residue from this gate (throwaway, not matt@helio.dev):
  - user `f7d41e24-69b1-4b35-8166-b97eacf6840c` (`hel1407-skeptic-1791539291744@example.test`)
  - source `e5c8bff7-fca4-4c38-92c8-68f83a083b47`
  - pipeline `7877b6d5-a8bc-4153-ad37-01c41b0d548f` (its p was set to 95 via the editor)
- The Playwright MCP wrote its accessibility snapshot and console logs to `/home/matt/Development/helio/.playwright-mcp/` (the main checkout, i.e. the MCP workspace root). I cannot redirect that from this role. The screenshots were written into the worktree, persisted, verified by `cmp`, and then removed from the worktree.
