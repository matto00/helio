## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed commit: 599cfe65d43b9a1a6d2c407e8277d5ba76303ada (diff 08fdbfb8..599cfe65 is frontend-only plus openspec notes; no backend change, so `sbt test` was not re-run).

### Phase 1: Spec Review — PASS
Cycle 1's change request (primary button centering) is fixed. The oversize improvement (client-side 8 MiB check, 413 mapping, no Retry for size) fits the ticket's "oversized" failure state (see the assessment below). No scope creep.

### Phase 2: Code Review — PASS
Gates re-run fresh in WORKTREE_PATH: `npm run lint` 0, `npm run format:check` 0, `npm test` 394 suites / 4121 tests passed, `npm --prefix frontend run build` 0. No HEL-1215 / SOURCE_FETCH flake to record (backend not run). The CSS fix scopes `align-self: flex-start` to `.first-run-drop > .first-run-drop__button`, with a new CSS guard test. `CSV_UPLOAD_MAX_BYTES` is named and documented; `isPayloadTooLarge` clears `lastAttempt` so no Retry is shown.

### Phase 3: UI Review — PASS
Live on this worktree's servers (the PIDs' cwd were checked), fresh free account:
- Centering (drop-target center vs button center, measured by getBoundingClientRect): 1440 dark 840/840, 1440 light 840/840, 390 light 195/195, 390 dark 195/195. Screenshots: `.../scratchpad/shots1209/eval1209c2-dz-dark-1440.png`, `eval1209c2-dz-light-390.png`. "Set up step by step" remains left-aligned at the card edge, as intended. The URL-row button keeps its layout.
- Oversize: a 9 MiB file dropped shows "That file is over the 8 MB upload limit. Try a smaller CSV, or paste a link to it instead (links allow up to 50 MB)." as an alert, with no Retry and no network request (verified: only the later boundary probe reached `/api/data-sources/infer`).
- Regression: normal 120-row sales.csv drop still lands on `/dashboards/<id>` with 3 panels in about 0.5 s; free account shows no refine control.

### Assessment of the 8 MiB vs 50 MiB gap (executor's flag)
Acceptable for this ticket. Confirmed against cycle 1 evidence: Pekko's default `max-content-length` (8 MiB, no override in `application.conf`) bounds the multipart upload, while `CsvUrlFetch.maxFileSizeBytes` (50 MiB) bounds link ingestion. The ticket's oversized failure state is "handled gracefully with a visible, specific error". It now is: it is announced, names the real limit, offers the working alternative (a link up to 50 MiB), and does not offer a Retry that cannot succeed. The 50 MiB cap itself is unchanged and still enforced on the link path. Raising the upload ceiling is a backend limit change outside this ticket's scope.

### Overall: PASS

### Non-blocking Suggestions
- Boundary: a file whose size is within a few hundred bytes below 8 MiB (probe: exactly 8,388,608 bytes) passes the client check but the multipart envelope pushes the entity over Pekko's limit, so the infer route returns 500 and the user sees the generic "couldn't read that as a CSV" with a Retry. Tiny window; a small safety margin on `CSV_UPLOAD_MAX_BYTES` would close it.
- Follow-ups carried from cycle 1 (outside this ticket): HEL-1208 client telemetry batches are rejected (`userId` field on `/api/events` -> 400); the infer route returns 500 rather than 413; sidebar selection on `/dashboards/:id` leaves a stale URL id.

### Cleanup and residue
- Test user `5f6ba55e-e6cb-4891-a28c-58089bfea1f5` (eval1209d@example.test) and its source `b6201dba-0d8f-4a26-9b3c-9aadb3410db1`, dashboard, panels, pipeline and outputs were deleted by exact id; 0 `eval1209%` users remain.
- Residue: `~/.helio/uploads/csv/b6201dba-0d8f-4a26-9b3c-9aadb3410db1.csv` (plus the four cycle-1 files listed in evaluation-1.md) remain; deleting under `~` needs the user's "Approved".
- Servers I started were stopped by captured PID; ports 6641/9548 are free. The worktree and main checkout are otherwise unmodified.
