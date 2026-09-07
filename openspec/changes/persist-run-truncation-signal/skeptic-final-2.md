## Skeptic Report — final gate (round 2, skeptic-final-2.md)

Cold review of HEAD `b3301d02` (four commits). I read skeptic-final-1.md, evaluation-3.md and
files-modified.md as *claims*; every conclusion below is derived from the tree, the diff, gates I
re-ran myself, a live backend/frontend I stood up, or a screenshot I looked at.

### Environment — closed the same way round 1 did, and torn down the same way

The shared dev DB is still at V103 (`V103__pending_connectors.sql`, HEL-955), absent from this
branch, so Flyway will not boot the backend against it. I closed this **without touching the
shared database and without `flyway repair`**:

- `CREATE DATABASE helio_hel873b` (a *new* name; round 1's `helio_hel873` was verifiably gone).
- Pointed the worktree's gitignored `backend/.env` at it (backup taken first, md5
  `99592e628f5bdc6360dfb0827ffa8ced`), ran `start-servers.sh . 6305 9212 HEL-873` →
  `READY backend` / `READY frontend`; `assert-phase.sh servers` → **`PASS servers`**.
- Flyway applied cleanly on the fresh schema: top two rows `104|t`, `102|t` (V103 correctly
  absent — it is not this branch's), and `pipeline_runs.truncated_reads jsonb` /
  `pipelines.last_run_truncated boolean` exist.
- Teardown: killed the two owning PIDs (backend `9212`, vite `6305`) and confirmed both ports
  return `000`; restored `backend/.env` and **verified the restore by md5 equality** with the
  backup; `DROP DATABASE helio_hel873b WITH (FORCE)` and **verified the drop by query**
  (`select count(*) from pg_database where datname='helio_hel873b'` → `0`).
- Shared `helio` re-checked afterwards and is untouched: `max(installed_rank)` still `103`, and
  `information_schema.columns` still has **0** rows for `pipeline_runs.truncated_reads`.
  Worktree `git status --porcelain` is empty. Nothing HEL-955 or HEL-1003 depends on was mutated.

---

### 1. CR1 from round 1 — the badge/row-count collision — VERIFIED FIXED IN A REAL BROWSER

This was my primary job and I did not accept it on assertion. Live app, real data (a real 1500-row
CSV source, two real pipelines, real runs through the API), all three surfaces, both themes.

| Surface | Screenshot | Measured visual gap | Result |
|---|---|---|---|
| Pipeline list table | `skept873r2-list-light.png`, `skept873r2-list-dark.png` | **4px** | `1,000 rows ⚠ Partial` — collision gone |
| Run history modal | `skept873r2-history-light.png`, `skept873r2-history-dark.png` | **4px** | `1,000 rows ⚠ Partial` — collision gone |
| Detail-page footer | `skept873r2-detail-light.png` | **8px** | `Rows written: 1,000 ⚠ Partial` — no regression |

The gap was measured, not eyeballed: for each surface I took the preceding text node's
`Range.getBoundingClientRect().right` and subtracted it from the badge's
`getBoundingClientRect().left`. Computed `margin-left` is `4px` (`var(--space-1)`) as claimed.

The DOM now reads `td.textContent === "1,000 rows⚠ Partial"` (no space character at all) while the
*rendering* has a real 4px gap — which is the direct positive confirmation that the gap comes from
CSS margin and not from a text node that flex could swallow again.

**On the executor's jsdom reasoning:** correct, and the test it wrote is genuine evidence, not a
weaker substitute. `textContent` is unaffected by CSS layout in any engine, so no jsdom assertion
can observe whitespace *collapse*; it can only observe DOM *shape*. The test asserts exactly the
DOM shape that is the root cause. I **red-armed it myself** rather than trusting the claim: I
re-inserted `{" "}` inside the span, ran `npx jest --testPathPatterns=TruncatedRowCountBadge`, and
it failed at `expect(badge.textContent).toBe("⚠ Partial")`; I then restored the file and confirmed
the worktree is clean. That is a real red arm.

### 2. Nothing round 1 verified live has regressed

- **Reload round trip with empty Redux state** — cold browser navigation to
  `/pipelines/<id>` (a genuine full page load, not a client-side route change):
  `skept873r2-detail-light.png` shows both the recomposed truncation banner (full HEL-861 notice
  text, naming `big-csv-1500`, 1000-of-3303) and the footer `Rows written: 1,000 ⚠ Partial`.
  The notice is genuinely recomposed on read — it is not in the persisted column.
- **NULL-row (not-recorded) rendering** — a row I inserted with `truncated_reads = NULL` renders
  `900 rows` with **no** marker in the run-history modal, in both themes. Not-recorded is not
  rendered as complete.
- **Light/dark parity** — toggled via the real theme button. Badge is `rgb(153,98,30)` in light and
  amber in dark; legible on both surfaces in both themes.
- **Narrow breakpoint (390×844)** — `skept873r2-list-narrow.png`; measured `td.scrollWidth ==
  td.clientWidth == 147`, badge right edge inside the cell (`overflowsCell: false`), gap still 4px.
  No clipping, no wrap, no layout break.
- **Console** — on my port (6305) the only errors are pre-login `401 /api/auth/me` and
  `404 …/schedule` (no schedule set; both pre-existing). The `ShareDialogHost` /
  `shareDialogDashboard` / `useRef` ReferenceErrors in the shared Playwright log are from ports
  6022/6387/6405/6435 — **other worktrees**, not this change.

### 3. Gates re-run by me

- `sbt "testOnly *PipelineRunRepositorySpec *PipelineRepositorySpec *PipelineRunServiceSpec
  *PipelineRunRoutesSpec *OutputRoutesSpec"` → `Tests: succeeded 228, failed 0`, `EXIT=0`.
  I ran this despite no backend change, because I am cold and round 1's output is a claim to me.
- `npm run lint` → 0. `npm run typecheck` → 0. `prettier --check src/features/pipelines/**` → clean.
- `node scripts/check-schema-drift.mjs` → in sync (77 schemas / 49 protocol files).
- `npx jest` over `PipelineDetailPage|PipelineListTable|RunHistoryModal|TruncatedRowCountBadge|
  rawElementGuardHel440` → 6 suites, **149** tests, all pass.

**The "did not re-run `sbt test`, no backend Scala changed" claim is TRUE and I verified it
against the diff:** `git diff e237f322 HEAD --stat -- backend/` is empty (0 lines), and cycle 4's
`--name-only` contains zero `.scala` files. The backend tree is byte-identical to the one round 1
tested — and I re-ran the suite anyway.

### 4. Independent re-checks (cold)

- **Three-state model — no path collapses not-recorded into complete.** Audited every call site of
  `updateLastRun`/`updateLastRunInternal`/`updateRunTerminal`/`updateRunTerminalInternal`/
  `insertDryRun*`: every one passes an explicit non-null value (`EmptyTruncationJson` or a real
  payload); the parameters carry **no defaults**, so a forgotten site fails to compile. The only
  NULL-writing site is `insertRunInternal`'s *queued* row — non-terminal, no row count, so there is
  no number to qualify. Confirmed on the wire: legacy row returns **no `truncation` key at all**,
  complete run returns `{"reads": [], "truncated": false}`, truncated run returns the full record.
- **`parseTruncationRecord` totality — proved live, not just by reading.** The whole decode
  (`parseJson`, `asJsObject`, `fields(...)`, `convertTo`, the non-`JsArray` `reads` throw) is inside
  one `Try`; `Failure` logs and returns `None`. I inserted a row with
  `truncated_reads = '{"reads": "not-an-array"}'` and hit `GET /run-history`: **HTTP 200**, that
  row came back with no `truncation` key (degraded to not-recorded), and the other two rows were
  unaffected. Degrades to not-recorded, never to empty-and-complete, never fails the request.
- **Can the primary-scoped scalar carry a secondary's number?** No. `truncationFields`
  (PipelineRunService.scala:120-141) returns `primaryStats.availableRowCount` **directly** — it is
  never derived from `allReads` — and is threaded verbatim through `truncatedReadsToJson` and back.
  The `reads.headOption` inference the cycle-1 defect had is gone, not guarded.
- **The TS-type fix is honest, verified against the real wire.** A live complete run returns
  exactly `{"reads": [], "truncated": false}` — `primaryAvailableRowCount` and `notice` absent, not
  `null`. The now-optional fields and the corrected `RunHistoryModal` fixture match what the API
  actually emits.
- **Evidence-shaped non-evidence:** none found. The list/modal tests use two-item fixtures with
  `getAllByText(/Partial/)).toHaveLength(1)` — a real discriminator (an unconditional badge would
  give 2) — and the not-recorded arms assert *absence* with the field genuinely absent.
- **Hygiene:** zero forbidden files touched (`ApiRoutes.scala`, `Connector*`,
  `RestApiConnectorDriver`, `ConnectorRepository`, `helio-mcp/src/{types,helioApi}.ts`,
  `frontend/src/shared/chrome/**`, `DashboardList.css` — grep over `--name-only`: no hits).
  `V104__pipeline_run_truncation_signal.sql` is the **only** migration file in the diff; no applied
  migration edited; no DEFAULT, no backfill (NULL is the deliberate not-recorded state).
  `schemas/` and `openspec/` updated in the same change. Spec delta now names the
  failed-after-truncated-read case explicitly (spec.md:70-75).

### 5. Acceptance criteria — all five traced to evidence

1. *Partial after reload* — cold navigation, `skept873r2-detail-light.png`: banner + `⚠ Partial`. ✅
2. *Survives in the persisted record* — `pipeline_runs.truncated_reads` /
   `pipelines.last_run_truncated`, read back over HTTP after a fresh load. ✅
3. *No false positives, including historically* — "Complete Pipeline / 3 rows" unmarked; the
   `NULL` legacy row unmarked; live `GET /api/pipelines` shows `lastRunTruncated=false`. ✅
4. *Distinguishable wherever a persisted count is shown* — all three surfaces, both themes,
   desktop and narrow, with a measured gap. ✅
5. *Schemas/openspec in the same change* — present; drift check clean. ✅

### Verdict: CONFIRM

The one blocker from round 1 is fixed at the right layer (the shared component, not three call
sites), the fix is confirmed by measurement in a real browser on all three surfaces in both themes,
the regression test is red-armed by my own mutation, and nothing round 1 verified live has
regressed. Ships.

### Non-blocking notes

- **The footer's gap is 8px while the other two surfaces are 4px.** `.pipeline-detail-page__
  meta-bar-item` is itself `display: flex; gap: 4px`, so the badge's new `margin-left: 4px` stacks
  on top of the parent's flex gap. Not a defect — 8px reads fine and nothing collides — but the
  badge is now spaced inconsistently across its three surfaces, which the shared-component fix was
  partly meant to prevent. Trivially resolved later with `.pipeline-detail-page__meta-bar-item
  .truncated-row-count-badge { margin-left: 0 }` if the inconsistency ever matters.
- **The regression test guards the DOM shape, not the margin.** Deleting `margin-left` from
  `TruncatedRowCountBadge.css` reintroduces the exact collision with every test still green. This
  is unavoidable in jsdom (it does not do layout) and the executor was right not to fake it — just
  be aware the CSS line is load-bearing and unguarded, and that only a browser check catches its
  removal.
- **`margin-left` on the shared component encodes a call-site assumption** — that the badge always
  *follows* something. A future call site that leads a line with it will get an unwanted 4px
  indent. Fine for today's three consumers.
- Round 1's note about `check-schema-drift.mjs`'s unbalanced-paren regex still stands: the field
  ordering in `PipelineProtocol.scala` is load-bearing, and moving `truncation` after `assertions`
  would silently drop it from drift checking with no warning.
