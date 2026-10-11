## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `f0927874af1a9fc4e58e25701db4fa196929d2ab`. Diff base resolved live: `02dc11abdc28577c8071a61d1e7295eacbdfee1c` (origin/main).
Evidence dir: `/home/matt/Development/helio/.concertino/runs/HEL-1493/evidence/` (abbreviated `EV/` below).

### Phase 1: Spec Review — PASS
Issues: none blocking.

- Ticket ACs. The owner decision is recorded in workflow-state.md `OWNER_DECISIONS` (Q1 B, Q2 legacy rows keep the source, Q3 wire field and toast) and in proposal.md. Option B is implemented with red-first tests. Prod orphan cleanup is left out, as HEL-1495 requires.
- Every task in tasks.md (1.1 to 4.9) is checked and matches the diff. No scope creep. The one change outside the plan's file list is `toast.css` `white-space: pre-line`, and C4 requires it.
- Contracts updated together: the backend protocol (`jsonFormat5`, with the new format declared first), `schemas/patch-sets/patch-set-undo-response.schema.json` (new `$defs`, `additionalProperties: false`, `minItems: 1`), the frontend type, and the `helio-mcp` type. `npm --prefix helio-mcp run build` exits 0.
- Standing constraints:
  - **C1 (red first)**: honored, and I reproduced it independently. See Phase 2.
  - **C2**: new DB-backed specs start Postgres through `PatchSetInlineSourceFixture.beforeAll` → `VerifiedEmbeddedPostgres.start(...)`. `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0` appears in my testFull log.
  - **C3**:
    - `sourceId` roots are never journaled (`InlineRootPairing` filters on `` `type`.isDefined ``).
    - A count mismatch journals `None`, so undo keeps today's behaviour.
    - A legacy row (`inlineSources` absent) reads as `None`, and `restorePipelineCreateUndo` then returns the unchanged `restored` outcome.
    - Tests 4.3 and 4.5 pin this, and the live UI run confirmed it.
  - **C4**: closed by me in the running app, both themes. See Phase 3.
  - **C5**: `PatchSetApplyService.journaledInlineSources` leaves out unpaired inline roots and logs a warning. The `InlineRootPairing` spec covers the `unpaired` count.

### Phase 2: Code Review — PASS
Issues: none blocking (minor items under Non-blocking Suggestions).

**Gates (my own fresh runs in WORKTREE_PATH at f0927874a):**

| Gate | Result |
| --- | --- |
| `npm run lint` | clean, zero warnings |
| `npm run format:check` | "All matched files use Prettier code style!" |
| `npm test` | 535 suites / 5805 tests passed, exit 0 |
| `npm --prefix frontend run build` | exit 0 |
| `cd backend && nice -n 19 sbt -J-Xmx3g testFull` | exit 0; `[hel1468-guard] ScalaTest summary: failed=0 aborted=0 unreadable=0`; `Tests: succeeded 6984, failed 0, canceled 4`. Log: `EV/eval1-sbt-testFull.log`. All 6 `PatchSetUndoInlineSourceSpec` tests, the 3 wire tests, and every `PatchSetUndoInlineSourceCleanupSpec` test are listed as passing. The existing `PipelineCreateInlineSourceCleanupSpec` (rollback / single-call cleanup) also passes. |
| `npm run check:scala-quality` | clean. No inline FQNs. I also grepped every added diff line for an inline `com.helio.` / `spray.json.` / `java.util.` / `org.apache.` qualifier outside `import` / `package`: zero hits. |

**Red evidence, verified independently, not taken from the report.**
- I created a throwaway detached worktree at the base SHA `02dc11abd`, added only the committed `PatchSetInlineSourceFixture.scala` and `PatchSetUndoInlineSourceSpec.scala` from f0927874a, and ran `testOnly ...PatchSetUndoInlineSourceSpec`. The worktree was removed afterwards and `git worktree list` is clean.
- Result: 4 tests FAIL by runtime assertion on base:
  - `1 was not equal to 0` (:23)
  - `Vector() was not equal to Vector("kept")` (:39)
  - `1 was not equal to 0` (:52)
  - `5 was not equal to 4` (:62)
- The 2 tests labelled `(guard: green before the fix)` pass on base. `[hel1468-guard] ScalaTest summary: failed=4`. Log: `EV/eval1-red-on-base.log`.
- So the runtime red is real. The guards are labelled as guards in their test names and in red-evidence.md.
- The compile-time red claims are labelled honestly as compile-red:
  - `PatchSetUndoInlineSourceCleanupSpec` and `PatchSetUndoInlineSourceWireSpec` reference `InlineRootPairing`, `deleteIfUnreferenced`, `InlineSourceUndoOutcome` and `JournaledEdit.inlineSources`, none of which exist on base.
  - On the frontend, `patchSetsSlice.test.ts` and `undoToast.test.ts` are compile-red, and `PatchSetReviewPage.test.tsx` is labelled as runtime red.
- One disclosure gap (non-blocking, see below): red-evidence.md cites lines `:169/:185/:198/:208`, but the committed spec is 94 lines. The red run predates the fixture extraction (a constant offset of 146 lines). My run reproduces the same four failures and messages against the committed files.

**Rollback unchanged.** `PatchSetApplyRollback.deleteInlineRootSources` now calls `InlineRootPairing.pair`. The branch order is the same as before:
1. No inline roots → `rolledBack`.
2. Count mismatch → warn + `unrecoverable`.
3. Null cleanup → `logFailure` + `unrecoverable`.
4. Missing-id warn → fold over `deleteCallCreated`, and `ok && missing == 0` → `rolledBack`, else `unrecoverable`.

The log strings and outcome strings are identical. The pairing code is a verbatim move, and `deleteCallCreated` is untouched. The existing rollback / create-cleanup specs pass in testFull.

**Legacy journal row parses.** `JournaledEdit.inlineSources: Option[...] = None` with `jsonFormat8`. spray-json reads an absent `Option` field as `None`. The spec feeds a literal pre-change row (no `priorState` / `rawResultingConfig` / `inlineSources`) through `journaledEditFormat.read`, persists it, and undoes it. Result: the source survives, the pipeline is deleted, and `inlineSources` is absent from the wire. The format is declared before use, as the comment says.

**Kept reason leaks nothing hidden.**
- `KeptReferenced` carries `DataSourceService.referenceConflict(...).reason`. That text is built from `SourceReferences`, which by construction holds names and ids only of referencers the caller can see. Hidden ones appear only as counts (HEL-1252, `DataSourceService.scala:685-707`).
- `Failed` and the no-helper case map to the fixed constants `ReasonFailed` and `ReasonUnavailable` (`PatchSetUndoInlineSources.scala:258,261`).
- Exception messages reach only `log.warn`, never the wire.
- The race-path P0001 conflict passes one hidden pipeline, so it stays non-leaky as well.
- In my live run the toast showed only the caller's own visible holder pipeline names and ids.

**Other checks:**
- **DRY**: pairing is extracted, not duplicated.
- **Modular**: new units are small (47 / 58 / 27 lines).
- **Error handling**: `deleteIfUnreferenced` and `PatchSetUndoInlineSources.removeOne` both recover to `Failed` / `kept` and never throw.
- **Edit status**: stays `restored` whatever the per-source results.
- **Pipeline-delete failure path**: unchanged (`case left => left`).
- **Type safety**: no `any`. The `OutcomeLike.inlineSources` structural type is minimal but typed.
- **DESIGN.md [mechanical] rules**: no new colours or spacing literals. The toast uses the existing `warning` variant (`--app-warning` intent token) and the shared `Toast` component.

### Phase 3: UI Review — PASS
Issues: none blocking.

Servers came from `scripts/concertino/start-servers.sh` and `assert-phase.sh servers` printed PASS. Both listeners on 9832 and 6925 had their cwd in this worktree and were freshly started (12:46:49 / 12:46:52), so this was not a reused stale server.

**How the toast was produced.** It is the real production path end to end, with no mocks:
- A throwaway user was registered through `POST /api/auth/register`: id `9d9e7134-9742-401b-8db2-649f7ae5d4de`, `hel1493-eval-1791748034849@example.test`, recorded up front in `EV/eval1-throwaway-user.json`.
- A patch set of two `pipeline` `create` edits, each with one inline `dataset` root, was handed to `/patch-sets/review` through `location.state.patchSet`. This is the route's documented producer input. I used `history.pushState` + `popstate` because no UI producer exists yet.
- The real Preview ran, then the real "Accept & apply" button.
- After the apply, one extra pipeline per created source was made through `POST /api/pipelines`, rooted on that source. This is the "referenced since the apply" case.
- Clicking the real "Undo" action on the "Applied." toast called the real `POST /api/patch-sets/:id/undo` (200). The page's `undoSuccessToast` produced the toast.

**C4: CLOSED.**
- **Dark, 1440×900**: `EV/eval1-undo-kept-toast-dark.png`. A `toast toast--warning` shows "Undone." followed by one line per kept source.
  - `Kept data source "HEL1493 Sales inline": This source is still referenced by pipeline(s) 'Holder of HEL1493 Sales inline' (...; as root). Remove each reference first (...)`
  - The same for "HEL1493 Costs inline".
  - Computed style on `.toast__message`: `white-space: pre-line`. Text `rgb(242,239,233)` on `rgb(38,35,32)`.
- **Light, 1440×900, on /sources**: `EV/eval1-undo-kept-toast-light.png`. Same structure for "Revenue" and "Churn". Each "Kept data source" entry starts on its own line in both themes.
- **Light, 390×844 (mobile)**: `EV/eval1-undo-kept-toast-light-390.png`. Two kept lines, no layout breakage, and the toast clears the bottom nav.
- **Readable**: warning variant, 12 s duration (`KEPT_TOAST_DURATION_MS`), and a dismiss button.
- These screenshots were saved directly into the durable evidence dir at capture time, so no relocation happened. The claims rest on the image content and computed-style reads, not on mtimes.

**Happy path / removal.**
- In the light run, a third edit's inline source was left unreferenced. After Undo:
  - The DB had no row for it. The final pre-cleanup count was 6 sources: the 6 referenced ones kept, the unreferenced one removed.
  - The created pipelines were gone.
  - The UI issued `GET /api/data-sources` right after the undo (network #1353 undo → #1354 data-sources), so `fetchSources()` was dispatched. The `/sources` table re-rendered with the newly listed sources and without "HEL1493 Unreferenced inline".
- No console errors or warnings during the tested flows on :6925. The only errors were the pre-login `401 /api/auth/me` and my own first register attempt without the CSRF header, before the flow started. Entries from :6740 belong to another lane sharing the browser.

**Cleanup.**
- The throwaway user was deleted by exact id and email through `e2e/support/userCleanupCore.buildUserDeleteSql` + `db.cjs psql`.
  - Before: users 1, data_sources 6, pipelines 6, patch_set_applications 3.
  - After: `0|0|0|0`.
- The servers I started were stopped by exact pid (sbt wrapper, launcher, JVM; npm and vite). Ports 9832/6925 are no longer listening.

### Overall: PASS

### Change Requests
(none)

### Non-blocking Suggestions
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetInlineSourceFixture.scala:6`: `StaticDataSourceRequest` is imported but unused. Drop it from the import.
- `backend/src/test/scala/com/helio/services/patchsets/PatchSetUndoInlineSourceWireSpec.scala:34`: the test name says "an unknown result value or an unknown field", but only the unknown `result` value is exercised. Add an extra-property case, or rename the test.
- red-evidence.md: add a note that the backend red run predates the fixture extraction, so its line numbers (`:169/:185/:198/:208`) map to `:23/:39/:52/:62` in the committed spec. The failures are otherwise exactly reproducible (see `EV/eval1-red-on-base.log`).
- Gap observed live, not a regression (main did no source refresh on undo at all): after an undo whose pipelines referenced a now-kept source, the `/sources` "Used by" column stays stale. It showed "2 pipelines" when the server reports 1, because `GET /api/data-sources/references` is not refetched with `fetchSources()`. Consider refetching references in the same branch, or a follow-up ticket.
- For the skeptic (judgment, not mechanical): each kept line repeats the full 409 remediation sentence, including raw pipeline UUIDs. Two kept sources fill about 13 wrapped lines at 248 px. It is readable within 12 s, but dense.
- `toast.css` `white-space: pre-line` applies to every toast. A server error message that contains `\n` will now break lines where it used to collapse. This is probably an improvement, but it is a global change.
